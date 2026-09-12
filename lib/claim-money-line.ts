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
// ROUND 13 (F15): a resume_mismatch is decided by the bound row's own stamp. On the claim's OWN row
// the identity is established and an earlier version wrote the contrary after a failed read
// (identity_unread, A-S36-1); with the row unread nothing is established (unknown). A reversal marker
// reads as a bound refund that pays nothing (bound_reverted, A-S24-1).
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
  /** F15 / A-S36-1: the bound row carries this claim's stamp; a legacy text said the contrary. */
  | 'identity_unread'
  /** F15 / A-S24-1: the bound refund failed or was canceled at Stripe after it was recorded. */
  | 'bound_reverted'

export type MoneyLine = { certainty: MoneyCertainty; text: string }

/** The engine's own marker for "this refund is not the one this claim asked for". */
export const RESUME_MISMATCH = 'resume_mismatch'

export function isResumeMismatch(refundError?: string | null): boolean {
  return typeof refundError === 'string' && refundError.startsWith(RESUME_MISMATCH)
}

const UNKNOWN_TEXT = 'INDÉTERMINÉ — à établir par preuve Stripe.'
/** A-S36-1, the fact half: true whatever the reconcile gate says today. */
export const IDENTITY_UNREAD_FACT =
  'un remboursement est lié et sa ligne porte l’identité de cette réclamation ; une version antérieure a écrit le contraire après un échec de lecture.'
/** A-S36-1, verbatim: the fact plus the exit that establishes the money. Rendered ONLY when that exit is accepted. */
export const IDENTITY_UNREAD_TEXT =
  `${IDENTITY_UNREAD_FACT} Seule la preuve (« Réconcilier d’après la preuve ») établira ce qui a été versé.`
/** The same fact while the reconcile gate refuses the claim: it names no exit (F16 (7)). */
export const IDENTITY_UNREAD_NO_EXIT_TEXT =
  `${IDENTITY_UNREAD_FACT} Ce qui a été versé au titre de cette réclamation n’est pas établi ici.`
/**
 * F15 / F16 (7) — IMPLEMENTATION NOTE (W1): the A-S36-1 sentence names « Réconcilier d’après la preuve ».
 * It is rendered only when the server's reconcile verdict for the SAME claim is « accepted »
 * (reconcilable === true); otherwise the fact alone. A copy never names an exit the server refuses.
 */
export function identityUnreadText(reconcilable: boolean | null | undefined): string {
  return reconcilable === true ? IDENTITY_UNREAD_TEXT : IDENTITY_UNREAD_NO_EXIT_TEXT
}
/** A-S24-1. */
export const BOUND_REVERTED_TEXT =
  'un remboursement est lié, mais Stripe rapporte ce remboursement échoué ou annulé : il ne verse rien au titre de cette ligne. Lisez le détail enregistré.'

/** F15 / A-S24-1: a claim carrying a reversal marker (STRIPE_REVERTED or REVERTED_AFTER_REFUND). startsWith, never includes. */
export function isStripeReverted(refundError?: string | null): boolean {
  return typeof refundError === 'string'
    && (refundError.startsWith('stripe_reverted_after_refund:') || refundError.startsWith('stripe_reverted:'))
}

export function moneyLineFor(row: {
  kind: QueueRowKind
  refundId?: string | null
  refundError?: string | null
  /** F15: needed to recognise the claim's own stamp. */
  claimId?: string | null
  /** F15: the bound row as read. undefined = not read. */
  boundRow?: { reason?: string | null } | null
  /** D0: the server's reconcile verdict for this claim (payload flag). Only `true` lets a line name reconcile. */
  reconcilable?: boolean | null
}): MoneyLine {
  // The two ambiguous buckets exist BECAUSE the truth is open. Nothing to qualify.
  if (row.kind !== 'other_unsettled') {
    return { certainty: 'unknown', text: UNKNOWN_TEXT }
  }
  if (isStripeReverted(row.refundError)) {
    return { certainty: 'bound_reverted', text: BOUND_REVERTED_TEXT }
  }
  // Checked BEFORE the binding test: these rows have a refundId, and whose it is decides the line.
  if (isResumeMismatch(row.refundError)) {
    if (row.boundRow === undefined) return { certainty: 'unknown', text: UNKNOWN_TEXT }
    if (!!row.claimId && row.boundRow?.reason === `claim:${row.claimId}`) {
      return { certainty: 'identity_unread', text: identityUnreadText(row.reconcilable) }
    }
    // ROUND-5 AUDIT FIX: this said "de l'argent a bougé pour quelqu'un d'autre". Two of the four
    // writers of this marker sit on the PENDING path, where the engine only got the refund
    // ACCEPTED — nothing has moved yet. What IS established on every one of them is that the bound
    // refund is not this claim's.
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
      // ROUND-10 AUDIT FIX (P2): this pointed to « Remboursements à traiter », which is not on screen
      // while claims are closed. The card itself carries the next line (action or guidance).
      text: 'un remboursement est LIÉ à cette réclamation — c’est l’état de la ligne liée qui fait foi, '
        + 'pas ce libellé : lisez la ligne suivante de cette carte.',
    }
  }
  return {
    certainty: 'unbound',
    text: 'NON SOLDÉ, et aucun remboursement n’est lié — l’état argent n’est pas établi ici.',
  }
}

/**
 * F15 — the financial-verification card's « Argent » line, from the row payload the card receives
 * (GET /api/admin/claims/financial-verification). The bound row's reason travels in `refund.reason`
 * (listActionableRefundClaims); a payload without it is « not read » (undefined → INDÉTERMINÉ), never
 * « not ours ». The claim id and the server's reconcile verdict come from the same row.
 */
export function cardMoneyLine(r: {
  kind: QueueRowKind
  id: string
  refundId?: string | null
  refundError?: string | null
  refund?: { reason?: string | null } | null
  reconcilable?: boolean | null
}): MoneyLine {
  const boundRow = r.refund === undefined ? undefined
    : r.refund === null ? null
      : r.refund.reason === undefined ? undefined
        : { reason: r.refund.reason }
  return moneyLineFor({ kind: r.kind, refundId: r.refundId, refundError: r.refundError, claimId: r.id, boundRow, reconcilable: r.reconcilable })
}

/** Which « Montant réellement remboursé » branch the arbitration card renders (F15, its mirror of moneyLineFor). */
export type AmountLineKind = 'amount' | 'reverted' | 'identity_unread' | 'not_ours' | 'bound_not_succeeded' | 'unbound'
export function amountLineKind(r: {
  actualRefundedCents: number | null
  refundError?: string | null
  refund?: unknown
  refundIdentityUnread?: boolean
  refundNotOurs?: boolean
}): AmountLineKind {
  if (r.actualRefundedCents !== null) return 'amount'
  if (!r.refund) return 'unbound'
  if (isStripeReverted(r.refundError)) return 'reverted'
  if (r.refundIdentityUnread) return 'identity_unread'
  if (r.refundNotOurs) return 'not_ours'
  return 'bound_not_succeeded'
}

/**
 * ROUND-11 AUDIT FIX (P2): whether the financial-verification card renders at all. It must render when
 * there are claims to act on OR only pending refund rows whose claim moved on — reverting the second half
 * hid that list and stayed green. A pure predicate so the truth table is pinned.
 * ROUND 13 (E0 / H10 / I-09, slice W7): widened to the two sections kept out of `total` — the refunded claims whose bound
 * row is not established (E-13) and the closure notices not sent (E-16). Each input alone makes the card visible.
 */
export function financialVerificationCardVisible(p: { claimRows: number; unfinalizedRows: number; closureNotices: number; refundedUnproven: number }): boolean {
  return p.claimRows > 0 || p.unfinalizedRows > 0 || p.closureNotices > 0 || p.refundedUnproven > 0
}

/** H10: the red « Vérification financière requise (n) » heading renders only for claim rows or unfinalized rows. */
export function financialVerificationHeadingVisible(p: { claimRows: number; unfinalizedRows: number }): boolean {
  return p.claimRows > 0 || p.unfinalizedRows > 0
}
