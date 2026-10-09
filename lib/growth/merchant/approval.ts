// ── Growth / merchant — human approval queue ─────────────────────────────────────────
//
// PURE. No I/O, no persistence — the queue is a VALUE a caller builds up and threads
// through its workflow. The lot's design rule is explicit: no automated outreach without
// a documented human approval of the proposal. This module makes that rule unavoidable
// in code: callers construct an `ApprovalQueue`, enqueue proposals, and only `approved`
// items ever reach the dispatcher.
//
// Doctrine:
//   - Every item carries full PROVENANCE (reasonCode, rationale, score snapshot, scorer
//     weights, contact id, tenant id). Nothing is reconstructed from memory.
//   - Idempotency is enforced on `(prospectId, contactId, proposalIdempotencyKey)`. Re-
//     enqueuing the same proposal is a no-op; re-approving is a no-op.
//   - Tenant isolation: items track `tenantOperatorId`. A caller fetching the queue for
//     one tenant must not see another tenant's items.
//   - A rejection is RECORDED, not deleted — the audit trail must survive restarts.

import type { OutreachProposal, NextActionDecision } from './next-action'
import type { MerchantProspect } from '../types'

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired'

export interface ApprovalItem {
  /** Deterministic key: equals the proposal's idempotencyKey. */
  id:              string
  prospectId:      string
  contactId:       string
  /** Central Grubano prospects have `null`; franchise-scoped prospects carry their operatorId. */
  tenantOperatorId: string | null
  proposal:        OutreachProposal
  /** The decision that produced this proposal. Immutable. */
  decisionReasonCode: string
  decisionRationale:  string
  /** 0..100 composite at the moment of enqueue (snapshot, not re-computed on read). */
  compositeScoreSnapshot: number
  enqueuedAtMs:    number
  status:          ApprovalStatus
  /** Who / what approved (null while pending). */
  approvedBy:      string | null
  approvedAtMs:    number | null
  /** Reason for rejection (null while pending/approved). */
  rejectionReason: string | null
  rejectedAtMs:    number | null
  /** TTL in ms; items older than enqueuedAt + ttl auto-expire during inspection. */
  ttlMs:           number
}

export interface EnqueueInput {
  nowMs:           number
  prospect:        Pick<MerchantProspect, 'id'>
  tenantOperatorId: string | null
  decision:        NextActionDecision
  compositeScoreSnapshot: number
  /** TTL in ms. Default: 14 days. */
  ttlMs?:          number
}

export type EnqueueResult =
  | { ok: true;  item: ApprovalItem; added: boolean }
  | { ok: false; reason: 'decision_not_outreach' | 'invalid_input' }

const DEFAULT_TTL_MS = 14 * 86_400_000

/**
 * The queue is a plain Map keyed by itemId. Immutable from outside this module's
 * mutation helpers; downstream code should treat it as opaque and only call the exposed
 * functions.
 */
export class ApprovalQueue {
  private readonly items = new Map<string, ApprovalItem>()

  /**
   * Enqueue a proposal if (a) the decision kind is one that proposes an outreach,
   * (b) no item with the same idempotency key exists already. Returns the stored item
   * either way (`added: false` on dedupe).
   */
  enqueue(input: EnqueueInput): EnqueueResult {
    const d = input.decision
    if (d.kind !== 'propose_outreach' && d.kind !== 'followup') {
      return { ok: false, reason: 'decision_not_outreach' }
    }
    if (!input.prospect?.id) return { ok: false, reason: 'invalid_input' }
    const existing = this.items.get(d.proposal.idempotencyKey)
    if (existing) return { ok: true, item: existing, added: false }

    const item: ApprovalItem = {
      id:               d.proposal.idempotencyKey,
      prospectId:       input.prospect.id,
      contactId:        d.proposal.contactId,
      tenantOperatorId: input.tenantOperatorId,
      proposal:         d.proposal,
      decisionReasonCode: d.reasonCode,
      decisionRationale:  d.rationale,
      compositeScoreSnapshot: input.compositeScoreSnapshot,
      enqueuedAtMs:    input.nowMs,
      status:          'pending',
      approvedBy:      null,
      approvedAtMs:    null,
      rejectionReason: null,
      rejectedAtMs:    null,
      ttlMs:           input.ttlMs ?? DEFAULT_TTL_MS,
    }
    this.items.set(item.id, item)
    return { ok: true, item, added: true }
  }

  approve(id: string, approvedBy: string, nowMs: number): { ok: boolean; reason?: string } {
    const it = this.items.get(id)
    if (!it) return { ok: false, reason: 'not_found' }
    if (it.status === 'approved') return { ok: true }  // idempotent
    if (it.status !== 'pending')   return { ok: false, reason: `wrong_status:${it.status}` }
    if (nowMs > it.enqueuedAtMs + it.ttlMs) {
      it.status = 'expired'
      return { ok: false, reason: 'expired' }
    }
    it.status = 'approved'
    it.approvedBy = approvedBy
    it.approvedAtMs = nowMs
    return { ok: true }
  }

  reject(id: string, reason: string, nowMs: number): { ok: boolean; reason?: string } {
    const it = this.items.get(id)
    if (!it) return { ok: false, reason: 'not_found' }
    if (it.status === 'rejected') return { ok: true }  // idempotent
    if (it.status !== 'pending')   return { ok: false, reason: `wrong_status:${it.status}` }
    it.status = 'rejected'
    it.rejectionReason = reason
    it.rejectedAtMs = nowMs
    return { ok: true }
  }

  /** Items for a tenant. Null tenantOperatorId means "central Grubano queue". */
  listForTenant(tenantOperatorId: string | null, nowMs: number): readonly ApprovalItem[] {
    const out: ApprovalItem[] = []
    for (const it of this.items.values()) {
      if (it.tenantOperatorId !== tenantOperatorId) continue
      if (it.status === 'pending' && nowMs > it.enqueuedAtMs + it.ttlMs) {
        it.status = 'expired'
      }
      out.push(it)
    }
    // Deterministic order: enqueuedAt ascending, then id.
    out.sort((a, b) => a.enqueuedAtMs - b.enqueuedAtMs || a.id.localeCompare(b.id))
    return out
  }

  /** Approved proposals ready to dispatch. Caller still has to re-check policy at send time. */
  readyToDispatch(tenantOperatorId: string | null, nowMs: number): readonly ApprovalItem[] {
    return this.listForTenant(tenantOperatorId, nowMs).filter((it) => it.status === 'approved')
  }

  get(id: string): ApprovalItem | undefined {
    return this.items.get(id)
  }

  size(): number {
    return this.items.size
  }
}
