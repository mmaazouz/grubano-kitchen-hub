import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── P4.5-A — franchise SETTLEMENT is refund-aware (Agent 49) ──────────────────────
// The settlement must disburse ONLY the NON-refunded royalty (royaltyCents −
// refundedCents): a partially-refunded 'pending' line settles on its remainder; a
// fully-refunded line settles with NO transfer; thresholds compare the net. The
// existing franchise-settlement.test.ts proves the byte-identical behaviour when
// refundedCents is absent/0.

const { stripeMock } = vi.hoisted(() => ({ stripeMock: { transfers: { create: vi.fn(), list: vi.fn() } } }))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

const { db } = vi.hoisted(() => ({
  db: {
    operator:         { findUnique: vi.fn() },
    franchiseRoyalty: { findMany: vi.fn(), aggregate: vi.fn(), updateMany: vi.fn() },
    payout:           { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    $transaction:     vi.fn(),
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { uuidMock } = vi.hoisted(() => ({ uuidMock: vi.fn() }))
vi.mock('crypto', async (importOriginal) => ({ ...(await importOriginal<object>()), randomUUID: uuidMock }))

// PHASE 2 (D-G v2) — the over-transfer / drift alerts (read-only signal, never money).
const { alertMock } = vi.hoisted(() => ({ alertMock: vi.fn(async () => ({ status: 'sent' })) }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: alertMock }))

import { settleFranchisor } from '@/lib/franchise-settlement'

const fx = {
  claimed: [] as Array<{ id: string; royaltyCents: number; refundedCents: number; settlementId: string | null }>,
  /** PHASE 2 — what the D-G post-transfer re-read (where:{settlementId} only) returns; null = same as claimed. */
  live: null as null | Array<{ id: string; royaltyCents: number; refundedCents: number }>,
  settling: [] as Array<{ id: string; royaltyCents: number; refundedCents: number; settlementId: string | null }>,
  pendingRoyaltySum: 0,
  pendingRefundedSum: 0,
  pendingCount: 0,
  claimCount: 0,
}
const callsWith = (status: string) => db.franchiseRoyalty.updateMany.mock.calls.filter((c) => c[0]?.data?.status === status)

beforeEach(() => {
  vi.clearAllMocks()
  fx.live = null
  fx.settling = []
  delete process.env.FRANCHISE_SETTLEMENT_MIN_CENTS
  uuidMock.mockReturnValue('SID')
  db.operator.findUnique.mockResolvedValue({ id: 'op1', franchiseStripeAccountId: 'acct_f1', franchisePayoutStatus: 'active' })
  db.franchiseRoyalty.findMany.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
    if (where?.status === 'settling' && where?.settlementId === undefined) return Promise.resolve(fx.settling) // resume check
    // D-G v2 detection re-read: by settlementId ONLY (no status, no franchisor filter).
    if (where?.settlementId && where?.status === undefined && where?.franchisorOperatorId === undefined) {
      return Promise.resolve(fx.live ?? fx.claimed)
    }
    if (where?.settlementId !== undefined && where?.settlementId !== null) return Promise.resolve(fx.claimed) // claimed lines
    return Promise.resolve([])
  })
  db.franchiseRoyalty.aggregate.mockImplementation(() =>
    Promise.resolve({ _sum: { royaltyCents: fx.pendingRoyaltySum, refundedCents: fx.pendingRefundedSum }, _count: fx.pendingCount }))
  db.franchiseRoyalty.updateMany.mockImplementation(({ data }: { data: { status?: string } }) =>
    Promise.resolve({ count: data.status === 'settling' ? fx.claimCount : fx.claimed.length }))
  db.payout.findUnique.mockResolvedValue(null)
  db.payout.create.mockImplementation(({ data }: { data: { amountCents: number; currency: string } }) =>
    Promise.resolve({ id: 'po1', amountCents: data.amountCents, currency: data.currency, status: 'pending', stripeTransferId: null }))
  db.payout.update.mockResolvedValue({})
  db.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops))
  stripeMock.transfers.create.mockResolvedValue({ id: 'tr_1' })
  stripeMock.transfers.list.mockResolvedValue({ data: [] })
})
afterEach(() => { delete process.env.FRANCHISE_SETTLEMENT_MIN_CENTS })

describe('settleFranchisor — refund-aware amount', () => {
  it('partially-refunded pending lines → transfer = Σ(royaltyCents − refundedCents)', async () => {
    fx.claimed = [
      { id: 'l1', royaltyCents: 100, refundedCents: 40, settlementId: 'SID' }, // owes 60
      { id: 'l2', royaltyCents: 200, refundedCents: 0,  settlementId: 'SID' }, // owes 200
    ]
    fx.pendingRoyaltySum = 300; fx.pendingRefundedSum = 40; fx.pendingCount = 2; fx.claimCount = 2

    const out = await settleFranchisor('op1')
    expect(out).toMatchObject({ status: 'settled', amountCents: 260 })
    expect(stripeMock.transfers.create.mock.calls[0][0].amount).toBe(260) // 60 + 200, NOT 300
    expect(db.payout.create.mock.calls[0][0].data.amountCents).toBe(260)
  })

  it('a fully-refunded claimed batch → NO transfer, lines marked settled (nothing owed)', async () => {
    fx.claimed = [{ id: 'l1', royaltyCents: 100, refundedCents: 100, settlementId: 'SID' }] // owes 0
    fx.pendingRoyaltySum = 100; fx.pendingRefundedSum = 100; fx.pendingCount = 1; fx.claimCount = 1

    const out = await settleFranchisor('op1')
    expect(out).toEqual({ status: 'skipped', operatorId: 'op1', reason: 'nothing_to_settle' })
    expect(stripeMock.transfers.create).not.toHaveBeenCalled()
    expect(db.payout.create).not.toHaveBeenCalled()
    // the fully-refunded 'settling' line is settled (no payout) so it never lingers
    expect(callsWith('settled').some((c) => c[0]?.where?.settlementId === 'SID')).toBe(true)
  })

  it('below threshold on the NET (gross ≥ min but net < min) → skip, no claim', async () => {
    process.env.FRANCHISE_SETTLEMENT_MIN_CENTS = '250'
    fx.pendingRoyaltySum = 300; fx.pendingRefundedSum = 100; fx.pendingCount = 2 // net 200 < 250
    const out = await settleFranchisor('op1')
    expect(out).toEqual({ status: 'skipped', operatorId: 'op1', reason: 'below_threshold' })
    expect(callsWith('settling').length).toBe(0) // never claimed
    expect(stripeMock.transfers.create).not.toHaveBeenCalled()
  })
})

// ── PHASE 2 — D-G v2 : over-transfer DETECTION (REFUND-FINANCIAL-CONTRACT §10.A, §15 A5) ──
// A refund landing between the claim and the transfer raises refundedCents on a claimed
// line; the frozen Payout amount is transferred anyway (the shared idempotency key is the
// only guard against a concurrent double). Phase 2 does NOT re-plan the amount — it
// re-reads the batch AFTER the money moved and ALERTS the exact delta (human clawback).
describe('settleFranchisor — D-G v2 over-transfer detection (fresh + adopt paths)', () => {
  const claimedBatch = [
    { id: 'l1', royaltyCents: 100, refundedCents: 40, settlementId: 'SID' },
    { id: 'l2', royaltyCents: 200, refundedCents: 0,  settlementId: 'SID' },
  ]
  beforeEach(() => {
    fx.claimed = claimedBatch
    fx.pendingRoyaltySum = 300; fx.pendingRefundedSum = 40; fx.pendingCount = 2; fx.claimCount = 2
  })

  it('fresh path — a refund raised refundedCents after the claim → transfer of the FROZEN 260, then MONEY REVIEW alert with delta 100', async () => {
    fx.live = [
      { id: 'l1', royaltyCents: 100, refundedCents: 40 },
      { id: 'l2', royaltyCents: 200, refundedCents: 100 }, // +100 refunded during the batch → live owed 160
    ]
    const out = await settleFranchisor('op1')
    expect(out).toMatchObject({ status: 'settled', amountCents: 260 })
    expect(stripeMock.transfers.create.mock.calls[0][0].amount).toBe(260) // money behaviour UNCHANGED
    expect(alertMock).toHaveBeenCalledTimes(1)
    expect(alertMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'settlement_over_transfer',
      facts: expect.objectContaining({ settlementId: 'SID', transferredCents: 260, liveOwedCents: 160, deltaCents: 100, stripeTransferId: 'tr_1' }),
    }))
  })

  it('[negative control] no refund during the batch → NO alert (live Σ == transferred)', async () => {
    const out = await settleFranchisor('op1')
    expect(out).toMatchObject({ status: 'settled', amountCents: 260 })
    expect(alertMock).not.toHaveBeenCalled()
  })

  it('[negative control of the detection itself] the alert is driven by the LIVE re-read: a stale snapshot equal to the payout would hide the over-transfer', async () => {
    // Same fixture as the positive case, but the re-read returns the (stale) claimed snapshot:
    // the pre-Phase-2 code — which never re-read — could never see the delta.
    fx.live = null
    await settleFranchisor('op1')
    expect(alertMock).not.toHaveBeenCalled()
  })

  it('resume-adopt path (transfer already exists in the group) → adopted WITHOUT a new transfer, drift detected + alerted', async () => {
    fx.settling = claimedBatch
    fx.live = [{ id: 'l1', royaltyCents: 100, refundedCents: 100 }, { id: 'l2', royaltyCents: 200, refundedCents: 0 }] // live owed 200
    db.payout.findUnique.mockResolvedValue({ id: 'po9', amountCents: 260, currency: 'eur', status: 'pending', stripeTransferId: null })
    stripeMock.transfers.list.mockResolvedValue({ data: [{ id: 'tr_prev' }] })
    const out = await settleFranchisor('op1')
    expect(out).toMatchObject({ status: 'settled', stripeTransferId: 'tr_prev', resumed: true })
    expect(stripeMock.transfers.create).not.toHaveBeenCalled()
    expect(alertMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'settlement_over_transfer',
      facts: expect.objectContaining({ transferredCents: 260, liveOwedCents: 200, deltaCents: 60, stripeTransferId: 'tr_prev' }),
    }))
  })

  it('resume path — frozen payout ≠ live lines and NO transfer yet → failed:amount_drift, NO transfer, MONEY REVIEW alert (never silent, never re-planned)', async () => {
    fx.settling = claimedBatch
    db.payout.findUnique.mockResolvedValue({ id: 'po7', amountCents: 300, currency: 'eur', status: 'pending', stripeTransferId: null }) // frozen 300 ≠ live 260
    const out = await settleFranchisor('op1')
    expect(out).toEqual({ status: 'failed', operatorId: 'op1', reason: 'amount_drift' })
    expect(stripeMock.transfers.create).not.toHaveBeenCalled()
    expect(db.payout.update).not.toHaveBeenCalled() // the frozen amount is NEVER re-planned
    expect(alertMock).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'settlement_amount_drift',
      facts: expect.objectContaining({ frozenPayoutCents: 300, liveOwedCents: 260, deltaCents: 40 }),
    }))
  })
})
