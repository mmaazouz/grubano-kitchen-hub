import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'

// ── /api/admin/onboarding-nudges/run (cron) — Agent 95 ────────────────────────────────
// Flag OFF → no-op (no candidate read, no send). Auth = INTERNAL_CRON_TOKEN or admin.
// Per account: REAL checklist engine + onboarding-progress decide completeness; the nudge
// level is CLAIMED via OnboardingNudge.create (unique guard) BEFORE sending (no double-send).
// prisma + auth + sender + next-intl mocked; the decision/engine libs are REAL.

const { session, db, sendMock } = vi.hoisted(() => ({
  session: vi.fn(),
  db: {
    operator:           { findMany: vi.fn(), findUnique: vi.fn() },
    brand:              { findFirst: vi.fn(), count: vi.fn() },
    restaurant:         { findFirst: vi.fn() },
    menuItem:           { count: vi.fn() },
    affiliate:          { findMany: vi.fn() }, // Agent 102 cohort — empty here (restaurant-path tests)
    creator:            { findMany: vi.fn() }, // Agent 102 cohort — empty here
    supplierProfile:    { findMany: vi.fn() }, // Agent 107 cohort — empty here
    prestataireProfile: { findMany: vi.fn() }, // Agent 107 cohort — empty here
    onboardingNudge:    { findMany: vi.fn(), create: vi.fn() },
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
const run = (headers: Record<string, string> = {}) =>
  POST(new Request('http://x/api/admin/onboarding-nudges/run', { method: 'POST', headers }))

const INCOMPLETE_OP = {
  id: 'op1', email: 'r@x.fr', name: 'Luigi', locale: 'fr',
  createdAt: new Date(Date.now() - 2 * DAY), status: 'active', emailVerifiedAt: new Date(),
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ONBOARDING_NUDGE_ENABLED = 'true'
  process.env.INTERNAL_CRON_TOKEN = 'cron-secret'
  // Incomplete onboarding: no brand / no restaurant / no menu → checklist isDiscovery=true.
  // Role-scoped so the RESTAURANT cohort gets the candidate and the franchisor cohort (role
  // 'franchise', Agent 107) gets none — these are restaurant-path tests.
  db.operator.findMany.mockImplementation(({ where }: { where: { role?: string } }) =>
    where?.role === 'restaurant' ? Promise.resolve([INCOMPLETE_OP]) : Promise.resolve([]))
  db.brand.findFirst.mockResolvedValue(null)
  db.brand.count.mockResolvedValue(0)
  db.restaurant.findFirst.mockResolvedValue(null)
  db.menuItem.count.mockResolvedValue(0)
  db.onboardingNudge.findMany.mockResolvedValue([]) // no prior nudge
  db.onboardingNudge.create.mockResolvedValue({ id: 'n1' })
  db.affiliate.findMany.mockResolvedValue([])          // restaurant-path tests: other cohorts empty
  db.creator.findMany.mockResolvedValue([])
  db.supplierProfile.findMany.mockResolvedValue([])    // Agent 107 cohorts empty here
  db.prestataireProfile.findMany.mockResolvedValue([])
})
afterEach(() => { delete process.env.ONBOARDING_NUDGE_ENABLED; delete process.env.INTERNAL_CRON_TOKEN })

describe('flag + auth gates', () => {
  it('⚠️ flag OFF → no-op: gated, 0 sent, candidates never read', async () => {
    delete process.env.ONBOARDING_NUDGE_ENABLED
    const body = await (await run({ 'x-internal-token': 'cron-secret' })).json()
    expect(body).toMatchObject({ gated: true, sent: 0 })
    expect(db.operator.findMany).not.toHaveBeenCalled()
    expect(sendMock).not.toHaveBeenCalled()
  })
  it('no cron token + no session → 401', async () => {
    session.mockResolvedValue(null)
    expect((await run()).status).toBe(401)
  })
  it('non-admin session → 403', async () => {
    session.mockResolvedValue({ user: { email: 'x@x.fr' } })
    db.operator.findUnique.mockResolvedValue({ role: 'restaurant' })
    expect((await run()).status).toBe(403)
  })
})

describe('send + claim-before-send idempotence', () => {
  it('incomplete account due for level 1 → claims OnboardingNudge then sends', async () => {
    const body = await (await run({ 'x-internal-token': 'cron-secret' })).json()
    expect(body).toMatchObject({ ok: true, considered: 1, sent: 1 })
    // CLAIM happened with the right (operatorId, role, level) — Agent 102 role-keyed
    expect(db.onboardingNudge.create).toHaveBeenCalledWith({ data: { operatorId: 'op1', role: 'restaurant', level: 1 } })
    // then SEND through the existing best-effort sender, tagged + addressed
    expect(sendMock).toHaveBeenCalledTimes(1)
    expect(sendMock.mock.calls[0][0]).toMatchObject({ to: 'r@x.fr', trigger: 'onboarding_nudge' })
  })

  it('⚠️ re-run / concurrent: claim hits @@unique (P2002) → SKIP, no send', async () => {
    db.onboardingNudge.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }))
    const body = await (await run({ 'x-internal-token': 'cron-secret' })).json()
    expect(body).toMatchObject({ sent: 0 })
    expect(sendMock).not.toHaveBeenCalled()
  })
})

describe('STOP conditions (no send)', () => {
  it('completed onboarding → no claim, no send', async () => {
    db.brand.findFirst.mockResolvedValue({ id: 'b1' })
    db.restaurant.findFirst.mockResolvedValue({ isActive: true, stripeAccountStatus: 'active' })
    db.menuItem.count.mockResolvedValue(5)
    const body = await (await run({ 'x-internal-token': 'cron-secret' })).json()
    expect(body).toMatchObject({ sent: 0 })
    expect(db.onboardingNudge.create).not.toHaveBeenCalled()
    expect(sendMock).not.toHaveBeenCalled()
  })
  it('level 3 already sent → no send (no 4th)', async () => {
    db.onboardingNudge.findMany.mockResolvedValue([{ level: 1 }, { level: 2 }, { level: 3 }])
    const body = await (await run({ 'x-internal-token': 'cron-secret' })).json()
    expect(body).toMatchObject({ sent: 0 })
    expect(sendMock).not.toHaveBeenCalled()
  })
})

describe('best-effort per account', () => {
  it('one account throwing does not stop the batch (isolated)', async () => {
    const OP2 = { ...INCOMPLETE_OP, id: 'op2', email: 'b@x.fr' }
    db.operator.findMany.mockImplementation(({ where }: { where: { role?: string } }) =>
      where?.role === 'restaurant' ? Promise.resolve([INCOMPLETE_OP, OP2]) : Promise.resolve([]))
    // op1's signal read throws; op2 proceeds.
    db.brand.findFirst.mockImplementation(({ where }: { where: { operatorId: string } }) =>
      where.operatorId === 'op1' ? Promise.reject(new Error('db blip')) : Promise.resolve(null))
    const body = await (await run({ 'x-internal-token': 'cron-secret' })).json()
    expect(body.ok).toBe(true)
    expect(sendMock).toHaveBeenCalledTimes(1) // only op2 sent
    expect(sendMock.mock.calls[0][0].to).toBe('b@x.fr')
  })
})
