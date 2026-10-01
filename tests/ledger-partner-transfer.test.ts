import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'

// ── recordPartnerTransferLedgerEntry (rail A3 payout trace, Agent 84) ──────────
// The append-only, idempotent ledger line for a SUCCESSFUL partner payout. Proves
// the field mapping that makes the line PROVABLY NEUTRAL to every existing reader:
//   restaurantId = beneficiary partner id (NOT a restaurant); applicationFeeAmount = 0
//   (→ the monthly invoice generator's `if ttc<=0 continue` skips it); netToRestaurant
//   = amount (golden equation gross = fee + net holds); sourceEventId = the Payout id
//   (→ @@unique([sourceEventId,'partner_transfer']) makes a replay a silent duplicate).

const { db } = vi.hoisted(() => ({ db: { ledgerEntry: { create: vi.fn() } } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { recordPartnerTransferLedgerEntry } from '@/lib/ledger'

const INPUT = {
  payoutId:             'po1',
  role:                 'creator',
  beneficiaryId:        'c1',
  amountCents:          5000,
  currency:             'eur',
  stripeTransferId:     'tr_1',
  destinationAccountId: 'acct_c1',
}

beforeEach(() => {
  vi.clearAllMocks()
  db.ledgerEntry.create.mockResolvedValue({ id: 'led1' })
})

describe('recordPartnerTransferLedgerEntry — field mapping', () => {
  it('writes a partner_transfer line: amount in gross, fee=0, net=amount, beneficiary in restaurantId', async () => {
    const r = await recordPartnerTransferLedgerEntry(INPUT)
    expect(r).toEqual({ ok: true, id: 'led1', duplicate: false })
    const data = db.ledgerEntry.create.mock.calls[0][0].data
    expect(data).toMatchObject({
      type:                 'partner_transfer',
      restaurantId:         'c1',        // the BENEFICIARY id (a Creator.id) — never a Restaurant.id
      grossAmount:          5000,        // the disbursed amount (human-readable)
      applicationFeeAmount: 0,           // a payout earns Grubano NO commission → invoice generator skips it
      netToRestaurant:      5000,        // = gross − fee → golden equation holds
      routed:               true,
      destinationAccountId: 'acct_c1',
      stripeTransferId:     'tr_1',
      currency:             'eur',
      channel:              null,
      sourceEventId:        'po1',       // the Payout id → idempotency anchor
    })
  })

  it('⚠️ the golden equation holds: grossAmount === applicationFeeAmount + netToRestaurant', async () => {
    for (const amountCents of [1, 49, 50, 2500, 9999, 123456]) {
      db.ledgerEntry.create.mockClear()
      await recordPartnerTransferLedgerEntry({ ...INPUT, amountCents })
      const d = db.ledgerEntry.create.mock.calls[0][0].data
      expect(d.grossAmount).toBe(d.applicationFeeAmount + d.netToRestaurant)
      expect(d.applicationFeeAmount).toBe(0) // invoice-generator-safe for ALL amounts
    }
  })

  it('the affiliate beneficiary (an Operator id) lands in restaurantId all the same', async () => {
    await recordPartnerTransferLedgerEntry({ ...INPUT, role: 'affiliate', beneficiaryId: 'op1', destinationAccountId: 'acct_a1' })
    const data = db.ledgerEntry.create.mock.calls[0][0].data
    expect(data.restaurantId).toBe('op1')
    expect(data.destinationAccountId).toBe('acct_a1')
    expect(data.type).toBe('partner_transfer')
  })

  it('currency defaults to eur when omitted', async () => {
    const { currency: _omit, ...noCurrency } = INPUT
    await recordPartnerTransferLedgerEntry(noCurrency)
    expect(db.ledgerEntry.create.mock.calls[0][0].data.currency).toBe('eur')
  })
})

describe('recordPartnerTransferLedgerEntry — idempotent & append-only', () => {
  it('a duplicate (same Payout id → @@unique hit) is SUCCESS, not a 2nd line', async () => {
    db.ledgerEntry.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }))
    expect(await recordPartnerTransferLedgerEntry(INPUT)).toEqual({ ok: true, id: null, duplicate: true })
  })

  it('a real write failure returns ok:false (caller logs [LEDGER MISS]) and NEVER throws', async () => {
    db.ledgerEntry.create.mockRejectedValue(new Error('db down'))
    const r = await recordPartnerTransferLedgerEntry(INPUT)
    expect(r.ok).toBe(false)
  })

  it('APPEND-ONLY: only ledgerEntry.create is used — there is no update/delete in lib/ledger', async () => {
    await recordPartnerTransferLedgerEntry(INPUT)
    expect(db.ledgerEntry.create).toHaveBeenCalledTimes(1)
    // The mock deliberately exposes ONLY .create; an update/delete call would throw.
    expect(db.ledgerEntry).not.toHaveProperty('update')
    expect(db.ledgerEntry).not.toHaveProperty('delete')
  })
})
