import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'

// ── /api/admin/onboarding-nudges/run — supplier + prestataire + franchisor cohorts (Agent 107) ─
// SEND-SAFETY: the cron now ALSO nudges supplier + prestataire + franchisor, tracked PER ROLE
// (OnboardingNudge.role; @@unique([operatorId,role,level]) — ALREADY migrated by Agent 102, NO new
// migration). These tests lock: send-once PER ROLE (P2002 skip; multi-role claimed separately);
// stop per role (complete / ≥3 / cadence); the GLOBAL unsubscribe blocks all; the role-appropriate
// + ACTIONABLE resume link; and franchisor NUMBER-FREE (no royalty figure). The franchisor cohort is
// SELECTED by operator.role='franchise' but its nudge `role` column value is 'franchisor'. The REAL
// decision/engine libs are used; prisma/auth/sender/next-intl mocked.

const { session, db, sendMock } = vi.hoisted(() => ({
  session: vi.fn(),
  db: {
    operator:           { findMany: vi.fn(), findUnique: vi.fn() },
    brand:              { findFirst: vi.fn(), count: vi.fn() },
    restaurant:         { findFirst: vi.fn() },
    menuItem:           { count: vi.fn() },
    affiliate:          { findMany: vi.fn() },
    creator:            { findMany: vi.fn() },
    supplierProfile:    { findMany: vi.fn() },
    prestataireProfile: { findMany: vi.fn() },
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
const old = () => new Date(Date.now() - 2 * DAY)
const run = () => POST(new Request('http://x/api/admin/onboarding-nudges/run', { method: 'POST', headers: { 'x-internal-token': 'cron-secret' } }))

// email.in join → the operators matching by shared email (supplier/prestataire/creator cohorts).
let emailJoinOps: Array<Record<string, unknown>> = []
// role==='franchise' → the franchisor operators (operator-keyed cohort).
let franchiseOps: Array<Record<string, unknown>> = []

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ONBOARDING_NUDGE_ENABLED = 'true'
  process.env.INTERNAL_CRON_TOKEN = 'cron-secret'
  emailJoinOps = []
  franchiseOps = []
  db.operator.findMany.mockImplementation(({ where }: { where: { role?: string; id?: { in: string[] }; email?: { in: string[] } } }) => {
    if (where.role === 'restaurant') return Promise.resolve([])
    if (where.role === 'franchise') return Promise.resolve(franchiseOps)
    if (where.id?.in)    return Promise.resolve([])            // affiliate join (none)
    if (where.email?.in) return Promise.resolve(emailJoinOps)  // creator/supplier/prestataire join
    return Promise.resolve([])
  })
  db.affiliate.findMany.mockResolvedValue([])
  db.creator.findMany.mockResolvedValue([])
  db.supplierProfile.findMany.mockResolvedValue([])
  db.prestataireProfile.findMany.mockResolvedValue([])
  db.brand.findFirst.mockResolvedValue(null)
  db.brand.count.mockResolvedValue(0)
  db.restaurant.findFirst.mockResolvedValue(null)
  db.menuItem.count.mockResolvedValue(0)
  db.onboardingNudge.findMany.mockResolvedValue([])
  db.onboardingNudge.create.mockResolvedValue({ id: 'n1' })
})
afterEach(() => { delete process.env.ONBOARDING_NUDGE_ENABLED; delete process.env.INTERNAL_CRON_TOKEN })

describe('supplier cohort (email-keyed)', () => {
  it('incomplete supplier → claims role-keyed (supplier) + sends with the supplier resume link', async () => {
    db.supplierProfile.findMany.mockResolvedValue([{ email: 's@x.fr', createdAt: old(), verificationStatus: null, payoutStatus: 'none', _count: { catalogItems: 0 } }])
    emailJoinOps = [{ id: 'opS', email: 's@x.fr', name: 'Sam', locale: 'fr', status: 'active' }]
    const body = await (await run()).json()
    expect(body.sent).toBe(1)
    expect(db.onboardingNudge.create).toHaveBeenCalledWith({ data: { operatorId: 'opS', role: 'supplier', level: 1 } })
    const email = sendMock.mock.calls[0][0]
    expect(email.to).toBe('s@x.fr')
    expect(email.html).toContain('/supplier/dashboard/profil') // resume → verify company (the supplier's next actionable step)
    expect(email.html).not.toMatch(/[€$%]/)
  })

  it('supplier with NO login operator (unreachable for unsub) → skipped, no send', async () => {
    db.supplierProfile.findMany.mockResolvedValue([{ email: 'ghost@x.fr', createdAt: old(), verificationStatus: null, payoutStatus: 'none', _count: { catalogItems: 0 } }])
    emailJoinOps = [] // no matching operator
    expect((await (await run()).json()).sent).toBe(0)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('re-run / concurrent: supplier claim hits P2002 → SKIP, no send', async () => {
    db.supplierProfile.findMany.mockResolvedValue([{ email: 's@x.fr', createdAt: old(), verificationStatus: null, payoutStatus: 'none', _count: { catalogItems: 0 } }])
    emailJoinOps = [{ id: 'opS', email: 's@x.fr', name: 'Sam', locale: 'fr', status: 'active' }]
    db.onboardingNudge.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: 'x' }))
    expect((await (await run()).json()).sent).toBe(0)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('complete supplier (verified + catalogue + payout) → no send', async () => {
    db.supplierProfile.findMany.mockResolvedValue([{ email: 's@x.fr', createdAt: old(), verificationStatus: 'verified', payoutStatus: 'active', _count: { catalogItems: 3 } }])
    emailJoinOps = [{ id: 'opS', email: 's@x.fr', name: 'Sam', locale: 'fr', status: 'active' }]
    expect((await (await run()).json()).sent).toBe(0)
    expect(db.onboardingNudge.create).not.toHaveBeenCalled()
  })
})

describe('prestataire cohort (email-keyed)', () => {
  it('incomplete prestataire → claims role-keyed (prestataire) + sends with the prestataire resume link', async () => {
    db.prestataireProfile.findMany.mockResolvedValue([{ email: 'p@x.fr', createdAt: old(), serviceCategories: [], verificationStatus: null, payoutStatus: 'none' }])
    emailJoinOps = [{ id: 'opP', email: 'p@x.fr', name: 'Pat', locale: 'fr', status: 'active' }]
    const body = await (await run()).json()
    expect(body.sent).toBe(1)
    expect(db.onboardingNudge.create).toHaveBeenCalledWith({ data: { operatorId: 'opP', role: 'prestataire', level: 1 } })
    expect(sendMock.mock.calls[0][0].html).toContain('/prestataire/dashboard/profil')
    expect(sendMock.mock.calls[0][0].html).not.toMatch(/[€$%]/)
  })
})

describe('franchisor cohort (operator-keyed; role "franchise" → nudge role "franchisor")', () => {
  it('incomplete franchisor → claims role="franchisor" + resume link points to the ACTIONABLE step, NUMBER-FREE', async () => {
    franchiseOps = [{ id: 'opF', email: 'f@x.fr', name: 'Fred', locale: 'fr', createdAt: old(), status: 'active', kybStatus: null, franchisePayoutStatus: 'none' }]
    db.brand.count.mockResolvedValue(0)
    const body = await (await run()).json()
    expect(body.sent).toBe(1)
    expect(db.onboardingNudge.create).toHaveBeenCalledWith({ data: { operatorId: 'opF', role: 'franchisor', level: 1 } })
    const email = sendMock.mock.calls[0][0]
    // company step is CTA-less → resume points at "configure franchise" (the next actionable step)
    expect(email.html).toContain('/franchise/dashboard/etablissements')
    expect(email.html).not.toMatch(/[€$%]/)        // NO royalty rate/amount can leak
    expect(email.html.toLowerCase()).not.toMatch(/royalt\w*\s*[:=]?\s*\d/)
    // owner-scoped franchise read: brand count filtered to this operator + openToFranchise
    expect(db.brand.count.mock.calls[0][0].where).toEqual({ operatorId: 'opF', openToFranchise: true })
  })

  it('complete franchisor (kyb verified + franchisable brand + payout active) → no send', async () => {
    franchiseOps = [{ id: 'opF', email: 'f@x.fr', name: 'Fred', locale: 'fr', createdAt: old(), status: 'active', kybStatus: 'verified', franchisePayoutStatus: 'active' }]
    db.brand.count.mockResolvedValue(1)
    expect((await (await run()).json()).sent).toBe(0)
    expect(db.onboardingNudge.create).not.toHaveBeenCalled()
  })

  it('level 3 already sent for the franchisor role → no 4th', async () => {
    franchiseOps = [{ id: 'opF', email: 'f@x.fr', name: 'Fred', locale: 'fr', createdAt: old(), status: 'active', kybStatus: null, franchisePayoutStatus: 'none' }]
    db.onboardingNudge.findMany.mockResolvedValue([{ level: 1 }, { level: 2 }, { level: 3 }])
    expect((await (await run()).json()).sent).toBe(0)
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('cadence: a franchisor younger than J+1 → no send', async () => {
    franchiseOps = [{ id: 'opF', email: 'f@x.fr', name: 'Fred', locale: 'fr', createdAt: new Date(Date.now() - 1000), status: 'active', kybStatus: null, franchisePayoutStatus: 'none' }]
    expect((await (await run()).json()).sent).toBe(0)
    expect(sendMock).not.toHaveBeenCalled()
  })
})

describe('send-once PER ROLE across the new cohorts + global unsubscribe', () => {
  it('a supplier+prestataire (same operator/email) is claimed separately for each role', async () => {
    db.supplierProfile.findMany.mockResolvedValue([{ email: 'm@x.fr', createdAt: old(), verificationStatus: null, payoutStatus: 'none', _count: { catalogItems: 0 } }])
    db.prestataireProfile.findMany.mockResolvedValue([{ email: 'm@x.fr', createdAt: old(), serviceCategories: [], verificationStatus: null, payoutStatus: 'none' }])
    emailJoinOps = [{ id: 'opM', email: 'm@x.fr', name: 'Max', locale: 'fr', status: 'active' }]
    const body = await (await run()).json()
    expect(body.sent).toBe(2)
    const roles = db.onboardingNudge.create.mock.calls.map((c) => c[0].data.role).sort()
    expect(roles).toEqual(['prestataire', 'supplier'])
    expect(sendMock).toHaveBeenCalledTimes(2)
  })

  it('⚠️ global unsubscribe filters the operator out → no send on the new cohorts', async () => {
    db.supplierProfile.findMany.mockResolvedValue([{ email: 's@x.fr', createdAt: old(), verificationStatus: null, payoutStatus: 'none', _count: { catalogItems: 0 } }])
    franchiseOps = [] // franchise query filters onboardingNudgeUnsub:false → none
    emailJoinOps = [] // email join filters onboardingNudgeUnsub:false → none
    const body = await (await run()).json()
    expect(body.sent).toBe(0)
    expect(db.onboardingNudge.create).not.toHaveBeenCalled()
    expect(sendMock).not.toHaveBeenCalled()
  })
})
