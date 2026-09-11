// ── WHICH HUMAN ACTIONS THE SERVER ACCEPTS ON A CLAIM (T-49, round-9 audit fix) ──
//
// WHY THIS IS A MODULE. Round 9 was the fourth round in which a server guard and the console
// control that exercises it disagreed (Class 3), and the first in which a claim could reach a state
// that no accepted action leads out of (Class 4). Both come from answering the same question in two
// places. Every question "may a human do X on this claim?" now has ONE pure answer here: the server
// asks it before it writes, the lists the consoles read carry its verdict, parity tests hold the two
// sides together, and an exit-table test asserts that every non-terminal state has a way out
// (tests/claims-t49-round10.test.ts, tests/claims-t49-round11.test.ts).
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
 * How long a refund attempt may legitimately be in flight before its marker means something is
 * wrong. The marker is written at the START of every attempt: without this a healthy refund would be
 * listed as interrupted — and reconciled — while Stripe is still answering.
 * ROUND-10 AUDIT FIX (P2): the window only filtered ONE list, so round 10's ungated card offered
 * « Réconcilier » on an attempt in flight. It lives here now and the reconcile GATE applies it.
 */
export const RECONCILE_GRACE_MS = 5 * 60 * 1000

/** The age of a crash marker, or null when its timestamp cannot be read. A timestamp in the future
 *  (clock skew) is unreadable, never "healthy" — it fails visible. */
export function reconcileMarkerAge(refundError: string | null | undefined, nowMs = Date.now()): number | null {
  if (!isReconcileMarker(refundError)) return null
  // A regex literal keeps its escapes visible: a shell-mangled copy of this once shipped inert.
  const m = /(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/.exec(refundError as string)
  if (!m) return null
  const t = Date.parse(m[1])
  if (!Number.isFinite(t)) return null
  const age = nowMs - t
  return age < 0 ? null : age
}

/**
 * May `reconcileClaimEvidence` run on this claim? Admits exactly:
 *   - a claim parked in FINANCIAL VERIFICATION;
 *   - a claim carrying the crash marker, once its grace window has passed;
 *   - the legacy stranded shape (refunding, no binding, no error);
 *   - a claim BOUND to a refund row with no recorded error — reconcile applies that row's truth,
 *     reading Stripe for a pending row. Without this, a bound refund whose webhook never came had
 *     no human exit at all;
 *   - an approval whose refund attempt was taken with nothing recorded (no binding, no error).
 * NOT a healthy approved-but-unpaid claim (no binding): reconciling it could park a case whose
 * money truth is not in question — the round-8 finding this gate was written for.
 */
export function reconcileRefusal(c: ClaimFacts, nowMs: number = Date.now()): Refusal | null {
  const reconcilable = c.status === 'refunding' || c.status === 'approved' || c.status === MARKERS.FINANCIAL_VERIFICATION
  const legacyStranded = c.status === 'refunding' && !c.refundId && !c.refundError
  const bound = (c.status === 'refunding' || c.status === 'approved') && !!c.refundId && !c.refundError
  // An approval whose single refund attempt WAS taken (refundAttempted) with nothing recorded about it
  // — no binding, no error. No current writer leaves it; a legacy row can, and no human action accepted
  // it at all (found by the round-10 exit table). Its money truth is unknown: evidence decides.
  const attemptedUnrecorded = c.status === 'approved' && c.refundAttempted === true && !c.refundId && !c.refundError
  if (reconcilable && (c.status === MARKERS.FINANCIAL_VERIFICATION || isReconcileMarker(c.refundError) || legacyStranded || bound || attemptedUnrecorded)) {
    const age = reconcileMarkerAge(c.refundError, nowMs)
    if (age !== null && age < RECONCILE_GRACE_MS) {
      return { status: 409, error: 'Une tentative de remboursement a démarré il y a moins de 5 minutes : la réconciliation est refusée jusqu’à la fin de cette fenêtre.' }
    }
    return null
  }
  return { status: 409, error: 'Cette réclamation n’est pas en attente de réconciliation.' }
}

/**
 * `arbitrateClaim`'s pre-checks — same checks, same order, same messages. The arbitration queue
 * emits both verdicts so the console disables exactly the decisions this refuses.
 */
export function arbitrationRefusal(c: ClaimFacts, decision: 'approve' | 'refuse_final', now: Date): Refusal | null {
  // A rail-locked claim: the engine refuses every refund on the order. ROUND-10 AUDIT FIX (P3): the
  // marker has several causes (a failed row, a failed refund still pending here, a dead pending row),
  // not all permanent in the same way — the claim's own detail says which, so this line does not.
  if (decision === 'approve' && isRailLockedMarker(c.refundError)) {
    return { status: 409, error: 'Approbation impossible : le moteur refusera tout remboursement sur cette commande (la cause, et si elle est définitive, sont dans le détail de la réclamation). Clôturez le dossier (« Clôturer ce dossier… »).' }
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
 * Whether a bound refund row lets the customer read « remboursement en cours »: it carries a Stripe
 * refund id AND is still pending in our base. ROUND-10 AUDIT FIX (P1): the Stripe id alone was used,
 * so a row that had already FAILED read « en cours ». null = the row could not be read.
 */
export function boundRowShowsInProgress(row: { status?: string | null; stripeRefundId?: string | null } | null | undefined): boolean | null {
  if (!row) return null
  return row.status === 'pending' && !!row.stripeRefundId
}

/**
 * The status the CUSTOMER is shown. The raw status of a recovery state is not a statement the
 * customer can read truthfully: « remboursement en cours » only when a refund is bound to a row
 * that is pending and recorded at Stripe; every state whose money truth is open, or whose engine run
 * failed, reads as the neutral manual review.
 */
export function customerClaimStatus(c: ClaimFacts, boundRowInProgress: boolean | null): string {
  if (c.status === MARKERS.FINANCIAL_VERIFICATION) return MARKERS.FINANCIAL_VERIFICATION
  if (c.status === 'refunding') {
    return !c.refundError && !!c.refundId && boundRowInProgress === true ? 'refunding' : MARKERS.FINANCIAL_VERIFICATION
  }
  if (c.status === 'approved' && c.refundError) return MARKERS.FINANCIAL_VERIFICATION
  // ROUND-11 AUDIT FIX (P1): 'refused_final' has two writers. arbitrateClaim's refusal records
  // arbitrationDecision 'refused_final'; the declaration close (resolveStuckClaim, « Clôturer sans
  // paiement ») leaves the decision as it was — often 'approved'. That second claim was never refused:
  // telling the customer « Refus confirmé » was false. It reads as a closure by the team.
  if (c.status === 'refused_final' && c.arbitrationDecision !== 'refused_final') return 'closed_by_support'
  return c.status
}

/**
 * The line an operator reads for a money state the stuck-money hatch does NOT accept: the fact, and
 * the one accepted action that moves it. Never a mechanism the code does not run, and never a Stripe
 * state this list did not read (ROUND-10 AUDIT FIX, P2: the money states below come from OUR rows).
 */
const GUIDANCE: Record<string, string> = {
  reconcile_required:
    'Argent non établi. « Réconcilier d’après la preuve » (section « Vérification financière requise ») lit Stripe et nos lignes, et n’applique que ce qui est prouvé — refusé tant que la tentative a démarré il y a moins de 5 minutes.',
  stripe_pending:
    'Notre ligne liée est en attente et porte un identifiant de remboursement Stripe ; son statut actuel chez Stripe n’est pas relu dans cette liste. « Réconcilier d’après la preuve » le relit et applique un statut terminal. Aucune clôture manuelle sur cet état.',
  local_pending_unconfirmed:
    'La ligne liée est en attente, sans identifiant Stripe enregistré. « Réconcilier d’après la preuve » lit Stripe pour cette ligne : il applique ce qui est prouvé, ou indique à partir de quand conclure. Aucune clôture manuelle sur cet état.',
  stripe_failed:
    'Notre ligne liée est marquée ÉCHOUÉE (statut enregistré d’après Stripe) ; la réclamation n’est pas encore réconciliée. « Réconcilier d’après la preuve » l’applique, et le dossier devient clôturable.',
  stripe_succeeded_claim_unreconciled:
    'Notre ligne liée est marquée ABOUTIE (statut enregistré d’après Stripe) ; la réclamation n’est pas encore réconciliée. « Réconcilier d’après la preuve » l’applique.',
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
