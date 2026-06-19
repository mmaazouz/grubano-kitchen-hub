import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'

// ── Brique D1 — payPartner(role, refId) role-aware payout rail (Agent 63) ─────────────
// The SAME transfer core + triple idempotence as P4.3, parameterised by role. Proves:
// the AFFILIATE rail pays the right entity (Operator affiliate Connect fields) / balance
// ('affiliate') / Payout{role:'affiliate', operatorId}; idempotence is SHARED; the flag
// AFFILIATE_CONNECT_ENABLED gates it OFF; the CREATOR rail is unaffected by that flag.
// (The byte-identical creator behaviour is proven separately by the UNCHANGED
// tests/creator-payout.test.ts, which exercises payCreator → payPartner('creator').)

const { stripeMock } = vi.hoisted(() => ({ stripeMock: { transfers: { create: vi.fn() } } }))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

const { db } = vi.hoisted(() => ({
  db: {
    creator:  { findUnique: vi.fn() },
    operator: { findUnique: vi.fn() },
    payout:   { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { balMock } = vi.hoisted(() => ({ balMock: vi.fn() }))
vi.mock('@/lib/partner-balance', () => ({ computePartnerBalance: balMock }))

import { payPartner } from '@/lib/creator-payout'

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.CREATOR_PAYOUT_MIN_CENTS
  process.env.AFFILIATE_CONNECT_ENABLED = 'true' // ON for the affiliate-path tests; flag-OFF test overrides
  db.creator.findUnique.mockResolvedValue({ stripeAccountId: 'acct_c1', payoutStatus: 'active' })
  db.operator.findUnique.mockResolvedValue({ affiliateStripeAccountId: 'acct_a1', affiliatePayoutStatus: 'active' })
  db.payout.findFirst.mockResolvedValue(null)
  db.payout.create.mockImplementation(({ data }: { data: { amountCents: number; currency: string; idempotencyKey: string } }) =>
    Promise.resolve({ id: 'po1', amountCents: data.amountCents, currency: data.currency, idempotencyKey: data.idempotencyKey }))
  db.payout.update.mockResolvedValue({})
  stripeMock.transfers.create.mockResolvedValue({ id: 'tr_a1' })
  balMock.mockResolvedValue({ role: 'affiliate', refId: 'op1', earnedCents: 5000, paidCents: 0, availableCents: 5000, currency: 'eur' })
})
afterEach(() => { delete process.env.AFFILIATE_CONNECT_ENABLED; delete process.env.CREATOR_PAYOUT_MIN_CENTS })

describe('(b) affiliate happy path — right entity / balance / Payout', () => {
  it('pays the affiliate OPERATOR via its affiliate Connect, Payout{role:affiliate, operatorId}', async () => {
    const out = await payPartner('affiliate', 'op1')
    expect(out).toEqual({ status: 'paid', role: 'affiliate', refId: 'op1', amountCents: 5000, stripeTransferId: 'tr_a1', resumed: false })
    // balance read with the AFFILIATE role + operator id (server-computed, not client)
    expect(balMock).toHaveBeenCalledWith('affiliate', 'op1')
    // Payout row tagged role=affiliate + operatorId, key on the affiliate paid cursor
    expect(db.payout.create.mock.calls[0][0].data).toMatchObject({ role: 'affiliate', operatorId: 'op1', amountCents: 5000, status: 'pending', idempotencyKey: 'affiliate:op1:paid:0' })
    expect(db.payout.create.mock.calls[0][0].data).not.toHaveProperty('creatorId')
    // transfer to the affiliate account, same deterministic key
    const [params, opts] = stripeMock.transfers.create.mock.calls[0]
    expect(params).toMatchObject({ amount: 5000, currency: 'eur', destination: 'acct_a1', metadata: { operatorId: 'op1', payoutId: 'po1' } })
    expect(opts).toEqual({ idempotencyKey: 'affiliate:op1:paid:0' })
    // creator table is NEVER touched on the affiliate path
    expect(db.creator.findUnique).not.toHaveBeenCalled()
  })

  it('amount = the server matured balance remainder (paid cursor), never client', async () => {
    balMock.mockResolvedValue({ role: 'affiliate', refId: 'op1', earnedCents: 7000, paidCents: 5000, availableCents: 2000, currency: 'eur' })
    await payPartner('affiliate', 'op1')
    expect(db.payout.create.mock.calls[0][0].data.amountCents).toBe(2000)
    expect(db.payout.create.mock.calls[0][0].data.idempotencyKey).toBe('affiliate:op1:paid:5000')
  })
})

describe('(c) idempotence — SHARED implementation, no double payout', () => {
  it('@unique cursor lock (P2002) → no transfer, no 2nd payout', async () => {
    db.payout.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }))
    const out = await payPartner('affiliate', 'op1')
    expect(out).toEqual({ status: 'skipped', role: 'affiliate', refId: 'op1', reason: 'already_in_progress' })
    expect(stripeMock.transfers.create).not.toHaveBeenCalled()
  })

  it('RESUME a stuck pending affiliate payout with its STORED key (Stripe dedupes)', async () => {
    db.payout.findFirst.mockResolvedValue({ id: 'po9', amountCents: 3000, currency: 'eur', idempotencyKey: 'affiliate:op1:paid:0' })
    const out = await payPartner('affiliate', 'op1')
    expect(out).toMatchObject({ status: 'paid', amountCents: 3000, resumed: true })
    expect(balMock).not.toHaveBeenCalled()         // resume short-circuits
    expect(db.payout.create).not.toHaveBeenCalled() // no NEW payout
    expect(db.payout.findFirst.mock.calls[0][0].where).toMatchObject({ role: 'affiliate', operatorId: 'op1', status: 'pending' })
  })
})

describe('(d) KYC before money — affiliate must have an ACTIVE Connect', () => {
  it('no affiliate Connect account → skip, no transfer', async () => {
    db.operator.findUnique.mockResolvedValue({ affiliateStripeAccountId: null, affiliatePayoutStatus: 'active' })
    expect(await payPartner('affiliate', 'op1')).toEqual({ status: 'skipped', role: 'affiliate', refId: 'op1', reason: 'no_active_connect' })
    db.operator.findUnique.mockResolvedValue({ affiliateStripeAccountId: 'acct_a1', affiliatePayoutStatus: 'pending' })
    expect(await payPartner('affiliate', 'op1')).toEqual({ status: 'skipped', role: 'affiliate', refId: 'op1', reason: 'no_active_connect' })
    expect(stripeMock.transfers.create).not.toHaveBeenCalled()
  })

  it('operator not found → affiliate_not_found', async () => {
    db.operator.findUnique.mockResolvedValue(null)
    expect(await payPartner('affiliate', 'op1')).toEqual({ status: 'skipped', role: 'affiliate', refId: 'op1', reason: 'affiliate_not_found' })
  })

  it('below threshold → skip, no payout', async () => {
    balMock.mockResolvedValue({ role: 'affiliate', refId: 'op1', earnedCents: 1000, paidCents: 0, availableCents: 1000, currency: 'eur' })
    expect((await payPartner('affiliate', 'op1')).status).toBe('skipped')
    expect(db.payout.create).not.toHaveBeenCalled()
  })
})

describe('(e) flag gate — AFFILIATE_CONNECT_ENABLED', () => {
  it('OFF → affiliate rail inert: no entity/Stripe/DB touch', async () => {
    delete process.env.AFFILIATE_CONNECT_ENABLED
    const out = await payPartner('affiliate', 'op1')
    expect(out).toEqual({ status: 'skipped', role: 'affiliate', refId: 'op1', reason: 'rail_disabled' })
    expect(db.operator.findUnique).not.toHaveBeenCalled()
    expect(db.payout.create).not.toHaveBeenCalled()
    expect(stripeMock.transfers.create).not.toHaveBeenCalled()
  })

  it('the creator rail is UNAFFECTED by the affiliate flag (no internal gate)', async () => {
    delete process.env.AFFILIATE_CONNECT_ENABLED // affiliate OFF
    balMock.mockResolvedValue({ role: 'creator', refId: 'c1', earnedCents: 5000, paidCents: 0, availableCents: 5000, currency: 'eur' })
    const out = await payPartner('creator', 'c1')
    // generic shape, role=creator, paid — proves creator path runs regardless of the affiliate flag
    expect(out).toEqual({ status: 'paid', role: 'creator', refId: 'c1', amountCents: 5000, stripeTransferId: 'tr_a1', resumed: false })
    expect(balMock).toHaveBeenCalledWith('creator', 'c1')
    expect(db.payout.create.mock.calls[0][0].data).toMatchObject({ role: 'creator', creatorId: 'c1' })
    expect(db.operator.findUnique).not.toHaveBeenCalled() // creator path never reads operator
  })
})
