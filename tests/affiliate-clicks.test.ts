import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── lib/affiliate-clicks — privacy-safe click tracking (Brique C, Agent 60) ───────────
// recordAffiliateClick resolves the AFFILIATE owning a /ref code and inserts a click that
// stores ONLY the operator id + canonical code + timestamp (NO IP / user-agent / PII).
// Unknown codes record nothing. countAffiliateClicks is a pure read.

const { db } = vi.hoisted(() => ({
  db: {
    affiliate:     { findFirst: vi.fn() },
    referralClick: { create: vi.fn(), count: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { recordAffiliateClick, countAffiliateClicks } from '@/lib/affiliate-clicks'

beforeEach(() => {
  vi.clearAllMocks()
  db.affiliate.findFirst.mockResolvedValue({ operatorId: 'op1', referralCode: 'NABIL30' })
  db.referralClick.create.mockResolvedValue({ id: 'rc1' })
  db.referralClick.count.mockResolvedValue(7)
})

describe('recordAffiliateClick', () => {
  it('records a click for a known affiliate code and returns true', async () => {
    const ok = await recordAffiliateClick('nabil30')
    expect(ok).toBe(true)
    expect(db.referralClick.create).toHaveBeenCalledTimes(1)
  })

  it('stores NO PII — only operator id + canonical code (privacy by design)', async () => {
    await recordAffiliateClick('NABIL30')
    const payload = db.referralClick.create.mock.calls[0][0].data
    expect(Object.keys(payload).sort()).toEqual(['affiliateId', 'code'])
    expect(payload).toEqual({ affiliateId: 'op1', code: 'NABIL30' })
    // Defensive: no IP / user-agent style fields ever present.
    expect(payload).not.toHaveProperty('ip')
    expect(payload).not.toHaveProperty('userAgent')
  })

  it('resolves by referralCode (upper) OR referralLinkSlug (lower)', async () => {
    await recordAffiliateClick('NaBiL30')
    const where = db.affiliate.findFirst.mock.calls[0][0].where
    expect(where).toEqual({ OR: [{ referralCode: 'NABIL30' }, { referralLinkSlug: 'nabil30' }] })
  })

  it('unknown code → false, records nothing', async () => {
    db.affiliate.findFirst.mockResolvedValue(null)
    const ok = await recordAffiliateClick('UNKNOWN')
    expect(ok).toBe(false)
    expect(db.referralClick.create).not.toHaveBeenCalled()
  })

  it('empty/blank code → false, no DB call at all', async () => {
    expect(await recordAffiliateClick('')).toBe(false)
    expect(await recordAffiliateClick('   ')).toBe(false)
    expect(db.affiliate.findFirst).not.toHaveBeenCalled()
    expect(db.referralClick.create).not.toHaveBeenCalled()
  })
})

describe('countAffiliateClicks', () => {
  it('counts clicks scoped to the operator id', async () => {
    const n = await countAffiliateClicks('op1')
    expect(n).toBe(7)
    expect(db.referralClick.count).toHaveBeenCalledWith({ where: { affiliateId: 'op1' } })
  })
})
