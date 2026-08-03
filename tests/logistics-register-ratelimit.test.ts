import { describe, it, expect, beforeEach, afterAll, vi, afterEach } from 'vitest'

// ── S2 — /api/logistics/register rate-limit wiring (Agent 126) ─────────────────
// The PUBLIC register triggers a PAID verifyBusiness call (LLM + official registry) on a fresh
// SIREN. rateLimit() (flag RATE_LIMIT_ENABLED) must throttle it per-IP and SHORT-CIRCUIT before
// the paid call once the window is exceeded. When the flag is OFF → byte-identical (no throttle).
// Uses the REAL lib/rate-limit; the heavy deps are mocked so the test is fast + deterministic.

const { db, la, biz, idp } = vi.hoisted(() => ({
  db: { logisticsProfile: { findUnique: vi.fn(), create: vi.fn() } },
  la: {
    isLogisticsEnabled: () => process.env.LOGISTICS_ENABLED === 'true',
    ensureLogisticsOperator: vi.fn(),
    decideLogisticsOutcome: vi.fn(),
    applyCourierActivationGate: vi.fn(),
    isCourierActivationEnabled: vi.fn(),
  },
  biz: { verifyBusiness: vi.fn() },
  idp: { propagateVerifiedCompanyIdentity: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/logistics-account', () => la)
vi.mock('@/lib/business-verification', () => biz)
vi.mock('@/lib/identity-propagation', () => idp)

import { POST as register } from '@/app/api/logistics/register/route'
import { __resetRateLimit } from '@/lib/rate-limit'

// P0-06 — rôle(s) ouvert(s) pour ces tests : la surface est désormais derrière un
// flag de rôle (404 OFF — prouvé par tests/role-locks.test.ts) ; ici on teste la
// logique métier, donc on ouvre le rôle explicitement.
beforeEach(() => { process.env.LOGISTICS_ENABLED = 'true' })
afterEach(() => { delete process.env.LOGISTICS_ENABLED })

const ENV = { ...process.env }
const body = () => ({
  partnerType: 'independent', contactName: 'Jean Livreur', contactEmail: 'j@x.fr',
  siren: '123456789', missionTypes: ['repas'], vehicleTypes: ['velo'], zones: [],
  consent: true, website: '', formStartedAt: Date.now() - 5000, // honeypot empty, delay satisfied
})
const post = () =>
  new Request('http://t/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '1.2.3.4' },
    body: JSON.stringify(body()),
  })

beforeEach(() => {
  vi.clearAllMocks()
  __resetRateLimit()
  // Fresh path so verifyBusiness is on the code path (proves the throttle short-circuits it).
  db.logisticsProfile.findUnique.mockResolvedValue(null)
  db.logisticsProfile.create.mockResolvedValue({ id: 'p1' })
  la.isCourierActivationEnabled.mockReturnValue(false) // waitlist
  la.decideLogisticsOutcome.mockReturnValue({ status: 'pending', verificationStatus: 'review', reason: 'ok' })
  la.applyCourierActivationGate.mockImplementation((d: unknown) => d)
  la.ensureLogisticsOperator.mockResolvedValue(undefined)
  biz.verifyBusiness.mockResolvedValue({ officialName: 'ACME', verificationStatus: 'review' })
  idp.propagateVerifiedCompanyIdentity.mockResolvedValue(undefined)
})
afterAll(() => { process.env = ENV })

describe('RATE_LIMIT_ENABLED ON', () => {
  beforeEach(() => {
    process.env.RATE_LIMIT_ENABLED = 'true'
    process.env.RATE_LIMIT_LOGISTICS_REGISTER_MAX = '2'
    process.env.RATE_LIMIT_LOGISTICS_REGISTER_WINDOW_SEC = '60'
  })

  it('throttles the 3rd request from the same IP with 429, short-circuiting the paid call', async () => {
    expect((await register(post())).status).toBe(200)
    expect((await register(post())).status).toBe(200)
    const third = await register(post())
    expect(third.status).toBe(429)              // over the window
    expect(third.headers.get('Retry-After')).toBeTruthy()
    expect(biz.verifyBusiness).toHaveBeenCalledTimes(2) // NOT called for the throttled request
  })
})

describe('RATE_LIMIT_ENABLED OFF → byte-identical (no throttle)', () => {
  beforeEach(() => {
    delete process.env.RATE_LIMIT_ENABLED
    process.env.RATE_LIMIT_LOGISTICS_REGISTER_MAX = '2'
  })

  it('never 429s, even past the nominal limit', async () => {
    for (let i = 0; i < 4; i++) expect((await register(post())).status).toBe(200)
    expect(biz.verifyBusiness).toHaveBeenCalledTimes(4) // every request proceeds to the real path
  })
})
