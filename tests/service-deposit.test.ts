import { describe, it, expect } from 'vitest'
import { computeDepositSplit, hasDeposit } from '@/lib/service-deposit'
import { computeServiceEconomics } from '@/lib/service-pricing'

// ── Deposit (acompte) split engine (PURE, P8c, Agent 83) ──────────────────────
// ⚠️ THE CARDINAL MONEY INVARIANTS — proven by a property sweep over many amounts × pcts:
//   depositCents + balanceCents       === quoteCents                 (no cent created or lost)
//   depositFeeCents + balanceFeeCents === total commission on the quote (5% of the WHOLE, exact)
// The balance + its fee are DERIVED (remainder) so they absorb every rounding cent.

describe('computeDepositSplit — nominal splits', () => {
  it('30% of 100 € → deposit 30 €, balance 70 €; fees split 5% of 100 € (1,50 + 3,50)', () => {
    const s = computeDepositSplit(10000, 30)
    expect(s.depositCents).toBe(3000)
    expect(s.balanceCents).toBe(7000)
    expect(s.totalFeeCents).toBe(500)        // 5% of 10000
    expect(s.depositFeeCents).toBe(150)      // 5% of 3000
    expect(s.balanceFeeCents).toBe(350)      // 500 − 150 (derived)
  })

  it('depositPct = 0 → deposit 0, balance = quote, balanceFee = totalFee (the P8 case)', () => {
    const s = computeDepositSplit(12345, 0)
    expect(s.depositCents).toBe(0)
    expect(s.balanceCents).toBe(12345)
    expect(s.depositFeeCents).toBe(0)
    expect(s.balanceFeeCents).toBe(s.totalFeeCents)
    expect(s.totalFeeCents).toBe(computeServiceEconomics(12345).grubanoMarginCents)
  })

  it('depositPct = 100 → deposit = quote, balance 0, balanceFee 0', () => {
    const s = computeDepositSplit(8000, 100)
    expect(s.depositCents).toBe(8000)
    expect(s.balanceCents).toBe(0)
    expect(s.depositFeeCents).toBe(s.totalFeeCents)
    expect(s.balanceFeeCents).toBe(0)
  })

  it('rounding edge (333 ¢ @ 33%) — the two charges + the two fees still re-add EXACTLY', () => {
    const s = computeDepositSplit(333, 33)
    expect(s.depositCents).toBe(110)         // round(333 × 0.33)
    expect(s.balanceCents).toBe(223)         // 333 − 110
    expect(s.totalFeeCents).toBe(17)         // round(333 × 0.05)
    expect(s.depositFeeCents).toBe(6)        // round(110 × 0.05) = round(5.5)
    expect(s.balanceFeeCents).toBe(11)       // 17 − 6
    expect(s.depositCents + s.balanceCents).toBe(333)
    expect(s.depositFeeCents + s.balanceFeeCents).toBe(17)
  })
})

describe('bounds — negative / non-finite / out-of-range pct', () => {
  it('negative / NaN quote → 0; pct clamped to [0,100]; pct rounded', () => {
    expect(computeDepositSplit(-5000, 30).quoteCents).toBe(0)
    expect(computeDepositSplit(Number.NaN, 30).quoteCents).toBe(0)
    expect(computeDepositSplit(10000, 150).depositPct).toBe(100)
    expect(computeDepositSplit(10000, -10).depositPct).toBe(0)
    expect(computeDepositSplit(10000, 29.6).depositPct).toBe(30)
  })
  it('hasDeposit — true only for a clamped pct > 0', () => {
    expect(hasDeposit(0)).toBe(false)
    expect(hasDeposit(-5)).toBe(false)
    expect(hasDeposit(1)).toBe(true)
    expect(hasDeposit(100)).toBe(true)
  })
})

describe('⚠️ INVARIANT (property sweep over many amounts × pcts)', () => {
  it('deposit+balance == quote; depositFee+balanceFee == total fee; each fee in [0, its charge]', () => {
    const pcts = [0, 1, 3, 5, 10, 25, 30, 33, 50, 67, 90, 99, 100]
    for (let quote = 0; quote <= 200_000; quote += 137) {
      const totalFee = computeServiceEconomics(quote).grubanoMarginCents
      for (const pct of pcts) {
        const s = computeDepositSplit(quote, pct)
        // (1) the two charges re-add to the quote EXACTLY — no cent created or lost.
        if (s.depositCents + s.balanceCents !== quote) {
          throw new Error(`charge split broke at quote=${quote} pct=${pct}: ${s.depositCents}+${s.balanceCents}≠${quote}`)
        }
        // (2) the two application_fees re-add to the commission on the WHOLE quote EXACTLY.
        if (s.depositFeeCents + s.balanceFeeCents !== totalFee) {
          throw new Error(`fee split broke at quote=${quote} pct=${pct}: ${s.depositFeeCents}+${s.balanceFeeCents}≠${totalFee}`)
        }
        // (3) each fee is non-negative and never exceeds its own charge.
        expect(s.depositFeeCents).toBeGreaterThanOrEqual(0)
        expect(s.balanceFeeCents).toBeGreaterThanOrEqual(0)
        expect(s.depositFeeCents).toBeLessThanOrEqual(s.depositCents)
        expect(s.balanceFeeCents).toBeLessThanOrEqual(s.balanceCents)
      }
    }
  })

  it('⚠️ depositPct=0 ≡ P8: the FULL quote + the FULL fee land on the balance, for every amount', () => {
    for (let quote = 0; quote <= 200_000; quote += 311) {
      const s = computeDepositSplit(quote, 0)
      expect(s.depositCents).toBe(0)
      expect(s.balanceCents).toBe(quote)
      expect(s.depositFeeCents).toBe(0)
      expect(s.balanceFeeCents).toBe(computeServiceEconomics(quote).grubanoMarginCents)
    }
  })
})
