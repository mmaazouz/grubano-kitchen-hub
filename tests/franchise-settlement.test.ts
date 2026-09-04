import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'

// ── P4-Franchise-B — franchise settlement (Agent 42) — IDEMPOTENCE IS THE CORE ──
// Real Stripe Transfer (mocked) of the server-summed FranchiseRoyalty 'pending' lines
// to the franchisor's Connect account, with: atomic claim + @unique Payout + Stripe key
// (≤24h) + transfer_group reconciliation (>24h) + $transaction finalize. Prisma + Stripe
// + crypto.randomUUID mocked.

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

import { settleFranchisor, runFranchiseSettlements } from '@/lib/franchise-settlement'

const TWO_LINES = [
  { id: 'l1', royaltyCents: 100, settlementId: 'SID' },
  { id: 'l2', royaltyCents: 200, settlementId: 'SID' },
]

// Mutable fixtures read by the arg-branching prisma mocks (reset each test).
const fx = {
  settling:  [] as Array<{ id: string; royaltyCents: number; settlementId: string | null }>,
  claimed:   TWO_LINES as Array<{ id: string; royaltyCents: number; settlementId: string | null }>,
  pendingCount: 2,
  pendingSum:   300,
  claimCount:   2,
  distinct:  [] as Array<{ franchisorOperatorId: string }>,
}

const callsWith = (status: string) => db.franchiseRoyalty.updateMany.mock.calls.filter((c) => c[0]?.data?.status === status)
const claimCall  = () => callsWith('settling')[0]
const settleCall = () => callsWith('settled')[0]
const revertCall = () => callsWith('pending')[0]

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.FRANCHISE_SETTLEMENT_MIN_CENTS
  fx.settling = []; fx.claimed = TWO_LINES; fx.pendingCount = 2; fx.pendingSum = 300; fx.claimCount = 2; fx.distinct = []
  uuidMock.mockReturnValue('SID')
  db.operator.findUnique.mockImplementation(({ where }: { where: { id: string } }) =>
    Promise.resolve({ id: where.id, franchiseStripeAccountId: 'acct_f1', franchisePayoutStatus: 'active' }))
  db.franchiseRoyalty.findMany.mockImplementation(({ where }: { where: Record<string, unknown> }) => {
    if (where?.status && typeof where.status === 'object') return Promise.resolve(fx.distinct) // batch distinct {in:[...]}
    if (where?.settlementId !== undefined && where?.settlementId !== null) return Promise.resolve(fx.claimed) // claimed-lines fetch
    if (where?.status === 'settling')                      return Promise.resolve(fx.settling)  // resume check
    return Promise.resolve([])
  })
  db.franchiseRoyalty.aggregate.mockImplementation(() =>
    Promise.resolve({ _sum: { royaltyCents: fx.pendingSum }, _count: fx.pendingCount }))
  db.franchiseRoyalty.updateMany.mockImplementation(({ data }: { data: { status?: string } }) =>
    Promise.resolve({ count: data.status === 'settling' ? fx.claimCount : fx.claimed.length }))
  db.payout.findUnique.mockResolvedValue(null)
  db.payout.create.mockImplementation(({ data }: { data: { amountCents: number; currency: string } }) =>
    Promise.resolve({ id: 'po1', amountCents: data.amountCents, currency: data.currency, status: 'pending', stripeTransferId: null }))
  db.payout.update.mockResolvedValue({})
  db.$transaction.mockImplementation((ops: Promise<unknown>[]) => Promise.all(ops))
  stripeMock.transfers.create.mockResolvedValue({ id: 'tr_1' })
  stripeMock.transfers.list.mockResolvedValue({ data: [] }) // no prior transfer by default
})
afterEach(() => { delete process.env.FRANCHISE_SETTLEMENT_MIN_CENTS })

describe('settleFranchisor — happy path (a) + pass-through (i)', () => {
  it('(a) N pending lines + active → ONE transfer = exact sum, Payout pending→paid, lines settled', async () => {
    const out = await settleFranchisor('op1')
    expect(out).toEqual({ status: 'settled', operatorId: 'op1', amountCents: 300, lineCount: 2, stripeTransferId: 'tr_1', settlementId: 'SID', resumed: false })
    expect(claimCall()![0]).toEqual({ where: { franchisorOperatorId: 'op1', status: 'pending' }, data: { status: 'settling', settlementId: 'SID' } })
    expect(db.payout.create.mock.calls[0][0].data).toMatchObject({ role: 'franchise', operatorId: 'op1', amountCents: 300, status: 'pending', idempotencyKey: 'franchise:op1:SID' })
    expect(stripeMock.transfers.list).not.toHaveBeenCalled()          // fresh path: no wasted reconcile
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1)
    const [params, opts] = stripeMock.transfers.create.mock.calls[0]
    expect(params).toMatchObject({ amount: 300, currency: 'eur', destination: 'acct_f1', transfer_group: 'frset_SID' })
    expect(opts).toEqual({ idempotencyKey: 'franchise:op1:SID' })
    // finalize is atomic (payout paid + lines settled in one $transaction)
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(db.payout.update.mock.calls[0][0].data).toMatchObject({ status: 'paid', stripeTransferId: 'tr_1' })
    expect(settleCall()![0]).toEqual({ where: { settlementId: 'SID', status: 'settling' }, data: expect.objectContaining({ status: 'settled', payoutId: 'po1' }) })
  })

  it('(i) 100% PASS-THROUGH — transfer amount == exact sum, NO application_fee retained', async () => {
    await settleFranchisor('op1')
    const [params] = stripeMock.transfers.create.mock.calls[0]
    expect(params.amount).toBe(300)
    expect(params).not.toHaveProperty('application_fee')
    expect(params).not.toHaveProperty('application_fee_amount')
    expect(params).not.toHaveProperty('applicationFeeAmount')
    expect(db.payout.create.mock.calls[0][0].data.amountCents).toBe(300)
  })
})

describe('settleFranchisor — idempotence / NO double settlement (the core)', () => {
  it('(b) 2nd run immediately after → nothing pending, NO new transfer, NO line re-settled', async () => {
    fx.settling = []; fx.pendingCount = 0; fx.pendingSum = 0
    const out = await settleFranchisor('op1')
    expect(out).toEqual({ status: 'skipped', operatorId: 'op1', reason: 'nothing_pending' })
    expect(db.franchiseRoyalty.updateMany).not.toHaveBeenCalled()
    expect(stripeMock.transfers.create).not.toHaveBeenCalled()
    expect(db.payout.create).not.toHaveBeenCalled()
  })

  it('(c) CONCURRENCY — the atomic claim grabbed 0 (a rival won) → skip, NO transfer', async () => {
    fx.pendingCount = 2; fx.pendingSum = 300; fx.claimCount = 0
    const out = await settleFranchisor('op1')
    expect(out).toEqual({ status: 'skipped', operatorId: 'op1', reason: 'nothing_pending' })
    expect(claimCall()).toBeTruthy()
    expect(stripeMock.transfers.create).not.toHaveBeenCalled()
  })

  it('(d) RESUME (no prior transfer) — re-driven with ITS key + group, NO new claim', async () => {
    fx.settling = [
      { id: 'l1', royaltyCents: 100, settlementId: 'SIDX' },
      { id: 'l2', royaltyCents: 200, settlementId: 'SIDX' },
    ]
    db.payout.findUnique.mockResolvedValue({ id: 'po9', amountCents: 300, currency: 'eur', status: 'pending', stripeTransferId: null })
    const out = await settleFranchisor('op1')
    expect(out).toMatchObject({ status: 'settled', amountCents: 300, settlementId: 'SIDX', resumed: true })
    expect(db.franchiseRoyalty.aggregate).not.toHaveBeenCalled()
    expect(claimCall()).toBeUndefined()
    expect(db.payout.create).not.toHaveBeenCalled()
    // not-fresh → reconcile first (no prior transfer found), then transfer with the batch key
    expect(stripeMock.transfers.list).toHaveBeenCalledWith({ transfer_group: 'frset_SIDX', limit: 1 })
    expect(stripeMock.transfers.create.mock.calls[0][1]).toEqual({ idempotencyKey: 'franchise:op1:SIDX' })
  })

  it('(d-HIGH) RESUME where the transfer ALREADY happened (Payout pending, >24h) → ADOPT it, NO 2nd transfer', async () => {
    // The exact double-spend scenario the review flagged: transfer succeeded, mark-paid failed,
    // Payout still 'pending'. The transfer_group reconciliation finds it → no re-transfer.
    fx.settling = [{ id: 'l1', royaltyCents: 300, settlementId: 'SIDZ' }]
    db.payout.findUnique.mockResolvedValue({ id: 'po8', amountCents: 300, currency: 'eur', status: 'pending', stripeTransferId: null })
    stripeMock.transfers.list.mockResolvedValue({ data: [{ id: 'tr_prev' }] }) // Stripe still has the transfer
    const out = await settleFranchisor('op1')
    expect(out).toMatchObject({ status: 'settled', stripeTransferId: 'tr_prev', resumed: true })
    expect(stripeMock.transfers.create).not.toHaveBeenCalled()         // NO second money movement
    expect(db.payout.update.mock.calls[0][0].data).toMatchObject({ status: 'paid', stripeTransferId: 'tr_prev' })
    expect(settleCall()![0].where).toEqual({ settlementId: 'SIDZ', status: 'settling' })
  })

  it('(d-bis) RESUME where the Payout is already paid → settle lines, NO reconcile, NO transfer', async () => {
    fx.settling = [{ id: 'l1', royaltyCents: 300, settlementId: 'SIDY' }]
    db.payout.findUnique.mockResolvedValue({ id: 'po7', amountCents: 300, currency: 'eur', status: 'paid', stripeTransferId: 'tr_old' })
    const out = await settleFranchisor('op1')
    expect(out).toMatchObject({ status: 'settled', stripeTransferId: 'tr_old', resumed: true })
    expect(stripeMock.transfers.list).not.toHaveBeenCalled()
    expect(stripeMock.transfers.create).not.toHaveBeenCalled()
  })

  it('@unique Payout race (P2002 on create) → reuse the existing row, single transfer', async () => {
    db.payout.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }))
    db.payout.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'po1', amountCents: 300, currency: 'eur', status: 'pending', stripeTransferId: null })
    const out = await settleFranchisor('op1')
    expect(out.status).toBe('settled')
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1)
  })

  it('amount-drift on resume (lines diverge from stored Payout) → FAIL, NO transfer (Phase 2 D-G v2: detected + alerted, never re-planned)', async () => {
    fx.settling = [{ id: 'l1', royaltyCents: 200, settlementId: 'SIDM' }] // sum 200
    db.payout.findUnique.mockResolvedValue({ id: 'po6', amountCents: 300, currency: 'eur', status: 'pending', stripeTransferId: null }) // stored 300
    const out = await settleFranchisor('op1')
    expect(out).toEqual({ status: 'failed', operatorId: 'op1', reason: 'amount_drift' })
    // reconcile runs first (finds no prior transfer), THEN the amount check blocks a NEW transfer
    expect(stripeMock.transfers.list).toHaveBeenCalledTimes(1)
    expect(stripeMock.transfers.create).not.toHaveBeenCalled()
  })

  it('drift BUT a transfer already executed → ADOPT it (reconcile beats the amount check), NO new transfer', async () => {
    fx.settling = [{ id: 'l1', royaltyCents: 200, settlementId: 'SIDD' }] // re-sum 200…
    db.payout.findUnique.mockResolvedValue({ id: 'po5', amountCents: 300, currency: 'eur', status: 'pending', stripeTransferId: null }) // …≠ stored 300
    stripeMock.transfers.list.mockResolvedValue({ data: [{ id: 'tr_done' }] }) // money already moved
    const out = await settleFranchisor('op1')
    expect(out).toMatchObject({ status: 'settled', stripeTransferId: 'tr_done', resumed: true })
    expect(stripeMock.transfers.create).not.toHaveBeenCalled()
  })
})

describe('settleFranchisor — atomicity (e)', () => {
  it('(e) transfer throws → Payout NOT marked paid, lines NOT settled (recoverable), no double', async () => {
    stripeMock.transfers.create.mockRejectedValue(new Error('stripe down'))
    const out = await settleFranchisor('op1')
    expect(out).toEqual({ status: 'failed', operatorId: 'op1', reason: 'transfer_failed' })
    expect(db.$transaction).not.toHaveBeenCalled() // finalize never ran
    expect(settleCall()).toBeUndefined()
  })
})

describe('settleFranchisor — guards (f) (g) + threshold race', () => {
  it('(f) no active Connect account → skip, no claim, no transfer', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'op1', franchiseStripeAccountId: null, franchisePayoutStatus: 'active' })
    expect(await settleFranchisor('op1')).toEqual({ status: 'skipped', operatorId: 'op1', reason: 'no_active_connect' })
    db.operator.findUnique.mockResolvedValue({ id: 'op1', franchiseStripeAccountId: 'acct_f1', franchisePayoutStatus: 'pending' })
    expect(await settleFranchisor('op1')).toEqual({ status: 'skipped', operatorId: 'op1', reason: 'no_active_connect' })
    expect(stripeMock.transfers.create).not.toHaveBeenCalled()
  })

  it('(g) below threshold (pre-check) → skip, no claim, no transfer', async () => {
    process.env.FRANCHISE_SETTLEMENT_MIN_CENTS = '10000'
    fx.pendingSum = 300
    const out = await settleFranchisor('op1')
    expect(out).toEqual({ status: 'skipped', operatorId: 'op1', reason: 'below_threshold' })
    expect(claimCall()).toBeUndefined()
    expect(stripeMock.transfers.create).not.toHaveBeenCalled()
  })

  it('(g-race) claimed batch falls below threshold (concurrent shrink) → REVERT + skip, no transfer', async () => {
    process.env.FRANCHISE_SETTLEMENT_MIN_CENTS = '250'
    fx.pendingSum = 300; fx.pendingCount = 2          // pre-check passes (300 >= 250)
    fx.claimed = [{ id: 'l1', royaltyCents: 100, settlementId: 'SID' }]; fx.claimCount = 1 // claim grabbed only 100
    const out = await settleFranchisor('op1')
    expect(out).toEqual({ status: 'skipped', operatorId: 'op1', reason: 'below_threshold' })
    expect(revertCall()![0]).toEqual({ where: { settlementId: 'SID', status: 'settling' }, data: { status: 'pending', settlementId: null } })
    expect(stripeMock.transfers.create).not.toHaveBeenCalled()
    expect(db.payout.create).not.toHaveBeenCalled()
  })

  it('operator not found → skip', async () => {
    db.operator.findUnique.mockResolvedValue(null)
    expect(await settleFranchisor('ghost')).toEqual({ status: 'skipped', operatorId: 'ghost', reason: 'operator_not_found' })
  })

  it('orphan self-heal — settling rows with NULL settlementId are adopted, not stranded', async () => {
    fx.settling = [{ id: 'l1', royaltyCents: 300, settlementId: null }]
    fx.claimed  = [{ id: 'l1', royaltyCents: 300, settlementId: 'SID' }] // re-fetch after minting 'SID'
    const out = await settleFranchisor('op1')
    expect(out).toMatchObject({ status: 'settled', settlementId: 'SID', resumed: true })
    // adopted via an updateMany that stamps the minted settlementId on the orphan rows
    expect(db.franchiseRoyalty.updateMany.mock.calls.some((c) => c[0]?.where?.settlementId === null && c[0]?.data?.settlementId === 'SID')).toBe(true)
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1)
  })
})

describe('runFranchiseSettlements — batch', () => {
  it('settles each franchisor that has pending/settling lines (sequential, idempotent)', async () => {
    fx.distinct = [{ franchisorOperatorId: 'op1' }, { franchisorOperatorId: 'op2' }]
    const summary = await runFranchiseSettlements()
    expect(summary.processed).toBe(2)
    expect(summary.settled).toBe(2)
    expect(summary.results.map((r) => r.operatorId).sort()).toEqual(['op1', 'op2'])
  })
})
