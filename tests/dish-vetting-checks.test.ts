import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Mission 7 — hardened vetting: the FREE pre-Claude checks + the mapping ────
//   1.2 anti-pub regex · 1.7 quality bounds · 1.6a internal duplicate ·
//   verdict→status mapping preserved (pass→approved · flag→pending ·
//   reject→rejected ; technical fallback = flag → pending, NEVER auto-approve).

const { db } = vi.hoisted(() => ({
  db: { creatorDish: { findMany: vi.fn() } },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { vetMock } = vi.hoisted(() => ({ vetMock: vi.fn() }))
vi.mock('@/lib/creator-vetting', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/creator-vetting')>()
  return { ...real, vetDish: vetMock }
})

import {
  detectAdvertising, checkQualityMin, normalizeName, isDuplicateOf,
  runDishVetting, DISH_PRICE_MIN_EUR, DISH_PRICE_MAX_EUR,
} from '@/lib/dish-submit'

const CLEAN = {
  name: 'Gnocchi truffe de Nonna', description: 'Gnocchi maison à la crème de truffe noire, recette du dimanche.',
  ingredients: ['gnocchi', 'truffe', 'crème'], cuisineType: 'italien', suggestedPrice: 14.5,
}

beforeEach(() => {
  vi.clearAllMocks()
  db.creatorDish.findMany.mockResolvedValue([])
  vetMock.mockResolvedValue({ verdict: 'pass', signatureScore: 72 })
})

describe('1.2 detectAdvertising — free regex net', () => {
  it('catches external links, www, bare domains', () => {
    expect(detectAdvertising(['voir https://monsite.fr/promo'])).toContain('lien externe')
    expect(detectAdvertising(['www.chez-marco.com'])).toContain('lien externe')
    expect(detectAdvertising(['retrouvez-moi sur chezmarco.shop'])).toContain('lien externe')
  })

  it('catches FR phone numbers, promo codes, visit/subscribe CTAs', () => {
    expect(detectAdvertising(['commandez au 06 12 34 56 78'])).toContain('téléphone')
    expect(detectAdvertising(['avec le code promo MARCO10'])).toContain('code promo')
    expect(detectAdvertising(['visitez mon site pour la suite'])).toContain('visiter')
    expect(detectAdvertising(['abonnez-vous à ma chaîne'])).toContain('abonner')
  })

  it('clean recipe text → null', () => {
    expect(detectAdvertising([CLEAN.name, CLEAN.description, ...CLEAN.ingredients])).toBeNull()
    expect(detectAdvertising([])).toBeNull()
    expect(detectAdvertising([undefined])).toBeNull()
  })
})

describe('1.7 checkQualityMin — free bounds', () => {
  it('short description / too few ingredients / price out of bounds → precise detail', () => {
    expect(checkQualityMin({ ...CLEAN, description: 'aaa' })).toContain('description trop courte')
    expect(checkQualityMin({ ...CLEAN, ingredients: ['sel'] })).toContain('minimum 2')
    expect(checkQualityMin({ ...CLEAN, suggestedPrice: DISH_PRICE_MIN_EUR - 1 })).toContain('hors bornes')
    expect(checkQualityMin({ ...CLEAN, suggestedPrice: DISH_PRICE_MAX_EUR + 1 })).toContain('hors bornes')
  })

  it('a decent recipe passes', () => {
    expect(checkQualityMin(CLEAN)).toBeNull()
  })
})

describe('1.6a internal duplicate — heuristic', () => {
  it('same normalized name (accents/case/punctuation) → duplicate', () => {
    expect(normalizeName('Gnocchi  Truffé!')).toBe(normalizeName('gnocchi truffe'))
    expect(isDuplicateOf(
      { name: 'Gnocchi Truffé', ingredients: ['gnocchi'] },
      { name: 'gnocchi truffe', ingredients: ['autre chose'] },
    )).toBe(true)
  })

  it('strong name+ingredients similarity → duplicate; loose overlap → not', () => {
    expect(isDuplicateOf(
      { name: 'Burger maison du chef', ingredients: ['pain brioché', 'steak', 'cheddar', 'oignon'] },
      { name: 'Burger maison du sud',  ingredients: ['pain brioché', 'steak', 'cheddar', 'tomate'] },
    )).toBe(true)
    expect(isDuplicateOf(
      { name: 'Burger truffe', ingredients: ['pain', 'steak', 'truffe'] },
      { name: 'Salade truffe', ingredients: ['salade', 'truffe', 'parmesan'] },
    )).toBe(false)
  })
})

describe('runDishVetting — pipeline order + mapping (1.8)', () => {
  it('advertising rejects BEFORE any Claude call', async () => {
    const out = await runDishVetting({ ...CLEAN, description: 'Super plat — commandez sur www.chezmoi.fr, description assez longue.' })
    expect(out.status).toBe('rejected')
    expect(out.reasonCode).toBe('advertising')
    expect(vetMock).not.toHaveBeenCalled()
  })

  it('quality bounds flag to pending BEFORE Claude', async () => {
    const out = await runDishVetting({ ...CLEAN, suggestedPrice: 999 })
    expect(out.status).toBe('pending')
    expect(out.reasonCode).toBe('low_quality')
    expect(vetMock).not.toHaveBeenCalled()
  })

  it("internal duplicate vs ANOTHER creator's catalogue → rejected duplicate_internal", async () => {
    db.creatorDish.findMany.mockResolvedValue([
      { name: 'Gnocchi truffe de Nonna', ingredients: ['gnocchi', 'truffe'] },
    ])
    const out = await runDishVetting(CLEAN, { creatorId: 'me' })
    expect(out.status).toBe('rejected')
    expect(out.reasonCode).toBe('duplicate_internal')
    expect(out.detail).toContain('Gnocchi truffe de Nonna')
    // The query excluded MY dishes (and the dish being edited).
    expect(db.creatorDish.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ creatorId: { not: 'me' } }),
    }))
    expect(vetMock).not.toHaveBeenCalled()
  })

  it('duplicate-check DB error is skipped (extra net, never a blocker)', async () => {
    db.creatorDish.findMany.mockRejectedValue(new Error('db down'))
    const out = await runDishVetting(CLEAN, { creatorId: 'me' })
    expect(out.status).toBe('approved') // Claude (mocked pass) still ruled
  })

  it('mapping preserved: pass→approved (+ score), flag→pending, reject→rejected', async () => {
    expect((await runDishVetting(CLEAN)).status).toBe('approved')
    expect((await runDishVetting(CLEAN)).signatureScore).toBe(72)

    vetMock.mockResolvedValue({ verdict: 'flag', reasonCode: 'incoherent_photo', detail: 'photo douteuse' })
    const flagged = await runDishVetting(CLEAN)
    expect(flagged.status).toBe('pending')
    expect(flagged.reason).toContain('Photo incohérente')

    vetMock.mockResolvedValue({ verdict: 'reject', reasonCode: 'not_a_recipe', detail: 'texte de test' })
    const rejected = await runDishVetting(CLEAN)
    expect(rejected.status).toBe('rejected')
    expect(rejected.reason).toContain('pas une vraie recette')
  })

  it('technical fallback (flag, no code) → pending, never auto-approved', async () => {
    vetMock.mockResolvedValue({ verdict: 'flag', detail: 'vérification auto indisponible' })
    const out = await runDishVetting(CLEAN)
    expect(out.status).toBe('pending')
  })
})
