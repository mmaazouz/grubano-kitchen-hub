// tests/growth-merchant-approval.test.ts — human-approval queue invariants.
// Idempotent enqueue, idempotent approve/reject, tenant isolation, TTL expiry, provenance
// preserved on every item.

import { describe, it, expect } from 'vitest'
import { ApprovalQueue, type AuthenticatedApprover } from '@/lib/growth/merchant/approval'
import type { NextActionDecision, OutreachProposal } from '@/lib/growth/merchant/next-action'

const platformAdmin: AuthenticatedApprover = {
  operatorId: null, role: 'platform_admin', displayName: 'ops@grubano.com',
}
const tenantAApprover: AuthenticatedApprover = {
  operatorId: 'tenant_A', role: 'tenant_admin', displayName: 'alice@tenant-a',
}
const tenantBApprover: AuthenticatedApprover = {
  operatorId: 'tenant_B', role: 'tenant_admin', displayName: 'bob@tenant-b',
}

const T = Date.parse('2026-10-09T12:00:00+00:00')

const proposal = (over: Partial<OutreachProposal> = {}): OutreachProposal => ({
  contactId: 'c1', channel: 'email', purpose: 'cold_b2b',
  legalBasis: 'legitimate_interest',
  idempotencyKey: 'merchant_outreach|prospect=p1|contact=c1|state=verified',
  requirements: {
    includeOptOut: true, identifyGrubano: true, includeBusinessContext: true,
    respectQuietHours: true, respectFrequencyCap: true, professionalRelevanceOnly: true,
  },
  ...over,
})

const outreachDecision: NextActionDecision = {
  kind: 'propose_outreach',
  reasonCode: 'first_touch_ready',
  rationale: 'Prospect is outreach-eligible; composite 72.',
  proposal: proposal(),
}

describe('ApprovalQueue.enqueue', () => {
  it('refuses decisions that are not outreach proposals', () => {
    const q = new ApprovalQueue()
    const r = q.enqueue({
      nowMs: T, prospect: { id: 'p1' }, tenantOperatorId: null,
      decision: { kind: 'wait', reasonCode: 'x', rationale: 'y', retryAfterMs: 1 },
      compositeScoreSnapshot: 70,
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('decision_not_outreach')
  })

  it('stores the full provenance of the decision', () => {
    const q = new ApprovalQueue()
    const r = q.enqueue({
      nowMs: T, prospect: { id: 'p1' }, tenantOperatorId: null,
      decision: outreachDecision, compositeScoreSnapshot: 72,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.added).toBe(true)
      expect(r.item.decisionReasonCode).toBe('first_touch_ready')
      expect(r.item.compositeScoreSnapshot).toBe(72)
      expect(r.item.status).toBe('pending')
      expect(r.item.enqueuedAtMs).toBe(T)
    }
  })

  it('is idempotent on identical idempotencyKey (added:false, same item)', () => {
    const q = new ApprovalQueue()
    const a = q.enqueue({ nowMs: T, prospect: { id: 'p1' }, tenantOperatorId: null, decision: outreachDecision, compositeScoreSnapshot: 72 })
    const b = q.enqueue({ nowMs: T + 1000, prospect: { id: 'p1' }, tenantOperatorId: null, decision: outreachDecision, compositeScoreSnapshot: 80 })
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(b.added).toBe(false)
      expect(b.item.id).toBe(a.item.id)
      expect(b.item.compositeScoreSnapshot).toBe(72)   // first-write wins
    }
    expect(q.size()).toBe(1)
  })
})

describe('ApprovalQueue.approve / reject', () => {
  it('approves a pending item and records who / when', () => {
    const q = new ApprovalQueue()
    q.enqueue({ nowMs: T, prospect: { id: 'p1' }, tenantOperatorId: null, decision: outreachDecision, compositeScoreSnapshot: 72 })
    const r = q.approve(outreachDecision.proposal.idempotencyKey, platformAdmin, T + 1000)
    expect(r.ok).toBe(true)
    const item = q.get(outreachDecision.proposal.idempotencyKey)!
    expect(item.status).toBe('approved')
    expect(item.approvedBy).toBe('ops@grubano.com')
    expect(item.approverOperatorId).toBeNull()
    expect(item.approverRole).toBe('platform_admin')
    expect(item.approvedAtMs).toBe(T + 1000)
  })

  it('is idempotent on repeated approve', () => {
    const q = new ApprovalQueue()
    q.enqueue({ nowMs: T, prospect: { id: 'p1' }, tenantOperatorId: null, decision: outreachDecision, compositeScoreSnapshot: 72 })
    const u1: AuthenticatedApprover = { operatorId: null, role: 'platform_admin', displayName: 'u1' }
    const u2: AuthenticatedApprover = { operatorId: null, role: 'platform_admin', displayName: 'u2' }
    q.approve(outreachDecision.proposal.idempotencyKey, u1, T + 1)
    const r = q.approve(outreachDecision.proposal.idempotencyKey, u2, T + 2)
    expect(r.ok).toBe(true)
    // first approver sticks
    expect(q.get(outreachDecision.proposal.idempotencyKey)!.approvedBy).toBe('u1')
  })

  it('rejects a pending item with a reason', () => {
    const q = new ApprovalQueue()
    q.enqueue({ nowMs: T, prospect: { id: 'p1' }, tenantOperatorId: null, decision: outreachDecision, compositeScoreSnapshot: 72 })
    q.reject(outreachDecision.proposal.idempotencyKey, platformAdmin, 'off-ICP', T + 1)
    const item = q.get(outreachDecision.proposal.idempotencyKey)!
    expect(item.status).toBe('rejected')
    expect(item.rejectionReason).toBe('off-ICP')
  })

  it('expires a pending item once past TTL', () => {
    const q = new ApprovalQueue()
    const ttl = 86_400_000  // 1 day
    q.enqueue({ nowMs: T, prospect: { id: 'p1' }, tenantOperatorId: null, decision: outreachDecision, compositeScoreSnapshot: 72, ttlMs: ttl })
    const items = q.listForTenant(null, T + ttl + 1)
    expect(items[0].status).toBe('expired')
    const r = q.approve(outreachDecision.proposal.idempotencyKey, platformAdmin, T + ttl + 2)
    // Already expired → cannot approve.
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('wrong_status')
  })
})

// ── P1c — authenticated approver authz ────────────────────────────────────────────────
//
// An ApprovalItem.tenantOperatorId is a server-side classification. The approve/reject
// seam must NEVER trust a tenant id supplied by (or implied by) an untrusted caller: it
// must take an authenticated principal and verify that principal is allowed to act on
// THIS item. A tenant_admin for 'tenant_A' cannot approve 'tenant_B' items; a
// tenant_admin cannot approve central (null-tenant) items; platform_admin can act on
// any item.
describe('ApprovalQueue authz (P1c)', () => {
  it('refuses cross-tenant approve attempts', () => {
    const q = new ApprovalQueue()
    const other: NextActionDecision = {
      ...outreachDecision,
      proposal: proposal({ idempotencyKey: 'tenantA|key' }),
    }
    q.enqueue({ nowMs: T, prospect: { id: 'pA' }, tenantOperatorId: 'tenant_A', decision: other, compositeScoreSnapshot: 70 })
    const r = q.approve('tenantA|key', tenantBApprover, T + 1)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('forbidden_tenant_mismatch')
    expect(q.get('tenantA|key')!.status).toBe('pending')
  })

  it('refuses cross-tenant reject attempts', () => {
    const q = new ApprovalQueue()
    const other: NextActionDecision = {
      ...outreachDecision,
      proposal: proposal({ idempotencyKey: 'tenantA|key2' }),
    }
    q.enqueue({ nowMs: T, prospect: { id: 'pA' }, tenantOperatorId: 'tenant_A', decision: other, compositeScoreSnapshot: 70 })
    const r = q.reject('tenantA|key2', tenantBApprover, 'bad', T + 1)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('forbidden_tenant_mismatch')
  })

  it('refuses tenant_admin acting on central (null tenant) items', () => {
    const q = new ApprovalQueue()
    q.enqueue({ nowMs: T, prospect: { id: 'p1' }, tenantOperatorId: null, decision: outreachDecision, compositeScoreSnapshot: 72 })
    const r = q.approve(outreachDecision.proposal.idempotencyKey, tenantAApprover, T + 1)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('forbidden_tenant_mismatch')
  })

  it('allows a tenant_admin to approve their own tenant items', () => {
    const q = new ApprovalQueue()
    const other: NextActionDecision = {
      ...outreachDecision,
      proposal: proposal({ idempotencyKey: 'tenantA|ok' }),
    }
    q.enqueue({ nowMs: T, prospect: { id: 'pA' }, tenantOperatorId: 'tenant_A', decision: other, compositeScoreSnapshot: 70 })
    const r = q.approve('tenantA|ok', tenantAApprover, T + 1)
    expect(r.ok).toBe(true)
    expect(q.get('tenantA|ok')!.status).toBe('approved')
    expect(q.get('tenantA|ok')!.approverOperatorId).toBe('tenant_A')
  })

  it('refuses an approver with a non-admin role', () => {
    const q = new ApprovalQueue()
    q.enqueue({ nowMs: T, prospect: { id: 'p1' }, tenantOperatorId: null, decision: outreachDecision, compositeScoreSnapshot: 72 })
    const viewer: AuthenticatedApprover = {
      operatorId: null, role: 'viewer' as unknown as AuthenticatedApprover['role'], displayName: 'v',
    }
    const r = q.approve(outreachDecision.proposal.idempotencyKey, viewer, T + 1)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('forbidden_role')
  })
})

// ── P1d — expiry on all command paths ────────────────────────────────────────────────
describe('ApprovalQueue expiry (P1d)', () => {
  it('reject on a past-TTL pending item marks it expired, never rejected', () => {
    const q = new ApprovalQueue()
    const ttl = 86_400_000
    q.enqueue({ nowMs: T, prospect: { id: 'p1' }, tenantOperatorId: null, decision: outreachDecision, compositeScoreSnapshot: 72, ttlMs: ttl })
    const r = q.reject(outreachDecision.proposal.idempotencyKey, platformAdmin, 'late', T + ttl + 1)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('expired')
    expect(q.get(outreachDecision.proposal.idempotencyKey)!.status).toBe('expired')
  })

  it('expireAll sweeps every tenant without needing a listForTenant per tenant', () => {
    const q = new ApprovalQueue()
    const ttl = 86_400_000
    q.enqueue({ nowMs: T, prospect: { id: 'p1' }, tenantOperatorId: null, decision: outreachDecision, compositeScoreSnapshot: 72, ttlMs: ttl })
    const other: NextActionDecision = {
      ...outreachDecision,
      proposal: proposal({ idempotencyKey: 'tenantA|exp' }),
    }
    q.enqueue({ nowMs: T, prospect: { id: 'pA' }, tenantOperatorId: 'tenant_A', decision: other, compositeScoreSnapshot: 70, ttlMs: ttl })
    const n = q.expireAll(T + ttl + 1)
    expect(n).toBe(2)
    expect(q.get(outreachDecision.proposal.idempotencyKey)!.status).toBe('expired')
    expect(q.get('tenantA|exp')!.status).toBe('expired')
  })
})

describe('tenant isolation', () => {
  it('does not leak items between tenants', () => {
    const q = new ApprovalQueue()
    q.enqueue({ nowMs: T, prospect: { id: 'p1' }, tenantOperatorId: null, decision: outreachDecision, compositeScoreSnapshot: 72 })
    const other: NextActionDecision = {
      ...outreachDecision,
      proposal: proposal({ idempotencyKey: 'other|key' }),
    }
    q.enqueue({ nowMs: T, prospect: { id: 'p2' }, tenantOperatorId: 'tenant_B', decision: other, compositeScoreSnapshot: 60 })
    expect(q.listForTenant(null, T).map((i) => i.id)).toEqual([outreachDecision.proposal.idempotencyKey])
    expect(q.listForTenant('tenant_B', T).map((i) => i.id)).toEqual(['other|key'])
  })

  it('only approved items are returned by readyToDispatch', () => {
    const q = new ApprovalQueue()
    q.enqueue({ nowMs: T, prospect: { id: 'p1' }, tenantOperatorId: null, decision: outreachDecision, compositeScoreSnapshot: 72 })
    expect(q.readyToDispatch(null, T)).toHaveLength(0)
    q.approve(outreachDecision.proposal.idempotencyKey, platformAdmin, T + 1)
    expect(q.readyToDispatch(null, T + 2)).toHaveLength(1)
  })
})
