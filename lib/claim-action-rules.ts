// ── WHICH HUMAN ACTIONS THE SERVER ACCEPTS ON A CLAIM (T-49, round-9 audit fix) ──
//
// WHY THIS IS A MODULE. Round 9 was the fourth round in which a server guard and the console
// control that exercises it disagreed (Class 3), and the first in which a claim could reach a state
// that no accepted action leads out of (Class 4). Both come from answering the same question in two
// places. Every question "may a human do X on this claim?" now has ONE pure answer here: the server
// asks it before it writes, the lists the consoles read carry its verdict, parity tests hold the two
// sides together, and an exit-table test asserts that every non-terminal state has a way out
// (tests/claims-t49-round10.test.ts).
//
// No I/O, and no import from lib/claims (which imports this module): the marker prefixes are
// repeated here and pinned equal to lib/claims' exports by the round-10 test.

export const MARKERS = {
  FINANCIAL_VERIFICATION: 'financial_verification',
  RECONCILE_REQUIRED:     'reconcile_required',
  NO_REFUND_PROVEN:       'no_refund_proven',
  RAIL_LOCKED:            'no_refund_proven_rail_locked',
  ENGINE_ROW_DEAD:        'engine_row_dead',
} as const

export const TERMINAL: readonly string[] = ['refunded', 'refused_final']

/** The claim fields these rules read. Prisma rows satisfy it as they are. */
export type ClaimFacts = {
  status: string
  refundAttempted?: boolean | null
  refundId?: string | null
  refundError?: string | null
  arbitrationDecision?: string | null
  responseDeadlineAt?: Date | string | null
}

export type Refusal = { status: 409; error: string }

const isReconcileMarker = (e?: string | null) => typeof e === 'string' && e.startsWith(MARKERS.RECONCILE_REQUIRED)
const isRailLockedMarker = (e?: string | null) => typeof e === 'string' && e.startsWith(`${MARKERS.RAIL_LOCKED}:`)

/**
 * May `reconcileClaimEvidence` run on this claim? Admits exactly:
 *   - a claim parked in FINANCIAL VERIFICATION;
 *   - a claim carrying the crash marker;
 *   - the legacy stranded shape (refunding, no binding, no error);
 *   - a claim BOUND to a refund row with no recorded error — reconcile applies that row's truth,
 *     reading Stripe for a pending row. Without this, a bound refund whose webhook never came had
 *     no human exit at all;
 *   - an approval whose refund attempt was taken with nothing recorded (no binding, no error).
 * NOT a healthy approved-but-unpaid claim (no binding): reconciling it could park a case whose
 * money truth is not in question — the round-8 finding this gate was written for.
 */
export function reconcileRefusal(c: ClaimFacts): Refusal | null {
  const reconcilable = c.status === 'refunding' || c.status === 'approved' || c.status === MARKERS.FINANCIAL_VERIFICATION
  const legacyStranded = c.status === 'refunding' && !c.refundId && !c.refundError
  const bound = (c.status === 'refunding' || c.status === 'approved') && !!c.refundId && !c.refundError
  // An approval whose single refund attempt WAS taken (refundAttempted) with nothing recorded about it
  // — no binding, no error. No current writer leaves it; a legacy row can, and no human action accepted
  // it at all (found by the round-10 exit table). Its money truth is unknown: evidence decides.
  const attemptedUnrecorded = c.status === 'approved' && c.refundAttempted === true && !c.refundId && !c.refundError
  if (reconcilable && (c.status === MARKERS.FINANCIAL_VERIFICATION || isReconcileMarker(c.refundError) || legacyStranded || bound || attemptedUnrecorded)) {
    return null
  }
  return { status: 409, error: 'Cette réclamation n’est pas en attente de réconciliation.' }
}

/**
 * `arbitrateClaim`'s pre-checks — same checks, same order, same messages. The arbitration queue
 * emits both verdicts so the console disables exactly the decisions this refuses.
 */
export function arbitrationRefusal(c: ClaimFacts, decision: 'approve' | 'refuse_final', now: Date): Refusal | null {
  // A rail-locked claim: the engine refuses every refund on the order, for good.
  if (decision === 'approve' && isRailLockedMarker(c.refundError)) {
    return { status: 409, error: 'Approbation impossible : le moteur refusera tout remboursement sur cette commande, définitivement (voir le détail de la réclamation). Clôturez le dossier (« Clôturer ce dossier… »).' }
  }
  // FINALIZATION LOCK: a decided outcome is not rewritten — except an UNPAID approval, which may be re-driven.
  const awaitingRefundActivation = c.status === 'approved' && !c.refundAttempted
  if (c.arbitrationDecision && !awaitingRefundActivation) {
    return { status: 409, error: 'Cette réclamation a déjà été arbitrée — décision définitive.' }
  }
  if (c.arbitrationDecision === 'approved' && decision === 'refuse_final') {
    return { status: 409, error: 'Cette réclamation a déjà été approuvée — elle ne peut plus être refusée (le client en a été informé).' }
  }
  if (TERMINAL.includes(c.status)) {
    return { status: 409, error: 'Cette réclamation est clôturée — elle ne peut plus être arbitrée.' }
  }
  const legacyApproved = c.status === 'approved' && !c.refundAttempted
  const deadline = c.responseDeadlineAt instanceof Date ? c.responseDeadlineAt : null
  const silenceExpired = c.status === 'restaurant_review' && !!deadline && deadline.getTime() <= now.getTime()
  if (c.status === 'restaurant_review' && !silenceExpired) {
    return { status: 409, error: 'Le restaurant dispose encore du délai de réponse — arbitrage prématuré.' }
  }
  if (c.status !== 'arbitration' && !legacyApproved && !silenceExpired) {
    return { status: 409, error: 'Cette réclamation n’est pas en arbitrage.' }
  }
  return null
}

/**
 * The status the CUSTOMER is shown. The raw status of a recovery state is not a statement the
 * customer can read truthfully: « remboursement en cours » only when a refund is bound to a row
 * Stripe confirmed; every state whose money truth is open, or whose engine run failed, reads as
 * the neutral manual review.
 */
export function customerClaimStatus(c: ClaimFacts, boundRowConfirmedAtStripe: boolean | null): string {
  if (c.status === MARKERS.FINANCIAL_VERIFICATION) return MARKERS.FINANCIAL_VERIFICATION
  if (c.status === 'refunding') {
    return !c.refundError && !!c.refundId && boundRowConfirmedAtStripe === true ? 'refunding' : MARKERS.FINANCIAL_VERIFICATION
  }
  if (c.status === 'approved' && c.refundError) return MARKERS.FINANCIAL_VERIFICATION
  return c.status
}

/**
 * The line an operator reads for a money state the stuck-money hatch does NOT accept: the fact, and
 * the one accepted action that moves it. Never a mechanism the code does not run.
 */
const GUIDANCE: Record<string, string> = {
  reconcile_required:
    'Argent non établi. « Réconcilier d’après la preuve » (section « Vérification financière requise ») lit Stripe et nos lignes, et n’applique que ce qui est prouvé.',
  stripe_pending:
    'Le remboursement lié est en attente chez Stripe. « Réconcilier d’après la preuve » relit Stripe et applique son statut lorsqu’il est terminal. Aucune clôture manuelle sur cet état.',
  local_pending_unconfirmed:
    'La ligne liée est en attente, sans identifiant Stripe enregistré. « Réconcilier d’après la preuve » lit Stripe pour cette ligne : il applique ce qui est prouvé, ou indique à partir de quand conclure. Aucune clôture manuelle sur cet état.',
  stripe_failed:
    'Le remboursement lié a ÉCHOUÉ chez Stripe ; la réclamation n’est pas encore réconciliée. « Réconcilier d’après la preuve » l’applique, et le dossier devient clôturable.',
  stripe_succeeded_claim_unreconciled:
    'Le remboursement lié a abouti chez Stripe ; la réclamation n’est pas encore réconciliée. « Réconcilier d’après la preuve » l’applique.',
  stale_refunding_no_refund_row:
    'La réclamation est liée à une ligne de remboursement introuvable. « Réconcilier d’après la preuve » la place en vérification financière, où un remboursement existant peut être lié.',
  approved_not_driven:
    'Approuvée, jamais payée. Elle ne se paie que par l’approbation admin (file d’arbitrage), réclamations et remboursements ouverts. Aucune clôture manuelle sur cet état.',
  absence_proven_payable:
    'Rien à clôturer : approuvée et non payée, aucun remboursement n’a déplacé d’argent. Elle ne se paie que par une nouvelle approbation admin, réclamations et remboursements ouverts.',
  refund_error_recorded:
    'Erreur de remboursement enregistrée : lisez le détail. « Clôturer ce dossier… » enregistre votre déclaration ; aucune action ici ne déplace d’argent.',
}

export function moneyStateGuidance(moneyState: string): string {
  return GUIDANCE[moneyState] ?? 'État non reconnu : aucune action proposée ici. Vérifiez la commande dans Stripe.'
}
