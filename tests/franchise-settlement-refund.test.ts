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

import { settleFranchisor } from '@/lib/franchise-settlement'

const fx = {
  claimed: [] as Array<{ id: string; royaltyCents: number; refundedCents: number; settlementId: string | null }>,
  pendingRoyaltySum: 0,
  pendingRefundedSum: 0,
  pendingCount: 0,
  claimCount: 0,
}
const callsWith = (status: string) => db.franchiseRoyalty.updateMany.mock.calls.filter((c) => c[0]?.data?.status === status)

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.FRANCHISE_SETTLEMENT_MIN_CENTS
  uuidMock.mockReturnValue('SID')
  db.operator.findUnique.mockResolvedValue({ id: 'op1', franchiseStripeAccountId: 'acct_f1', franchisePayoutStatus: 'active' })
  db.franchiseRoyalty.findMany.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
    if (where?.status === 'settling' && where?.settlementId === undefined) return Promise.resolve([]) // resume check: none
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
