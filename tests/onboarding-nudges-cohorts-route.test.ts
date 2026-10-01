import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'

// ── /api/admin/onboarding-nudges/run — affiliate + creator cohorts (Agent 102) ─────────
// SEND-SAFETY: the cron now nudges restaurant + affiliate + creator, tracked PER ROLE
// (OnboardingNudge.role; @@unique([operatorId,role,level])). These tests lock: send-once PER
// ROLE (a resto+affiliate operator is claimed separately for each); stop per role (complete /
// ≥3); the GLOBAL unsubscribe (operator filtered out) blocks all roles; the cadence; and the
// role-appropriate resume link. The REAL decision/engine libs are used; prisma/auth/sender/
// next-intl mocked.

const { session, db, sendMock } = vi.hoisted(() => ({
  session: vi.fn(),
  db: {
    operator:        { findMany: vi.fn(), findUnique: vi.fn() },
    brand:           { findFirst: vi.fn(), count: vi.fn() },
    restaurant:      { findFirst: vi.fn() },
    menuItem:        { count: vi.fn() },
    affiliate:       { findMany: vi.fn() },
    creator:         { findMany: vi.fn() },
    supplierProfile:    { findMany: vi.fn() }, // Agent 107 cohort — empty here
    prestataireProfile: { findMany: vi.fn() }, // Agent 107 cohort — empty here
    onboardingNudge: { findMany: vi.fn(), create: vi.fn() },
  },
  sendMock: vi.fn(),
}))
vi.mock('next-auth', () => ({ getServerSession: session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/transactional-emails', () => ({ sendTransactional: sendMock }))
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (k: string, v?: Record<string, unknown>) => `${k}${v?.steps !== undefined ? `:${v.steps}` : ''}`,
}))

import { POST } from '@/app/api/admin/onboarding-nudges/run/route'

const DAY = 24 * 60 * 60 * 1000
const old = () => new Date(Date.now() - 2 * DAY)
const run = () => POST(new Request('http://x/api/admin/onboarding-nudges/run', { method: 'POST', headers: { 'x-internal-token': 'cron-secret' } }))

const affOp = (over: Record<string, unknown> = {}) => ({
  id: 'op1', email: 'a@x.fr', name: 'Alex', locale: 'fr', status: 'active',
  affiliatePayoutStatus: null, registeredAddress: null, taxId: null, taxIdCountry: null, sellerType: null, dateOfBirth: null,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ONBOARDING_NUDGE_ENABLED = 'true'
  process.env.INTERNAL_CRON_TOKEN = 'cron-secret'
  // default: no restaurant candidates, no creators; one incomplete affiliate.
  db.operator.findMany.mockImplementation(({ where }: { where: { role?: string; id?: { in: string[] }; email?: { in: string[] } } }) => {
    if (where.role === 'restaurant') return Promise.resolve([])
    if (where.id?.in)    return Promise.resolve([affOp()])               // affiliate join
    if (where.email?.in) return Promise.resolve([])                       // creator join
    return Promise.resolve([])
  })
  db.affiliate.findMany.mockResolvedValue([{ operatorId: 'op1', createdAt: old(), status: 'active' }])
  db.creator.findMany.mockResolvedValue([])
  db.brand.findFirst.mockResolvedValue(null)
  db.brand.count.mockResolvedValue(0)
  db.restaurant.findFirst.mockResolvedValue(null)
  db.menuItem.count.mockResolvedValue(0)
  db.supplierProfile.findMany.mockResolvedValue([])    // Agent 107 cohorts empty here
  db.prestataireProfile.findMany.mockResolvedValue([])
  db.onboardingNudge.findMany.mockResolvedValue([])
  db.onboardingNudge.create.mockResolvedValue({ id: 'n1' })
})
afterEach(() => { delete process.env.ONBOARDING_NUDGE_ENABLED; delete process.env.INTERNAL_CRON_TOKEN })

describe('affiliate cohort', () => {
  it('incomplete affiliate → claims role-keyed (affiliate) + sends with the affiliate resume link', async () => {
    const body = await (await run()).json()
    expect(body).toMatchObject({ ok: true, sent: 1 })
    expect(db.onboardingNudge.create).toHaveBeenCalledWith({ data: { operatorId: 'op1', role: 'affiliate', level: 1 } })
    const email = sendMock.mock.calls[0][0]
    expect(email.to).toBe('a@x.fr')
    expect(email.trigger).toBe('onboarding_nudge')
    expect(email.html).toContain('/affiliate/dashboard') // resume → the affiliate's next step
  })

  it('withdraw-ready affiliate (role complete) → no send for the affiliate role', async () => {
    db.operator.findMany.mockImplementation(({ where }: { where: { role?: string; id?: { in: string[] }; email?: { in: string[] } } }) =>
      where.id?.in
        ? Promise.resolve([affOp({ affiliatePayoutStatus: 'active', registeredAddress: '1 rue X', taxId: 'FR1', taxIdCountry: 'FR', sellerType: 'individual', dateOfBirth: new Date('1990-01-01') })])
        : Promise.resolve([]))
    const body = await (await run()).json()
    expect(body.sent).toBe(0)
    expect(db.onboardingNudge.create).not.toHaveBeenCalled()
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('cadence: an affiliate younger than J+1 → no send (interval not reached)', async () => {
    db.affiliate.findMany.mockResolvedValue([{ operatorId: 'op1', createdAt: new Date(Date.now() - 1000), status: 'active' }])
    expect((await (await run()).json()).sent).toBe(0)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('level 3 already sent for the affiliate role → no 4th', async () => {
    db.onboardingNudge.findMany.mockResolvedValue([{ level: 1 }, { level: 2 }, { level: 3 }])
    expect((await (await run()).json()).sent).toBe(0)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('⚠️ global unsubscribe: the operator is filtered out (onboardingNudgeUnsub) → no affiliate send', async () => {
    db.operator.findMany.mockImplementation(() => Promise.resolve([])) // operator excluded by unsub filter
    const body = await (await run()).json()
    expect(body.sent).toBe(0)
    expect(db.onboardingNudge.create).not.toHaveBeenCalled()
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('⚠️ re-run / concurrent: affiliate claim hits P2002 → SKIP, no send', async () => {
    db.onboardingNudge.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }))
    expect((await (await run()).json()).sent).toBe(0)
    expect(sendMock).not.toHaveBeenCalled()
  })
})

describe('send-once PER ROLE — a resto+affiliate operator is claimed separately for each', () => {
  it('the same operator is nudged for restaurant AND affiliate with distinct role-keyed claims', async () => {
    const RESTO = { id: 'op1', email: 'a@x.fr', name: 'Alex', locale: 'fr', createdAt: old(), status: 'active', emailVerifiedAt: new Date() }
    db.operator.findMany.mockImplementation(({ where }: { where: { role?: string; id?: { in: string[] }; email?: { in: string[] } } }) => {
      if (where.role === 'restaurant') return Promise.resolve([RESTO])
      if (where.id?.in) return Promise.resolve([affOp()])
      return Promise.resolve([])
    })
    const body = await (await run()).json()
    expect(body.sent).toBe(2) // one restaurant nudge + one affiliate nudge
    const roles = db.onboardingNudge.create.mock.calls.map((c) => c[0].data.role).sort()
    expect(roles).toEqual(['affiliate', 'restaurant'])
    expect(sendMock).toHaveBeenCalledTimes(2)
  })
})

describe('creator cohort', () => {
  it('incomplete creator (empty bio) → claims role-keyed (creator) + sends with the creator resume link', async () => {
    db.affiliate.findMany.mockResolvedValue([])
    db.creator.findMany.mockResolvedValue([{ email: 'c@x.fr', createdAt: old(), bio: null, payoutStatus: null }])
    db.operator.findMany.mockImplementation(({ where }: { where: { role?: string; email?: { in: string[] } } }) =>
      where.email?.in
        ? Promise.resolve([{ id: 'opC', email: 'c@x.fr', name: 'Coco', locale: 'fr', status: 'active' }])
        : Promise.resolve([]))
    const body = await (await run()).json()
    expect(body.sent).toBe(1)
    expect(db.onboardingNudge.create).toHaveBeenCalledWith({ data: { operatorId: 'opC', role: 'creator', level: 1 } })
    expect(sendMock.mock.calls[0][0].html).toContain('/creators/dashboard') // resume → the creator's next step
  })

  it('creator with NO login operator (unreachable for unsub) → skipped, no send', async () => {
    db.affiliate.findMany.mockResolvedValue([])
    db.creator.findMany.mockResolvedValue([{ email: 'ghost@x.fr', createdAt: old(), bio: null, payoutStatus: null }])
    db.operator.findMany.mockResolvedValue([]) // no matching operator
    expect((await (await run()).json()).sent).toBe(0)
    expect(sendMock).not.toHaveBeenCalled()
  })
})
