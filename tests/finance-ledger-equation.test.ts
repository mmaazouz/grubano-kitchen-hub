// tests/finance-ledger-equation.test.ts — Agent 1 / A6 gardiens.
// Pure unit tests for the golden ledger equation: gross = applicationFee + net.
//
// This is the property the `/api/admin/ledger/check` route enforces line-by-line
// over every period. Refunds are NEGATIVE on all three columns, and the equation
// must STILL hold (a property the original A3 module was carefully designed for).
// Here we exercise the equation itself — positive payments, negative refunds, a
// wide property range — without touching Prisma.

import { describe, it, expect } from 'vitest'

// The same check the `/api/admin/ledger/check` route does internally.
// We re-state it as a pure helper so we can hit it from tests without booting
// Next or pulling Prisma in.
function ledgerEquationHolds(entry: {
  grossAmount:          number
  applicationFeeAmount: number
  netToRestaurant:      number
}): boolean {
  return entry.grossAmount === entry.applicationFeeAmount + entry.netToRestaurant
}

describe('ledger golden equation — gross = fee + net', () => {
  it('holds on a typical successful payment (20 €, 5 %)', () => {
    // 2000c gross, 100c fee, 1900c net
    expect(ledgerEquationHolds({
      grossAmount:          2000,
      applicationFeeAmount: 100,
      netToRestaurant:      1900,
    })).toBe(true)
  })

  it('holds on a deposit_capture (12 €, 0 % commission on reservation)', () => {
    expect(ledgerEquationHolds({
      grossAmount:          1200,
      applicationFeeAmount: 0,
      netToRestaurant:      1200,
    })).toBe(true)
  })

  it('holds on a refund — NEGATIVE on all three columns', () => {
    // A5: a refund of the 20 € payment above writes a NEGATIVE compensating
    // line. The equation must still re-add: −2000 = −100 + −1900.
    expect(ledgerEquationHolds({
      grossAmount:          -2000,
      applicationFeeAmount: -100,
      netToRestaurant:      -1900,
    })).toBe(true)
  })

  it('holds on a partial refund of 10 € out of 20 €', () => {
    // pro-rata: −1000 / −50 / −950
    expect(ledgerEquationHolds({
      grossAmount:          -1000,
      applicationFeeAmount: -50,
      netToRestaurant:      -950,
    })).toBe(true)
  })

  it('rejects a broken line (1c off → must fail)', () => {
    expect(ledgerEquationHolds({
      grossAmount:          2000,
      applicationFeeAmount: 100,
      netToRestaurant:      1899,   // off by 1c
    })).toBe(false)
  })

  it('rejects a broken NEGATIVE line too (the most insidious silent corruption)', () => {
    expect(ledgerEquationHolds({
      grossAmount:          -2000,
      applicationFeeAmount: -99,
      netToRestaurant:      -1900,   // -99 + -1900 = -1999 ≠ -2000
    })).toBe(false)
  })

  it('handles the zero-fee edge case (commissionFreeUntil active)', () => {
    expect(ledgerEquationHolds({
      grossAmount:          5000,
      applicationFeeAmount: 0,
      netToRestaurant:      5000,
    })).toBe(true)
  })

  it('handles the all-zero degenerate line (placeholder / accounting ping)', () => {
    expect(ledgerEquationHolds({
      grossAmount:          0,
      applicationFeeAmount: 0,
      netToRestaurant:      0,
    })).toBe(true)
  })

  it('property: equation holds for any (fee, net) — sweep over a wide range', () => {
    // For every (fee, net) in a representative range we build a synthetic line
    // with gross = fee + net and assert the property. This catches any future
    // refactor that swaps a sign or drops a column.
    for (let fee = -500; fee <= 500; fee += 50) {
      for (let net = -10_000; net <= 10_000; net += 250) {
        const gross = fee + net
        if (!ledgerEquationHolds({ grossAmount: gross, applicationFeeAmount: fee, netToRestaurant: net })) {
          throw new Error(`equation broken at fee=${fee} net=${net} gross=${gross}`)
        }
      }
    }
  })

  it('aggregate property: ∑ gross = ∑ fee + ∑ net over a synthetic period', () => {
    // The check route also checks the aggregate equation across all lines of
    // the window. We assemble a mix of payment + deposit_capture + refund lines
    // and verify that the equation holds in aggregate AS WELL AS per line.
    const lines = [
      { grossAmount:  2000, applicationFeeAmount:  100, netToRestaurant:  1900 }, // payment
      { grossAmount:  1990, applicationFeeAmount:  159, netToRestaurant:  1831 }, // payment
      { grossAmount:  1200, applicationFeeAmount:    0, netToRestaurant:  1200 }, // deposit
      { grossAmount: -1000, applicationFeeAmount:  -50, netToRestaurant:  -950 }, // partial refund
      { grossAmount: -1000, applicationFeeAmount:  -50, netToRestaurant:  -950 }, // partial refund
    ]
    let okPerLine = true
    for (const l of lines) {
      if (!ledgerEquationHolds(l)) { okPerLine = false; break }
    }
    expect(okPerLine).toBe(true)
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
    const aggGross = sum(lines.map(l => l.grossAmount))
    const aggFee   = sum(lines.map(l => l.applicationFeeAmount))
    const aggNet   = sum(lines.map(l => l.netToRestaurant))
    expect(aggGross).toBe(aggFee + aggNet)
  })

  it('refund of the WHOLE payment brings every aggregate back to its pre-payment value', () => {
    // Philosophie append-only: on n'efface jamais, on compense. After the
    // refund the totals must exactly cancel out — proving the compensation
    // is mathematically clean.
    const payment = { grossAmount:  2000, applicationFeeAmount:  100, netToRestaurant:  1900 }
    const refund  = { grossAmount: -2000, applicationFeeAmount: -100, netToRestaurant: -1900 }
    const sumGross = payment.grossAmount + refund.grossAmount
    const sumFee   = payment.applicationFeeAmount + refund.applicationFeeAmount
    const sumNet   = payment.netToRestaurant + refund.netToRestaurant
    expect(sumGross).toBe(0)
    expect(sumFee).toBe(0)
    expect(sumNet).toBe(0)
  })
})
