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

/**
 * The authenticated principal performing an approve/reject. The queue trusts THIS value
 * and never the caller-supplied tenant id on the item. Construction of an
 * `AuthenticatedApprover` must happen on a server seam that has already verified the
 * session; a client-supplied object is a bug.
 *
 * `platform_admin` can act on central (null-tenant) items AND any tenant item.
 * `tenant_admin` can act ONLY on items whose `tenantOperatorId === approver.operatorId`.
 * Any other role is rejected (`forbidden_role`).
 */
export const APPROVER_ROLES = ['platform_admin', 'tenant_admin'] as const
export type ApproverRole = (typeof APPROVER_ROLES)[number]

export interface AuthenticatedApprover {
  /** Null iff the approver is a platform admin (central Grubano). */
  operatorId:  string | null
  role:        ApproverRole
  /** Human-readable identifier recorded on the item (email, username). Audit trail only. */
  displayName: string
}

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
  /** Human-readable approver identity (displayName at approve-time). Null while pending. */
  approvedBy:      string | null
  /** The approver's authenticated operatorId at approve-time (null = platform). */
  approverOperatorId: string | null
  approverRole:    ApproverRole | null
  approvedAtMs:    number | null
  /** Reason for rejection (null while pending/approved). */
  rejectionReason: string | null
  /** Approver identity recorded on reject. */
  rejectedBy:      string | null
  rejecterOperatorId: string | null
  rejecterRole:    ApproverRole | null
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
      approverOperatorId: null,
      approverRole:    null,
      approvedAtMs:    null,
      rejectionReason: null,
      rejectedBy:      null,
      rejecterOperatorId: null,
      rejecterRole:    null,
      rejectedAtMs:    null,
      ttlMs:           input.ttlMs ?? DEFAULT_TTL_MS,
    }
    this.items.set(item.id, item)
    return { ok: true, item, added: true }
  }

  /**
   * Authz gate shared by approve/reject. Returns a reason code on refusal, null when
   * the approver may act on this item. Fail-closed on unknown roles AND on an operatorId
   * that is not an explicit `string` or `null` (any other truthy shape).
   */
  private authorise(it: ApprovalItem, approver: AuthenticatedApprover):
    | { ok: true }
    | { ok: false; reason: 'forbidden_role' | 'forbidden_tenant_mismatch' } {
    const roleAllowed = APPROVER_ROLES.includes(approver.role as ApproverRole)
    if (!roleAllowed) return { ok: false, reason: 'forbidden_role' }
    if (approver.role === 'platform_admin') return { ok: true }
    // tenant_admin: must match the item's tenant AND must not be null.
    if (typeof approver.operatorId !== 'string' || approver.operatorId.length === 0) {
      return { ok: false, reason: 'forbidden_tenant_mismatch' }
    }
    if (approver.operatorId !== it.tenantOperatorId) {
      return { ok: false, reason: 'forbidden_tenant_mismatch' }
    }
    return { ok: true }
  }

  approve(id: string, approver: AuthenticatedApprover, nowMs: number): { ok: boolean; reason?: string } {
    const it = this.items.get(id)
    if (!it) return { ok: false, reason: 'not_found' }
    // Expire first so a past-TTL item never auto-approves on command path.
    if (it.status === 'pending' && nowMs > it.enqueuedAtMs + it.ttlMs) {
      it.status = 'expired'
      return { ok: false, reason: 'expired' }
    }
    if (it.status === 'approved') return { ok: true }  // idempotent
    if (it.status !== 'pending')   return { ok: false, reason: `wrong_status:${it.status}` }
    const authz = this.authorise(it, approver)
    if (!authz.ok) return { ok: false, reason: authz.reason }
    it.status = 'approved'
    it.approvedBy = approver.displayName
    it.approverOperatorId = approver.operatorId
    it.approverRole = approver.role
    it.approvedAtMs = nowMs
    return { ok: true }
  }

  reject(id: string, approver: AuthenticatedApprover, reason: string, nowMs: number): { ok: boolean; reason?: string } {
    const it = this.items.get(id)
    if (!it) return { ok: false, reason: 'not_found' }
    // Expiry wins over reject: a past-TTL item is expired, never rejected.
    if (it.status === 'pending' && nowMs > it.enqueuedAtMs + it.ttlMs) {
      it.status = 'expired'
      return { ok: false, reason: 'expired' }
    }
    if (it.status === 'rejected') return { ok: true }  // idempotent
    if (it.status !== 'pending')   return { ok: false, reason: `wrong_status:${it.status}` }
    const authz = this.authorise(it, approver)
    if (!authz.ok) return { ok: false, reason: authz.reason }
    it.status = 'rejected'
    it.rejectionReason = reason
    it.rejectedBy = approver.displayName
    it.rejecterOperatorId = approver.operatorId
    it.rejecterRole = approver.role
    it.rejectedAtMs = nowMs
    return { ok: true }
  }

  /**
   * Sweep every tenant and mark past-TTL pending items as expired. Returns the number of
   * items expired. Fixes P1d: without this, lazy expiry only fires on read/approve/reject
   * and a tenant that never reads keeps `pending` rows past TTL.
   */
  expireAll(nowMs: number): number {
    let n = 0
    for (const it of this.items.values()) {
      if (it.status === 'pending' && nowMs > it.enqueuedAtMs + it.ttlMs) {
        it.status = 'expired'
        n += 1
      }
    }
    return n
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
