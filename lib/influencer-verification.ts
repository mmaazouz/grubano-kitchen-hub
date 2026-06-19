import { prisma } from '@/lib/prisma'

// ── Influencer tier — AUDIENCE verification (Phase 6 INF-1, Agent 66) ─────────────────
// An "influencer" is an AFFILIATE whose AUDIENCE has been VERIFIED by an admin. This module
// owns ONLY that state machine: an affiliate APPLIES (owner-scoped), an admin APPROVES/
// REJECTS, and on approval Affiliate.audienceVerified flips to true. It is 100% OFF the
// money path: it NEVER reads/writes ReferralOrder / Payout / commission / balance. The
// BETTER commissions of a verified influencer are a SEPARATE later brick (INF-3). Gated by
// INFLUENCER_ENABLED (default OFF) → OFF means no request/approval is possible and no
// affiliate can become verified. Distinct from the Stripe Connect identity-KYC (D1/D2).

/** Kill-switch — default OFF. Only the exact string 'true' opens the influencer tier. */
export function isInfluencerEnabled(): boolean {
  return process.env.INFLUENCER_ENABLED === 'true'
}

export const VERIFY_PLATFORMS = ['youtube', 'instagram', 'tiktok', 'other'] as const
export type VerifyPlatform = (typeof VERIFY_PLATFORMS)[number]

export interface VerificationRequestView {
  status:            string   // pending | approved | rejected
  platform:          string
  handle:            string
  declaredFollowers: number
  proofUrl:          string | null
  createdAt:         string
  reviewedAt:        string | null
}

export interface VerificationState {
  verified: boolean
  request:  VerificationRequestView | null
}

export type CreateRequestInput = {
  platform:          VerifyPlatform
  handle:            string
  declaredFollowers: number
  proofUrl?:         string | null
}

export type CreateRequestResult =
  | { ok: true;  status: 'pending' }
  | { ok: false; reason: 'disabled' | 'not_affiliate' | 'already_verified' | 'already_pending' | 'error' }

export type DecideResult =
  | { ok: true;  status: 'approved' | 'rejected' }
  | { ok: false; reason: 'disabled' | 'not_found' | 'already_decided' | 'error' }

/** Read-only: is this affiliate's audience verified? false when not an affiliate / no row. */
export async function isAffiliateVerified(operatorId: string): Promise<boolean> {
  const aff = await prisma.affiliate.findUnique({
    where:  { operatorId },
    select: { audienceVerified: true },
  })
  return !!aff?.audienceVerified
}

/** The SESSION affiliate's verification state (verified flag + current request, if any). */
export async function getVerificationState(operatorId: string): Promise<VerificationState> {
  const [aff, req] = await Promise.all([
    prisma.affiliate.findUnique({ where: { operatorId }, select: { audienceVerified: true } }),
    prisma.audienceVerificationRequest.findUnique({
      where:  { operatorId },
      select: { status: true, platform: true, handle: true, declaredFollowers: true, proofUrl: true, createdAt: true, reviewedAt: true },
    }),
  ])
  return {
    verified: !!aff?.audienceVerified,
    request: req
      ? {
          status:            req.status,
          platform:          req.platform,
          handle:            req.handle,
          declaredFollowers: req.declaredFollowers,
          proofUrl:          req.proofUrl,
          createdAt:         req.createdAt.toISOString(),
          reviewedAt:        req.reviewedAt?.toISOString() ?? null,
        }
      : null,
  }
}

/**
 * Create (or re-apply) a verification request for the SESSION affiliate. OWNER-SCOPED:
 * `operatorId` is the session operator (resolved by the route, never a client value).
 * Idempotent: a pending request blocks a 2nd one; an already-verified affiliate cannot
 * apply; a previously REJECTED request is reset to pending (re-apply). NO money.
 */
export async function createVerificationRequest(operatorId: string, input: CreateRequestInput): Promise<CreateRequestResult> {
  if (!isInfluencerEnabled()) return { ok: false, reason: 'disabled' }
  try {
    const aff = await prisma.affiliate.findUnique({ where: { operatorId }, select: { audienceVerified: true } })
    if (!aff) return { ok: false, reason: 'not_affiliate' }
    if (aff.audienceVerified) return { ok: false, reason: 'already_verified' }

    const existing = await prisma.audienceVerificationRequest.findUnique({ where: { operatorId }, select: { status: true } })
    if (existing && existing.status === 'pending') return { ok: false, reason: 'already_pending' }

    const data = {
      platform:          input.platform,
      handle:            input.handle.trim().slice(0, 120),
      declaredFollowers: Math.max(0, Math.floor(input.declaredFollowers || 0)),
      proofUrl:          input.proofUrl?.trim().slice(0, 500) || null,
    }
    // operatorId @unique → one row per affiliate, transitioned in place (re-apply resets
    // a rejected/approved row to pending + clears the prior review). Race-safe by @unique.
    await prisma.audienceVerificationRequest.upsert({
      where:  { operatorId },
      create: { operatorId, ...data, status: 'pending' },
      update: { ...data, status: 'pending', reviewedBy: null, reviewedAt: null },
    })
    return { ok: true, status: 'pending' }
  } catch (err) {
    console.error('[createVerificationRequest]', operatorId, err instanceof Error ? err.message : err)
    return { ok: false, reason: 'error' }
  }
}

export interface AdminRequestRow {
  id:                string
  operatorId:        string
  operatorEmail:     string | null
  operatorName:      string | null
  platform:          string
  handle:            string
  declaredFollowers: number
  proofUrl:          string | null
  status:            string
  createdAt:         string
  reviewedAt:        string | null
}

/** ADMIN read: list verification requests (newest first), optionally filtered by status.
 *  Decorated with the applicant operator's email/name for display. */
export async function listVerificationRequests(status?: string): Promise<AdminRequestRow[]> {
  const rows = await prisma.audienceVerificationRequest.findMany({
    where:   status ? { status } : undefined,
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take:    200,
    select:  { id: true, operatorId: true, platform: true, handle: true, declaredFollowers: true, proofUrl: true, status: true, createdAt: true, reviewedAt: true },
  })
  const ids = Array.from(new Set(rows.map(r => r.operatorId)))
  const ops = ids.length
    ? await prisma.operator.findMany({ where: { id: { in: ids } }, select: { id: true, email: true, name: true } })
    : []
  const byId = new Map(ops.map(o => [o.id, o]))
  return rows.map(r => ({
    id: r.id, operatorId: r.operatorId,
    operatorEmail: byId.get(r.operatorId)?.email ?? null,
    operatorName:  byId.get(r.operatorId)?.name ?? null,
    platform: r.platform, handle: r.handle, declaredFollowers: r.declaredFollowers, proofUrl: r.proofUrl,
    status: r.status, createdAt: r.createdAt.toISOString(), reviewedAt: r.reviewedAt?.toISOString() ?? null,
  }))
}

/**
 * ADMIN decision (the route MUST have verified the admin role server-side; `adminId` is for
 * audit). Atomic: APPROVE → request 'approved' + Affiliate.audienceVerified=true (+ snapshot
 * platform/handle/followers); REJECT → request 'rejected', audienceVerified stays false. Only
 * a 'pending' request can be decided. NO money is ever touched (no commission/payout effect —
 * that is INF-3).
 */
export async function decideVerification(requestId: string, action: 'approve' | 'reject', adminId: string): Promise<DecideResult> {
  if (!isInfluencerEnabled()) return { ok: false, reason: 'disabled' }
  try {
    const req = await prisma.audienceVerificationRequest.findUnique({
      where:  { id: requestId },
      select: { id: true, operatorId: true, status: true, platform: true, handle: true, declaredFollowers: true },
    })
    if (!req) return { ok: false, reason: 'not_found' }
    if (req.status !== 'pending') return { ok: false, reason: 'already_decided' }

    if (action === 'reject') {
      await prisma.audienceVerificationRequest.update({
        where: { id: req.id },
        data:  { status: 'rejected', reviewedBy: adminId, reviewedAt: new Date() },
      })
      return { ok: true, status: 'rejected' }
    }

    // APPROVE — flip the verified state + snapshot, atomically with the request transition.
    await prisma.$transaction([
      prisma.audienceVerificationRequest.update({
        where: { id: req.id },
        data:  { status: 'approved', reviewedBy: adminId, reviewedAt: new Date() },
      }),
      prisma.affiliate.update({
        where: { operatorId: req.operatorId },
        data:  {
          audienceVerified:   true,
          audienceVerifiedAt: new Date(),
          primaryPlatform:    req.platform,
          handle:             req.handle,
          declaredFollowers:  req.declaredFollowers,
        },
      }),
    ])
    return { ok: true, status: 'approved' }
  } catch (err) {
    console.error('[decideVerification]', requestId, action, err instanceof Error ? err.message : err)
    return { ok: false, reason: 'error' }
  }
}
