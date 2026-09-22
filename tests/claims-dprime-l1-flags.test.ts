// tests/claims-dprime-l1-flags.test.ts — D′ lot L1 (spec v2 §3, §6; invariants S-12, S-13, S-14, S-23, S-24, S-25).
//
// The claims gates move to lib/claim-flags.ts. Two PRODUCT flags run the beta (CLAIMS_SURFACE_ENABLED /
// CLAIMS_INTAKE_ENABLED); the legacy lease (CLAIMS_ENABLED + CLAIMS_WINDOW_UNTIL) is the REHEARSAL gate only and is
// inert under the product surface. This file pins: the pure matrix, the equivalence of every gate with the legacy
// lease when no product flag is set (S-12), the intake_closed shapes (S-23), the split admin GET, the notice classes
// (S-25), what the product flags never open (S-13), check-flags, the operators' refusals BY NAME (S-14), and the
// static shape of the 25 sites — each with a negative control on the dab754d/05152b6 shape.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const { db, tokenMock, listMocks, adminMock, ackMock } = vi.hoisted(() => ({
  db: {
    order:  { findUnique: vi.fn() },
    claim:  { create: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    refund: { aggregate: vi.fn(), findMany: vi.fn() },
  },
  tokenMock: vi.fn(),
  listMocks: { queue: vi.fn(), pending: vi.fn(), money: vi.fn(), silence: vi.fn() },
  adminMock: vi.fn(),
  ackMock: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth/jwt', () => ({ getToken: tokenMock }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => null }))
vi.mock('@/lib/dish-photo', () => ({ processDishImage: vi.fn(), ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp'] as const }))
vi.mock('@/lib/refund', () => ({ executeRefund: vi.fn(), isRefundsEnabled: () => false, RESUME_CREATE_WINDOW_MS: 0 }))
vi.mock('@/lib/claim-emails', () => ({ sendClaimAckEmail: ackMock, sendClaimDecisionEmail: vi.fn(), sendClaimClosureEmail: vi.fn() }))
vi.mock('@/lib/admin-guard', () => ({ resolveAdmin: adminMock }))
vi.mock('@/lib/claims', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/claims')>()
  return {
    ...real,
    listArbitrationQueue: listMocks.queue, listPendingRestaurantClaims: listMocks.pending,
    listActionableRefundClaims: listMocks.money, listSilenceExpiredClaims: listMocks.silence,
  }
})

import {
  claimsGateState, isClaimsEnabled, isClaimsSurfaceEnabled, isClaimsIntakeEnabled, claimsSurfaceOpen, claimsIntakeOpen,
  claimNoticeGate, claimsFlagsSnapshot, CLAIMS_WINDOW_MAX_MS,
} from '@/lib/claim-flags'
import * as claimsModule from '@/lib/claims'
import { POST as postClaim, GET as getClaims } from '@/app/api/claims/route'
import { GET as getAdminClaims } from '@/app/api/admin/claims/route'
import { checkFlagCoupling, checkFlagWarnings, COUPLING_RULES } from '../scripts/check-flags.mjs'

const FLAG_KEYS = ['CLAIMS_SURFACE_ENABLED', 'CLAIMS_INTAKE_ENABLED', 'CLAIMS_ENABLED', 'CLAIMS_WINDOW_UNTIL'] as const
const clearFlags = () => { for (const k of FLAG_KEYS) delete process.env[k] }
const lease = (msFromNow = 15 * 60_000) => { process.env.CLAIMS_ENABLED = 'true'; process.env.CLAIMS_WINDOW_UNTIL = new Date(Date.now() + msFromNow).toISOString() }
const product = (surface: string | undefined, intake: string | undefined) => {
  if (surface !== undefined) process.env.CLAIMS_SURFACE_ENABLED = surface
  if (intake !== undefined) process.env.CLAIMS_INTAKE_ENABLED = intake
}

const ORDER = { id: 'o1', consumerId: 'owner', restaurantId: 'r1', paymentStatus: 'paid', total: 32.5, updatedAt: new Date(), items: [{ itemId: 'm1', name: 'Gnocchi', qty: 1, price: 32.5 }], stripePaymentIntentId: null }
const post = (body: unknown) =>
  postClaim(new Request('https://app.grubano.com/api/claims', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) as never)
const get = (qs = '') => getClaims(new Request(`https://app.grubano.com/api/claims${qs}`) as never)

beforeEach(() => {
  vi.clearAllMocks()
  clearFlags()
  tokenMock.mockResolvedValue({ sub: 'owner' })
  db.order.findUnique.mockResolvedValue(ORDER)
  db.refund.aggregate.mockResolvedValue({ _sum: { amountCents: 0 } })
  db.refund.findMany.mockResolvedValue([])
  db.claim.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'cl1', ...data }))
  db.claim.findFirst.mockResolvedValue(null)
  db.claim.findMany.mockResolvedValue([])
  db.claim.count.mockResolvedValue(0)
  ackMock.mockResolvedValue({ status: 'sent' })
  adminMock.mockResolvedValue({ id: 'admin1', email: 'admin@grubano.test' })
  listMocks.queue.mockResolvedValue([{ id: 'q1', status: 'arbitration', queueReason: 'contested' }])
  listMocks.pending.mockResolvedValue([{ id: 'p1' }])
  listMocks.money.mockResolvedValue([{ id: 'm1', moneyState: 'approved_not_driven' }])
  listMocks.silence.mockResolvedValue([{ id: 's1' }])
})
afterEach(clearFlags)

// ── the pure matrix ──────────────────────────────────────────────────────────────────────────────────────────────
describe('lib/claim-flags — the matrix (spec v2 §3.1)', () => {
  it("exact 'true' only: 'TRUE', '1', '' are OFF for both product flags", () => {
    for (const v of ['TRUE', '1', '', ' true', 'yes', 'True']) {
      product(v, v)
      expect(isClaimsSurfaceEnabled(), JSON.stringify(v)).toBe(false)
      expect(isClaimsIntakeEnabled(), JSON.stringify(v)).toBe(false)
      expect(claimsSurfaceOpen()).toBe(false)
      expect(claimsIntakeOpen()).toBe(false)
    }
    product('true', 'true')
    expect(isClaimsSurfaceEnabled()).toBe(true)
    expect(isClaimsIntakeEnabled()).toBe(true)
  })

  it('SURFACE=true · INTAKE=true → surface open, intake open; SURFACE=true · INTAKE=false → surface open, intake CLOSED', () => {
    product('true', 'true')
    expect([claimsSurfaceOpen(), claimsIntakeOpen()]).toEqual([true, true])
    product('true', 'false')
    expect([claimsSurfaceOpen(), claimsIntakeOpen()]).toEqual([true, false])
    delete process.env.CLAIMS_INTAKE_ENABLED
    expect([claimsSurfaceOpen(), claimsIntakeOpen()]).toEqual([true, false])
  })

  it('INTAKE=true without SURFACE=true opens NOTHING (fail-closed), even beside an open legacy lease it is the lease that decides', () => {
    product(undefined, 'true')
    expect([claimsSurfaceOpen(), claimsIntakeOpen()]).toEqual([false, false])
    product('false', 'true')
    expect([claimsSurfaceOpen(), claimsIntakeOpen()]).toEqual([false, false])
    // SURFACE absent + lease open ⇒ the lease opens both (Mode A/B shape), INTAKE is not consulted
    delete process.env.CLAIMS_SURFACE_ENABLED
    lease()
    expect([claimsSurfaceOpen(), claimsIntakeOpen()]).toEqual([true, true])
    process.env.CLAIMS_INTAKE_ENABLED = 'false'
    expect([claimsSurfaceOpen(), claimsIntakeOpen()]).toEqual([true, true])
  })

  it('SURFACE=true makes the legacy lease INERT: the lease neither opens the intake nor changes the surface', () => {
    product('true', 'false')
    lease()
    expect(isClaimsEnabled()).toBe(true)                 // the lease itself still reads open …
    expect([claimsSurfaceOpen(), claimsIntakeOpen()]).toEqual([true, false]) // … but decides nothing
    product('false', 'false')
    lease()
    // SURFACE explicitly 'false' is « product flags absent » for the matrix: the lease still governs (spec §3.1: only
    // SURFACE='true' makes the lease inert) — the kill-switch procedure therefore also requires the lease absent.
    expect([claimsSurfaceOpen(), claimsIntakeOpen()]).toEqual([true, true])
  })

  it('S-12 — product flags ABSENT ⇒ claimsSurfaceOpen ≡ claimsIntakeOpen ≡ isClaimsEnabled over every lease state', () => {
    const states: Array<[string, () => void]> = [
      ['absent', () => {}],
      ['flag only', () => { process.env.CLAIMS_ENABLED = 'true' }],
      ['open lease', () => lease()],
      ['expired lease', () => lease(-1000)],
      ['too long', () => lease(CLAIMS_WINDOW_MAX_MS + 60_000)],
      ['unreadable', () => { process.env.CLAIMS_ENABLED = 'true'; process.env.CLAIMS_WINDOW_UNTIL = 'soon' }],
      ["flag 'TRUE'", () => { process.env.CLAIMS_ENABLED = 'TRUE'; process.env.CLAIMS_WINDOW_UNTIL = new Date(Date.now() + 60_000).toISOString() }],
    ]
    for (const [name, arm] of states) {
      clearFlags(); arm()
      const legacy = isClaimsEnabled()
      expect(claimsSurfaceOpen(), name).toBe(legacy)
      expect(claimsIntakeOpen(), name).toBe(legacy)
      expect(claimNoticeGate('pre_money'), name).toBe(legacy)
      expect(claimNoticeGate('post_money'), name).toBe(true)
      expect(claimNoticeGate('closure'), name).toBe(true)
    }
    // the legacy reader is byte-for-byte the T-53 lease: reasons preserved
    clearFlags(); expect(claimsGateState()).toEqual({ open: false, reason: 'flag_off' })
    process.env.CLAIMS_ENABLED = 'true'; expect(claimsGateState()).toEqual({ open: false, reason: 'no_lease' })
    process.env.CLAIMS_WINDOW_UNTIL = 'soon'; expect(claimsGateState()).toEqual({ open: false, reason: 'lease_unreadable' })
    lease(-1); expect(claimsGateState()).toEqual({ open: false, reason: 'lease_expired' })
    lease(CLAIMS_WINDOW_MAX_MS + 1000); expect(claimsGateState()).toEqual({ open: false, reason: 'lease_too_long' })
    lease(); expect(claimsGateState().open).toBe(true)
  })

  it('claimNoticeGate: pre_money follows the surface; post_money and closure are ALWAYS true (S-25), and the snapshot names every gate', () => {
    clearFlags()
    expect(claimNoticeGate('pre_money')).toBe(false)
    expect(claimNoticeGate('post_money')).toBe(true)
    expect(claimNoticeGate('closure')).toBe(true)
    product('true', 'false')
    expect(claimNoticeGate('pre_money')).toBe(true)
    expect(claimsFlagsSnapshot()).toMatchObject({ surfaceFlag: true, intakeFlag: false, surfaceOpen: true, intakeOpen: false, legacy: { open: false, reason: 'flag_off' } })
  })

  it('lib/claims re-exports the legacy readers (existing importers keep working) and they are the same functions', () => {
    expect(claimsModule.isClaimsEnabled).toBe(isClaimsEnabled)
    expect(claimsModule.claimsGateState).toBe(claimsGateState)
    expect(claimsModule.CLAIMS_WINDOW_MAX_MS).toBe(CLAIMS_WINDOW_MAX_MS)
  })
})

// ── the routes ───────────────────────────────────────────────────────────────────────────────────────────────────
describe('POST /api/claims — surface, then intake (S-23)', () => {
  it('kill-switch (no flag, no lease) → 403 {gated:true}, no token read, no DB work', async () => {
    const res = await post({ orderId: 'o1', reason: 'quality' })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ gated: true })
    expect(tokenMock).not.toHaveBeenCalled()
    expect(db.order.findUnique).not.toHaveBeenCalled()
  })

  it("SURFACE=true · INTAKE=false → 403 {gated:false, enabled:true, intakeOpen:false, reason:'intake_closed'} before auth; a probe never reads CLOSED", async () => {
    product('true', 'false')
    const res = await post({ orderId: 'o1', reason: 'quality' })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body).toEqual({ error: 'Dépôt de réclamation suspendu', gated: false, enabled: true, intakeOpen: false, reason: 'intake_closed' })
    expect(tokenMock).not.toHaveBeenCalled()
    expect(db.claim.create).not.toHaveBeenCalled()
    // the operators' probe: 403 is CLOSED only with gated:true or enabled:false — this shape is neither
    const probe = res.status === 403 && (body.gated === true || body.enabled === false) ? 'CLOSED' : `UNKNOWN(${res.status})`
    expect(probe).toBe('UNKNOWN(403)')
  })

  it('SURFACE=true · INTAKE=true → 201, the ack e-mail carries claimsOpen from the pre_money gate (true)', async () => {
    product('true', 'true')
    const res = await post({ orderId: 'o1', reason: 'quality' })
    expect(res.status).toBe(201)
    expect(db.claim.create).toHaveBeenCalledTimes(1)
    expect(ackMock).toHaveBeenCalledWith(expect.objectContaining({ claimsOpen: true }))
  })

  it('S-12 — legacy lease alone (Mode A shape): 201 exactly as before; expired lease: 403 gated', async () => {
    lease()
    expect((await post({ orderId: 'o1', reason: 'quality' })).status).toBe(201)
    clearFlags(); lease(-1000)
    const res = await post({ orderId: 'o1', reason: 'quality' })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ gated: true })
  })

  it('INTAKE=true without SURFACE opens nothing: 403 {gated:true} (fail-closed)', async () => {
    product(undefined, 'true')
    const res = await post({ orderId: 'o1', reason: 'quality' })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ gated: true })
  })
})

describe('GET /api/claims — surface; ?orderId overlay (S-23)', () => {
  it('kill-switch → {enabled:false} without auth', async () => {
    const res = await get('?orderId=o1')
    expect(await res.json()).toEqual({ enabled: false })
    expect(tokenMock).not.toHaveBeenCalled()
  })

  it('SURFACE=true · INTAKE=false → {enabled:true, intakeOpen:false, eligibility overlaid canClaim:false / intake_closed}; history unchanged', async () => {
    product('true', 'false')
    const res = await get('?orderId=o1')
    const body = await res.json()
    expect(body).toMatchObject({ enabled: true, intakeOpen: false, eligibility: { canClaim: false, reason: 'intake_closed' } })
    // the engine's own facts are KEPT under the overlay (existingClaim / scope / ceiling)
    expect(body.eligibility).toHaveProperty('existingClaim')
    expect(body.eligibility).toHaveProperty('maxRefundableCents')
    const hist = await (await get()).json()
    expect(hist).toEqual({ enabled: true, claims: [] })
  })

  it("SURFACE=true · INTAKE=false · not the owner → 'not_owner' is NOT overlaid (nothing about the order is disclosed)", async () => {
    product('true', 'false')
    tokenMock.mockResolvedValue({ sub: 'someone_else' })
    const body = await (await get('?orderId=o1')).json()
    expect(body.eligibility).toMatchObject({ canClaim: false, reason: 'not_owner' })
    expect(body.intakeOpen).toBe(false)
  })

  it('SURFACE=true · INTAKE=true → the engine verdict as is, intakeOpen:true', async () => {
    product('true', 'true')
    const body = await (await get('?orderId=o1')).json()
    expect(body).toMatchObject({ enabled: true, intakeOpen: true, eligibility: { canClaim: true } })
    expect(body.eligibility.reason).toBeUndefined()
  })

  it('NEGATIVE CONTROL — getClaimEligibility itself never returns intake_closed (the overlay is the route’s)', async () => {
    product('true', 'false')
    const e = await claimsModule.getClaimEligibility({ consumerId: 'owner', orderId: 'o1' })
    expect(e.canClaim).toBe(true)
    expect(e.reason).toBeUndefined()
  })
})

describe('GET /api/admin/claims — split by the surface (spec v2 §3.2)', () => {
  it('surface open (product) → the full payload, enabled:true', async () => {
    product('true', 'false')
    const body = await (await getAdminClaims()).json()
    expect(body.enabled).toBe(true)
    expect(body.claims).toHaveLength(1)
    expect(body.pending).toHaveLength(1)
    expect(body.silenceExpired).toHaveLength(1)
    expect(body.actionableRefunds).toHaveLength(1)
    expect(body.counts.actionableTotal).toBe(2)
  })

  it('kill-switch → enabled:false, workflow lists EMPTY, actionableRefunds STILL RETURNED, counts.actionableTotal = money', async () => {
    const body = await (await getAdminClaims()).json()
    expect(body).toEqual({
      enabled: false, claims: [], pending: [], silenceExpired: [],
      actionableRefunds: [{ id: 'm1', moneyState: 'approved_not_driven' }],
      counts: { arbitration: 0, silenceExpired: 0, legacyPendingMoney: 0, actionableRefunds: 1, actionableTotal: 1 },
    })
    expect(listMocks.queue).not.toHaveBeenCalled()
    expect(listMocks.money).toHaveBeenCalledTimes(1)
  })

  it('kill-switch · not an admin → {enabled:false} only (the pre-L1 shape; no money list for a non-admin)', async () => {
    adminMock.mockResolvedValue(null)
    const res = await getAdminClaims()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enabled: false })
    expect(listMocks.money).not.toHaveBeenCalled()
  })

  it('surface open · not an admin → 403 as before', async () => {
    product('true', 'true')
    adminMock.mockResolvedValue(null)
    expect((await getAdminClaims()).status).toBe(403)
  })
})

// ── S-13 — what the product flags never open ─────────────────────────────────────────────────────────────────────
describe('S-13 — the product flags open neither auto-approve, nor auto-resolve, nor the engine', () => {
  it('autoResolveSmallClaim stays inert under SURFACE+INTAKE and its own flag+ceiling', async () => {
    product('true', 'true')
    process.env.CLAIM_AUTO_RESOLVE_ENABLED = 'true'; process.env.CLAIM_AUTO_APPROVE_MAX_CENTS = '5000'
    try {
      const r = await claimsModule.autoResolveSmallClaim({ id: 'cl1', consumerId: 'owner', requestedAmountCents: 100, status: 'restaurant_review' })
      expect(r).toEqual({ state: 'not_eligible' })
      expect(db.claim.updateMany).not.toHaveBeenCalled()
    } finally { delete process.env.CLAIM_AUTO_RESOLVE_ENABLED; delete process.env.CLAIM_AUTO_APPROVE_MAX_CENTS }
  })

  it('the auto-approve route keeps the LEGACY lease + its own flag: SURFACE+INTAKE alone → 403 gated', async () => {
    product('true', 'true')
    const { POST } = await import('@/app/api/admin/claims/auto-approve/route')
    const res = await POST(new Request('https://app.grubano.com/api/admin/claims/auto-approve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ gated: true })
  })

  it('the coupling: INTAKE ⇒ SURFACE is an ERROR; no rule couples a claims flag to REFUNDS_ENABLED; 21 rules', () => {
    expect(COUPLING_RULES).toHaveLength(21)
    expect(checkFlagCoupling({ CLAIMS_INTAKE_ENABLED: 'true' }).ok).toBe(false)
    expect(checkFlagCoupling({ CLAIMS_INTAKE_ENABLED: 'true' }).errors[0]).toMatch(/CLAIMS_INTAKE_ENABLED=true exige CLAIMS_SURFACE_ENABLED=true/)
    expect(checkFlagCoupling({ CLAIMS_INTAKE_ENABLED: 'true', CLAIMS_SURFACE_ENABLED: 'true' }).ok).toBe(true)
    expect(checkFlagCoupling({ CLAIMS_INTAKE_ENABLED: 'TRUE' }).ok).toBe(true) // 'TRUE' is OFF: nothing to couple
    expect(COUPLING_RULES.some((r) => /^CLAIMS_(SURFACE|INTAKE)_ENABLED$/.test(r.flag) && r.requires === 'REFUNDS_ENABLED')).toBe(false)
    expect(COUPLING_RULES.some((r) => r.flag === 'REFUNDS_ENABLED' && /^CLAIMS_(SURFACE|INTAKE)_ENABLED$/.test(r.requires))).toBe(false)
    // WARNINGS: lease beside the product surface; a non-'true' value
    expect(checkFlagWarnings({ CLAIMS_SURFACE_ENABLED: 'true', CLAIMS_ENABLED: 'true', CLAIMS_WINDOW_UNTIL: new Date(Date.now() + 60_000).toISOString(), REFUNDS_ENABLED: 'true' }).some((m) => /bail legacy .* INERTE/.test(m))).toBe(true)
    expect(checkFlagWarnings({ CLAIMS_SURFACE_ENABLED: 'TRUE' }).some((m) => /seule la chaîne exacte « true »/.test(m))).toBe(true)
    expect(checkFlagWarnings({ CLAIMS_SURFACE_ENABLED: 'true', CLAIMS_INTAKE_ENABLED: 'true' })).toEqual([])
  })
})

// ── static pins: the sites and the operators (S-14) ──────────────────────────────────────────────────────────────
describe('STATIC PINS — the 25 sites read lib/claim-flags; the operators refuse BY NAME (S-14)', () => {
  const src = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

  it('no product site reads isClaimsEnabled() any more except the auto-approve route (legacy lease + own flag) and lib/claim-flags itself', () => {
    const readers = [
      'app/api/claims/route.ts', 'app/api/claims/[id]/contest/route.ts', 'app/api/claims/[id]/respond/route.ts', 'app/api/claims/restaurant/route.ts',
      'app/api/admin/claims/route.ts', 'app/api/admin/claims/stale-alerts/route.ts', 'app/api/admin/claims/[id]/arbitrate/route.ts',
      'app/api/admin/claims/[id]/attribute/route.ts', 'app/api/admin/claims/[id]/closure-notice/route.ts', 'app/api/admin/claims/[id]/reconcile/route.ts',
      'app/api/admin/claims/[id]/resolve-stuck/route.ts', 'app/api/admin/claims/census/route.ts', 'app/api/orders/[id]/status/route.ts',
      'app/[locale]/admin/claims/page.tsx', 'app/[locale]/orders/page.tsx', 'lib/admin-overview.ts', 'lib/admin-establishments.ts', 'lib/claims.ts',
    ]
    for (const p of readers) expect(strip(src(p)), p).not.toMatch(/\bisClaimsEnabled\(\)/)
    expect(strip(src('app/api/admin/claims/auto-approve/route.ts'))).toMatch(/if \(!isClaimsEnabled\(\)\)/)
    // lib/claims re-exports, defines nothing
    expect(src('lib/claims.ts')).toMatch(/export \{ CLAIMS_WINDOW_MAX_MS, claimsGateState, isClaimsEnabled, type ClaimsGateState \} from '@\/lib\/claim-flags'/)
    expect(strip(src('lib/claims.ts'))).not.toMatch(/process\.env\.CLAIMS_ENABLED/)
    // lib/claim-flags imports nothing
    expect(strip(src('lib/claim-flags.ts'))).not.toMatch(/\bimport\b/)
  })

  it('every claim sender call passes claimsOpen: claimNoticeGate(<class>) by the calling file’s class (FIN-EMAIL-01 §6.2)', () => {
    const CLASS: Record<string, 'pre_money' | 'closure'> = {
      'app/api/claims/route.ts': 'pre_money', 'app/api/claims/[id]/respond/route.ts': 'pre_money', 'app/api/admin/claims/[id]/arbitrate/route.ts': 'pre_money',
      'app/api/orders/[id]/status/route.ts': 'pre_money',
      'app/api/admin/claims/[id]/attribute/route.ts': 'closure', 'app/api/admin/claims/[id]/closure-notice/route.ts': 'closure',
      'app/api/admin/claims/[id]/reconcile/route.ts': 'closure', 'app/api/admin/claims/[id]/resolve-stuck/route.ts': 'closure',
    }
    for (const [p, cls] of Object.entries(CLASS)) {
      const s = strip(src(p))
      const calls = s.match(/claimsOpen:\s*[^,\n]+/g) ?? []
      if (p.endsWith('status/route.ts')) { expect(s).toMatch(/const claimsOpenNow = claimNoticeGate\('pre_money'\)/); continue }
      expect(calls.length, p).toBeGreaterThan(0)
      for (const c of calls) expect(c, p).toMatch(new RegExp(`claimsOpen:\\s*claimNoticeGate\\('${cls}'\\)`))
      expect(s, p).not.toMatch(/claimsOpen:\s*(true|isClaimsEnabled\(\)|claimsSurfaceOpen\(\))/)
    }
  })

  it('status route: the SYSTEM claim is gated by the SURFACE (never the intake); the split admin GET returns money when closed', () => {
    const st = strip(src('app/api/orders/[id]/status/route.ts'))
    expect(st).toMatch(/const claimsOn = claimsSurfaceOpen\(\)/)
    expect(st).not.toMatch(/claimsIntakeOpen/)
    const adm = strip(src('app/api/admin/claims/route.ts'))
    expect(adm).toMatch(/if \(!surfaceOpen\) \{[\s\S]*listActionableRefundClaims\(\)[\s\S]*enabled: false,[\s\S]*claims: \[\], pending: \[\], actionableRefunds, silenceExpired: \[\]/)
  })

  it('operators: Mode A, Mode B and refund-gate window refuse under the product flags, naming the flag; provenance watches both flags', () => {
    const a = src('scripts/server/phase2-claims-gate.js')
    expect(a).toMatch(/const PRODUCT_CLAIMS_FLAGS = \['CLAIMS_SURFACE_ENABLED', 'CLAIMS_INTAKE_ENABLED'\]/)
    expect(a).toMatch(/A\('1 env: ' \+ k \+ ' is true — the claims PRODUCT flags \(D′\) are active/)
    expect(a).toMatch(/return fail\('3 window: ' \+ k \+ ' is true — MODE A is impossible under the claims PRODUCT flags/)
    expect(a).toMatch(/UNKNOWN\(403\) = intake_closed/)
    const b = src('scripts/server/phase2-modeb-gate.js')
    expect(b).toMatch(/for \(const k of \['CLAIMS_SURFACE_ENABLED', 'CLAIMS_INTAKE_ENABLED'\]\) \{[\s\S]*?return fail\('1 flag: ' \+ k \+ ' est ACTIF — les flags PRODUIT réclamations \(D′\)/)
    const r = src('scripts/server/phase2-refund-gate.js')
    expect(r).toMatch(/for \(const k of \['CLAIMS_SURFACE_ENABLED', 'CLAIMS_INTAKE_ENABLED'\]\) \{[\s\S]*?A\('1 env: ' \+ k \+ ' is true — the claims PRODUCT flags \(D′\) are active/)
    expect(r).toMatch(/async function probeClaimsGate\(base\)/)
    expect(r).toMatch(/const claimsGate0 = await probeClaimsGate\(base\)[\s\S]*?if \(claimsGate0 !== 'CLOSED'\) A\(/)
    const { WATCHED_SECRET_KEYS } = require('../scripts/server/env-provenance.js') as { WATCHED_SECRET_KEYS: string[] }
    expect(WATCHED_SECRET_KEYS).toEqual(expect.arrayContaining(['CLAIMS_SURFACE_ENABLED', 'CLAIMS_INTAKE_ENABLED']))
  })

  it('the client renders intake_closed (help page + i18n ×5) and the admin console has its surface-closed empty copy ×5', () => {
    expect(src('app/[locale]/eat/order/[orderId]/help/page.tsx')).toMatch(/case 'intake_closed':\s*return t\('claimIntakeClosed'\)/)
    for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
      const m = JSON.parse(readFileSync(`messages/${loc}.json`, 'utf8')) as { eat: { help: Record<string, string> }; claims: { admin: Record<string, string> } }
      expect(typeof m.eat.help.claimIntakeClosed, loc).toBe('string')
      expect(typeof m.claims.admin.surfaceClosedEmpty, loc).toBe('string')
    }
  })

  it('NEGATIVE CONTROL — the 05152b6 shapes are caught: isClaimsEnabled() in a product site, claimsOpen: isClaimsEnabled(), a page gating the console, an operator without the refusal', () => {
    expect(strip("if (!isClaimsEnabled()) return NextResponse.json({ enabled: false })")).toMatch(/\bisClaimsEnabled\(\)/)
    expect('claimsOpen:    isClaimsEnabled(),').toMatch(/claimsOpen:\s*(true|isClaimsEnabled\(\)|claimsSurfaceOpen\(\))/)
    expect('claimsOpen: true').toMatch(/claimsOpen:\s*(true|isClaimsEnabled\(\)|claimsSurfaceOpen\(\))/)
    expect(strip(src('app/[locale]/admin/claims/page.tsx'))).not.toMatch(/\{claimsOpen && <AdminClaimsArbitration/)
    expect("const MODE = process.argv[2] === 'window' ? 'window' : 'precheck'\n").not.toMatch(/PRODUCT_CLAIMS_FLAGS/)
  })
})
