import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── lib/influencer-verification — audience verification state machine (INF-1, Agent 66) ─
// Proves: flag gates everything; owner-scoped request (no 2 pending; re-apply after reject);
// admin approve flips Affiliate.audienceVerified=true (atomic); reject leaves it false;
// 100% OFF the money path (no ReferralOrder/Payout/commission touched).

const { db } = vi.hoisted(() => ({
  db: {
    affiliate:                   { findUnique: vi.fn(), update: vi.fn() },
    audienceVerificationRequest: { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    operator:                    { findMany: vi.fn() },
    $transaction:                vi.fn((arr: unknown[]) => Promise.all(arr as Promise<unknown>[])),
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import {
  isInfluencerEnabled, isAffiliateVerified, createVerificationRequest, decideVerification,
} from '@/lib/influencer-verification'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.INFLUENCER_ENABLED = 'true'
  db.affiliate.findUnique.mockResolvedValue({ audienceVerified: false })
  db.affiliate.update.mockResolvedValue({})
  db.audienceVerificationRequest.findUnique.mockResolvedValue(null)
  db.audienceVerificationRequest.upsert.mockResolvedValue({ id: 'req1' })
  db.audienceVerificationRequest.update.mockResolvedValue({})
})
afterEach(() => { delete process.env.INFLUENCER_ENABLED })

describe('flag', () => {
  it('isInfluencerEnabled only on exact "true"', () => {
    expect(isInfluencerEnabled()).toBe(true)
    process.env.INFLUENCER_ENABLED = 'TRUE'; expect(isInfluencerEnabled()).toBe(false)
    delete process.env.INFLUENCER_ENABLED; expect(isInfluencerEnabled()).toBe(false)
  })
})

describe('createVerificationRequest (owner-scoped)', () => {
  const input = { platform: 'instagram' as const, handle: '@me', declaredFollowers: 12000 }

  it('flag OFF → disabled, NO DB touched', async () => {
    delete process.env.INFLUENCER_ENABLED
    expect(await createVerificationRequest('op1', input)).toEqual({ ok: false, reason: 'disabled' })
    expect(db.affiliate.findUnique).not.toHaveBeenCalled()
    expect(db.audienceVerificationRequest.upsert).not.toHaveBeenCalled()
  })
  it('not an affiliate → not_affiliate', async () => {
    db.affiliate.findUnique.mockResolvedValue(null)
    expect((await createVerificationRequest('op1', input)).ok).toBe(false)
    expect(db.audienceVerificationRequest.upsert).not.toHaveBeenCalled()
  })
  it('already verified → already_verified, no new request', async () => {
    db.affiliate.findUnique.mockResolvedValue({ audienceVerified: true })
    expect(await createVerificationRequest('op1', input)).toEqual({ ok: false, reason: 'already_verified' })
    expect(db.audienceVerificationRequest.upsert).not.toHaveBeenCalled()
  })
  it('a pending request blocks a 2nd one (idempotent)', async () => {
    db.audienceVerificationRequest.findUnique.mockResolvedValue({ status: 'pending' })
    expect(await createVerificationRequest('op1', input)).toEqual({ ok: false, reason: 'already_pending' })
    expect(db.audienceVerificationRequest.upsert).not.toHaveBeenCalled()
  })
  it('creates/re-applies → upsert to pending, scoped to the operator', async () => {
    const out = await createVerificationRequest('op1', input)
    expect(out).toEqual({ ok: true, status: 'pending' })
    const arg = db.audienceVerificationRequest.upsert.mock.calls[0][0]
    expect(arg.where).toEqual({ operatorId: 'op1' })
    expect(arg.create).toMatchObject({ operatorId: 'op1', platform: 'instagram', status: 'pending' })
    expect(arg.update).toMatchObject({ status: 'pending', reviewedBy: null, reviewedAt: null })
  })
})

describe('decideVerification (admin)', () => {
  beforeEach(() => {
    db.audienceVerificationRequest.findUnique.mockResolvedValue({ id: 'req1', operatorId: 'op1', status: 'pending', platform: 'instagram', handle: '@me', declaredFollowers: 12000 })
  })
  it('flag OFF → disabled', async () => {
    delete process.env.INFLUENCER_ENABLED
    expect(await decideVerification('req1', 'approve', 'admin1')).toEqual({ ok: false, reason: 'disabled' })
  })
  it('not found → not_found', async () => {
    db.audienceVerificationRequest.findUnique.mockResolvedValue(null)
    expect((await decideVerification('reqX', 'approve', 'admin1')).ok).toBe(false)
  })
  it('already decided → already_decided', async () => {
    db.audienceVerificationRequest.findUnique.mockResolvedValue({ id: 'req1', operatorId: 'op1', status: 'approved' })
    expect(await decideVerification('req1', 'approve', 'admin1')).toEqual({ ok: false, reason: 'already_decided' })
  })
  it('APPROVE → request approved + Affiliate.audienceVerified=true (atomic, snapshot)', async () => {
    const out = await decideVerification('req1', 'approve', 'admin1')
    expect(out).toEqual({ ok: true, status: 'approved' })
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(db.audienceVerificationRequest.update.mock.calls[0][0].data).toMatchObject({ status: 'approved', reviewedBy: 'admin1' })
    const affData = db.affiliate.update.mock.calls[0][0]
    expect(affData.where).toEqual({ operatorId: 'op1' })
    expect(affData.data).toMatchObject({ audienceVerified: true, primaryPlatform: 'instagram', handle: '@me', declaredFollowers: 12000 })
  })
  it('REJECT → request rejected, Affiliate NEVER updated (audienceVerified stays false)', async () => {
    const out = await decideVerification('req1', 'reject', 'admin1')
    expect(out).toEqual({ ok: true, status: 'rejected' })
    expect(db.audienceVerificationRequest.update.mock.calls[0][0].data).toMatchObject({ status: 'rejected', reviewedBy: 'admin1' })
    expect(db.affiliate.update).not.toHaveBeenCalled()
  })
})

describe('isAffiliateVerified (read-only state)', () => {
  it('reflects the affiliate flag', async () => {
    db.affiliate.findUnique.mockResolvedValue({ audienceVerified: true })
    expect(await isAffiliateVerified('op1')).toBe(true)
    db.affiliate.findUnique.mockResolvedValue(null)
    expect(await isAffiliateVerified('opX')).toBe(false)
  })
})
