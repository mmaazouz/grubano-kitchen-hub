import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── P1-SEC — POST /api/menu (imageBase64) : gouvernance de coût de la MODÉRATION ─
// Le train précédent a fermé POST /api/menu/scan-dish (Sonnet vision, `dish_scan`).
// La MÊME famille d'appel restait ouverte une ligne plus loin : POST /api/menu avec
// `imageBase64` → lib/dish-photo.processDishImage → moderateDishImage →
// llmComplete({ task: 'dish_moderation' }) SANS operatorId. Or lib/llm/index.ts ne
// teste le quota que `if (input.operatorId && …)` — exactement la condition refermée
// sur scan-dish. Conséquences fermées ici :
//   • `dish_moderation` est un appel SONNET VISION (lib/llm/index.ts TASKS) : même
//     coût unitaire que `dish_scan` ;
//   • POST /api/menu n'a AUCUN rate limit → le quota était la SEULE couche de coût,
//     et elle ne s'appliquait pas ;
//   • LlmUsage était écrit avec operatorId null, donc la dépense n'était même pas
//     COMPTÉE dans le compteur de l'opérateur (lib/llm/quota.ts agrège
//     `where: { operatorId }`) : un partenaire 429 sur scan-dish pouvait boucler ici.
// Ces tests traversent la VRAIE chaîne lib/dish-photo (seule la passerelle LLM et
// Cloudinary sont simulés) : c'est la propagation de bout en bout qui est épinglée,
// pas le passage d'un argument à un mock.

const { db, session, llm } = vi.hoisted(() => ({
  db: {
    operator: { findUnique: vi.fn() },
    brand:    { findFirst: vi.fn() },
    menuItem: { create: vi.fn() },
  },
  session: vi.fn(),
  llm:     vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth', () => ({ getServerSession: session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/llm', () => {
  class LlmQuotaError extends Error {
    constructor(public scope: 'day' | 'month' = 'day') {
      super(`LLM quota exceeded (${scope})`)
      this.name = 'LlmQuotaError'
    }
  }
  return { llmComplete: llm, LlmQuotaError }
})

import { POST } from '@/app/api/menu/route'
import { processDishImage } from '@/lib/dish-photo'

const IMAGE = Buffer.from('fake-jpeg-bytes').toString('base64')

const post = (body: Record<string, unknown>) =>
  POST(new Request('http://x/api/menu', {
    method:  'POST',
    headers: { 'content-type': 'application/json' },
    body:    JSON.stringify(body),
  }))

const dishBody = (over: Record<string, unknown> = {}) => ({
  brandId: 'b1', name: 'Gnocchi', price: 12, category: 'Plats',
  imageBase64: IMAGE, mediaType: 'image/jpeg',
  ...over,
})

const as = (id: string, role: string) => {
  session.mockResolvedValue({ user: { email: `${id}@x.fr` } })
  db.operator.findUnique.mockResolvedValue({ id, role })
}

/** The gateway answer for an ALLOWED photo. */
const moderationAllowed = () =>
  llm.mockResolvedValue({ text: '{"allowed":true,"reason":"","warnings":[]}' })

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  // Fake Cloudinary credentials + transport: no network, no real secret.
  process.env.CLOUDINARY_CLOUD_NAME = 'test-cloud'
  process.env.CLOUDINARY_API_KEY    = 'test-key'
  process.env.CLOUDINARY_API_SECRET = 'test-secret'
  fetchMock.mockResolvedValue({
    ok:   true,
    json: async () => ({ secure_url: 'https://res.cloudinary.com/x/image/upload/v1/a.jpg' }),
  })
  vi.stubGlobal('fetch', fetchMock)

  db.brand.findFirst.mockResolvedValue({ id: 'b1' })
  db.menuItem.create.mockResolvedValue({ id: 'm1', name: 'Gnocchi' })
  moderationAllowed()
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.CLOUDINARY_CLOUD_NAME
  delete process.env.CLOUDINARY_API_KEY
  delete process.env.CLOUDINARY_API_SECRET
})

// ── 1. Attribution ────────────────────────────────────────────────────────────

describe('POST /api/menu + photo — attribution du coût de modération', () => {
  it("l'operatorId de session descend jusqu'à llmComplete (le quota s'applique enfin)", async () => {
    as('op1', 'restaurant')
    const res = await post(dishBody())
    expect(res.status).toBe(201)

    expect(llm).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'dish_moderation', operatorId: 'op1' }),
    )
    // Pin de régression : `undefined` ici est EXACTEMENT ce qui désactivait le quota
    // (lib/llm/index.ts : `if (input.operatorId && …)`).
    const arg = llm.mock.calls[0][0] as { operatorId?: unknown }
    expect(arg.operatorId).toBe('op1')
    expect(arg.operatorId).not.toBeUndefined()
  })

  it("l'appel modéré reste bien un dish_moderation (tâche Sonnet vision, coût dish_scan)", async () => {
    as('op1', 'restaurant')
    await post(dishBody())
    expect((llm.mock.calls[0][0] as { task: string }).task).toBe('dish_moderation')
  })

  it("l'operatorId vient de la SESSION, jamais du corps (aucun override client)", async () => {
    as('op1', 'restaurant')
    await post(dishBody({ operatorId: 'victime' }))
    expect(llm).toHaveBeenCalledWith(expect.objectContaining({ operatorId: 'op1' }))
  })

  it('admin → son propre id est attribué (pas de dépense anonyme pour un superuser)', async () => {
    as('adm', 'admin')
    await post(dishBody())
    expect(llm).toHaveBeenCalledWith(expect.objectContaining({ operatorId: 'adm' }))
  })

  it('sans photo → aucun appel LLM du tout (chemin inchangé)', async () => {
    as('op1', 'restaurant')
    const res = await post({ brandId: 'b1', name: 'Gnocchi', price: 12, category: 'Plats' })
    expect(res.status).toBe(201)
    expect(llm).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

// ── 2. Le quota mord réellement ───────────────────────────────────────────────

describe('POST /api/menu + photo — opérateur au-dessus du quota', () => {
  it('quota dépassé → 429 honnête, AUCUN upload, AUCUN plat créé', async () => {
    as('op1', 'restaurant')
    const { LlmQuotaError } = await import('@/lib/llm')
    llm.mockRejectedValue(new LlmQuotaError('month'))

    const res = await post(dishBody())
    expect(res.status).toBe(429)
    // Message identique à celui de POST /api/menu/scan-dish — et surtout PAS
    // « Modération indisponible, réessayez dans un instant », qui serait un mensonge
    // pour un plafond MENSUEL.
    expect(await res.json()).toEqual({ error: 'Limite IA atteinte, réessaie plus tard.' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(db.menuItem.create).not.toHaveBeenCalled()
  })

  it('panne de modération (autre erreur) → toujours 503, fail-closed inchangé', async () => {
    as('op1', 'restaurant')
    llm.mockRejectedValue(new Error('transport down'))

    const res = await post(dishBody())
    expect(res.status).toBe(503)
    expect(db.menuItem.create).not.toHaveBeenCalled()
  })

  it('photo refusée par la modération → 422 inchangé (non-régression)', async () => {
    as('op1', 'restaurant')
    llm.mockResolvedValue({ text: '{"allowed":false,"reason":"pas de la nourriture","warnings":[]}' })

    const res = await post(dishBody())
    expect(res.status).toBe(422)
    expect(db.menuItem.create).not.toHaveBeenCalled()
  })
})

// ── 3. Les appelants HORS périmètre restent byte-identiques ───────────────────

describe('lib/dish-photo — le paramètre est ADDITIF', () => {
  it('sans operatorId (menu/photo, creators/dishes/photo, claims) → comportement actuel', async () => {
    const res = await processDishImage(IMAGE, 'image/jpeg')
    expect(res.ok).toBe(true)
    // Aucun quota appliqué, aucune attribution : exactement la situation d'aujourd'hui
    // pour les trois appelants non couverts par ce train.
    const arg = llm.mock.calls[0][0] as { operatorId?: unknown }
    expect(arg.operatorId).toBeUndefined()
  })

  it('avec operatorId → transmis tel quel à la passerelle', async () => {
    const res = await processDishImage(IMAGE, 'image/jpeg', 'op-direct')
    expect(res.ok).toBe(true)
    expect(llm).toHaveBeenCalledWith(expect.objectContaining({ operatorId: 'op-direct' }))
  })

  it('image vide → 400 avant tout appel LLM (borne conservée)', async () => {
    const res = await processDishImage('', 'image/jpeg', 'op1')
    expect(res.ok).toBe(false)
    expect(llm).not.toHaveBeenCalled()
  })
})
