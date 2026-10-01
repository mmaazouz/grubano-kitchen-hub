import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── lib/affiliate-account — instant affiliate onboarding bridge (Brique A, Agent 58) ──
// ensureAffiliateOperator grants the 'affiliate' role + creates the Affiliate entity +
// mints a referral code, INSTANTLY (no vetting), gated by AFFILIATE_ENABLED, IDEMPOTENT.
// Prisma + operator-roles mocked.

const { db, addRole } = vi.hoisted(() => ({
  db: {
    operator:  { findUnique: vi.fn() },
    affiliate: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    creator:   { findFirst: vi.fn() },
  },
  addRole: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/operator-roles', () => ({ addRoleToOperator: addRole }))

import { isAffiliateEnabled, ensureAffiliateOperator } from '@/lib/affiliate-account'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.AFFILIATE_ENABLED = 'true'
  db.operator.findUnique.mockResolvedValue({ id: 'op1', name: 'Alex Martin' })
  db.affiliate.findUnique.mockResolvedValue(null)
  db.affiliate.findFirst.mockResolvedValue(null) // no code clash
  db.creator.findFirst.mockResolvedValue(null)   // no cross-table clash
  db.affiliate.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
    id: 'aff1', operatorId: data.operatorId, referralCode: data.referralCode, referralLinkSlug: data.referralLinkSlug, status: 'active',
  }))
  addRole.mockResolvedValue(true)
})
afterEach(() => { delete process.env.AFFILIATE_ENABLED })

describe('isAffiliateEnabled', () => {
  it('only the exact string "true" enables it', () => {
    process.env.AFFILIATE_ENABLED = 'true';  expect(isAffiliateEnabled()).toBe(true)
    process.env.AFFILIATE_ENABLED = 'false'; expect(isAffiliateEnabled()).toBe(false)
    delete process.env.AFFILIATE_ENABLED;    expect(isAffiliateEnabled()).toBe(false)
  })
})

describe('ensureAffiliateOperator', () => {
  it('flag OFF → disabled, NO role grant, NO entity (byte-identical)', async () => {
    process.env.AFFILIATE_ENABLED = 'false'
    const res = await ensureAffiliateOperator('op1')
    expect(res).toEqual({ ok: false, reason: 'disabled' })
    expect(addRole).not.toHaveBeenCalled()
    expect(db.affiliate.create).not.toHaveBeenCalled()
  })

  it('flag ON, fresh operator → grants role + creates entity + mints a code (instant, no vetting)', async () => {
    const res = await ensureAffiliateOperator('op1')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.created).toBe(true)
    expect(addRole).toHaveBeenCalledWith('op1', 'affiliate')
    const data = db.affiliate.create.mock.calls[0][0].data
    expect(data.operatorId).toBe('op1')
    expect(typeof data.referralCode).toBe('string')
    expect(data.referralCode.length).toBeGreaterThan(0)
    expect(data.referralLinkSlug).toBe(data.referralCode.toLowerCase()) // slug = code lowercased
    expect(data.status).toBe('active')
    expect(res.affiliate.referralCode).toBe(data.referralCode)
  })

  it('IDEMPOTENT — an existing affiliate returns the same entity, NO second create / no new code', async () => {
    db.affiliate.findUnique.mockResolvedValue({ id: 'aff1', operatorId: 'op1', referralCode: 'ALEX9F2K', referralLinkSlug: 'alex9f2k', status: 'active' })
    const res = await ensureAffiliateOperator('op1')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.created).toBe(false)
    expect(res.affiliate.referralCode).toBe('ALEX9F2K')
    expect(db.affiliate.create).not.toHaveBeenCalled()
  })

  it('mint checks uniqueness across BOTH Affiliate AND Creator tables', async () => {
    await ensureAffiliateOperator('op1')
    expect(db.affiliate.findFirst).toHaveBeenCalled()
    expect(db.creator.findFirst).toHaveBeenCalled()
  })

  it('operator not found → operator_not_found, no entity', async () => {
    db.operator.findUnique.mockResolvedValue(null)
    const res = await ensureAffiliateOperator('ghost')
    expect(res).toEqual({ ok: false, reason: 'operator_not_found' })
    expect(db.affiliate.create).not.toHaveBeenCalled()
  })
})
