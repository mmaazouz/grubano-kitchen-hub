import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// ── P0-39 (vague 3) — visibilité admin des réclamations en attente + alerte ────
// L'auto-approbation 24 h (la soupape) a été retirée (P0-07/P0-25, Q3) sans
// remplacement : une réclamation ignorée par le resto restait invisible de tous.
// Ce fichier épingle : (1) la route GET stale-alerts (patron reconcile-ghost-
// orders : token constant-time OU admin, LECTURE SEULE, une alerte idempotente
// PAR réclamation) ; (2) le sender admin_stale_claim (patron admin_ghost_order) ;
// (3) la file `pending` ADDITIVE de GET /api/admin/claims ; (4) Q3 : AUCUNE
// action automatique — aucune écriture claim, aucun moteur, aucun argent.

const { db } = vi.hoisted(() => ({
  db: {
    claim:    { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    operator: { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { alertMock } = vi.hoisted(() => ({ alertMock: vi.fn() }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminStaleClaimAlert: alertMock }))

const { claimsFlag, arbQueueMock, pendingMock } = vi.hoisted(() => ({
  claimsFlag: vi.fn(() => true), arbQueueMock: vi.fn(), pendingMock: vi.fn(),
}))
vi.mock('@/lib/claims', () => ({
  isClaimsEnabled:             claimsFlag,
  listArbitrationQueue:        arbQueueMock,
  listPendingRestaurantClaims: pendingMock,
}))

import { GET as STALE } from '@/app/api/admin/claims/stale-alerts/route'
import { GET as ADMIN_LIST } from '@/app/api/admin/claims/route'

const staleCall = (headers: Record<string, string> = {}) =>
  STALE(new Request('https://app.grubano.com/api/admin/claims/stale-alerts', { headers }))

const OVERDUE = [
  { id: 'cl1', orderId: 'o1', requestedAmountCents: 1250, createdAt: new Date(Date.now() - 30 * 3_600_000) },
  { id: 'cl2', orderId: 'o2', requestedAmountCents: 800,  createdAt: new Date(Date.now() - 50 * 3_600_000) },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  claimsFlag.mockReturnValue(true)
  db.claim.findMany.mockResolvedValue(OVERDUE)
  alertMock.mockResolvedValue({ status: 'sent' })
  sessionMock.mockResolvedValue(null)
})

describe('GET /api/admin/claims/stale-alerts — auth (calque reconcile-ghost-orders)', () => {
  it('⭐ token cron valide → 200 + UNE alerte PAR réclamation en retard', async () => {
    vi.stubEnv('INTERNAL_CRON_TOKEN', 'tok-1')
    const res = await staleCall({ 'x-internal-token': 'tok-1' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, overdue: 2, alerted: 2 })
    expect(alertMock).toHaveBeenCalledTimes(2)
    expect(alertMock).toHaveBeenCalledWith(expect.objectContaining({
      claimId: 'cl1', orderId: 'o1', requestedAmountCents: 1250, ageHours: expect.any(Number),
    }))
  })

  it('env vide → le header n’ouvre JAMAIS la route ; session admin requise sinon', async () => {
    vi.stubEnv('INTERNAL_CRON_TOKEN', '')
    expect((await staleCall({ 'x-internal-token': '' })).status).toBe(401)
    expect(alertMock).not.toHaveBeenCalled()

    sessionMock.mockResolvedValue({ user: { email: 'resto@x.fr' } })
    db.operator.findUnique.mockResolvedValue({ role: 'restaurant' })
    expect((await staleCall()).status).toBe(403)

    sessionMock.mockResolvedValue({ user: { email: 'admin@grubano.com' } })
    db.operator.findUnique.mockResolvedValue({ role: 'admin' })
    expect((await staleCall()).status).toBe(200)
  })

  it('CLAIMS_ENABLED off → { enabled:false }, aucun accès DB', async () => {
    claimsFlag.mockReturnValue(false)
    const res = await staleCall()
    expect(await res.json()).toEqual({ enabled: false })
    expect(db.claim.findMany).not.toHaveBeenCalled()
  })
})

describe('GET /api/admin/claims/stale-alerts — la sonde est LECTURE SEULE (Q3)', () => {
  beforeEach(() => vi.stubEnv('INTERNAL_CRON_TOKEN', 'tok-1'))

  it('⭐ le WHERE cible les réclamations en retard SANS les toucher : status restaurant_review + responseDeadlineAt < now, bornée', async () => {
    await staleCall({ 'x-internal-token': 'tok-1' })
    const q = db.claim.findMany.mock.calls[0][0]
    expect(q.where.status).toBe('restaurant_review')
    expect(q.where.responseDeadlineAt.lt).toBeInstanceOf(Date)
    expect(q.take).toBeLessThanOrEqual(200)
  })

  it('⭐ AUCUNE action automatique : jamais d’update/updateMany claim, jamais de moteur', async () => {
    await staleCall({ 'x-internal-token': 'tok-1' })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
    expect(db.claim.update).not.toHaveBeenCalled()
  })

  it('rejouer la sonde : la dedupe est portée par le SENDER (une ligne EmailDispatch par claim) — ici alerted ne compte que les « sent »', async () => {
    alertMock.mockResolvedValue({ status: 'duplicate' })
    const res = await staleCall({ 'x-internal-token': 'tok-1' })
    expect(await res.json()).toMatchObject({ ok: true, overdue: 2, alerted: 0 })
  })

  it('aucune réclamation en retard → no-op propre', async () => {
    db.claim.findMany.mockResolvedValue([])
    const res = await staleCall({ 'x-internal-token': 'tok-1' })
    expect(await res.json()).toMatchObject({ ok: true, overdue: 0, alerted: 0 })
    expect(alertMock).not.toHaveBeenCalled()
  })
})

describe('GET /api/admin/claims — la file `pending` est ADDITIVE (P0-39)', () => {
  it('⭐ la réponse porte claims (arbitrage, inchangée) ET pending (attente resto)', async () => {
    sessionMock.mockResolvedValue({ user: { role: 'admin' } })
    arbQueueMock.mockResolvedValue([{ id: 'arb1' }])
    pendingMock.mockResolvedValue([{ id: 'pen1', createdAt: new Date(), responseDeadlineAt: new Date() }])
    const res = await ADMIN_LIST()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.enabled).toBe(true)
    expect(body.claims).toHaveLength(1)
    expect(body.pending).toHaveLength(1)
  })
})

describe('invariants source (Q3 + patrons maison)', () => {
  const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8')

  it('le sender admin_stale_claim suit le patron admin_ghost_order : sendOnce + dedupeKey claim:<id> + no-op sans ALERT_EMAIL', () => {
    const a = read('lib/admin-alerts.ts')
    expect(/sendOnce\('admin_stale_claim', `claim:\$\{p\.claimId\}`/.test(a)).toBe(true)
    expect(/ALERT_EMAIL/.test(a)).toBe(true)
  })

  it('le cron daily appelle la sonde (cron.yml) et l’auto-approve P0-07 n’est PAS ressuscité', () => {
    const y = read('.github/workflows/cron.yml')
    expect(/claims\/stale-alerts/.test(y)).toBe(true)
    expect(/curl[^\n]*claims\/auto-approve/.test(y)).toBe(false)
  })

  it('la section pending de la console est SANS action (aucun bouton d’arbitrage dans le bloc pending)', () => {
    const c = read('components/claims/AdminClaimsArbitration.tsx')
    const pendingBlock = c.slice(c.indexOf('admin.pendingTitle'), c.indexOf('admin.arbitrationTitle'))
    expect(pendingBlock.length).toBeGreaterThan(0)
    expect(/onClick|decide\(|arbitrate/.test(pendingBlock)).toBe(false)
  })
})
