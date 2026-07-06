import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'

// ── P4.3 ÉTAPE 2 — payPartner('logistics', refId) courier payout adapter ──────────────
// The SAME transfer core + triple idempotence, parameterised by the NEW 'logistics'
// adapter. Proves: it pays the right entity (LogisticsProfile Connect) / balance
// ('logistics') / Payout{role:'logistics', logisticsProfileId}; idempotence is SHARED;
// LOGISTICS_PAYOUT_ENABLED gates it OFF (inert); and the creator + affiliate rails are
// UNAFFECTED by the logistics flag. Balance + Stripe + Prisma mocked — no real money.

const { stripeMock } = vi.hoisted(() => ({ stripeMock: { transfers: { create: vi.fn() } } }))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

const { db } = vi.hoisted(() => ({
  db: {
    creator:          { findUnique: vi.fn() },
    operator:         { findUnique: vi.fn() },
    logisticsProfile: { findUnique: vi.fn() },
    payout:           { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
    ledgerEntry:      { create: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { balMock } = vi.hoisted(() => ({ balMock: vi.fn() }))
vi.mock('@/lib/partner-balance', () => ({ computePartnerBalance: balMock }))

import { payPartner } from '@/lib/creator-payout'

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.CREATOR_PAYOUT_MIN_CENTS
  process.env.LOGISTICS_PAYOUT_ENABLED = 'true' // ON for the happy-path tests; the flag-OFF test overrides
  db.logisticsProfile.findUnique.mockResolvedValue({ stripeAccountId: 'acct_l1', payoutStatus: 'active' })
  db.creator.findUnique.mockResolvedValue({ stripeAccountId: 'acct_c1', payoutStatus: 'active' })
  db.payout.findFirst.mockResolvedValue(null)
  db.payout.create.mockImplementation(({ data }: { data: { amountCents: number; currency: string; idempotencyKey: string } }) =>
    Promise.resolve({ id: 'po_l1', amountCents: data.amountCents, currency: data.currency, idempotencyKey: data.idempotencyKey }))
  db.payout.update.mockResolvedValue({})
  db.ledgerEntry.create.mockResolvedValue({ id: 'led1' }) // partner_transfer trace (shared, best-effort)
  stripeMock.transfers.create.mockResolvedValue({ id: 'tr_l1' })
  balMock.mockResolvedValue({ role: 'logistics', refId: 'lp1', earnedCents: 5000, paidCents: 0, availableCents: 5000, currency: 'eur' })
})
afterEach(() => { delete process.env.LOGISTICS_PAYOUT_ENABLED; delete process.env.CREATOR_PAYOUT_MIN_CENTS })

describe('(a) logistics happy path — right entity / balance / Payout', () => {
  it('pays the courier LogisticsProfile Connect, Payout{role:logistics, logisticsProfileId}', async () => {
    const out = await payPartner('logistics', 'lp1')
    expect(out).toEqual({ status: 'paid', role: 'logistics', refId: 'lp1', amountCents: 5000, stripeTransferId: 'tr_l1', resumed: false })
    // balance read with the LOGISTICS role + courier id (server-computed, never client)
    expect(balMock).toHaveBeenCalledWith('logistics', 'lp1')
    // Payout row tagged role=logistics + logisticsProfileId, keyed on the logistics paid cursor
    expect(db.payout.create.mock.calls[0][0].data).toMatchObject({ role: 'logistics', logisticsProfileId: 'lp1', amountCents: 5000, status: 'pending', idempotencyKey: 'logistics:lp1:paid:0' })
    expect(db.payout.create.mock.calls[0][0].data).not.toHaveProperty('creatorId')
    expect(db.payout.create.mock.calls[0][0].data).not.toHaveProperty('operatorId')
    // transfer to the courier account, same deterministic key
    const [params, opts] = stripeMock.transfers.create.mock.calls[0]
    expect(params).toMatchObject({ amount: 5000, currency: 'eur', destination: 'acct_l1', metadata: { logisticsProfileId: 'lp1', payoutId: 'po_l1' } })
    expect(opts).toEqual({ idempotencyKey: 'logistics:lp1:paid:0' })
    // neither the creator nor operator tables are touched on the logistics path
    expect(db.creator.findUnique).not.toHaveBeenCalled()
    expect(db.operator.findUnique).not.toHaveBeenCalled()
  })

  it('amount = the server matured balance remainder (paid cursor), never client', async () => {
    balMock.mockResolvedValue({ role: 'logistics', refId: 'lp1', earnedCents: 9000, paidCents: 5000, availableCents: 4000, currency: 'eur' })
    await payPartner('logistics', 'lp1')
    expect(db.payout.create.mock.calls[0][0].data.amountCents).toBe(4000)
    expect(db.payout.create.mock.calls[0][0].data.idempotencyKey).toBe('logistics:lp1:paid:5000')
  })
})

describe('(b) idempotence — SHARED implementation, no double payout', () => {
  it('@unique cursor lock (P2002) → no transfer, no 2nd payout', async () => {
    db.payout.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }))
    const out = await payPartner('logistics', 'lp1')
    expect(out).toEqual({ status: 'skipped', role: 'logistics', refId: 'lp1', reason: 'already_in_progress' })
    expect(stripeMock.transfers.create).not.toHaveBeenCalled()
  })

  it('RESUME a stuck pending logistics payout with its STORED key (Stripe dedupes)', async () => {
    db.payout.findFirst.mockResolvedValue({ id: 'po_l9', amountCents: 3000, currency: 'eur', idempotencyKey: 'logistics:lp1:paid:0' })
    const out = await payPartner('logistics', 'lp1')
    expect(out).toMatchObject({ status: 'paid', amountCents: 3000, resumed: true })
    expect(balMock).not.toHaveBeenCalled()          // resume short-circuits the balance read
    expect(db.payout.create).not.toHaveBeenCalled()  // no NEW payout row
    expect(db.payout.findFirst.mock.calls[0][0].where).toMatchObject({ role: 'logistics', logisticsProfileId: 'lp1', status: 'pending' })
  })
})

describe('(c) KYC before money — courier must have an ACTIVE Connect', () => {
  it('no courier Connect account (or not active) → skip, no transfer', async () => {
    db.logisticsProfile.findUnique.mockResolvedValue({ stripeAccountId: null, payoutStatus: 'active' })
    expect(await payPartner('logistics', 'lp1')).toEqual({ status: 'skipped', role: 'logistics', refId: 'lp1', reason: 'no_active_connect' })
    db.logisticsProfile.findUnique.mockResolvedValue({ stripeAccountId: 'acct_l1', payoutStatus: 'pending' })
    expect(await payPartner('logistics', 'lp1')).toEqual({ status: 'skipped', role: 'logistics', refId: 'lp1', reason: 'no_active_connect' })
    expect(stripeMock.transfers.create).not.toHaveBeenCalled()
  })

  it('courier profile not found → logistics_not_found', async () => {
    db.logisticsProfile.findUnique.mockResolvedValue(null)
    expect(await payPartner('logistics', 'lp1')).toEqual({ status: 'skipped', role: 'logistics', refId: 'lp1', reason: 'logistics_not_found' })
  })

  it('below threshold → skip, no payout', async () => {
    balMock.mockResolvedValue({ role: 'logistics', refId: 'lp1', earnedCents: 1000, paidCents: 0, availableCents: 1000, currency: 'eur' })
    expect((await payPartner('logistics', 'lp1')).status).toBe('skipped')
    expect(db.payout.create).not.toHaveBeenCalled()
  })

  it('empty balance (available 0, ÉTAPE 2 inert) → skipped below_threshold, no payout', async () => {
    balMock.mockResolvedValue({ role: 'logistics', refId: 'lp1', earnedCents: 0, paidCents: 0, availableCents: 0, currency: 'eur' })
    const out = await payPartner('logistics', 'lp1')
    expect(out).toEqual({ status: 'skipped', role: 'logistics', refId: 'lp1', reason: 'below_threshold' })
    expect(stripeMock.transfers.create).not.toHaveBeenCalled()
  })
})

describe('(d) flag gate — LOGISTICS_PAYOUT_ENABLED', () => {
  it('OFF → logistics rail inert: no entity/Stripe/DB/balance touch', async () => {
    delete process.env.LOGISTICS_PAYOUT_ENABLED
    const out = await payPartner('logistics', 'lp1')
    expect(out).toEqual({ status: 'skipped', role: 'logistics', refId: 'lp1', reason: 'rail_disabled' })
    expect(db.logisticsProfile.findUnique).not.toHaveBeenCalled()
    expect(balMock).not.toHaveBeenCalled()
    expect(db.payout.create).not.toHaveBeenCalled()
    expect(stripeMock.transfers.create).not.toHaveBeenCalled()
  })

  it('the CREATOR rail is UNAFFECTED by the logistics flag (no internal gate)', async () => {
    delete process.env.LOGISTICS_PAYOUT_ENABLED // logistics OFF
    balMock.mockResolvedValue({ role: 'creator', refId: 'c1', earnedCents: 5000, paidCents: 0, availableCents: 5000, currency: 'eur' })
    const out = await payPartner('creator', 'c1')
    expect(out).toEqual({ status: 'paid', role: 'creator', refId: 'c1', amountCents: 5000, stripeTransferId: 'tr_l1', resumed: false })
    expect(balMock).toHaveBeenCalledWith('creator', 'c1')
    expect(db.payout.create.mock.calls[0][0].data).toMatchObject({ role: 'creator', creatorId: 'c1' })
    expect(db.logisticsProfile.findUnique).not.toHaveBeenCalled() // creator path never reads the courier profile
  })
})
