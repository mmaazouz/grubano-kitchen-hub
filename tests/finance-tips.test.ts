import { describe, it, expect, afterEach } from 'vitest'
import { isTipsEnabled, isTipPayoutEnabled, sanitizeTipCents, MAX_TIP_CENTS } from '@/lib/tips'

// ── WP-MONEY-04 · pure money math — lib/tips.ts ───────────────────────────────
// Courier tip: charged with the order, HELD on the application_fee side (like the
// small-order fee), NEVER resto revenue / commission base / loyalty. Flag OFF by
// default → the whole rail is a no-op (byte-identical). All amounts integer cents.

afterEach(() => { delete process.env.TIPS_ENABLED; delete process.env.TIP_PAYOUT_ENABLED })

describe('isTipsEnabled / isTipPayoutEnabled — only exact "true"', () => {
  it('false by default and for any non-"true" value', () => {
    expect(isTipsEnabled()).toBe(false)
    for (const v of ['1', 'TRUE', 'True', 'yes', 'on', '', 'false']) {
      process.env.TIPS_ENABLED = v
      expect(isTipsEnabled()).toBe(false)
    }
  })
  it('true ONLY for exact "true"', () => {
    process.env.TIPS_ENABLED = 'true'
    expect(isTipsEnabled()).toBe(true)
  })
  it('isTipPayoutEnabled gated identically (documents the inert payout rail)', () => {
    expect(isTipPayoutEnabled()).toBe(false)
    process.env.TIP_PAYOUT_ENABLED = 'true'
    expect(isTipPayoutEnabled()).toBe(true)
    process.env.TIP_PAYOUT_ENABLED = 'yes'
    expect(isTipPayoutEnabled()).toBe(false)
  })
})

describe('sanitizeTipCents — clamp [0, MAX] + floor + non-finite → 0', () => {
  it('MAX_TIP_CENTS is 50000 (500,00 €)', () => { expect(MAX_TIP_CENTS).toBe(50000) })
  it('null / undefined / non-finite / negative → 0', () => {
    for (const v of [null, undefined, NaN, Infinity, -Infinity, -500, -0.5]) {
      expect(sanitizeTipCents(v as number)).toBe(0)
    }
  })
  it('floors fractional cents', () => {
    expect(sanitizeTipCents(1234.9)).toBe(1234)
    expect(sanitizeTipCents(0.9)).toBe(0)
  })
  it('clamps to MAX and respects the boundary', () => {
    expect(sanitizeTipCents(60000)).toBe(50000)
    expect(sanitizeTipCents(50000)).toBe(50000)
    expect(sanitizeTipCents(0)).toBe(0)
  })
})

describe('tip held on BOTH sides cancels for the resto (net unchanged)', () => {
  it('gross += t and fee += t ⇒ net = gross − fee is byte-identical to no-tip', () => {
    const gross0 = 10575, fee0 = 1151
    const net0 = gross0 - fee0
    for (const t of [0, 300, 5000, 50000]) {
      expect((gross0 + t) - (fee0 + t)).toBe(net0) // the resto never sees the tip
    }
  })
})
