import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'

// ── P4.3 — creator payout (Agent 39) — IDEMPOTENCE IS THE CORE ───────────────
// Real Stripe Transfer (mocked) of the server-computed available balance, with a
// three-layer anti-double-payment guard. Prisma + Stripe + partner-balance mocked.

const { stripeMock } = vi.hoisted(() => ({ stripeMock: { transfers: { create: vi.fn() } } }))
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
afterEach(() => { delete process.env.CREATOR_PAYOUT_MIN_CENTS })

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
