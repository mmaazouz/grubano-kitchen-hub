import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── P4-Franchise-A — lib/franchise-royalty + the held-back fee composition ───────
// The franchise royalty retains an EXTRA 6% in the charge application_fee for
// FRANCHISED orders, accrued separately. The CENTRAL INVARIANT under test: with the
// flag OFF (default) computeFranchiseRoyalty returns 0 WITHOUT touching the DB → the
// fee, and therefore the whole charge, is byte-identical to today and no row is made.
// Also: flag-ON arithmetic (cent-exact), the franchisor resolution, the golden
// equation under the composed fee, and the idempotent (@unique orderId) accrual.

const { db } = vi.hoisted(() => ({
  db: {
    pointOfSale:     { findUnique: vi.fn() },
    franchiseRoyalty: { create: vi.fn(), updateMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import {
  FRANCHISE_ROYALTY_RATE,
  isFranchiseRoyaltyEnabled,
  computeFranchiseRoyalty,
  recordFranchiseRoyalty,
} from '@/lib/franchise-royalty'

const ON  = () => { process.env.FRANCHISE_ROYALTY_ENABLED = 'true' }
const OFF = () => { delete process.env.FRANCHISE_ROYALTY_ENABLED }

beforeEach(() => {
  vi.clearAllMocks()
  OFF()
  db.pointOfSale.findUnique.mockResolvedValue({ franchiseId: 'franchisor-op-1' })
  db.franchiseRoyalty.create.mockResolvedValue({ id: 'fr1' })
  db.franchiseRoyalty.updateMany.mockResolvedValue({ count: 0 }) // default: no pending row → create
})
afterEach(() => { OFF() })

describe('rate constant — must match franchise my-dashboard', () => {
  it('is exactly 0.06', () => {
    expect(FRANCHISE_ROYALTY_RATE).toBe(0.06)
  })
})

describe('isFranchiseRoyaltyEnabled — kill-switch default OFF', () => {
  it('false by default (env unset)', () => {
    OFF()
    expect(isFranchiseRoyaltyEnabled()).toBe(false)
  })
  it('false for any value other than the exact string "true"', () => {
    for (const v of ['1', 'TRUE', 'yes', 'on', '', 'false']) {
      process.env.FRANCHISE_ROYALTY_ENABLED = v
      expect(isFranchiseRoyaltyEnabled()).toBe(false)
    }
  })
  it('true only for "true"', () => {
    ON()
    expect(isFranchiseRoyaltyEnabled()).toBe(true)
  })
})

describe('computeFranchiseRoyalty — CENTRAL INVARIANT: OFF is byte-identical', () => {
  it('(OFF) returns ZERO and does NOT touch the DB — even for a franchised POS', async () => {
    OFF()
    const q = await computeFranchiseRoyalty({ pointOfSaleId: 'pos-1', subtotalCents: 5000 })
    expect(q).toEqual({ royaltyCents: 0, franchisorOperatorId: null, pointOfSaleId: null, rate: 0 })
    expect(db.pointOfSale.findUnique).not.toHaveBeenCalled() // no latency / no read when OFF
  })
})

describe('computeFranchiseRoyalty — ON', () => {
  it('(franchised) holds back round(subtotal × 6%) and names the franchisor', async () => {
    ON()
    const q = await computeFranchiseRoyalty({ pointOfSaleId: 'pos-1', subtotalCents: 5000 })
    expect(q).toEqual({
      royaltyCents: 300, franchisorOperatorId: 'franchisor-op-1', pointOfSaleId: 'pos-1', rate: 0.06,
    })
    expect(db.pointOfSale.findUnique).toHaveBeenCalledWith({
      where: { id: 'pos-1' }, select: { franchiseId: true },
    })
  })

  it('(not franchised: order has no pointOfSaleId) → ZERO, no DB read', async () => {
    ON()
    const q = await computeFranchiseRoyalty({ pointOfSaleId: null, subtotalCents: 5000 })
    expect(q.royaltyCents).toBe(0)
    expect(q.franchisorOperatorId).toBeNull()
    expect(db.pointOfSale.findUnique).not.toHaveBeenCalled()
  })

  it('(POS exists but has no franchisor) → ZERO', async () => {
    ON()
    db.pointOfSale.findUnique.mockResolvedValue({ franchiseId: null })
    const q = await computeFranchiseRoyalty({ pointOfSaleId: 'pos-x', subtotalCents: 5000 })
    expect(q.royaltyCents).toBe(0)
    expect(q.franchisorOperatorId).toBeNull()
  })

  it('(POS not found) → ZERO', async () => {
    ON()
    db.pointOfSale.findUnique.mockResolvedValue(null)
    const q = await computeFranchiseRoyalty({ pointOfSaleId: 'ghost', subtotalCents: 5000 })
    expect(q.royaltyCents).toBe(0)
  })

  it('(zero / negative subtotal) → ZERO, no DB read', async () => {
    ON()
    expect((await computeFranchiseRoyalty({ pointOfSaleId: 'pos-1', subtotalCents: 0 })).royaltyCents).toBe(0)
    expect((await computeFranchiseRoyalty({ pointOfSaleId: 'pos-1', subtotalCents: -10 })).royaltyCents).toBe(0)
    expect(db.pointOfSale.findUnique).not.toHaveBeenCalled()
  })

  it('cent-exact rounding (round-half-up via Math.round)', async () => {
    ON()
    // 1733 × 0.06 = 103.98 → 104 ; 1750 × 0.06 = 105.0 → 105 ; 1741 × 0.06 = 104.46 → 104
    for (const [sub, expected] of [[1733, 104], [1750, 105], [1741, 104], [833, 50], [834, 50]] as const) {
      const q = await computeFranchiseRoyalty({ pointOfSaleId: 'pos-1', subtotalCents: sub })
      expect(q.royaltyCents).toBe(expected)
    }
  })
})

// The exact formula the orders/pay call site applies, re-stated as a pure helper so
// we can prove the held-back composition + golden equation without booting the route.
function composedFee(args: {
  grossFeeCents: number; loyaltyCreditCents: number; smallFeeCents: number; royaltyCents: number
}): number {
  return Math.max(0, args.grossFeeCents - args.loyaltyCreditCents) + args.smallFeeCents + args.royaltyCents
}

describe('held-back fee composition + golden equation (gross = fee + net)', () => {
  it('OFF (royalty 0): fee = commission alone → byte-identical', () => {
    const fee = composedFee({ grossFeeCents: 600, loyaltyCreditCents: 0, smallFeeCents: 0, royaltyCents: 0 })
    expect(fee).toBe(600) // = computeApplicationFee output, unchanged
  })

  it('ON: fee = commission + royalty; resto net drops by EXACTLY the royalty; equation holds', () => {
    const gross = 5000               // 50 € paid (subtotal-only order, no delivery)
    const commission = 600           // 12% delivery commission on 5000
    const royalty = 300              // 6% held back for the franchisor
    const feeOff = composedFee({ grossFeeCents: commission, loyaltyCreditCents: 0, smallFeeCents: 0, royaltyCents: 0 })
    const feeOn  = composedFee({ grossFeeCents: commission, loyaltyCreditCents: 0, smallFeeCents: 0, royaltyCents: royalty })
    expect(feeOn - feeOff).toBe(royalty)                 // fee grows by exactly the royalty
    const netOff = gross - feeOff
    const netOn  = gross - feeOn
    expect(netOff - netOn).toBe(royalty)                 // resto loses exactly the royalty
    expect(gross).toBe(feeOn + netOn)                    // golden equation STILL holds with the composed fee
  })

  it('ON with loyalty credit + small fee: royalty stacks additively, equation holds', () => {
    const gross = 5000
    const fee = composedFee({ grossFeeCents: 600, loyaltyCreditCents: 100, smallFeeCents: 50, royaltyCents: 300 })
    expect(fee).toBe(Math.max(0, 600 - 100) + 50 + 300) // 850
    expect(gross).toBe(fee + (gross - fee))
  })
})

describe('recordFranchiseRoyalty — reconcile-or-create, idempotent on orderId', () => {
  const input = {
    orderId: 'o1', paymentIntentId: 'pi_1', franchisorOperatorId: 'franchisor-op-1',
    restaurantId: 'r1', pointOfSaleId: 'pos-1', channel: 'delivery',
    baseRevenueCents: 5000, royaltyCents: 300, rate: 0.06,
  }

  it('(no existing pending row) creates exactly one "pending" row with all fields', async () => {
    db.franchiseRoyalty.updateMany.mockResolvedValue({ count: 0 })
    const res = await recordFranchiseRoyalty(input)
    expect(res).toEqual({ ok: true, created: true })
    expect(db.franchiseRoyalty.create).toHaveBeenCalledTimes(1)
    expect(db.franchiseRoyalty.create.mock.calls[0][0].data).toEqual({
      orderId: 'o1', paymentIntentId: 'pi_1', franchisorOperatorId: 'franchisor-op-1',
      restaurantId: 'r1', pointOfSaleId: 'pos-1', channel: 'delivery',
      baseRevenueCents: 5000, royaltyCents: 300, rate: 0.06, status: 'pending',
    })
  })

  it('CRITICAL: reconciles an existing PENDING row to the LIVE charge — never re-creates (cancel+recreate)', async () => {
    db.franchiseRoyalty.updateMany.mockResolvedValue({ count: 1 })
    // PI was cancelled + recreated → new pi id + clamped royalty on the recreate.
    const recreated = { ...input, paymentIntentId: 'pi_2', royaltyCents: 250 }
    const res = await recordFranchiseRoyalty(recreated)
    expect(res).toEqual({ ok: true, created: false })
    expect(db.franchiseRoyalty.create).not.toHaveBeenCalled() // @unique would block a create
    // it points the row at the NEW pi + the live amount, scoped to status 'pending'
    expect(db.franchiseRoyalty.updateMany.mock.calls[0][0].where).toEqual({ orderId: 'o1', status: 'pending' })
    expect(db.franchiseRoyalty.updateMany.mock.calls[0][0].data).toMatchObject({ paymentIntentId: 'pi_2', royaltyCents: 250 })
  })

  it('never overwrites a SETTLED row (status filter skips it → create → P2002 no-op)', async () => {
    db.franchiseRoyalty.updateMany.mockResolvedValue({ count: 0 }) // settled row not matched by status:'pending'
    db.franchiseRoyalty.create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }))
    const res = await recordFranchiseRoyalty(input)
    expect(res).toEqual({ ok: true, created: false }) // settled economics untouched
  })

  it('P2002 on create (concurrent create won the race) → idempotent no-op', async () => {
    db.franchiseRoyalty.updateMany.mockResolvedValue({ count: 0 })
    db.franchiseRoyalty.create.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }))
    expect(await recordFranchiseRoyalty(input)).toEqual({ ok: true, created: false })
  })

  it('any other DB error propagates (caller guards it best-effort)', async () => {
    db.franchiseRoyalty.updateMany.mockResolvedValue({ count: 0 })
    db.franchiseRoyalty.create.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: 'P1001' }))
    await expect(recordFranchiseRoyalty(input)).rejects.toThrow('boom')
  })
})

// The clamp the orders/pay call site applies so the composed application_fee can never
// exceed the charge amount (Stripe rejects application_fee_amount > amount). Re-stated as
// a pure helper to lock the deep-discount edge without booting the route.
function chargedRoyalty(args: { royaltyCents: number; baseFeeCents: number; amountCents: number }): number {
  return Math.min(args.royaltyCents, Math.max(0, args.amountCents - args.baseFeeCents))
}

describe('held-back CLAMP — application_fee never exceeds the charge amount', () => {
  it('normal order: full royalty fits under amount → charged in full', () => {
    // 50€ paid, commission 600c, royalty 300c → fee 900c < 5000c, no clamp
    expect(chargedRoyalty({ royaltyCents: 300, baseFeeCents: 600, amountCents: 5000 })).toBe(300)
  })

  it('CRITICAL deep-discount: raw royalty would exceed amount → clamped to the remaining room', () => {
    // subtotal 5000c → royalty round(5000*0.06)=300c, but promo leaves amount=200c, baseFee=24c.
    // room = 200-24 = 176c → charged royalty clamped to 176c so feeCents (24+176=200) == amount.
    const charged = chargedRoyalty({ royaltyCents: 300, baseFeeCents: 24, amountCents: 200 })
    expect(charged).toBe(176)
    expect(24 + charged).toBe(200)            // composed fee == amount (Stripe accepts, charge succeeds)
    expect(24 + charged).toBeLessThanOrEqual(200)
  })

  it('amount fully consumed by commission → royalty clamped to 0 (never negative)', () => {
    expect(chargedRoyalty({ royaltyCents: 300, baseFeeCents: 200, amountCents: 200 })).toBe(0)
    expect(chargedRoyalty({ royaltyCents: 300, baseFeeCents: 250, amountCents: 200 })).toBe(0) // max(0,...) floor
  })
})
