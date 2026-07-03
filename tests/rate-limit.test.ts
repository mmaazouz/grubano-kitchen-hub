import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { rateLimit, isRateLimitEnabled, __resetRateLimit } from '@/lib/rate-limit'

// ── WP-SEC-03 — in-memory sliding-window rate limiter ─────────────────────────
// Gated by RATE_LIMIT_ENABLED (default OFF → byte-identical no-op). Per (route, IP).
// Fail-open. The wired routes only do `if (rateLimit(...)) return it` → when the lib
// returns null (OFF), every route is byte-identical (the full suite runs with OFF).

const reqFrom = (ip: string) =>
  new Request('http://x/api/orders', { method: 'POST', headers: { 'x-forwarded-for': ip } })

beforeEach(() => { __resetRateLimit() })
afterEach(() => {
  delete process.env.RATE_LIMIT_ENABLED
  delete process.env.RATE_LIMIT_ORDERS_MAX
  delete process.env.RATE_LIMIT_ORDERS_WINDOW_SEC
})

describe('isRateLimitEnabled — only exact "true"', () => {
  it('OFF by default; "1"/"TRUE" do not enable', () => {
    expect(isRateLimitEnabled()).toBe(false)
    process.env.RATE_LIMIT_ENABLED = '1'; expect(isRateLimitEnabled()).toBe(false)
    process.env.RATE_LIMIT_ENABLED = 'TRUE'; expect(isRateLimitEnabled()).toBe(false)
    process.env.RATE_LIMIT_ENABLED = 'true'; expect(isRateLimitEnabled()).toBe(true)
  })
})

describe('OFF (default) → byte-identical no-op', () => {
  it('returns null for every call regardless of volume', () => {
    for (let i = 0; i < 1000; i++) {
      expect(rateLimit(reqFrom('1.2.3.4'), 'orders', { limitDefault: 5 })).toBeNull()
    }
  })
})

describe('ON → per (route, IP) sliding window', () => {
  beforeEach(() => { process.env.RATE_LIMIT_ENABLED = 'true' })

  it('allows up to the limit, then 429 + Retry-After', () => {
    for (let i = 0; i < 3; i++) {
      expect(rateLimit(reqFrom('1.1.1.1'), 'orders', { limitDefault: 3, windowDefault: 60 })).toBeNull()
    }
    const res = rateLimit(reqFrom('1.1.1.1'), 'orders', { limitDefault: 3, windowDefault: 60 })
    expect(res).not.toBeNull()
    expect(res!.status).toBe(429)
    expect(Number(res!.headers.get('Retry-After'))).toBeGreaterThan(0)
  })

  it('different IPs are independent', () => {
    for (let i = 0; i < 3; i++) rateLimit(reqFrom('2.2.2.2'), 'orders', { limitDefault: 3 })
    expect(rateLimit(reqFrom('3.3.3.3'), 'orders', { limitDefault: 3 })).toBeNull()
  })

  it('different route buckets are independent', () => {
    for (let i = 0; i < 3; i++) rateLimit(reqFrom('4.4.4.4'), 'orders', { limitDefault: 3 })
    expect(rateLimit(reqFrom('4.4.4.4'), 'ticket_pay', { limitDefault: 3 })).toBeNull()
  })

  it('env RATE_LIMIT_<ROUTE>_MAX overrides the default', () => {
    process.env.RATE_LIMIT_ORDERS_MAX = '1'
    expect(rateLimit(reqFrom('5.5.5.5'), 'orders', { limitDefault: 100 })).toBeNull()
    expect(rateLimit(reqFrom('5.5.5.5'), 'orders', { limitDefault: 100 })!.status).toBe(429)
  })

  it('the window slides — allowed again after windowSec', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(0)
      for (let i = 0; i < 2; i++) rateLimit(reqFrom('6.6.6.6'), 'orders', { limitDefault: 2, windowDefault: 10 })
      expect(rateLimit(reqFrom('6.6.6.6'), 'orders', { limitDefault: 2, windowDefault: 10 })!.status).toBe(429)
      vi.setSystemTime(11_000) // > 10 s later — the old timestamps fall out of the window
      expect(rateLimit(reqFrom('6.6.6.6'), 'orders', { limitDefault: 2, windowDefault: 10 })).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
