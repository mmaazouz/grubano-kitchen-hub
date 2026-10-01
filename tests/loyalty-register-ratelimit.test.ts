import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import { NextRequest } from 'next/server'

// ── /api/loyalty/register rate-limit wiring ────────────────────────────────────
// The PUBLIC unauthenticated register writes a LoyaltyCustomer (+10 pts bonus) on every fresh
// email and 409s on a known one (enumeration oracle). rateLimit() (flag RATE_LIMIT_ENABLED) must
// throttle it per-IP and SHORT-CIRCUIT before any DB access once the window is exceeded. When the
// flag is OFF → byte-identical (no throttle). Uses the REAL lib/rate-limit; prisma is mocked so
// the test is fast + deterministic.

const { db } = vi.hoisted(() => ({
  db: { loyaltyCustomer: { findUnique: vi.fn(), create: vi.fn() } },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { POST as register } from '@/app/api/loyalty/register/route'
import { __resetRateLimit } from '@/lib/rate-limit'

const ENV = { ...process.env }
const body = () => ({ name: 'Jean Client', email: 'j@x.fr', phone: '0600000000' })
const post = () =>
  new NextRequest('http://t/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
    body: JSON.stringify(body()),
  })

beforeEach(() => {
  vi.clearAllMocks()
  __resetRateLimit()
  delete process.env.RATE_LIMIT_ENABLED
  // Fresh-email path so the DB write is on the code path (proves the throttle short-circuits it).
  db.loyaltyCustomer.findUnique.mockResolvedValue(null)
  db.loyaltyCustomer.create.mockResolvedValue({
    id: 'c1', name: 'Jean Client', email: 'j@x.fr',
    pointsBalance: 10, tier: 'bronze', referralCode: 'REF1',
  })
})
afterAll(() => { process.env = ENV })

describe('RATE_LIMIT_ENABLED ON', () => {
  beforeEach(() => {
    process.env.RATE_LIMIT_ENABLED = 'true'
    process.env.RATE_LIMIT_LOYALTY_REGISTER_MAX = '2'
    process.env.RATE_LIMIT_LOYALTY_REGISTER_WINDOW_SEC = '600'
  })

  it('throttles the 3rd request from the same IP with 429, short-circuiting the DB write', async () => {
    expect((await register(post())).status).toBe(201)
    expect((await register(post())).status).toBe(201)
    const third = await register(post())
    expect(third.status).toBe(429)              // over the window
    expect(third.headers.get('Retry-After')).toBeTruthy()
    expect(db.loyaltyCustomer.create).toHaveBeenCalledTimes(2)     // NOT called for the throttled request
    expect(db.loyaltyCustomer.findUnique).toHaveBeenCalledTimes(2) // the 409 oracle is throttled too
  })

  it('also caps the 409 enumeration oracle (known email)', async () => {
    db.loyaltyCustomer.findUnique.mockResolvedValue({ id: 'c1', email: 'j@x.fr' })
    expect((await register(post())).status).toBe(409)
    expect((await register(post())).status).toBe(409)
    expect((await register(post())).status).toBe(429)
    expect(db.loyaltyCustomer.findUnique).toHaveBeenCalledTimes(2)
  })
})

describe('RATE_LIMIT_ENABLED OFF → byte-identical (no throttle)', () => {
  beforeEach(() => {
    delete process.env.RATE_LIMIT_ENABLED
    process.env.RATE_LIMIT_LOYALTY_REGISTER_MAX = '2'
  })

  it('never 429s, even past the nominal limit', async () => {
    for (let i = 0; i < 4; i++) expect((await register(post())).status).toBe(201)
    expect(db.loyaltyCustomer.create).toHaveBeenCalledTimes(4) // every request proceeds to the real path
  })
})
