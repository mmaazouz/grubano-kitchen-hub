import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'

// ── Payout → ledger trace wiring in payPartner (rail A3, Agent 84) ─────────────
// payPartner records ONE partner_transfer ledger line per SUCCESSFUL disbursement,
// at the single shared success point (settlePending) → covers BOTH rails (creator +
// affiliate) AND both the normal + resume paths. The ledger write is best-effort:
// it can NEVER alter the transfer or the payout outcome (= the byte-identical proof).
// @/lib/ledger is mocked here to spy the call; the field mapping is proven in
// tests/ledger-partner-transfer.test.ts. ⚠️ REAL money (TEST), flags gate the rail.

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

const { ledgerMock } = vi.hoisted(() => ({ ledgerMock: vi.fn() }))
vi.mock('@/lib/ledger', () => ({ recordPartnerTransferLedgerEntry: ledgerMock }))

import { payPartner, payCreator } from '@/lib/creator-payout'

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.CREATOR_PAYOUT_MIN_CENTS
  process.env.AFFILIATE_CONNECT_ENABLED = 'true'
  db.creator.findUnique.mockResolvedValue({ stripeAccountId: 'acct_c1', payoutStatus: 'active' })
  db.operator.findUnique.mockResolvedValue({ affiliateStripeAccountId: 'acct_a1', affiliatePayoutStatus: 'active' })
  db.payout.findFirst.mockResolvedValue(null)
  db.payout.create.mockImplementation(({ data }: { data: { amountCents: number; currency: string; idempotencyKey: string } }) =>
    Promise.resolve({ id: 'po1', amountCents: data.amountCents, currency: data.currency, idempotencyKey: data.idempotencyKey }))
  db.payout.update.mockResolvedValue({})
  stripeMock.transfers.create.mockResolvedValue({ id: 'tr_1' })
  balMock.mockResolvedValue({ role: 'creator', refId: 'c1', earnedCents: 5000, paidCents: 0, availableCents: 5000, currency: 'eur' })
  ledgerMock.mockResolvedValue({ ok: true, id: 'led1', duplicate: false })
})
afterEach(() => { delete process.env.AFFILIATE_CONNECT_ENABLED; delete process.env.CREATOR_PAYOUT_MIN_CENTS })

describe('(a) CREATOR payout → exactly one ledger trace', () => {
  it('records the disbursement: amount, beneficiary creatorId, transfer ref, destination, payout-id key', async () => {
    const out = await payCreator('c1')
    expect(out).toEqual({ status: 'paid', creatorId: 'c1', amountCents: 5000, stripeTransferId: 'tr_1', resumed: false })
    expect(ledgerMock).toHaveBeenCalledTimes(1)
    expect(ledgerMock.mock.calls[0][0]).toEqual({
      payoutId:             'po1',       // = sourceEventId (idempotency anchor)
      role:                 'creator',
      beneficiaryId:        'c1',        // the paid Creator
      amountCents:          5000,        // the SERVER amount (= the transfer)
      currency:             'eur',
      stripeTransferId:     'tr_1',      // the Stripe reference
      destinationAccountId: 'acct_c1',   // the creator's Connect account
    })
  })

  it('the TRANSFER is byte-identical to before (same single call, same args) — the ledger is a pure add-on', async () => {
    await payCreator('c1')
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1)
    const [params, opts] = stripeMock.transfers.create.mock.calls[0]
    expect(params).toMatchObject({ amount: 5000, currency: 'eur', destination: 'acct_c1', metadata: { creatorId: 'c1', payoutId: 'po1' } })
    expect(opts).toEqual({ idempotencyKey: 'creator:c1:paid:0' })
    expect(db.payout.update.mock.calls[0][0].data).toMatchObject({ status: 'paid', stripeTransferId: 'tr_1' })
  })
})

describe('(b) AFFILIATE payout → the SAME wiring covers the 2nd rail', () => {
  beforeEach(() => balMock.mockResolvedValue({ role: 'affiliate', refId: 'op1', earnedCents: 5000, paidCents: 0, availableCents: 5000, currency: 'eur' }))

  it('records the disbursement with the affiliate OPERATOR as beneficiary + its affiliate Connect account', async () => {
    const out = await payPartner('affiliate', 'op1')
    expect(out).toEqual({ status: 'paid', role: 'affiliate', refId: 'op1', amountCents: 5000, stripeTransferId: 'tr_1', resumed: false })
    expect(ledgerMock).toHaveBeenCalledTimes(1)
    expect(ledgerMock.mock.calls[0][0]).toEqual({
      payoutId: 'po1', role: 'affiliate', beneficiaryId: 'op1', amountCents: 5000,
      currency: 'eur', stripeTransferId: 'tr_1', destinationAccountId: 'acct_a1',
    })
  })
})

describe('(c) idempotence — NO trace unless a disbursement actually settled', () => {
  it('@unique cursor lock (P2002, already in progress) → no transfer, NO ledger line', async () => {
    db.payout.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }))
    expect((await payCreator('c1')).status).toBe('skipped')
    expect(stripeMock.transfers.create).not.toHaveBeenCalled()
    expect(ledgerMock).not.toHaveBeenCalled()
  })

  it('already settled (available 0 → below threshold) → skipped, NO ledger line', async () => {
    balMock.mockResolvedValue({ role: 'creator', refId: 'c1', earnedCents: 5000, paidCents: 5000, availableCents: 0, currency: 'eur' })
    expect((await payCreator('c1')).status).toBe('skipped')
    expect(ledgerMock).not.toHaveBeenCalled()
  })

  it('no active Connect → skipped, NO ledger line', async () => {
    db.creator.findUnique.mockResolvedValue({ stripeAccountId: null, payoutStatus: 'active' })
    expect((await payCreator('c1')).status).toBe('skipped')
    expect(ledgerMock).not.toHaveBeenCalled()
  })

  it('affiliate rail OFF (flag) → skipped, NO entity/Stripe/ledger touch', async () => {
    delete process.env.AFFILIATE_CONNECT_ENABLED
    expect(await payPartner('affiliate', 'op1')).toMatchObject({ status: 'skipped', reason: 'rail_disabled' })
    expect(ledgerMock).not.toHaveBeenCalled()
  })
})

describe('(d) transfer failure → no settled payout → no ledger line', () => {
  it('Stripe transfer throws → outcome failed, payout stays pending, NO ledger line', async () => {
    stripeMock.transfers.create.mockRejectedValue(new Error('stripe down'))
    expect((await payCreator('c1')).status).toBe('failed')
    expect(db.payout.update).not.toHaveBeenCalled() // never marked paid
    expect(ledgerMock).not.toHaveBeenCalled()
  })
})

describe('(e) the ledger write can NEVER break the payout (best-effort)', () => {
  it('ledger write returns ok:false → the payout is STILL paid (transfer untouched)', async () => {
    ledgerMock.mockResolvedValue({ ok: false, error: 'ledger down' })
    const out = await payCreator('c1')
    expect(out).toEqual({ status: 'paid', creatorId: 'c1', amountCents: 5000, stripeTransferId: 'tr_1', resumed: false })
    expect(stripeMock.transfers.create).toHaveBeenCalledTimes(1) // money moved exactly once
    expect(ledgerMock).toHaveBeenCalledTimes(1)
  })
})

describe('(f) the RESUME path also writes the trace (shared success point)', () => {
  it('a stuck pending payout re-driven → paid + one ledger line keyed on THAT payout id', async () => {
    db.payout.findFirst.mockResolvedValue({ id: 'po9', amountCents: 3000, currency: 'eur', idempotencyKey: 'creator:c1:paid:0' })
    const out = await payCreator('c1')
    expect(out).toMatchObject({ status: 'paid', amountCents: 3000, resumed: true })
    expect(balMock).not.toHaveBeenCalled() // resume short-circuits the normal path
    expect(ledgerMock).toHaveBeenCalledTimes(1)
    expect(ledgerMock.mock.calls[0][0]).toMatchObject({ payoutId: 'po9', role: 'creator', beneficiaryId: 'c1', amountCents: 3000, stripeTransferId: 'tr_1' })
  })
})
