import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { updateManyMock } from './support/prisma-where'
import { Prisma } from '@prisma/client'

// ── P4.5-C2 — lib/claims extensions: auto-resolution, contest, arbitration, abuse ──
// Reuses the C1 idempotent refund trigger. Prisma + the P4.5-A engine are mocked.
// P0-27 (vague 1) : l'auto-résolution est désormais FAIL-SAFE — double verrou
// CLAIM_AUTO_RESOLVE_ENABLED (défaut OFF) + CLAIM_AUTO_APPROVE_MAX_CENTS (défaut 0,
// mal formée → 0). Les tests positifs du bloc (a) stubbent donc la config post-pilote
// COMPLÈTE ; le bloc (a-bis) épingle le contrat fail-safe sans configuration.

const { db } = vi.hoisted(() => ({
  db: {
    claim: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn(), groupBy: vi.fn(), findMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { execMock, refundsFlag } = vi.hoisted(() => ({ execMock: vi.fn(), refundsFlag: vi.fn() }))
vi.mock('@/lib/refund', () => ({ executeRefund: execMock, isRefundsEnabled: refundsFlag }))

import {
  autoResolveSmallClaim, contestClaim, arbitrateClaim, isConsumerAbuseFlagged,
  consumerClaimStats, restaurantRefusalStats,
} from '@/lib/claims'

const fx = { row: null as Record<string, unknown> | null, updateManyCount: 1, recent: 0 }

beforeEach(() => {
  vi.clearAllMocks()
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
  db.claim.findUnique.mockResolvedValue({ id: 'cl1', orderId: 'o1', requestedAmountCents: 500 })
  db.claim.count.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
    Promise.resolve(where.createdAt ? fx.recent : 0))
  execMock.mockResolvedValue({ ok: true, refundId: 'rf1', stripeRefundId: 're_1' })
  refundsFlag.mockReturnValue(true)
})

afterEach(() => vi.unstubAllEnvs())

describe('(a) auto-resolution of small claims — config post-pilote EXPLICITE (P0-27)', () => {
  // Sans ces DEUX stubs, plus rien ne s'auto-résout (contrat épinglé en (a-bis)).
  beforeEach(() => {
    vi.stubEnv('CLAIM_AUTO_RESOLVE_ENABLED', 'true')
    vi.stubEnv('CLAIM_AUTO_APPROVE_MAX_CENTS', '1000')
  })

  it('≤ ceiling + not flagged → approve + ONE refund', async () => {
    const r = await autoResolveSmallClaim({ id: 'cl1', consumerId: 'c1', requestedAmountCents: 500, status: 'restaurant_review' })
    expect(r).toMatchObject({ state: 'refunded', refundId: 'rf1' })
    expect(execMock).toHaveBeenCalledTimes(1)
    const approved = db.claim.updateMany.mock.calls.find((c) => c[0]?.data?.decidedBy === 'auto_small')
    expect(approved).toBeTruthy()
  })

  it('> ceiling → NOT eligible (normal C1 flow, no refund)', async () => {
    const r = await autoResolveSmallClaim({ id: 'cl1', consumerId: 'c1', requestedAmountCents: 5000, status: 'restaurant_review' })
    expect(r).toEqual({ state: 'not_eligible' })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
    expect(execMock).not.toHaveBeenCalled()
  })

  it('≤ ceiling BUT consumer flagged for abuse → NOT auto (oriented to resto review)', async () => {
    fx.recent = 5 // ≥ threshold 3
    const r = await autoResolveSmallClaim({ id: 'cl1', consumerId: 'c1', requestedAmountCents: 500, status: 'restaurant_review' })
    expect(r).toEqual({ state: 'not_eligible' })
    expect(execMock).not.toHaveBeenCalled()
  })

  it('REFUNDS off → small claim approved but refund PENDING (no double, no silent refund)', async () => {
    refundsFlag.mockReturnValue(false)
    const r = await autoResolveSmallClaim({ id: 'cl1', consumerId: 'c1', requestedAmountCents: 500, status: 'restaurant_review' })
    expect(r).toEqual({ state: 'pending', reason: 'refunds_disabled' })
    expect(execMock).not.toHaveBeenCalled()
  })
})

// ── P0-27 — le contrat FAIL-SAFE : sans config, une réclamation de 5 € ne
// déclenche RIEN ; une valeur mal formée ne réactive JAMAIS l'auto-remboursement.
describe('(a-bis) P0-27 — verrou fail-safe de l’auto-résolution', () => {
  const smallClaim = { id: 'cl1', consumerId: 'c1', requestedAmountCents: 500, status: 'restaurant_review' }

  it('⭐ SANS AUCUNE configuration (état bêta) : réclamation de 5 € → not_eligible, ZÉRO refund, ZÉRO écriture, et le refus est TRACÉ (console.warn)', async () => {
    vi.stubEnv('CLAIM_AUTO_RESOLVE_ENABLED', '')     // déterministe même si l'env CI pose la var
    vi.stubEnv('CLAIM_AUTO_APPROVE_MAX_CENTS', '')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await autoResolveSmallClaim(smallClaim)
    expect(r).toEqual({ state: 'not_eligible' })
    expect(execMock).not.toHaveBeenCalled()
    expect(db.claim.updateMany).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('CLAIM_AUTO_RESOLVE_ENABLED'))
    warnSpy.mockRestore()
  })

  it('flag ON mais plafond ABSENT → 0 = désactivé (le verrou n°2 tient seul) ET tracé « config incomplète » (revue : jamais un no-op silencieux)', async () => {
    vi.stubEnv('CLAIM_AUTO_RESOLVE_ENABLED', 'true')
    vi.stubEnv('CLAIM_AUTO_APPROVE_MAX_CENTS', '')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await autoResolveSmallClaim(smallClaim)
    expect(r).toEqual({ state: 'not_eligible' })
    expect(execMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('absent/0'))
    warnSpy.mockRestore()
  })

  it('flag ON + plafond NON NUMÉRIQUE (« dix-euros ») → 0 tracé, jamais permissif', async () => {
    vi.stubEnv('CLAIM_AUTO_RESOLVE_ENABLED', 'true')
    vi.stubEnv('CLAIM_AUTO_APPROVE_MAX_CENTS', 'dix-euros')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await autoResolveSmallClaim(smallClaim)
    expect(r).toEqual({ state: 'not_eligible' })
    expect(execMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('mal formée'))
    warnSpy.mockRestore()
  })

  it('flag ON + plafond NÉGATIF (« -1000 ») → rejeté par le parse strict (regex \\d+) → 0, aucun refund', async () => {
    vi.stubEnv('CLAIM_AUTO_RESOLVE_ENABLED', 'true')
    vi.stubEnv('CLAIM_AUTO_APPROVE_MAX_CENTS', '-1000')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await autoResolveSmallClaim(smallClaim)
    expect(r).toEqual({ state: 'not_eligible' })
    expect(execMock).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it("flag ON + plafond PARTIELLEMENT numérique (« 1000abc » — parseInt laxiste l'accepterait) → rejeté strict, 0, aucun refund", async () => {
    vi.stubEnv('CLAIM_AUTO_RESOLVE_ENABLED', 'true')
    vi.stubEnv('CLAIM_AUTO_APPROVE_MAX_CENTS', '1000abc')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await autoResolveSmallClaim(smallClaim)
    expect(r).toEqual({ state: 'not_eligible' })
    expect(execMock).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it("seul le string exact 'true' active le verrou n°1 — 'TRUE' et '1' restent OFF", async () => {
    vi.stubEnv('CLAIM_AUTO_APPROVE_MAX_CENTS', '1000')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const v of ['TRUE', '1']) {
      vi.stubEnv('CLAIM_AUTO_RESOLVE_ENABLED', v)
      const r = await autoResolveSmallClaim(smallClaim)
      expect(r).toEqual({ state: 'not_eligible' })
    }
    expect(execMock).not.toHaveBeenCalled()
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

describe('(c) admin arbitration', () => {
  it('approve → CAS + ONE refund + approved', async () => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', status: 'arbitration', orderId: 'o1', requestedAmountCents: 500 })
    const r = await arbitrateClaim({ claimId: 'cl1', adminId: 'admin1', decision: 'approve' })
    expect(r.ok).toBe(true)
    expect(execMock).toHaveBeenCalledTimes(1)
    const approved = db.claim.updateMany.mock.calls.find((c) => c[0]?.data?.arbitrationDecision === 'approved')
    expect(approved?.[0].data).toMatchObject({ status: 'approved', arbitratedBy: 'admin1', decidedBy: 'admin' })
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
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', status: 'arbitration', orderId: 'o1', requestedAmountCents: 500 })
    fx.updateManyCount = 0
    expect(await arbitrateClaim({ claimId: 'cl1', adminId: 'a', decision: 'approve' })).toMatchObject({ ok: false, status: 409 })
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
