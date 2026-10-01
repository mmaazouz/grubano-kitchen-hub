import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'

// ── WP-MONEY-04 (2b) · lib/ledger.ts writer helpers ───────────────────────────
// The append-only writers WP-MONEY-01 will build on (esp. recordRefundLedgerEntry).
// Locks the golden equation gross = applicationFee + net on EVERY produced line
// (incl. negative refunds), the neutral-marker restaurantId conventions, and the
// P2002 → idempotent-duplicate / other-error → ok:false contract of recordLedgerEntry.

const { db } = vi.hoisted(() => ({ db: { ledgerEntry: { create: vi.fn() } } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import {
  recordRefundLedgerEntry, recordPartnerTransferLedgerEntry,
  recordCourierTipLedgerEntry, recordLedgerEntry,
} from '@/lib/ledger'

const P2002 = new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5.22.0' })
const data = () => db.ledgerEntry.create.mock.calls[0][0].data as any
const golden = (d: any) => expect(d.grossAmount).toBe(d.applicationFeeAmount + d.netToRestaurant)

beforeEach(() => {
  vi.clearAllMocks()
  db.ledgerEntry.create.mockResolvedValue({ id: 'le1' })
})

describe('recordRefundLedgerEntry — negative compensating line', () => {
  it('gross/fee/net are negative and satisfy the golden equation', async () => {
    await recordRefundLedgerEntry({ refundId: 're_1', restaurantId: 'r1', refundedCents: 2000, applicationFeeRefundCents: 100, routed: true, destinationAccountId: 'acct_x' })
    const d = data()
    expect(d.type).toBe('refund')
    expect(d.grossAmount).toBe(-2000)
    expect(d.applicationFeeAmount).toBe(-100)
    expect(d.netToRestaurant).toBe(-1900) // -2000 + 100
    expect(d.stripeFeeAmount).toBe(0)
    expect(d.sourceEventId).toBe('re_1')
    golden(d)
  })
})

describe('recordPartnerTransferLedgerEntry — outbound disbursement, neutral to restaurant readers', () => {
  it('restaurantId = beneficiary id, fee 0, net = amount, golden holds', async () => {
    await recordPartnerTransferLedgerEntry({ payoutId: 'po_1', role: 'creator', beneficiaryId: 'creator-9', amountCents: 3000, stripeTransferId: 'tr_1', destinationAccountId: 'acct_c' })
    const d = data()
    expect(d.type).toBe('partner_transfer')
    expect(d.restaurantId).toBe('creator-9') // NOT a Restaurant.id
    expect(d.applicationFeeAmount).toBe(0)
    expect(d.netToRestaurant).toBe(3000)
    expect(d.routed).toBe(true)
    expect(d.sourceEventId).toBe('po_1')
    golden(d)
  })
})

describe('recordCourierTipLedgerEntry — held-tip obligation, neutral marker', () => {
  it('restaurantId = courier_tip:<orderId>, fee 0, net = tip, golden holds', async () => {
    await recordCourierTipLedgerEntry({ orderId: 'o1', stripePaymentIntentId: 'pi_1', tipCents: 500 })
    const d = data()
    expect(d.type).toBe('courier_tip')
    expect(d.restaurantId).toBe('courier_tip:o1') // marker, never a Restaurant.id
    expect(d.applicationFeeAmount).toBe(0)
    expect(d.netToRestaurant).toBe(500)
    expect(d.sourceEventId).toBe('pi_1')
    golden(d)
  })
})

describe('recordLedgerEntry — idempotent, never throws', () => {
  const base = {
    type: 'payment' as const, restaurantId: 'r1', grossAmount: 10500,
    applicationFeeAmount: 1200, netToRestaurant: 9300, routed: true, sourceEventId: 'pi_x',
  }
  it('success → {ok, id, duplicate:false}', async () => {
    const res = await recordLedgerEntry(base)
    expect(res).toEqual({ ok: true, id: 'le1', duplicate: false })
  })
  it('P2002 (replayed event) → idempotent duplicate, NO throw', async () => {
    db.ledgerEntry.create.mockRejectedValue(P2002)
    const res = await recordLedgerEntry(base)
    expect(res).toEqual({ ok: true, id: null, duplicate: true })
  })
  it('other DB error → ok:false, NO throw (caller logs, never blocks payment)', async () => {
    db.ledgerEntry.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('down', { code: 'P1001', clientVersion: '5.22.0' }))
    const res = await recordLedgerEntry(base)
    expect(res.ok).toBe(false)
  })
})
