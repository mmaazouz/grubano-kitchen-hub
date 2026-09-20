// tests/refund-dispute-guard-callers.test.ts — PRE-MODE-B V1, CÔTÉ APPELANTS.
//
// tests/refund-dispute-guard.test.ts prouve que la garde dit non. Ce fichier prouve que chaque rail
// DIRECT l'appelle VRAIMENT, et qu'il l'appelle AVANT le moteur — donc avant la ligne Refund
// 'pending' que `lib/refund.ts:808` écrit avant de contacter Stripe (un rejet Stripe après cette
// écriture laisse une ligne fantôme que rien ne sait effacer : la clé de cumul @unique reste prise).
//
// Et il épingle la FRONTIÈRE : le rail RÉCLAMATION ne doit PAS utiliser cette garde — il est couvert
// en amont par H5 'disputed' (lib/claim-action-rules.ts), et son refus de moteur est modélisé
// octet par octet par le miroir G5 `engineRefusalOnReapproval`, lui-même vérifié contre le VRAI
// moteur par tests/claims-r13-engine-parity.test.ts. Ajouter la garde au rail réclamation
// changerait ce miroir en silence : le test le refuse.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const { guardMock } = vi.hoisted(() => ({ guardMock: vi.fn() }))
vi.mock('@/lib/refund-dispute-guard', () => ({ assertChargeNotDisputed: guardMock }))

// MODE B commit A — le préflight FINANCEMENT est le second refus pré-écriture des rails directs.
const { preflightMock } = vi.hoisted(() => ({ preflightMock: vi.fn() }))
vi.mock('@/lib/refund-preflight', () => ({ preflightRefundFunding: preflightMock }))

const { flagMock, execMock } = vi.hoisted(() => ({ flagMock: vi.fn(), execMock: vi.fn() }))
vi.mock('@/lib/refund', () => ({ isRefundsEnabled: flagMock, executeRefund: execMock }))

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { db } = vi.hoisted(() => ({
  db: { operator: { findUnique: vi.fn() }, order: { findUnique: vi.fn() }, restaurant: { findUnique: vi.fn() } },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { auditMock } = vi.hoisted(() => ({ auditMock: vi.fn() }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: auditMock, CRON_ACTOR_ID: 'cron' }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => null }))
vi.mock('@/lib/refund-route-guard', () => ({ requireRefundAdmin: async () => ({ ok: true, actorId: 'op1', actorEmail: 'a@b.c' }) }))
vi.mock('@/lib/safe-compare', () => ({ safeEqual: (a: string, b: string) => a === b }))
vi.mock('@/lib/transactional-emails', () => ({ sendRefundConfirmation: vi.fn(), refundEmailDedupeKey: () => 'k' }))

const DISPUTED = { ok: false as const, status: 409 as const, error: 'Paiement contesté chez Stripe — remboursement bloqué par sécurité.' }
const post = (body: unknown) => new Request('http://localhost/api/admin/refunds/run', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

beforeEach(() => {
  vi.clearAllMocks()
  flagMock.mockReturnValue(true)
  guardMock.mockResolvedValue({ ok: true })
  preflightMock.mockResolvedValue({ ok: true })
  sessionMock.mockResolvedValue({ user: { email: 'a@b.c' } })
  db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'admin' })
  db.order.findUnique.mockResolvedValue({ id: 'o1', stripePaymentIntentId: 'pi_1', restaurantId: 'r1', consumerId: 'c1', paymentStatus: 'paid' })
  db.restaurant.findUnique.mockResolvedValue({ id: 'r1', name: 'R' })
  execMock.mockResolvedValue({ ok: true, refundId: 're_1', amountCents: 500 })
})

describe('PRE-MODE-B V1 — POST /api/admin/refunds/run (le déclencheur de la répétition Mode B)', () => {
  it('charge CONTESTÉE → 409 et le moteur n’est JAMAIS appelé (aucune ligne Refund, aucun audit)', async () => {
    guardMock.mockResolvedValue(DISPUTED)
    const { POST } = await import('@/app/api/admin/refunds/run/route')
    const res = await POST(post({ orderId: 'o1', amountCents: 500 }))
    expect(res.status).toBe(409)
    expect(execMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('Stripe illisible → 502 fail-closed, moteur jamais appelé', async () => {
    guardMock.mockResolvedValue({ ok: false, status: 502, error: 'illisible' })
    const { POST } = await import('@/app/api/admin/refunds/run/route')
    const res = await POST(post({ orderId: 'o1', amountCents: 500 }))
    expect(res.status).toBe(502)
    expect(execMock).not.toHaveBeenCalled()
  })

  it('charge saine → la garde est consultée avec le PaymentIntent de LA commande, puis le moteur tourne', async () => {
    const { POST } = await import('@/app/api/admin/refunds/run/route')
    const res = await POST(post({ orderId: 'o1', amountCents: 500 }))
    expect(guardMock).toHaveBeenCalledWith('pi_1')
    expect(execMock).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(200)
    // le PaymentIntent lu est bien celui de LA commande demandée (garder la mauvaise commande
    // contournerait la garde en silence), et on ne lit QUE ce champ
    expect(db.order.findUnique).toHaveBeenCalledWith({ where: { id: 'o1' }, select: { stripePaymentIntentId: true } })
    // ORDRE RÉEL D'APPEL (pas une position dans le texte) : garde litige PUIS préflight financement,
    // les deux AVANT le moteur — donc avant la ligne Refund 'pending' qu'il écrit avant Stripe.
    expect(preflightMock).toHaveBeenCalledWith({ paymentIntentId: 'pi_1' })
    expect(guardMock.mock.invocationCallOrder[0]).toBeLessThan(preflightMock.mock.invocationCallOrder[0])
    expect(preflightMock.mock.invocationCallOrder[0]).toBeLessThan(execMock.mock.invocationCallOrder[0])
  })

  it('MODE B commit A — charge routée SANS commission → 409 et le moteur n’est jamais appelé', async () => {
    preflightMock.mockResolvedValue({ ok: false, status: 409, cause: 'routed_without_fee', error: 'routée sans commission' })
    const { POST } = await import('@/app/api/admin/refunds/run/route')
    const res = await POST(post({ orderId: 'o1', amountCents: 500 }))
    expect(res.status).toBe(409)
    expect(execMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('MODE B commit A — financement illisible → 502 propagé verbatim, moteur jamais appelé', async () => {
    preflightMock.mockResolvedValue({ ok: false, status: 502, cause: 'unreadable', error: 'illisible' })
    const { POST } = await import('@/app/api/admin/refunds/run/route')
    const res = await POST(post({ orderId: 'o1', amountCents: 500 }))
    expect(res.status).toBe(502)
    expect(execMock).not.toHaveBeenCalled()
  })

  it('commande sans PaymentIntent → la garde n’a rien à lire, le moteur répond lui-même', async () => {
    db.order.findUnique.mockResolvedValue({ id: 'o1', stripePaymentIntentId: null })
    execMock.mockResolvedValue({ ok: false, status: 409, error: 'Commande non payée — rien à rembourser.' })
    const { POST } = await import('@/app/api/admin/refunds/run/route')
    await POST(post({ orderId: 'o1', amountCents: 500 }))
    expect(guardMock).not.toHaveBeenCalled()
    expect(execMock).toHaveBeenCalledTimes(1)
  })

  it('la garde passe APRÈS le bail fermé : un rail gaté ne lit même pas Stripe', async () => {
    flagMock.mockReturnValue(false)
    const { POST } = await import('@/app/api/admin/refunds/run/route')
    const res = await POST(post({ orderId: 'o1', amountCents: 500 }))
    expect(res.status).toBe(403)
    expect(guardMock).not.toHaveBeenCalled()
    expect(execMock).not.toHaveBeenCalled()
  })
})

describe('PRE-MODE-B V1 — POST /api/orders/[id]/refund', () => {
  const postOrder = () => new Request('http://localhost/api/orders/o1/refund', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amountCents: 500 }),
  })

  it('charge CONTESTÉE → 409 et le moteur n’est jamais appelé', async () => {
    guardMock.mockResolvedValue(DISPUTED)
    const { POST } = await import('@/app/api/orders/[id]/refund/route')
    const res = await POST(postOrder(), { params: { id: 'o1' } })
    expect(res.status).toBe(409)
    expect(execMock).not.toHaveBeenCalled()
  })

  it('Stripe illisible → le statut de la garde est propagé VERBATIM (502), jamais réécrit en 409', async () => {
    guardMock.mockResolvedValue({ ok: false, status: 502, error: 'illisible' })
    const { POST } = await import('@/app/api/orders/[id]/refund/route')
    const res = await POST(postOrder(), { params: { id: 'o1' } })
    expect(res.status).toBe(502)
    expect(execMock).not.toHaveBeenCalled()
  })

  it('charge saine → garde consultée avec le PI de la commande, AVANT le moteur (ordre d’appel réel)', async () => {
    const { POST } = await import('@/app/api/orders/[id]/refund/route')
    await POST(postOrder(), { params: { id: 'o1' } })
    expect(guardMock).toHaveBeenCalledWith('pi_1')
    expect(preflightMock).toHaveBeenCalledWith({ paymentIntentId: 'pi_1' })
    expect(execMock).toHaveBeenCalledTimes(1)
    expect(guardMock.mock.invocationCallOrder[0]).toBeLessThan(preflightMock.mock.invocationCallOrder[0])
    expect(preflightMock.mock.invocationCallOrder[0]).toBeLessThan(execMock.mock.invocationCallOrder[0])
  })

  it('MODE B commit A — préflight refusant → le moteur n’est jamais appelé sur ce rail non plus', async () => {
    preflightMock.mockResolvedValue({ ok: false, status: 409, cause: 'routed_without_fee', error: 'routée sans commission' })
    const { POST } = await import('@/app/api/orders/[id]/refund/route')
    const res = await POST(postOrder(), { params: { id: 'o1' } })
    expect(res.status).toBe(409)
    expect(execMock).not.toHaveBeenCalled()
  })
})

// ── LA FRONTIÈRE : quels fichiers ont le droit d'appeler la garde ────────────────
describe('PRE-MODE-B V1 — la garde couvre les rails directs, et SEULEMENT eux', () => {
  const ROOT = path.join(__dirname, '..')
  const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')

  // ⭐ RECENSEMENT, pas une liste écrite à la main : on énumère TOUS les appelants du moteur dans le
  // dépôt. Un quatrième rail ajouté demain sans garde fait ROUGIR ce test — une liste figée, non.
  const GUARDED = [
    'app/api/admin/refunds/run/route.ts',
    'app/api/orders/[id]/refund/route.ts',
    'app/api/webhooks/stripe/route.ts',
  ]
  const CLAIM_RAIL = 'lib/claims.ts'   // couvert en amont par H5 'disputed', PAS par la garde
  const walk = (d: string): string[] => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : (/\.(ts|tsx)$/.test(e.name) ? [`${d}/${e.name}`] : [])))
  const engineCallers = () => [...walk('app'), ...walk('lib'), ...walk('scripts')]
    .filter((f) => /executeRefund\s*\(/.test(read(f)) && !/^lib\/refund\.ts$/.test(f))

  it('le recensement des appelants du moteur est EXACTEMENT : les 3 rails gardés + le rail réclamation', () => {
    expect(engineCallers().sort()).toEqual([...GUARDED, CLAIM_RAIL].sort())
  })

  // Présence seulement : l'ORDRE réel est prouvé par les tests de comportement ci-dessus et
  // ci-dessous (invocationCallOrder), jamais par une position dans le texte — un appel placé plus
  // haut mais dans une branche morte passerait un test textuel.
  it('chacun des rails gardés consulte la garde LITIGE et le préflight FINANCEMENT', () => {
    for (const f of GUARDED) {
      expect(read(f), f).toMatch(/assertChargeNotDisputed\(/)
      // MODE B commit A — les deux refus doivent exister sur les trois rails : le litige (l'argent a
      // pu sortir ailleurs) ET le financement (le moteur écrirait une ligne que Stripe rejette).
      expect(read(f), f).toMatch(/preflightRefundFunding\(/)
    }
  })

  it('le rail EMPREINTE (lib/refunds.ts) refuse le litige en ligne, sans lecture Stripe supplémentaire', () => {
    const src = read('lib/refunds.ts')
    expect(src).toMatch(/chargeIsDisputed\(charge\)/)
    expect(src).toMatch(/DISPUTED_REFUND_REFUSAL/)
    // le refus précède le calcul du plafond
    expect(src.indexOf('chargeIsDisputed(charge)')).toBeLessThan(src.indexOf('const refundableCents'))
  })

  it('⭐ CONTRÔLE NÉGATIF — AUCUNE surface du rail RÉCLAMATION n’utilise la garde (H5 le couvre déjà ; le miroir G5 deviendrait faux)', () => {
    // recensement, pas deux chemins écrits à la main : toute la surface réclamation (routes + libs)
    const claimSurface = [...walk('app/api/claims'), ...walk('app/api/admin/claims'), ...walk('lib')]
      .filter((f) => f.startsWith('app/') || /^lib\/claim/.test(f))
    expect(claimSurface.length).toBeGreaterThan(10)   // le recensement doit vraiment ratisser
    for (const f of claimSurface) {
      expect(read(f), f).not.toMatch(/refund-dispute-guard|assertChargeNotDisputed/)
      expect(read(f), f).not.toMatch(/refund-preflight|preflightRefundFunding/)
    }
  })

  it('⭐ CONTRÔLE NÉGATIF — le MOTEUR gelé n’importe ni la garde ni le préflight (empreinte SHA-256 épinglée)', () => {
    expect(read('lib/refund.ts')).not.toMatch(/refund-dispute-guard|assertChargeNotDisputed/)
    expect(read('lib/refund.ts')).not.toMatch(/refund-preflight|preflightRefundFunding/)
  })

  it('l’opérateur de fenêtre voit le litige avant d’ouvrir quoi que ce soit', () => {
    const src = read('scripts/server/phase2-refund-gate.js')
    expect(src).toMatch(/disputed/)
    expect(src).toMatch(/charge DISPUTED/)
  })
})
