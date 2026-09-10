// ── WHAT THE MONEY-QUEUE CARD MAY SAY ABOUT A CLAIM'S MONEY (T-49, round-4 audit fix) ──
//
// WHY THIS IS A MODULE AND NOT A TERNARY IN THE COMPONENT.
//
// Four consecutive audit rounds each found this component asserting something about money that
// the code had never established: "nothing reached the customer" on a state it never looked at;
// "reconciliation replayed daily" for a job that does not run; "state known" over rows whose
// state is exactly what is unknown; and then "the linked refund's state settles this claim" on
// the one binding the engine explicitly refused to attribute.
//
// The pattern is always the same shape: a truthy field used as a proxy for a fact. `refundId`
// being set does NOT mean a refund answers for this claim — RESUME-FIRST binds a claim to a row
// it did not create and records exactly that in `refundError`, so on those rows a bound refund
// answers for somebody else.
//
// Extracted so it is a pure function with a test, rather than copy nobody can pin.

export type QueueRowKind = 'reconcile_required' | 'financial_verification' | 'other_unsettled'

/** How much this row's money state is actually established. Never a guess. */
export type MoneyCertainty =
  /** The money truth is open: that is why the row is here. */
  | 'unknown'
  /** A refund IS bound, and the engine recorded that it is NOT this claim's. It settles nothing. */
  | 'bound_but_not_ours'
  /** A refund is bound and is genuinely this claim's; its own state is the answer. */
  | 'bound'
  /** Nothing is bound, so nothing here answers the question. */
  | 'unbound'

export type MoneyLine = { certainty: MoneyCertainty; text: string }

/** The engine's own marker for "this refund is not the one this claim asked for". */
export const RESUME_MISMATCH = 'resume_mismatch'

export function isResumeMismatch(refundError?: string | null): boolean {
  return typeof refundError === 'string' && refundError.startsWith(RESUME_MISMATCH)
}

export function moneyLineFor(row: {
  kind: QueueRowKind
  refundId?: string | null
  refundError?: string | null
}): MoneyLine {
  // The two ambiguous buckets exist BECAUSE the truth is open. Nothing to qualify.
  if (row.kind !== 'other_unsettled') {
    return { certainty: 'unknown', text: 'INDÉTERMINÉ — à établir par preuve Stripe.' }
  }
  // Checked BEFORE the binding test: these rows have a refundId, and it is the wrong one.
  if (isResumeMismatch(row.refundError)) {
    // ROUND-5 AUDIT FIX: this said "de l'argent a bougé pour quelqu'un d'autre". Two of the four
    // writers of this marker sit on the PENDING path, where the engine only got the refund
    // ACCEPTED — nothing has moved yet. Asserting movement was true for two writers and false for
    // the other two, so it is not asserted at all. What IS established on every one of them is
    // that the bound refund is not this claim's.
    return {
      certainty: 'bound_but_not_ours',
      text: 'un remboursement est lié, mais le moteur a établi qu’il n’appartient PAS à cette '
        + 'réclamation : son état ne règle RIEN ici, et il ne dit rien de ce qui a été versé au '
        + 'titre de cette réclamation.',
    }
  }
  if (row.refundId) {
    return {
      certainty: 'bound',
      text: 'un remboursement est LIÉ à cette réclamation — son état fait foi, voir la file '
        + '« Remboursements à traiter ».',
    }
  }
  return {
    certainty: 'unbound',
    text: 'NON SOLDÉ, et aucun remboursement n’est lié — l’état argent n’est pas établi ici.',
  }
}
