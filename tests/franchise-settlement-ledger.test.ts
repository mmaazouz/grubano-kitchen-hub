import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── Franchise settlement → ledger TRACE (Agent 94, calque Agent 84) ───────────────────
// A 'partner_transfer' ledger line is recorded AFTER a franchise Payout becomes 'paid',
// BEST-EFFORT: it never moves money, never throws to the caller, is idempotent, and carries
// the FRANCHISOR operator id (never a Restaurant.id). The settlement OUTCOME is byte-identical
// (the existing franchise-settlement.test.ts stays green unmodified — it doesn't mock the
// ledger, so the real best-effort helper logs [LEDGER MISS] there). Here the ledger helper is
// MOCKED so we can assert the trace args + the best-effort guarantees.

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

const { ledgerMock } = vi.hoisted(() => ({ ledgerMock: vi.fn() }))
vi.mock('@/lib/ledger', () => ({ recordPartnerTransferLedgerEntry: ledgerMock }))

import { settleFranchisor } from '@/lib/franchise-settlement'

const TWO_LINES = [
  { id: 'l1', royaltyCents: 100, settlementId: 'SID' },
  { id: 'l2', royaltyCents: 200, settlementId: 'SID' },
]
const fx = {
  settling: [] as Array<{ id: string; royaltyCents: number; settlementId: string | null }>,
  claimed:  TWO_LINES as Array<{ id: string; royaltyCents: number; settlementId: string | null }>,
  pendingCount: 2, pendingSum: 300, claimCount: 2,
  distinct: [] as Array<{ franchisorOperatorId: string }>,
}

beforeEach(() => {
  vi.clearAllMocks()
  fx.settling = []; fx.claimed = TWO_LINES; fx.pendingCount = 2; fx.pendingSum = 300; fx.claimCount = 2; fx.distinct = []
  uuidMock.mockReturnValue('SID')
  ledgerMock.mockResolvedValue({ ok: true, id: 'le1', duplicate: false })
  db.operator.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
    Promise.resolve({ id: where.id, franchiseStripeAccountId: 'acct_f1', franchisePayoutStatus: 'active' }))
  db.franchiseRoyalty.findMany.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
    if (where?.status && typeof where.status === 'object') return Promise.resolve(fx.distinct)
    if (where?.settlementId !== undefined && where?.settlementId !== null) return Promise.resolve(fx.claimed)
    if (where?.status === 'settling') return Promise.resolve(fx.settling)
    return Promise.resolve([])
  })
  db.franchiseRoyalty.aggregate.mockImplementation(() => Promise.resolve({ _sum: { royaltyCents: fx.pendingSum }, _count: fx.pendingCount }))
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

describe('(a) TRACE WRITTEN after a franchise payout becomes paid', () => {
  it('records a partner_transfer keyed on the Payout id, franchisor beneficiary, exact amount', async () => {
    const out = await settleFranchisor('op1')
    // settlement OUTCOME is byte-identical to the no-trace behaviour
    expect(out).toEqual({ status: 'settled', operatorId: 'op1', amountCents: 300, lineCount: 2, stripeTransferId: 'tr_1', settlementId: 'SID', resumed: false })
    expect(ledgerMock).toHaveBeenCalledTimes(1)
    expect(ledgerMock.mock.calls[0][0]).toEqual({
      payoutId:             'po1',          // sourceEventId → idempotence
      role:                 'franchise',
      beneficiaryId:        'op1',          // ⚠️ FRANCHISOR operator id, NEVER a Restaurant.id
      amountCents:          300,            // gross = net = amount (helper sets fee 0)
      currency:             'eur',
      stripeTransferId:     'tr_1',
      destinationAccountId: 'acct_f1',
    })
    // ⚠️ the trace ran AFTER the 'paid' transition (payout.update happened)
    expect(db.payout.update.mock.calls[0][0].data).toMatchObject({ status: 'paid', stripeTransferId: 'tr_1' })
  })
})

describe('(b) BEST-EFFORT — a ledger failure NEVER alters the settlement', () => {
  it('ledger returns ok:false → batch still settled, money untouched', async () => {
    ledgerMock.mockResolvedValue({ ok: false, error: 'db down' })
    const out = await settleFranchisor('op1')
    expect(out).toMatchObject({ status: 'settled', stripeTransferId: 'tr_1' })
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1) // the transfer still happened
  })
  it('ledger THROWS → caught, batch STILL settled (no exception propagated to the caller)', async () => {
    ledgerMock.mockRejectedValue(new Error('boom'))
    const out = await settleFranchisor('op1')
    expect(out).toMatchObject({ status: 'settled', amountCents: 300 })
  })
})

describe('(adopt + already-paid paths also trace, with the right transfer id)', () => {
  it('ADOPT (>24h reconcile) → traces the adopted transfer id', async () => {
    fx.settling = [{ id: 'l1', royaltyCents: 300, settlementId: 'SIDZ' }]
    db.payout.findUnique.mockResolvedValue({ id: 'po8', amountCents: 300, currency: 'eur', status: 'pending', stripeTransferId: null })
    stripeMock.transfers.list.mockResolvedValue({ data: [{ id: 'tr_prev' }] })
    await settleFranchisor('op1')
    expect(stripeMock.transfers.create).not.toHaveBeenCalled() // no 2nd money movement
    expect(ledgerMock.mock.calls[0][0]).toMatchObject({ payoutId: 'po8', stripeTransferId: 'tr_prev', beneficiaryId: 'op1' })
  })
  it('ALREADY-PAID resume → recovery trace with the stored transfer id', async () => {
    fx.settling = [{ id: 'l1', royaltyCents: 300, settlementId: 'SIDY' }]
    db.payout.findUnique.mockResolvedValue({ id: 'po7', amountCents: 300, currency: 'eur', status: 'paid', stripeTransferId: 'tr_old' })
    await settleFranchisor('op1')
    expect(ledgerMock.mock.calls[0][0]).toMatchObject({ payoutId: 'po7', stripeTransferId: 'tr_old', beneficiaryId: 'op1' })
  })
})

describe('(no trace when nothing was disbursed)', () => {
  it('skipped batch (nothing pending) → NO ledger line', async () => {
    fx.pendingCount = 0; fx.pendingSum = 0
    const out = await settleFranchisor('op1')
    expect(out.status).toBe('skipped')
    expect(ledgerMock).not.toHaveBeenCalled()
  })
})
