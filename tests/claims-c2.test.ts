import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { updateManyMock } from './support/prisma-where'
import { Prisma } from '@prisma/client'

// ── P4.5-C2 — lib/claims extensions: auto-resolution, contest, arbitration, abuse ──
// Prisma + the P4.5-A engine are mocked.
// P0-27 (vague 1) : l'auto-résolution était FAIL-SAFE — double verrou CLAIM_AUTO_RESOLVE_ENABLED
// (défaut OFF) + CLAIM_AUTO_APPROVE_MAX_CENTS (défaut 0, mal formée → 0).
// D′ L2 (spec v2 S-02/S-13) : `autoResolveSmallClaim` est INERTE PAR CONSTRUCTION — elle rend
// { state:'not_eligible' } quelle que soit la config (même la config post-pilote COMPLÈTE), sans lire la
// base ni le bail, sans écrire, sans moteur. Le bloc (a) l'épingle avec la config la plus permissive ;
// le bloc (a-bis) garde le parse strict des LECTEURS P0-27 (check-flags/recensement) et prouve qu'ils
// n'autorisent plus rien. `arbitrateClaim` approve = DÉCISION MÉTIER seule (bloc (c)) : jamais le moteur.

const { db } = vi.hoisted(() => ({
  db: {
    claim: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
    refund: { findUnique: vi.fn(), findMany: vi.fn(), aggregate: vi.fn(), findFirst: vi.fn() },
    order: { findUnique: vi.fn() },
    franchiseRoyalty: { findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { execMock, refundsFlag } = vi.hoisted(() => ({ execMock: vi.fn(), refundsFlag: vi.fn() }))
vi.mock('@/lib/refund', () => ({ executeRefund: execMock, isRefundsEnabled: refundsFlag, RESUME_CREATE_WINDOW_MS: 20 * 60 * 60 * 1000 }))
// ROUND 13 (C3): the approval path reads Stripe before the engine — never the real Stripe.
const { stripeMock } = vi.hoisted(() => ({ stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() } } }))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: vi.fn(async () => ({ status: 'sent' })) }))
import { payableWorld, wireWorld, engineOk, claimOf } from './support/claims-world'
/** ROUND 13 (C3): T1 → T2 on fresh reads → the engine → T4, driven in an in-memory world. */
const world = (claim: Record<string, unknown>) => {
  const w = payableWorld(claim)
  wireWorld(w, db, stripeMock)
  execMock.mockResolvedValue(engineOk({ refundId: 'rf1', stripeRefundId: 're_1' }))
  return w
}

import { APPROVE_CONFIRM_WORD, APPROVE_CONFIRM_REQUIRED } from '@/lib/claim-action-rules'
import {
  autoResolveSmallClaim, contestClaim, arbitrateClaim, isConsumerAbuseFlagged,
  consumerClaimStats, restaurantRefusalStats, triggerClaimRefund,
  isClaimAutoResolveEnabled, claimAutoApproveMaxCents,
} from '@/lib/claims'

const fx = { row: null as Record<string, unknown> | null, updateManyCount: 1, recent: 0 }

beforeEach(() => {
  vi.clearAllMocks()
  for (const m of [db.claim.findFirst, db.claim.findMany, db.refund.findFirst, db.order.findUnique, db.franchiseRoyalty.findFirst]) m.mockReset()
  fx.updateManyCount = 1; fx.recent = 0; fx.row = null;
  // GATE T-49: this mock used to ignore the where clause entirely, so every compare-and-set
  // exercised here (approveClaim, contestClaim, arbitrateClaim) was unverified — the guard
  // could match nothing and the test still passed. It now evaluates the clause whenever a
  // simulated row is supplied via fx.row; with fx.row null it keeps the previous permissive
  // behaviour so tests that never modelled a row are unaffected.
  // These suites name the forced count `updateManyCount`; adapt it rather than rename it
  // across every call site. Getters keep the fixture live between tests.
  db.claim.updateMany.mockImplementation(updateManyMock({
    get row() { return fx.row },
    get forcedCount() { return fx.updateManyCount },
  }))
  db.claim.update.mockResolvedValue({})
  // T-51: a claim may only be reported settled by a refund carrying ITS identity. The engine mock
  // returns row 'rf1', so the fixture row must be stamped for this claim — otherwise the guard
  // fails closed (which is the point) and every binding becomes a resume_mismatch.
  db.refund.findUnique.mockResolvedValue({ id: 'rf1', reason: 'claim:cl1', status: 'succeeded' })
  db.refund.findMany.mockResolvedValue([])
  db.refund.aggregate.mockResolvedValue({ _sum: { amountCents: 0 } })
  db.claim.findUnique.mockResolvedValue({ id: 'cl1', orderId: 'o1', requestedAmountCents: 500 })
  db.claim.count.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
    Promise.resolve(where.createdAt ? fx.recent : 0))
  execMock.mockResolvedValue({ ok: true, refundId: 'rf1', stripeRefundId: 're_1' })
  refundsFlag.mockReturnValue(true)
})

afterEach(() => vi.unstubAllEnvs())

/** D′ L2: what an inert auto-resolution must leave — no claim read, no abuse read, no write, no lease read, no engine. */
const expectInert = (r: unknown) => {
  expect(r).toEqual({ state: 'not_eligible' })
  expect(db.claim.updateMany).not.toHaveBeenCalled()
  expect(db.claim.update).not.toHaveBeenCalled()
  expect(db.claim.findUnique).not.toHaveBeenCalled()
  expect(db.claim.count).not.toHaveBeenCalled()      // the abuse orientation is not even consulted
  expect(refundsFlag).not.toHaveBeenCalled()         // nor the REFUNDS lease
  expect(execMock).not.toHaveBeenCalled()
}

describe('(a) auto-resolution of small claims — INERT BY CONSTRUCTION even under the config post-pilote EXPLICITE (D′ L2 S-13, ex-P0-27)', () => {
  // The two stubs that USED to unlock the machine approval: under D′ they unlock nothing.
  beforeEach(() => {
    vi.stubEnv('CLAIM_AUTO_RESOLVE_ENABLED', 'true')
    vi.stubEnv('CLAIM_AUTO_APPROVE_MAX_CENTS', '1000')
  })

  it('≤ ceiling + not flagged + REFUNDS on + payable world → not_eligible, ZERO writes, ZERO engine (the old « approve + ONE refund » is gone)', async () => {
    const w = world({ status: 'restaurant_review', arbitrationDecision: null })
    expect(isClaimAutoResolveEnabled()).toBe(true)     // the readers DO say « permissive »…
    expect(claimAutoApproveMaxCents()).toBe(1000)
    const r = await autoResolveSmallClaim({ id: 'cl1', consumerId: 'c1', requestedAmountCents: 500, status: 'restaurant_review' })
    expectInert(r)                                     // …and the function ignores them
    expect(w.writes).toEqual([])
    expect(claimOf(w)).toMatchObject({ status: 'restaurant_review', arbitrationDecision: null })
    expect(claimOf(w).decidedBy).toBeUndefined()      // no 'auto_small' decision was ever written
  })

  it('NEGATIVE CONTROL — the same world DOES pay when the old machine path (status approved → triggerClaimRefund) is executed by hand: the « 0 engine » above observes the function, not the mocks', async () => {
    const w = world({ status: 'restaurant_review', arbitrationDecision: null })
    const r = await autoResolveSmallClaim({ id: 'cl1', consumerId: 'c1', requestedAmountCents: 500, status: 'restaurant_review' })
    expectInert(r)
    // what the pre-D′ autoResolveSmallClaim did: a machine approval, then the engine
    // D′ L4: the rail only pays a RATIFIED decision, so the hand-written machine approval carries one.
    Object.assign(claimOf(w), { status: 'approved', arbitrationDecision: 'approved', approvedAmountCents: 500, decidedBy: 'auto_small', decidedAt: new Date() })
    const t = await triggerClaimRefund('cl1')
    expect(t).toMatchObject({ state: 'refunded', refundId: 'rf1' })
    expect(execMock).toHaveBeenCalledTimes(1)
    expect(claimOf(w).status).toBe('refunded')
  })

  it('> ceiling → not_eligible (as before — but for no reason the ceiling decides: nothing is read)', async () => {
    const r = await autoResolveSmallClaim({ id: 'cl1', consumerId: 'c1', requestedAmountCents: 5000, status: 'restaurant_review' })
    expectInert(r)
  })

  it('≤ ceiling BUT consumer flagged for abuse → not_eligible (the abuse orientation is not what refuses: it is never read)', async () => {
    fx.recent = 5 // ≥ threshold 3
    const r = await autoResolveSmallClaim({ id: 'cl1', consumerId: 'c1', requestedAmountCents: 500, status: 'restaurant_review' })
    expectInert(r)
  })

  it('REFUNDS off → not_eligible, never { pending, refunds_disabled }: no approval is written for a rail to pay later', async () => {
    refundsFlag.mockReturnValue(false)
    const r = await autoResolveSmallClaim({ id: 'cl1', consumerId: 'c1', requestedAmountCents: 500, status: 'restaurant_review' })
    expectInert(r)
  })

  it('a safety reason, an ordinary reason, an absent reason → the same not_eligible: the function has no branch', async () => {
    for (const reason of ['allergen_safety', 'quality', undefined, null]) {
      const r = await autoResolveSmallClaim({ id: 'cl1', consumerId: 'c1', requestedAmountCents: 500, status: 'restaurant_review', reason })
      expectInert(r)
    }
  })
})

// ── P0-27 — les LECTEURS fail-safe restent stricts (check-flags / recensement les lisent encore) ; et sous D′ L2
// ils n'AUTORISENT plus rien : autoResolveSmallClaim rend not_eligible sans les consulter, config ou pas.
describe('(a-bis) P0-27 readers stay fail-safe — and authorise nothing (D′ L2: the auto-resolution is inert whatever they return)', () => {
  const smallClaim = { id: 'cl1', consumerId: 'c1', requestedAmountCents: 500, status: 'restaurant_review' }

  it('⭐ SANS AUCUNE configuration (état bêta) : les lecteurs disent OFF / 0 ; réclamation de 5 € → not_eligible, ZÉRO refund, ZÉRO écriture, et AUCUNE trace de verrou config (le refus n’est plus une décision de config : rien à tracer)', async () => {
    vi.stubEnv('CLAIM_AUTO_RESOLVE_ENABLED', '')     // déterministe même si l'env CI pose la var
    vi.stubEnv('CLAIM_AUTO_APPROVE_MAX_CENTS', '')
    expect(isClaimAutoResolveEnabled()).toBe(false)
    expect(claimAutoApproveMaxCents()).toBe(0)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await autoResolveSmallClaim(smallClaim)
    expectInert(r)
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('flag ON mais plafond ABSENT → le lecteur rend 0 (désactivé) ; la fonction reste not_eligible sans lire quoi que ce soit', async () => {
    vi.stubEnv('CLAIM_AUTO_RESOLVE_ENABLED', 'true')
    vi.stubEnv('CLAIM_AUTO_APPROVE_MAX_CENTS', '')
    expect(isClaimAutoResolveEnabled()).toBe(true)
    expect(claimAutoApproveMaxCents()).toBe(0)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await autoResolveSmallClaim(smallClaim)
    expectInert(r)
    expect(warnSpy).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('flag ON + plafond NON NUMÉRIQUE (« dix-euros ») → le LECTEUR rend 0 et le TRACE (« mal formée ») ; la fonction, elle, ne le lit pas', async () => {
    vi.stubEnv('CLAIM_AUTO_RESOLVE_ENABLED', 'true')
    vi.stubEnv('CLAIM_AUTO_APPROVE_MAX_CENTS', 'dix-euros')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(claimAutoApproveMaxCents()).toBe(0)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('mal formée'))
    warnSpy.mockClear()
    const r = await autoResolveSmallClaim(smallClaim)
    expectInert(r)
    expect(warnSpy).not.toHaveBeenCalled()             // no reader ran inside the function
    warnSpy.mockRestore()
  })

  it('flag ON + plafond NÉGATIF (« -1000 ») → rejeté par le parse strict (regex \\d+) → 0 ; not_eligible, aucun refund', async () => {
    vi.stubEnv('CLAIM_AUTO_RESOLVE_ENABLED', 'true')
    vi.stubEnv('CLAIM_AUTO_APPROVE_MAX_CENTS', '-1000')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(claimAutoApproveMaxCents()).toBe(0)
    const r = await autoResolveSmallClaim(smallClaim)
    expectInert(r)
    warnSpy.mockRestore()
  })

  it("flag ON + plafond PARTIELLEMENT numérique (« 1000abc » — parseInt laxiste l'accepterait) → rejeté strict, 0 ; not_eligible, aucun refund", async () => {
    vi.stubEnv('CLAIM_AUTO_RESOLVE_ENABLED', 'true')
    vi.stubEnv('CLAIM_AUTO_APPROVE_MAX_CENTS', '1000abc')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(claimAutoApproveMaxCents()).toBe(0)
    const r = await autoResolveSmallClaim(smallClaim)
    expectInert(r)
    warnSpy.mockRestore()
  })

  it("seul le string exact 'true' active le lecteur n°1 — 'TRUE' et '1' restent OFF ; et 'true' lui-même n'autorise rien", async () => {
    vi.stubEnv('CLAIM_AUTO_APPROVE_MAX_CENTS', '1000')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const v of ['TRUE', '1']) {
      vi.stubEnv('CLAIM_AUTO_RESOLVE_ENABLED', v)
      expect(isClaimAutoResolveEnabled()).toBe(false)
      expect(await autoResolveSmallClaim(smallClaim)).toEqual({ state: 'not_eligible' })
    }
    vi.stubEnv('CLAIM_AUTO_RESOLVE_ENABLED', 'true')
    expect(isClaimAutoResolveEnabled()).toBe(true)
    expect(await autoResolveSmallClaim(smallClaim)).toEqual({ state: 'not_eligible' })
    expect(execMock).not.toHaveBeenCalled()
    expect(db.claim.updateMany).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

describe('(b) contest a refusal', () => {
  const refused = { id: 'cl1', consumerId: 'c1', orderId: 'o1', status: 'refused', decidedAt: new Date() }

  it('owner + refused + within delay → arbitration', async () => {
    db.claim.findUnique.mockResolvedValue(refused)
    const r = await contestClaim({ claimId: 'cl1', consumerId: 'c1', reason: 'pas d’accord' })
    expect(r.ok).toBe(true)
    const moved = db.claim.updateMany.mock.calls.find((c) => c[0]?.data?.status === 'arbitration')
    expect(moved?.[0].data).toMatchObject({ status: 'arbitration', activeOrderKey: 'o1' })
  })

  it('non-owner → 404 (no IDOR)', async () => {
    db.claim.findUnique.mockResolvedValue({ ...refused, consumerId: 'other' })
    expect(await contestClaim({ claimId: 'cl1', consumerId: 'c1' })).toMatchObject({ ok: false, status: 404 })
  })

  it('not refused → 409', async () => {
    db.claim.findUnique.mockResolvedValue({ ...refused, status: 'restaurant_review' })
    expect(await contestClaim({ claimId: 'cl1', consumerId: 'c1' })).toMatchObject({ ok: false, status: 409 })
  })

  it('outside the contest delay → 409', async () => {
    db.claim.findUnique.mockResolvedValue({ ...refused, decidedAt: new Date(Date.now() - 49 * 3600 * 1000) })
    expect(await contestClaim({ claimId: 'cl1', consumerId: 'c1' })).toMatchObject({ ok: false, status: 409 })
  })

  it('a newer active claim holds the order (P2002) → 409', async () => {
    db.claim.findUnique.mockResolvedValue(refused)
    db.claim.updateMany.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }))
    expect(await contestClaim({ claimId: 'cl1', consumerId: 'c1' })).toMatchObject({ ok: false, status: 409 })
  })
})

describe('(c) admin arbitration — approve is a DECISION only (D′ L2 S-02/T-07)', () => {
  it('approve → CAS to approved + NO refund (0 engine, 0 lease read, no refund field): APPROVED_AWAITING_PAYMENT', async () => {
    // D′ L4 (T-07): the decision names the amount it approves, confirmed by hand.
    const w = world({ status: 'arbitration', arbitrationDecision: null, approvedAmountCents: null })
    const r = await arbitrateClaim({ claimId: 'cl1', adminId: 'admin1', decision: 'approve', approvedAmountCents: 500, confirm: APPROVE_CONFIRM_WORD })
    expect(r.ok).toBe(true)
    expect(r).not.toHaveProperty('refund')
    expect(execMock).not.toHaveBeenCalled()
    expect(refundsFlag).not.toHaveBeenCalled()
    const approved = db.claim.updateMany.mock.calls.find((c) => c[0]?.data?.arbitrationDecision === 'approved')
    expect(approved?.[0].data).toMatchObject({ status: 'approved', approvedAmountCents: 500, arbitratedBy: 'admin1', decidedBy: 'admin' })
    expect(approved?.[0].where).toMatchObject({ approvedAmountCents: null })  // S-29: never a rewrite
    expect(db.claim.updateMany).toHaveBeenCalledTimes(1)   // the decision CAS and nothing else (no T1 token)
    expect(claimOf(w)).toMatchObject({ status: 'approved', arbitrationDecision: 'approved', approvedAmountCents: 500, refundAttempted: false, refundId: null, refundError: null })
  })

  // D′ L4 NEGATIVE CONTROL — the pre-L4 shape (decision alone) used to write this very CAS; it now writes nothing.
  it('D′ L4 — the same approve WITHOUT its confirmation writes nothing at all (400)', async () => {
    const w = world({ status: 'arbitration', arbitrationDecision: null, approvedAmountCents: null })
    expect(await arbitrateClaim({ claimId: 'cl1', adminId: 'admin1', decision: 'approve' }))
      .toMatchObject({ ok: false, status: 400, error: APPROVE_CONFIRM_REQUIRED })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
    expect(execMock).not.toHaveBeenCalled()
    expect(claimOf(w)).toMatchObject({ status: 'arbitration', arbitrationDecision: null, approvedAmountCents: null })
  })

  it('NEGATIVE CONTROL — after that approve, the rail run by hand (triggerClaimRefund) DOES reach the engine once: the approve stopped short of it, the world did not', async () => {
    const w = world({ status: 'arbitration', arbitrationDecision: null, approvedAmountCents: null })
    const r = await arbitrateClaim({ claimId: 'cl1', adminId: 'admin1', decision: 'approve', approvedAmountCents: 500, confirm: APPROVE_CONFIRM_WORD })
    expect(r.ok).toBe(true)
    expect(execMock).not.toHaveBeenCalled()
    const t = await triggerClaimRefund('cl1')
    expect(t).toMatchObject({ state: 'refunded', refundId: 'rf1' })
    expect(execMock).toHaveBeenCalledTimes(1)
    expect(refundsFlag).toHaveBeenCalledTimes(1)             // the lease is the RAIL's concern
    expect(claimOf(w)).toMatchObject({ status: 'refunded', refundId: 'rf1' })
  })

  it('refuse_final → terminal, NO refund', async () => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', status: 'arbitration' })
    const r = await arbitrateClaim({ claimId: 'cl1', adminId: 'admin1', decision: 'refuse_final', reason: 'preuve insuffisante' })
    expect(r.ok).toBe(true)
    expect(execMock).not.toHaveBeenCalled()
    const done = db.claim.updateMany.mock.calls.find((c) => c[0]?.data?.status === 'refused_final')
    expect(done?.[0].data).toMatchObject({ status: 'refused_final', activeOrderKey: null, arbitratedBy: 'admin1' })
  })

  it('not in arbitration → 409, no refund', async () => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', status: 'refused' })
    expect(await arbitrateClaim({ claimId: 'cl1', adminId: 'a', decision: 'approve' })).toMatchObject({ ok: false, status: 409 })
    expect(execMock).not.toHaveBeenCalled()
  })

  it('re-arbitrate (lost the atomic guard) → 409, no double refund', async () => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', status: 'arbitration', orderId: 'o1', requestedAmountCents: 500, approvedAmountCents: null })
    fx.updateManyCount = 0
    expect(await arbitrateClaim({ claimId: 'cl1', adminId: 'a', decision: 'approve', approvedAmountCents: 500, confirm: APPROVE_CONFIRM_WORD })).toMatchObject({ ok: false, status: 409 })
    expect(execMock).not.toHaveBeenCalled()
  })
})

describe('(d) abuse signals (read-only)', () => {
  it('isConsumerAbuseFlagged: recent ≥ threshold → true', async () => {
    fx.recent = 3
    expect(await isConsumerAbuseFlagged('c1')).toBe(true)
    fx.recent = 1
    expect(await isConsumerAbuseFlagged('c1')).toBe(false)
  })

  it('consumerClaimStats aggregates total/recent/approval rate', async () => {
    db.claim.count.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(where.createdAt ? 2 : 5))
    db.claim.groupBy.mockResolvedValue([{ status: 'refunded', _count: 3 }, { status: 'refused', _count: 1 }])
    const s = await consumerClaimStats('c1')
    expect(s).toMatchObject({ total: 5, recent: 2, approved: 3, refused: 1 })
    expect(s.approvalRate).toBeCloseTo(0.75)
  })

  it('restaurantRefusalStats: overturn rate + flagged when ≥3 refused and ≥50% overturned', async () => {
    db.claim.count.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(where.arbitrationDecision ? 2 : 4))
    const s = await restaurantRefusalStats('r1')
    expect(s).toMatchObject({ refused: 4, overturned: 2 })
    expect(s.overturnRate).toBeCloseTo(0.5)
    expect(s.flagged).toBe(true)
  })
})

// ── GATE T-49 — DIFFERENTIAL CAS CONTROLS ────────────────────────────────────────
// This suite's updateMany mock used to ignore the where clause, so contestClaim's and
// arbitrateClaim's compare-and-set guards were exercised but never verified. These drive
// shipped code with a simulated row and assert an outcome the blind mock could not produce.
describe('the contest guard is enforced, not assumed', () => {
  const refused = { id: 'cl1', consumerId: 'c1', orderId: 'o1', status: 'refused', decidedAt: new Date() }

  it('a claim that already left `refused` cannot be contested a second time', async () => {
    // The CAS is `where: { id, status: 'refused' }`. A row that already moved to arbitration
    // must match zero. Under the blind mock this returned ok:true and re-acquired the lock.
    db.claim.findUnique.mockResolvedValue(refused)
    fx.row = { status: 'arbitration' }
    const r = await contestClaim({ claimId: 'cl1', consumerId: 'c1', reason: 'encore' })
    expect(r).toMatchObject({ ok: false, status: 409 })
  })

  it('…and a genuinely refused claim still contests, so the guard is not a blanket refusal', async () => {
    db.claim.findUnique.mockResolvedValue(refused)
    fx.row = { status: 'refused' }
    const r = await contestClaim({ claimId: 'cl1', consumerId: 'c1', reason: 'pas d’accord' })
    expect(r.ok).toBe(true)
  })

  it('contesting never moves money, whichever way the guard falls', async () => {
    db.claim.findUnique.mockResolvedValue(refused)
    fx.row = { status: 'arbitration' }
    await contestClaim({ claimId: 'cl1', consumerId: 'c1' })
    expect(execMock).not.toHaveBeenCalled()
  })
})
