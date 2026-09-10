// ── CLAIMS — WHAT AN APPROVAL ACTUALLY DID (batch 2 re-audit fix) ─────────────────
//
// The admin console used to assert "remboursement déclenché" on every approval. It was wrong
// in the ordinary case (refund rail closed ⇒ nothing moves) and dangerously wrong in one
// specific case: RESUME-FIRST.
//
// When the engine resumes an OLDER interrupted refund of the same order it SUCCEEDS at Stripe —
// the money is gone — yet `triggerClaimRefund` reports `{ state: 'failed', error:
// 'resume_mismatch' }`, because it did not settle THIS claim. Rendering that as "the refund
// FAILED: no money left" tells the admin the exact opposite of the truth and invites them to
// pay the customer a second time.
//
// The mapping lives here, as a pure function, so it can be tested for exactly that.

/** The engine outcome as the arbitrate route returns it (`refund`, possibly absent). */
export type ApprovalRefundOutcome = {
  state?: string
  amountCents?: number
  error?: string
} | null | undefined

export type ApprovalToast =
  /** Stripe succeeded THIS claim's refund. `amountCents` is the amount that actually moved. */
  | { key: 'approvedRefunded'; tone: 'success'; amountCents: number }
  /** Money DID move, on an older refund of the same order. Never retry — never call this failed. */
  | { key: 'approvedResumeMismatch'; tone: 'error' }
  /** A genuine failure: nothing reached the customer. */
  | { key: 'approvedFailed'; tone: 'error' }
  /** Everything else (rail closed, pending, already handled): claim only what was confirmed. */
  | { key: 'approvedNotSent'; tone: 'success' }

export function approvalToast(refund: ApprovalRefundOutcome): ApprovalToast {
  if (refund?.state === 'refunded') {
    return { key: 'approvedRefunded', tone: 'success', amountCents: refund.amountCents ?? 0 }
  }
  if (refund?.state === 'failed') {
    // Order matters: the mismatch case is a SUCCESS at Stripe wearing a 'failed' label.
    return refund.error === 'resume_mismatch'
      ? { key: 'approvedResumeMismatch', tone: 'error' }
      : { key: 'approvedFailed', tone: 'error' }
  }
  return { key: 'approvedNotSent', tone: 'success' }
}
