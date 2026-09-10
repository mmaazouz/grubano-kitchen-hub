// ── CLAIMS — WHAT AN APPROVAL ACTUALLY DID (batch 2 re-audit fix) ─────────────────
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
  /** The engine ended on a refund that is NOT this claim's (RESUME-FIRST). Two of the four
   *  writers of that verdict are on the PENDING path, where nothing has moved yet — so this key
   *  asserts no movement, only that the refund is not ours and nothing is settled. Never retry. */
  | { key: 'approvedResumeMismatch'; tone: 'error' }
  /** The engine refused or could not confirm. That includes « déjà intégralement remboursé » and
   *  a throw after Stripe accepted — so this key asserts no cash outcome, only that nothing is
   *  established by THIS action. (ROUND-7 AUDIT FIX: it used to say "nothing reached the customer".) */
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
