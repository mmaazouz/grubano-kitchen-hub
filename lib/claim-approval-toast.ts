// ── CLAIMS — WHAT A RAIL ATTEMPT ACTUALLY DID (batch 2 re-audit fix · D′ L2 re-scoped) ─────
//
// D′ L2 (spec v2 S-02, F13 v1.1): an ADMIN APPROVAL no longer reaches the engine, so the arbitration
// console never calls this mapping any more (it shows the nominal approvedNotSent toast). This pure
// mapping now describes the outcome of ONE rail attempt (triggerClaimRefund, D′ L5 pay-approved) — the
// keys keep their names until the L5 batch report renames them. It is still the tested rendering of
// every RefundTriggerResult shape, which is why the trigger tests keep using it.
//
// The admin console used to assert "remboursement déclenché" on every approval. It was wrong
// in the ordinary case (refund rail closed ⇒ nothing moves) and dangerously wrong in one
// specific case: RESUME-FIRST.
//
// When the engine resumes an OLDER interrupted refund of the same order, `triggerClaimRefund`
// reports `{ state: 'failed', error: 'resume_mismatch' }` because it did not settle THIS claim.
// That verdict has FOUR writers: two after Stripe SUCCEEDED the resumed refund (money moved, for
// somebody else) and two on the PENDING path (Stripe only accepted it; nothing has moved yet).
// Rendering it as "the refund FAILED: no money left" is false on the first two and invites a
// second payment; rendering it as "money DID leave" is false on the other two (ROUND-7 AUDIT FIX:
// this comment, and the copy it produced, said the latter for all four). The only statement true
// on all four: the refund is not this claim's, it settles nothing here, do not pay again.
//
// ROUND 13 (F12): triggerClaimRefund now returns T2 outcomes that never reached the engine (a safety
// hold, a stale proof, a transient read, an own row), an identity it could not read (T3 'unknown'), and
// an attempt its claim outlived (T4). « le moteur a REFUSÉ » is false on every one of them, so each has
// its own key. The mapping lives here, as a pure function, so it can be tested for exactly that.

/** The engine outcome as the arbitrate route returns it (`refund`, possibly absent). */
export type ApprovalRefundOutcome = {
  state?: string
  amountCents?: number
  error?: string
  reason?: string
  until?: string
} | null | undefined

export type ApprovalToast =
  /** Stripe succeeded THIS claim's refund. `amountCents` is the amount that actually moved. */
  | { key: 'approvedRefunded'; tone: 'success'; amountCents: number }
  /** Stripe accepted THIS claim's refund (own 202, identity established, CAS won): nothing is established yet. */
  | { key: 'approvedPending'; tone: 'success' }
  /** The engine ended on a refund that is NOT this claim's (RESUME-FIRST). Never retry. */
  | { key: 'approvedResumeMismatch'; tone: 'error' }
  /** T3 'unknown': the row's identity could not be read — neither attributed nor ruled out. */
  | { key: 'approvedIdentityUnverified'; tone: 'error' }
  /** T2/T4 attempt_superseded: the claim changed during this attempt. */
  | { key: 'approvedSuperseded'; tone: 'error' }
  /** T2 (e') within the window of an older row: nothing started, a conclusion is possible from `until`. */
  | { key: 'approvedNotSentUntil'; tone: 'success'; until: string }
  /** Nothing was started by this action: success tone when the claim rests approved, error tone when a hold, lock or park was written. */
  | { key: 'approvedNotSent'; tone: 'success' | 'error' }
  /** The engine refused or could not confirm. That includes « déjà intégralement remboursé » and
   *  a throw after Stripe accepted — so this key asserts no cash outcome, only that nothing is
   *  established by THIS action. (ROUND-7 AUDIT FIX: it used to say "nothing reached the customer".) */
  | { key: 'approvedFailed'; tone: 'error' }

/** F12: T2 outcomes that wrote a hold, a lock or a park (engine not called). */
const NOT_SENT_ERROR = ['safety_hold', 'proof_locked', 'proof_awaiting', 'proof_stale', 'financial_verification', 'own_row_exists']

export function approvalToast(refund: ApprovalRefundOutcome): ApprovalToast {
  if (refund?.state === 'refunded') {
    return { key: 'approvedRefunded', tone: 'success', amountCents: refund.amountCents ?? 0 }
  }
  if (refund?.state === 'pending') {
    // refunds_disabled is returned before any write: « Stripe a accepté » would be false there.
    return refund.reason === 'stripe_pending' ? { key: 'approvedPending', tone: 'success' } : { key: 'approvedNotSent', tone: 'success' }
  }
  if (refund?.state === 'failed') {
    // Order matters: the mismatch case is a SUCCESS at Stripe wearing a 'failed' label.
    switch (refund.error) {
      case 'resume_mismatch': return { key: 'approvedResumeMismatch', tone: 'error' }
      case 'identity_unverified': return { key: 'approvedIdentityUnverified', tone: 'error' }
      case 'attempt_superseded': return { key: 'approvedSuperseded', tone: 'error' }
      case 'unconfirmed_within_window':
        return refund.until ? { key: 'approvedNotSentUntil', tone: 'success', until: refund.until } : { key: 'approvedNotSent', tone: 'success' }
      case 'safety_check_unreadable': return { key: 'approvedNotSent', tone: 'success' }
      default:
        if (refund.error && NOT_SENT_ERROR.includes(refund.error)) return { key: 'approvedNotSent', tone: 'error' }
        return { key: 'approvedFailed', tone: 'error' }
    }
  }
  return { key: 'approvedNotSent', tone: 'success' }
}
