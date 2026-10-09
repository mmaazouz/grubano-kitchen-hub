// tests/growth-merchant-approval.test.ts — human-approval queue invariants.
// Idempotent enqueue, idempotent approve/reject, tenant isolation, TTL expiry, provenance
// preserved on every item.

import { describe, it, expect } from 'vitest'
import { ApprovalQueue } from '@/lib/growth/merchant/approval'
import type { NextActionDecision, OutreachProposal } from '@/lib/growth/merchant/next-action'

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
    const r = q.approve(outreachDecision.proposal.idempotencyKey, 'user@grubano.com', T + 1000)
    expect(r.ok).toBe(true)
    const item = q.get(outreachDecision.proposal.idempotencyKey)!
    expect(item.status).toBe('approved')
    expect(item.approvedBy).toBe('user@grubano.com')
    expect(item.approvedAtMs).toBe(T + 1000)
  })

  it('is idempotent on repeated approve', () => {
    const q = new ApprovalQueue()
    q.enqueue({ nowMs: T, prospect: { id: 'p1' }, tenantOperatorId: null, decision: outreachDecision, compositeScoreSnapshot: 72 })
    q.approve(outreachDecision.proposal.idempotencyKey, 'u1', T + 1)
    const r = q.approve(outreachDecision.proposal.idempotencyKey, 'u2', T + 2)
    expect(r.ok).toBe(true)
    // first approver sticks
    expect(q.get(outreachDecision.proposal.idempotencyKey)!.approvedBy).toBe('u1')
  })

  it('rejects a pending item with a reason', () => {
    const q = new ApprovalQueue()
    q.enqueue({ nowMs: T, prospect: { id: 'p1' }, tenantOperatorId: null, decision: outreachDecision, compositeScoreSnapshot: 72 })
    q.reject(outreachDecision.proposal.idempotencyKey, 'off-ICP', T + 1)
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
    const r = q.approve(outreachDecision.proposal.idempotencyKey, 'u1', T + ttl + 2)
    // Already expired → cannot approve.
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('wrong_status')
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
    q.approve(outreachDecision.proposal.idempotencyKey, 'u1', T + 1)
    expect(q.readyToDispatch(null, T + 2)).toHaveLength(1)
  })
})
