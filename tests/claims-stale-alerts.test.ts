import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { openClaimsWindow, closeClaimsWindow } from './support/claims-window'

// ── P0-39 (vague 3) — visibilité admin des réclamations en attente + alerte ────
// L'auto-approbation 24 h (la soupape) a été retirée (P0-07/P0-25, Q3) sans
// remplacement : une réclamation ignorée par le resto restait invisible de tous.
// Ce fichier épingle : (1) la route GET stale-alerts (patron reconcile-ghost-
// orders : token constant-time OU admin, LECTURE SEULE, une alerte idempotente
// PAR réclamation) ; (2) le sender admin_stale_claim (patron admin_ghost_order) ;
// (3) la file `pending` ADDITIVE de GET /api/admin/claims ; (4) Q3 : AUCUNE
// action automatique — aucune écriture claim, aucun moteur, aucun argent.
//
// D′ L1 (spec v2 §3) : la porte est lib/claim-flags (process.env seul), plus une fonction de lib/claims qu'un mock
// pourrait répondre. La SURFACE est ouverte ici à la manière legacy (le bail, S-12) et fermée en le retirant.

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
// T-49 round 13: GET /api/admin/claims authorises through resolveAdmin (role set re-read). The stale-alerts
// route does not import it, so this mock only concerns the admin-list test below.
const { adminMock } = vi.hoisted(() => ({ adminMock: vi.fn() }))
vi.mock('@/lib/admin-guard', () => ({ resolveAdmin: adminMock }))

const { alertMock } = vi.hoisted(() => ({ alertMock: vi.fn() }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminStaleClaimAlert: alertMock }))

const { arbQueueMock, pendingMock, moneyMock, awaitingPayMock, awaitingRatifyMock } = vi.hoisted(() => ({
  arbQueueMock: vi.fn(), pendingMock: vi.fn(), moneyMock: vi.fn(async (): Promise<Array<Record<string, unknown>>> => []),
  // D′ L4 (spec v2 §8.5) : les deux files EN LECTURE SEULE que la route admin sert désormais aussi.
  awaitingPayMock: vi.fn(async (): Promise<Array<Record<string, unknown>>> => []),
  awaitingRatifyMock: vi.fn(async (): Promise<Array<Record<string, unknown>>> => []),
}))
vi.mock('@/lib/claims', () => ({
  listArbitrationQueue:        arbQueueMock,
  listPendingRestaurantClaims: pendingMock,
  // Claims batch 1: the admin route now also reads the money list and the silence list.
  listActionableRefundClaims: moneyMock,
  listSilenceExpiredClaims: vi.fn(async () => []),
  // D′ L4 : « À rembourser » (ARGENT, servie même surface fermée) et « À ratifier » (workflow).
  listApprovedAwaitingPayment: awaitingPayMock,
  listAwaitingRatification:    awaitingRatifyMock,
}))

// D′ L4 : la route admin consulte la sonde de schéma AVANT de lire les deux files D′ (le client Prisma du
// processus peut ignorer la colonne). Les doubles de ce fichier ne portent pas de quoi satisfaire la vraie
// sonde ; on la pilote donc explicitement, et on épingle les deux réponses (prête / pas prête).
const { schemaMock } = vi.hoisted(() => ({ schemaMock: { fn: vi.fn() } }))
vi.mock('@/lib/schema-ready', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/schema-ready')>()
  return { ...real, schemaReady: (...a: unknown[]) => schemaMock.fn(...a) }
})
const SCHEMA_READY = { ready: true, clientReady: true, dbReady: true, missingClient: [], missingDb: [], probedAt: '', why: null }
const SCHEMA_STALE = { ready: false, clientReady: false, dbReady: null, missingClient: ['Claim.approvedAmountCents'], missingDb: [], probedAt: '', why: 'client Prisma périmé' }

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
  delete process.env.CLAIMS_SURFACE_ENABLED; delete process.env.CLAIMS_INTAKE_ENABLED
  openClaimsWindow() // D′ L1 : la vraie porte, ouverte comme Mode A/B l'ouvrait
  db.claim.findMany.mockResolvedValue(OVERDUE)
  alertMock.mockResolvedValue({ status: 'sent' })
  moneyMock.mockResolvedValue([])
  awaitingPayMock.mockResolvedValue([])
  awaitingRatifyMock.mockResolvedValue([])
  schemaMock.fn.mockReset(); schemaMock.fn.mockResolvedValue(SCHEMA_READY)
  sessionMock.mockResolvedValue(null)
})
afterEach(() => { closeClaimsWindow(); delete process.env.CLAIMS_SURFACE_ENABLED; delete process.env.CLAIMS_INTAKE_ENABLED })

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

  it('surface FERMÉE (bail retiré) → { enabled:false }, aucun accès DB, même avec un token cron valide', async () => {
    closeClaimsWindow()
    vi.stubEnv('INTERNAL_CRON_TOKEN', 'tok-1')
    const res = await staleCall({ 'x-internal-token': 'tok-1' })
    expect(await res.json()).toEqual({ enabled: false })
    expect(db.claim.findMany).not.toHaveBeenCalled()
    expect(alertMock).not.toHaveBeenCalled()
  })

  it('D′ L1 — la SURFACE produit seule (CLAIMS_SURFACE_ENABLED=true, sans bail, INTAKE fermé) ouvre la sonde ; INTAKE seul n’ouvre rien', async () => {
    closeClaimsWindow()
    vi.stubEnv('INTERNAL_CRON_TOKEN', 'tok-1')
    process.env.CLAIMS_SURFACE_ENABLED = 'true'; process.env.CLAIMS_INTAKE_ENABLED = 'false'
    expect(await (await staleCall({ 'x-internal-token': 'tok-1' })).json()).toMatchObject({ ok: true, overdue: 2, alerted: 2 })
    delete process.env.CLAIMS_SURFACE_ENABLED; process.env.CLAIMS_INTAKE_ENABLED = 'true'
    expect(await (await staleCall({ 'x-internal-token': 'tok-1' })).json()).toEqual({ enabled: false })
    expect(db.claim.findMany).toHaveBeenCalledTimes(1)
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
    adminMock.mockResolvedValue({ id: 'op1', role: 'admin', name: 'Admin', email: 'admin@grubano.com' })
    arbQueueMock.mockResolvedValue([{ id: 'arb1' }])
    pendingMock.mockResolvedValue([{ id: 'pen1', createdAt: new Date(), responseDeadlineAt: new Date() }])
    // D′ L4 (§8.5) : les deux nouvelles files sont ADDITIVES elles aussi — `claims` et `pending` inchangées.
    awaitingPayMock.mockResolvedValue([{ id: 'pay1', approvedAmountCents: 400 }])
    awaitingRatifyMock.mockResolvedValue([{ id: 'rat1' }])
    const res = await ADMIN_LIST()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.enabled).toBe(true)
    expect(body.claims).toHaveLength(1)
    expect(body.pending).toHaveLength(1)
    expect(body.awaitingPayment).toEqual([{ id: 'pay1', approvedAmountCents: 400 }])
    expect(body.awaitingRatification).toEqual([{ id: 'rat1' }])
    expect(body.counts).toMatchObject({ awaitingPayment: 1, awaitingRatification: 1 })
  })

  it('D′ L1 (spec v2 §3.2) — surface FERMÉE · admin : la file `pending` est VIDE et non lue, enabled:false ; la liste ARGENT reste servie (CONTRÔLE NÉGATIF de la scission)', async () => {
    closeClaimsWindow()
    adminMock.mockResolvedValue({ id: 'op1', role: 'admin', name: 'Admin', email: 'admin@grubano.com' })
    arbQueueMock.mockResolvedValue([{ id: 'arb1' }])
    pendingMock.mockResolvedValue([{ id: 'pen1' }])
    moneyMock.mockResolvedValue([{ id: 'm1', moneyState: 'approved_not_driven' }])
    // D′ L4 : une décision PRISE et NON PAYÉE est de l'ARGENT — elle reste servie derrière le kill-switch,
    // alors que « À ratifier » est du workflow et n'est même pas lue (CONTRÔLE NÉGATIF de la scission).
    awaitingPayMock.mockResolvedValue([{ id: 'pay1', approvedAmountCents: 400 }])
    awaitingRatifyMock.mockResolvedValue([{ id: 'rat1' }])
    const res = await ADMIN_LIST()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      enabled: false, schemaReady: true, claims: [], pending: [], silenceExpired: [],
      actionableRefunds: [{ id: 'm1', moneyState: 'approved_not_driven' }],
      awaitingPayment: [{ id: 'pay1', approvedAmountCents: 400 }], awaitingRatification: [],
      counts: {
        arbitration: 0, silenceExpired: 0, legacyPendingMoney: 0, actionableRefunds: 1,
        awaitingPayment: 1, awaitingRatification: 0, actionableTotal: 1,
      },
    })
    expect(pendingMock).not.toHaveBeenCalled()
    expect(arbQueueMock).not.toHaveBeenCalled()
    expect(awaitingPayMock).toHaveBeenCalledTimes(1)
    expect(awaitingRatifyMock).not.toHaveBeenCalled()
  })

  // D′ L4 — CONTRÔLE NÉGATIF de la sonde : quand le client du processus ignore la colonne, les deux files D′
  // ne sont même pas interrogées (la requête échouerait) et le payload DIT pourquoi elles sont vides. Sans ce
  // `schemaReady:false`, une console lisant `awaitingPayment: []` conclurait « rien à payer » alors que la
  // vérité est « je ne peux pas lire ». Le reste de la route — l'argent legacy — continue de répondre.
  it('D′ L4 — sonde PAS prête : les deux files D′ ne sont PAS lues, payload schemaReady:false, le reste inchangé', async () => {
    schemaMock.fn.mockResolvedValue(SCHEMA_STALE)
    adminMock.mockResolvedValue({ id: 'op1', role: 'admin', name: 'Admin', email: 'admin@grubano.com' })
    arbQueueMock.mockResolvedValue([{ id: 'arb1' }])
    pendingMock.mockResolvedValue([{ id: 'pen1' }])
    moneyMock.mockResolvedValue([{ id: 'm1', moneyState: 'approved_not_driven' }])
    awaitingPayMock.mockResolvedValue([{ id: 'pay1', approvedAmountCents: 400 }])
    awaitingRatifyMock.mockResolvedValue([{ id: 'rat1' }])
    const body = await (await ADMIN_LIST()).json()
    expect(body.schemaReady).toBe(false)
    expect(body.awaitingPayment).toEqual([])
    expect(body.awaitingRatification).toEqual([])
    expect(body.counts).toMatchObject({ awaitingPayment: 0, awaitingRatification: 0 })
    expect(awaitingPayMock).not.toHaveBeenCalled()
    expect(awaitingRatifyMock).not.toHaveBeenCalled()
    // l'argent legacy et le workflow ne dépendent d'aucune colonne D′ : ils répondent comme avant
    expect(body.enabled).toBe(true)
    expect(body.claims).toHaveLength(1)
    expect(body.actionableRefunds).toHaveLength(1)
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
