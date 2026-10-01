import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'

// ── P4.3 — creator payout (Agent 39) — IDEMPOTENCE IS THE CORE ───────────────
// Real Stripe Transfer (mocked) of the server-computed available balance, with a
// three-layer anti-double-payment guard. Prisma + Stripe + partner-balance mocked.

const { stripeMock } = vi.hoisted(() => ({ stripeMock: { transfers: { create: vi.fn(), list: vi.fn() } } }))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

const { db } = vi.hoisted(() => ({
  db: { creator: { findUnique: vi.fn() }, payout: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() } },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { balMock } = vi.hoisted(() => ({ balMock: vi.fn() }))
vi.mock('@/lib/partner-balance', () => ({ computePartnerBalance: balMock }))

import { payCreator } from '@/lib/creator-payout'

const ACTIVE = { id: 'c1', stripeAccountId: 'acct_c1', payoutStatus: 'active' }

beforeEach(() => {
  // T-112: a RESUME now asks Stripe whether the transfer already exists (adopt-or-refuse), because the
  // Stripe idempotency key is pruned after ~24 h. Default: Stripe holds nothing → the resume creates.
  stripeMock.transfers.list.mockResolvedValue({ has_more: false, data: [] })
  // T-90-ter: the creator rail now reads its OWN gate (CREATOR_PAYOUT_ENABLED), fail-closed, instead of
  // `enabled: () => true`. Production checks the same flag at app/api/admin/creator-payouts/run, so the
  // suite says here what production says. Its ABSENCE is exercised by a test of its own below.
  process.env.CREATOR_PAYOUT_ENABLED = 'true'
  vi.clearAllMocks()
  delete process.env.CREATOR_PAYOUT_MIN_CENTS
  db.creator.findUnique.mockResolvedValue(ACTIVE)
  db.payout.findFirst.mockResolvedValue(null) // no stuck pending
  db.payout.create.mockImplementation(({ data }: { data: { amountCents: number; currency: string; idempotencyKey: string } }) =>
    Promise.resolve({ id: 'po1', amountCents: data.amountCents, currency: data.currency, idempotencyKey: data.idempotencyKey }))
  db.payout.update.mockResolvedValue({})
  stripeMock.transfers.create.mockResolvedValue({ id: 'tr_1' })
  balMock.mockResolvedValue({ role: 'creator', refId: 'c1', earnedCents: 5000, paidCents: 0, availableCents: 5000, currency: 'eur' })
})
afterEach(() => { delete process.env.CREATOR_PAYOUT_ENABLED; delete process.env.CREATOR_PAYOUT_MIN_CENTS })

describe('payCreator — happy path', () => {
  it('(a)/(h) ≥ threshold + active → ONE transfer of the SERVER amount + Payout pending→paid', async () => {
    const out = await payCreator('c1')
    expect(out).toEqual({ status: 'paid', creatorId: 'c1', amountCents: 5000, stripeTransferId: 'tr_1', resumed: false })
    // transfer of the computed available, to the creator account, with the deterministic idempotency key
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1)
    const [params, opts] = stripeMock.transfers.create.mock.calls[0]
    expect(params).toMatchObject({ amount: 5000, currency: 'eur', destination: 'acct_c1' })
    // key is on the PAID cursor (paidCents=0 here), NOT earned — serialises concurrent runs
    expect(opts).toEqual({ idempotencyKey: 'creator:c1:paid:0' })
    // Payout 'pending' first (same key), then 'paid'
    expect(db.payout.create.mock.calls[0][0].data).toMatchObject({ role: 'creator', creatorId: 'c1', amountCents: 5000, status: 'pending', idempotencyKey: 'creator:c1:paid:0' })
    expect(db.payout.update.mock.calls[0][0].data).toMatchObject({ status: 'paid', stripeTransferId: 'tr_1' })
  })

  it('cursor key is the PAID amount — two concurrent runs at different EARNED but same PAID share a key (serialise)', async () => {
    // A creator who has already been paid 5000, now earned 9000 → available 4000
    // (≥ the unified 2500 threshold — Brique D2; the cursor logic is what's under test).
    balMock.mockResolvedValue({ role: 'creator', refId: 'c1', earnedCents: 9000, paidCents: 5000, availableCents: 4000, currency: 'eur' })
    await payCreator('c1')
    expect(db.payout.create.mock.calls[0][0].data.idempotencyKey).toBe('creator:c1:paid:5000')
    // amount is the remainder, not the gross earned
    expect(db.payout.create.mock.calls[0][0].data.amountCents).toBe(4000)
    expect(stripeMock.transfers.create.mock.calls[0][1]).toEqual({ idempotencyKey: 'creator:c1:paid:5000' })
  })
})

describe('payCreator — idempotence (no double payment)', () => {
  it('(b) @unique cursor lock — a concurrent/re-run create (P2002) → no transfer, no 2nd payout', async () => {
    db.payout.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }))
    const out = await payCreator('c1')
    expect(out).toEqual({ status: 'skipped', creatorId: 'c1', reason: 'already_in_progress' })
    expect(stripeMock.transfers.create).not.toHaveBeenCalled()
  })

  it('RESUME — a stuck pending payout is completed with its STORED key (Stripe dedupes → no double)', async () => {
    db.payout.findFirst.mockResolvedValue({ id: 'po9', amountCents: 3000, currency: 'eur', idempotencyKey: 'creator:c1:earned:3000' })
    const out = await payCreator('c1')
    expect(out).toMatchObject({ status: 'paid', amountCents: 3000, resumed: true })
    expect(balMock).not.toHaveBeenCalled() // resume short-circuits the normal path
    expect(db.payout.create).not.toHaveBeenCalled() // no NEW payout
    expect(stripeMock.transfers.create.mock.calls[0][1]).toEqual({ idempotencyKey: 'creator:c1:earned:3000' })
  })
})

describe('payCreator — guards', () => {
  it('(c) below threshold → skip, no payout, no transfer', async () => {
    balMock.mockResolvedValue({ role: 'creator', refId: 'c1', earnedCents: 1000, paidCents: 0, availableCents: 1000, currency: 'eur' })
    const out = await payCreator('c1')
    expect(out).toEqual({ status: 'skipped', creatorId: 'c1', reason: 'below_threshold' })
    expect(db.payout.create).not.toHaveBeenCalled()
    expect(stripeMock.transfers.create).not.toHaveBeenCalled()
  })

  it('(d) no active Connect account → skip, no transfer', async () => {
    db.creator.findUnique.mockResolvedValue({ id: 'c1', stripeAccountId: null, payoutStatus: 'active' })
    expect(await payCreator('c1')).toEqual({ status: 'skipped', creatorId: 'c1', reason: 'no_active_connect' })
    db.creator.findUnique.mockResolvedValue({ id: 'c1', stripeAccountId: 'acct_c1', payoutStatus: 'pending' })
    expect(await payCreator('c1')).toEqual({ status: 'skipped', creatorId: 'c1', reason: 'no_active_connect' })
    expect(stripeMock.transfers.create).not.toHaveBeenCalled()
  })
})

describe('payCreator — atomicity / reconciliation', () => {
  it('(g) transfer throws after the pending Payout → NOT marked paid (recoverable), no double', async () => {
    stripeMock.transfers.create.mockRejectedValue(new Error('stripe down'))
    const out = await payCreator('c1')
    expect(out).toEqual({ status: 'failed', creatorId: 'c1', reason: 'transfer_failed' })
    // payout stays 'pending' — NEVER marked 'paid' on a failed transfer
    expect(db.payout.update).not.toHaveBeenCalled()
  })

  it('threshold is env-configurable (CREATOR_PAYOUT_MIN_CENTS)', async () => {
    process.env.CREATOR_PAYOUT_MIN_CENTS = '6000'
    balMock.mockResolvedValue({ role: 'creator', refId: 'c1', earnedCents: 5000, paidCents: 0, availableCents: 5000, currency: 'eur' })
    expect((await payCreator('c1')).status).toBe('skipped') // 5000 < 6000
  })
})

// ══ T-112 — ADOPT-OR-REFUSE ON A RESUME (found by the final invariant review) ═══════════════════════
//
// The only protection against paying a partner twice was the Stripe idempotency key, and Stripe prunes
// those « after they are at least 24 hours old ». A `pending` Payout re-driven more than a day later — by
// the nightly cron, by an admin re-run, by a retry after an outage — re-sent the SAME key past its life,
// which Stripe treats as a NEW request. The partner was paid a second time, and `status` was still
// 'pending' so nothing objected. The refund rail has had the F8 answer to this for months; this rail did not.
describe('T-112 — a resume never risks a second transfer', () => {
  const pendingRow = (ageHours: number) => ({
    id: 'po_stuck', amountCents: 5000, currency: 'eur', idempotencyKey: 'creator:c1:paid:0',
    createdAt: new Date(Date.now() - ageHours * 3600_000),
  })

  it('a FRESH resume with nothing at Stripe creates exactly one transfer', async () => {
    db.payout.findFirst.mockResolvedValue(pendingRow(2))
    stripeMock.transfers.list.mockResolvedValue({ has_more: false, data: [] })
    const out = await payCreator('c1')
    expect(out).toMatchObject({ status: 'paid', resumed: true })
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1)
  })

  it('a resume whose transfer ALREADY EXISTS at Stripe adopts it — nothing is created', async () => {
    db.payout.findFirst.mockResolvedValue(pendingRow(2))
    stripeMock.transfers.list.mockResolvedValue({ has_more: false, data: [{ id: 'tr_already', metadata: { payoutId: 'po_stuck' } }] })
    const out = await payCreator('c1')
    expect(stripeMock.transfers.create, 'THE defect: this must be zero').toHaveBeenCalledTimes(0)
    expect(out).toMatchObject({ status: 'paid', resumed: true, stripeTransferId: 'tr_already' })
    // the row is closed on the ADOPTED transfer, so the next run takes no path at all
    expect(db.payout.update.mock.calls[0][0].data).toMatchObject({ status: 'paid', stripeTransferId: 'tr_already' })
  })

  it("ANOTHER payout's transfer is NOT adopted — the match is on our own metadata", async () => {
    db.payout.findFirst.mockResolvedValue(pendingRow(2))
    stripeMock.transfers.list.mockResolvedValue({ has_more: false, data: [{ id: 'tr_other', metadata: { payoutId: 'po_SOMEONE_ELSE' } }] })
    await payCreator('c1')
    expect(stripeMock.transfers.create, 'a foreign transfer must not close our row').toHaveBeenCalledTimes(1)
  })

  it('PAST the idempotency window with nothing to adopt → REFUSED, not re-created', async () => {
    db.payout.findFirst.mockResolvedValue(pendingRow(30))   // 30 h old: the key is pruned
    stripeMock.transfers.list.mockResolvedValue({ has_more: false, data: [] })
    const out = await payCreator('c1')
    expect(stripeMock.transfers.create, 'a re-sent key past its life is a SECOND transfer').toHaveBeenCalledTimes(0)
    expect(out).toMatchObject({ status: 'failed', reason: 'resume_expired' })
    // …and it is reported as a refusal a human must close, not as « try again ». `reason` lives on the
    // skipped/failed arms of the union, so the assertion goes through toMatchObject above rather than a
    // property read the narrowed type does not carry.
    expect(out).not.toMatchObject({ reason: 'transfer_failed_resume' })
  })

  it('past the window but the transfer EXISTS → adopted, because proof beats the clock', async () => {
    db.payout.findFirst.mockResolvedValue(pendingRow(30))
    stripeMock.transfers.list.mockResolvedValue({ has_more: false, data: [{ id: 'tr_old', metadata: { payoutId: 'po_stuck' } }] })
    const out = await payCreator('c1')
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(0)
    expect(out).toMatchObject({ status: 'paid', stripeTransferId: 'tr_old' })
  })

  it('a TRUNCATED list cannot prove absence → fail CLOSED, nothing created', async () => {
    db.payout.findFirst.mockResolvedValue(pendingRow(2))
    stripeMock.transfers.list.mockResolvedValue({ has_more: true, data: [] })
    const out = await payCreator('c1')
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(0)
    expect(out).toMatchObject({ status: 'failed', reason: 'resume_unprovable' })
  })

  it('an UNREADABLE list is the same refusal — absence is never inferred from an error', async () => {
    db.payout.findFirst.mockResolvedValue(pendingRow(2))
    stripeMock.transfers.list.mockRejectedValue(new Error('Stripe 500 (simulated)'))
    const out = await payCreator('c1')
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(0)
    expect(out).toMatchObject({ status: 'failed', reason: 'resume_unprovable' })
  })

  it('a FRESH payout (not a resume) never pays for the list — the read is resume-only', async () => {
    db.payout.findFirst.mockResolvedValue(null)   // nothing stuck → the fresh path
    const out = await payCreator('c1')
    expect(out).toMatchObject({ status: 'paid', resumed: false })
    expect(stripeMock.transfers.list, 'a fresh payout has nothing to adopt by construction').not.toHaveBeenCalled()
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1)
  })
})
