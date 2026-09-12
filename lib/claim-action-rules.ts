// ── WHICH HUMAN ACTIONS THE SERVER ACCEPTS ON A CLAIM, AND WHAT ITS MONEY FACTS ALLOW (T-49) ──
//
// WHY THIS IS A MODULE. Round 9 was the fourth round in which a server guard and the console
// control that exercises it disagreed (Class 3), and the first in which a claim could reach a state
// that no accepted action leads out of (Class 4). Both come from answering the same question in two
// places. Every question "may a human do X on this claim?" now has ONE pure answer here: the server
// asks it before it writes, the lists the consoles read carry its verdict, parity tests hold the two
// sides together, and an exit-table test asserts that every non-terminal state has a way out.
//
// ROUND 13 (docs/ops/CLAIMS-T49-ROUND13-SPEC-v1.md, slice W1) adds the pure layer the spec freezes:
// the engine mirror, holds and verdict (G5), temporary versus permanent locks (G9), the quiescence
// instant of a payable proof (C4), the exit table (D1), the refusal copy (D14), the reconcile gate
// admissions (G1), the no-row derivation (G6/G7), the customer status contract (F01-F05) and the
// closure-record constants (H05). Rule ids are cited next to the code that implements them.
//
// No I/O, and no import from lib/claims (which imports this module): the marker prefixes are
// repeated here and pinned equal to lib/claims' exports by the round-10 test.

import { ownersOf, stampedClaimId } from '@/lib/claim-attribution-rules'

export const MARKERS = {
  FINANCIAL_VERIFICATION: 'financial_verification',
  RECONCILE_REQUIRED:     'reconcile_required',
  NO_REFUND_PROVEN:       'no_refund_proven',
  RAIL_LOCKED:            'no_refund_proven_rail_locked',
  ENGINE_ROW_DEAD:        'engine_row_dead',
  // ── ROUND 13: full prefixes, matched with startsWith (never includes) ──
  /** G8: a proof of absence written by this build, payable from its quiescence instant (C4). */
  PROOF_PAYABLE_V13:      'no_refund_proven:v13:',
  /** G8/G9: the only TEMPORARY lock. It still starts with the rail-locked prefix. */
  AWAITING_FINALIZATION:  'no_refund_proven_rail_locked:awaiting_finalization:',
  /** C3 (b')/(c): a pre-engine safety hold. */
  SAFETY_HOLD:            'refund_safety_hold:',
  /** G8: STRIPE_REVERTED_TEXT on a non-terminal claim. */
  STRIPE_REVERTED:        'stripe_reverted:',
  /** G11: a settled claim whose refund later failed or was canceled at Stripe. */
  REVERTED_AFTER_REFUND:  'stripe_reverted_after_refund:',
  /** D11/F02: a declaration made on a REVERTED_AFTER_REFUND claim. */
  DECLARED_AFTER_REVERT:  'declared_settled_after_revert:',
} as const

export const TERMINAL: readonly string[] = ['refunded', 'refused_final']

/** B8/G1/F03: the bound Refund row as read. Every field is optional so a partial select stays typed. */
export type BoundRowFacts = {
  id?: string
  orderId?: string | null
  status?: string | null
  stripeRefundId?: string | null
  reason?: string | null
  amountCents?: number | null
  createdAt?: Date | string | null
}

/** The claim fields these rules read. Prisma rows satisfy it as they are. */
export type ClaimFacts = {
  id?: string
  orderId?: string
  status: string
  refundAttempted?: boolean | null
  refundId?: string | null
  refundError?: string | null
  arbitrationDecision?: string | null
  responseDeadlineAt?: Date | string | null
  /** F02: the restaurant's answer ('refused' has one writer, respondToClaim). */
  restaurantResponse?: string | null
  reason?: string | null
  /** B8/G1: the bound row. undefined = NOT READ (every rule that needs it refuses); null = read, absent. */
  boundRow?: BoundRowFacts | null
}

export type Refusal = { status: 409; error: string }

const starts = (e: string | null | undefined, prefix: string): boolean => typeof e === 'string' && e.startsWith(prefix)
const isReconcileMarker = (e?: string | null) => starts(e, MARKERS.RECONCILE_REQUIRED)
/** 'no_refund_proven:' — a legacy proof OR a v13 proof. Never the rail-locked prefix (its prefix is `no_refund_proven_`). */
const isNoRefundProofText = (e?: string | null) => starts(e, `${MARKERS.NO_REFUND_PROVEN}:`)
const isRailLockedText = (e?: string | null) => starts(e, `${MARKERS.RAIL_LOCKED}:`)
const isResumeMismatchText = (e?: string | null) => starts(e, 'resume_mismatch')

/**
 * How long a refund attempt may legitimately be in flight before its marker means something is
 * wrong. The marker is written at the START of every attempt: without this a healthy refund would be
 * listed as interrupted — and reconciled — while Stripe is still answering.
 */
export const RECONCILE_GRACE_MS = 5 * 60 * 1000

/** The raw timestamp of a crash marker (the FIRST ISO instant after the prefix), or null. */
function markerTimestampMs(refundError: string | null | undefined): number | null {
  if (!isReconcileMarker(refundError)) return null
  // A regex literal keeps its escapes visible: a shell-mangled copy of this once shipped inert.
  const m = /(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/.exec(refundError as string)
  if (!m) return null
  const t = Date.parse(m[1])
  return Number.isFinite(t) ? t : null
}

/** The age of a crash marker, or null when its timestamp cannot be read. A timestamp in the future
 *  (clock skew) is unreadable, never "healthy" — it fails visible. */
export function reconcileMarkerAge(refundError: string | null | undefined, nowMs = Date.now()): number | null {
  const t = markerTimestampMs(refundError)
  if (t === null) return null
  const age = nowMs - t
  return age < 0 ? null : age
}

// ══ C4 — QUIESCENCE INSTANT OF A PAYABLE PROOF (replaces the withdrawn engine guard) ═══════════════════════════════════

/** C4: at least 60 min (ENGINE_DEAD_MARGIN_MS), far above the ~4 min Stripe budget of the pre-insert path. */
export const ATTEMPT_QUIESCENCE_MS = 60 * 60 * 1000

/** C4/D3: THE instant parser — one regex literal, no second parser anywhere. null when absent or unparsable. */
export function proofInstant(e: string | null | undefined): Date | null {
  if (typeof e !== 'string') return null
  const m = /payable au plus tôt le (\d{4}-\d{2}-\d{2}T[\d:.]+Z) \(UTC\)/.exec(e)
  if (!m) return null
  const t = Date.parse(m[1])
  return Number.isFinite(t) ? new Date(t) : null
}

/**
 * C4 proofInstantFor(preImage, now), used by N8 and T2(e') when they write PROOF_PAYABLE_V13:
 * (1) the crash-marker timestamp in the pre-image + Q; (2) otherwise the instant a v13 pre-image
 * already carries; (3) otherwise now + Q. Rule (1) needs the marker PREFIX: a v13 text carries an ISO
 * instant too, and reading it as a marker would push the instant a second Q later.
 */
export function proofInstantFor(preImage: string | null | undefined, now: Date): Date {
  const marker = markerTimestampMs(preImage)
  if (marker !== null) return new Date(marker + ATTEMPT_QUIESCENCE_MS)
  if (starts(preImage, MARKERS.PROOF_PAYABLE_V13)) {
    const carried = proofInstant(preImage)
    if (carried) return carried
  }
  return new Date(now.getTime() + ATTEMPT_QUIESCENCE_MS)
}

/** A v13 proof in the canonical shape D14 (0) and D2 (1)(c) name: approved, not attempted, unbound. */
const isCanonicalV13 = (c: ClaimFacts) =>
  c.status === 'approved' && !c.refundAttempted && !c.refundId && starts(c.refundError, MARKERS.PROOF_PAYABLE_V13)

// ══ B8 / G1 — THE RECONCILE GATE ═════════════════════════════════════════════════════════════════

/** B8: a legacy resume_mismatch on the claim's OWN stamped row. Identity is established: reconcile, never a declaration. */
export function ownRowMismatch(c: ClaimFacts): boolean {
  return c.status === 'refunding' && !!c.refundId && isResumeMismatchText(c.refundError)
    && !!c.id && c.boundRow !== undefined && c.boundRow?.reason === `claim:${c.id}`
}

const RECONCILE_NOT_PENDING = 'Cette réclamation n’est pas en attente de réconciliation.'
const RECONCILE_GRACE_TEXT = 'Une tentative de remboursement a démarré il y a moins de 5 minutes : la réconciliation est refusée jusqu’à la fin de cette fenêtre.'
/** D5 (IMPLEMENTATION NOTE (W3)): a marker whose start instant cannot be read is never treated as aged. */
export const RECONCILE_MARKER_UNREADABLE_TEXT = 'L’heure de début de la tentative de remboursement enregistrée sur cette réclamation n’a pas pu être lue, ou est postérieure à maintenant : la réconciliation est refusée, car cette tentative n’est pas établie comme terminée. Vérifiez la commande dans Stripe.'

/** G1: admitted, and whether the only refusal is the marker grace (D14 (2) reads it) or an unreadable marker instant (D5). */
function reconcileVerdict(c: ClaimFacts, nowMs: number): { admitted: boolean; graceOnly: boolean; markerUnreadable?: boolean } {
  const e = c.refundError
  const reconcilable = c.status === 'refunding' || c.status === 'approved' || c.status === MARKERS.FINANCIAL_VERIFICATION
  const legacyStranded = c.status === 'refunding' && !c.refundId && !e
  const bound = (c.status === 'refunding' || c.status === 'approved') && !!c.refundId && !e
  // An approval whose single refund attempt WAS taken with nothing recorded (no binding, no error).
  const attemptedUnrecorded = c.status === 'approved' && c.refundAttempted === true && !c.refundId && !e
  const existing = reconcilable && (c.status === MARKERS.FINANCIAL_VERIFICATION || isReconcileMarker(e) || legacyStranded || bound || attemptedUnrecorded)
  // (i) a proof of absence (v13 or legacy) or a lock, AWAITING included.
  const proofOrLock = c.status === 'approved' && !c.refundAttempted && !c.refundId && (isNoRefundProofText(e) || isRailLockedText(e))
  // (i-b) a pre-engine safety hold.
  const safetyHold = c.status === 'approved' && c.refundAttempted === true && !c.refundId && starts(e, MARKERS.SAFETY_HOLD)
  // (iii) a settled claim whose bound row is on its own order and may carry a reversal (R0).
  const row = c.boundRow
  const settledBound = c.status === 'refunded' && !e && !!c.refundId && !!row && !!c.orderId && row.orderId === c.orderId
    && (row.status === 'pending' || row.status === 'succeeded' || (row.status === 'failed' && !!row.stripeRefundId))
  const admitted = existing || proofOrLock || safetyHold || ownRowMismatch(c) || settledBound
  if (!admitted) return { admitted: false, graceOnly: false }
  const age = reconcileMarkerAge(e, nowMs)
  // D5: the marker admission is reconcileMarkerAge >= RECONCILE_GRACE_MS. An unreadable instant (malformed, or in
  // the future) is refused — never read as an aged attempt (J-M34 negative control).
  if (isReconcileMarker(e) && age === null) return { admitted: true, graceOnly: false, markerUnreadable: true }
  return { admitted: true, graceOnly: age !== null && age < RECONCILE_GRACE_MS }
}

/**
 * G1: may `reconcileClaimEvidence` run on this claim? Admits exactly: FINANCIAL VERIFICATION; the crash
 * marker once its grace has passed; the legacy stranded shape; a claim bound with no error; an attempt
 * taken with nothing recorded; (i) an approved proof or lock; (i-b) a safety hold; (ii) the own-row
 * legacy mismatch (B8); (iii) a settled claim bound to a row of its own order that is pending, succeeded,
 * or failed with a Stripe id. A rule that needs the bound row refuses when it was not read.
 * NOT a healthy approved-but-unpaid claim: reconciling it could park a case whose money truth is not in question.
 */
export function reconcileRefusal(c: ClaimFacts, nowMs: number = Date.now()): Refusal | null {
  const v = reconcileVerdict(c, nowMs)
  if (!v.admitted) return { status: 409, error: RECONCILE_NOT_PENDING }
  if (v.graceOnly) return { status: 409, error: RECONCILE_GRACE_TEXT }
  if (v.markerUnreadable) return { status: 409, error: RECONCILE_MARKER_UNREADABLE_TEXT }
  return null
}

// ══ D11 — THE DECLARATION EXIT PREDICATE ═════════════════════════════════════════════════════════

/**
 * D11 isStuckResolvable({claim, boundRow}). A declaration is a judgement, not evidence: never on a
 * money-unknown marker, never on a proof of absence (v13 or legacy), never on a resume_mismatch whose
 * identity is unread or is the claim's own row. It accepts a settled claim only when Stripe reversed it.
 */
export function isStuckResolvable(c: ClaimFacts): boolean {
  const e = c.refundError
  if (isReconcileMarker(e)) return false
  if (isNoRefundProofText(e)) return false
  if (c.status === 'refunded') return starts(e, MARKERS.REVERTED_AFTER_REFUND)
  if (!e || (c.status !== 'approved' && c.status !== 'refunding')) return false
  if (isResumeMismatchText(e)) return !!c.id && c.boundRow !== undefined && c.boundRow?.reason !== `claim:${c.id}`
  return true
}

// ══ D14 / C4 / D13 — ARBITRATION REFUSALS ════════════════════════════════════════════════════════

export const APPROVE_INSTANT_UNREADABLE =
  'Approbation impossible : l’heure à partir de laquelle cette preuve d’absence permet un paiement n’a pas pu être lue. Relancez « Réconcilier d’après la preuve » (section « Vérification financière requise »).'
export const approvePrematureText = (iso: string) =>
  `Approbation prématurée : la preuve d’absence de cette réclamation ne permet un paiement qu’à partir du ${iso} (UTC) ; ce délai sépare toute nouvelle tentative de remboursement d’une éventuelle tentative antérieure. Rien n’est payé avant cette heure ; approuvez-la à nouveau ensuite.`
export const APPROVE_LEGACY_PROOF =
  'Approbation suspendue : la preuve d’absence de cette réclamation a été écrite par une version antérieure de la réconciliation, qui ne vérifiait pas toutes les conditions du moteur. Relancez « Réconcilier d’après la preuve » (section « Vérification financière requise ») avant toute approbation.'
export const approveRevisableText = (stuckResolvable: boolean) =>
  'Approbation impossible dans l’état enregistré : une nouvelle approbation ne paierait pas cette réclamation, ou n’est pas établie comme sûre (la cause est dans le détail de la réclamation). Rien n’est payé tant que cet état est enregistré. « Réconcilier d’après la preuve » (section « Vérification financière requise ») relit Stripe et nos lignes et réévalue toutes les conditions.'
  + (stuckResolvable ? ' « Clôturer ce dossier… » enregistre votre déclaration.' : '')
export const approvePermanentText = (stuckResolvable: boolean) =>
  'Approbation impossible : une nouvelle approbation ne paierait pas cette réclamation (la cause est dans le détail de la réclamation). Rien ne sera payé par le rail pour elle.'
  + (stuckResolvable ? ' Clôturez le dossier (« Clôturer ce dossier… »).' : ' Aucune action de l’application ne la clôt : vérifiez la commande dans Stripe.')
/** D13 AM-B3: no refuse_final on any approved claim, arbitrationDecision null included. */
export const REFUSE_APPROVED_AM_B3 =
  'Cette réclamation a été approuvée — elle ne peut plus être refusée. Selon son état : approuvez-la à nouveau (réclamations et remboursements ouverts), réconciliez-la, ou clôturez le dossier (« Clôturer ce dossier… ») si le détail le propose.'

/**
 * `arbitrateClaim`'s pre-checks — same checks, same order, same messages. The arbitration queue
 * emits both verdicts so the console disables exactly the decisions this refuses.
 *   refuse_final on an approved claim → AM-B3 (D13).
 *   approve on an approved claim, D14 in order:
 *     (0) canonical v13 proof → only the C4 instant checks (unreadable; premature, REVISABLE);
 *     (1) LEGACY proof → suspended until reconcile re-proves it;
 *     (2) REVISABLE: any recorded error the reconcile gate admits (or refuses only for the marker grace);
 *     (3) PERMANENT: any other recorded error.
 *   then the existing checks (finalization lock, terminal, restaurant delay, not in arbitration).
 */
export function arbitrationRefusal(c: ClaimFacts, decision: 'approve' | 'refuse_final', now: Date): Refusal | null {
  if (decision === 'refuse_final' && c.status === 'approved') return { status: 409, error: REFUSE_APPROVED_AM_B3 }
  if (decision === 'approve' && c.status === 'approved') {
    if (isCanonicalV13(c)) {
      const instant = proofInstant(c.refundError)
      if (!instant) return { status: 409, error: APPROVE_INSTANT_UNREADABLE }
      if (now.getTime() < instant.getTime()) return { status: 409, error: approvePrematureText(instant.toISOString()) }
    } else if (isNoRefundProofText(c.refundError) && !starts(c.refundError, MARKERS.PROOF_PAYABLE_V13)) {
      return { status: 409, error: APPROVE_LEGACY_PROOF }
    } else if (c.refundError) {
      const v = reconcileVerdict(c, now.getTime())
      // D14 (2) only when reconcile is admitted or refused for its grace alone; an unreadable marker instant is refused
      // by reconcile (D5), so it gets (3) — never a text naming an exit the server refuses (W3 round-1 fix).
      const revisable = v.admitted && !v.markerUnreadable
      return { status: 409, error: revisable ? approveRevisableText(isStuckResolvable(c)) : approvePermanentText(isStuckResolvable(c)) }
    }
  }
  // FINALIZATION LOCK: a decided outcome is not rewritten — except an UNPAID approval, which may be re-driven.
  // ROUND 13 (D2 (1)(b)): unpaid means UNBOUND too. An approval already bound to a Refund row (refundId set)
  // is never re-driven by arbitration: approving it would call the engine on a claim a row already answers.
  const legacyApproved = c.status === 'approved' && !c.refundAttempted && !c.refundId
  if (c.arbitrationDecision && !legacyApproved) {
    return { status: 409, error: 'Cette réclamation a déjà été arbitrée — décision définitive.' }
  }
  if (TERMINAL.includes(c.status)) {
    return { status: 409, error: 'Cette réclamation est clôturée — elle ne peut plus être arbitrée.' }
  }
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

// ══ D1 — THE EXIT TABLE ══════════════════════════════════════════════════════════════════════════

export type Exit = 'approve' | 'refuse_final' | 'reconcile' | 'attribute' | 'adopt' | 'stuck_close'
const EXIT_ORDER: readonly Exit[] = ['approve', 'refuse_final', 'reconcile', 'attribute', 'adopt', 'stuck_close']

export type RegistryId =
  | 'E-01' | 'E-02' | 'E-03' | 'E-04' | 'E-05' | 'E-06' | 'E-07' | 'E-08' | 'E-09'
  | 'E-10' | 'E-11' | 'E-12' | 'E-13' | 'E-14' | 'E-15' | 'E-16' | 'E-17' | 'E-18'
/** What names a state whose exit set is empty or gated-only (D1 TEST). E ids for money states; the
 *  decision states that are not money (IMPLEMENTATION NOTE (W1) on D1, ER-M06) carry their own note. */
export type ExitNote =
  | RegistryId
  /** W3 round-1 fix (E-04 founder acceptance list): a reconcile marker whose instant is malformed. Reconcile,
   *  approve and the declaration all refuse it; no exit exists until the recorded data is corrected. */
  | 'E-04:malformed_marker'
  | 'terminal'
  | 'not_money:awaiting_decision'
  | 'not_money:restaurant_delay'
  | 'not_money:refused_contestable'
  | 'unread:bound_row'
  | 'unknown_status'

export type ExitInput = {
  claim: ClaimFacts
  /** undefined = not read. Overrides claim.boundRow when given. */
  boundRow?: BoundRowFacts | null
  orderId?: string
  now: Date
  /** D1 row 10: how many rows of the order pass the attributionRefusal pre-check. */
  attributableRows?: number
}

const factsOf = (input: ExitInput): ClaimFacts => ({
  ...input.claim,
  ...(input.boundRow !== undefined ? { boundRow: input.boundRow } : {}),
  ...(input.orderId !== undefined ? { orderId: input.orderId } : {}),
})

/**
 * D1 acceptedExits({claim, boundRow, orderId, now}). Computed from the SAME predicates the routes
 * apply (reconcileRefusal, isStuckResolvable, arbitrationRefusal, the FV-only attribution routes), so
 * control parity (D0) holds by construction; tests/claims-t49-round10.test.ts pins the D1 sets.
 * 'approve' is in the set for a canonical v13 proof before its instant too (D3: REVISABLE, the table keeps it) —
 * but only when that instant can be READ: an unreadable instant refuses approval until reconcile re-derives
 * it (C4/D3), so it is not a revisable approval (D1 row 2).
 */
export function acceptedExits(input: ExitInput): Exit[] {
  const c = factsOf(input)
  const out = new Set<Exit>()
  const v13BeforeInstant = isCanonicalV13(c) && proofInstant(c.refundError) !== null
  if (arbitrationRefusal(c, 'approve', input.now) === null || v13BeforeInstant) out.add('approve')
  if (arbitrationRefusal(c, 'refuse_final', input.now) === null) out.add('refuse_final')
  if (reconcileRefusal(c, input.now.getTime()) === null) out.add('reconcile')
  if (c.status === MARKERS.FINANCIAL_VERIFICATION) {
    if ((input.attributableRows ?? 0) > 0) out.add('attribute')
    out.add('adopt')
  }
  if (isStuckResolvable(c)) out.add('stuck_close')
  return EXIT_ORDER.filter((x) => out.has(x))
}

/** D1: the registry entry (or note) that names a state. The D1 TEST requires one for every empty or gated-only set. */
export function exitRegistry(input: ExitInput): ExitNote | null {
  const c = factsOf(input)
  const e = c.refundError
  switch (c.status) {
    case 'restaurant_review': {
      const d = c.responseDeadlineAt instanceof Date ? c.responseDeadlineAt : null
      return d && d.getTime() <= input.now.getTime() ? 'not_money:awaiting_decision' : 'not_money:restaurant_delay'
    }
    case 'arbitration': return 'not_money:awaiting_decision'
    case 'refused': return 'not_money:refused_contestable'
    case MARKERS.FINANCIAL_VERIFICATION: return 'E-03' // E-03 ∪ E-04: the recorded reason decides
    case 'approved':
      if (!e) return c.refundAttempted || c.refundId ? null : 'E-10'
      if (isReconcileMarker(e)) return markerTimestampMs(e) === null ? 'E-04:malformed_marker' : 'E-05'
      if (starts(e, MARKERS.PROOF_PAYABLE_V13)) return 'E-10'
      if (isNoRefundProofText(e) || isRailLockedText(e) || starts(e, MARKERS.SAFETY_HOLD)) return 'E-01'
      return 'E-02'
    case 'refunding':
      if (!e) return null
      if (isReconcileMarker(e)) return markerTimestampMs(e) === null ? 'E-04:malformed_marker' : 'E-05'
      if (isResumeMismatchText(e)) {
        if (c.boundRow === undefined) return 'unread:bound_row'
        return ownRowMismatch(c) ? 'E-05' : 'E-02'
      }
      return 'E-02'
    case 'refunded':
      if (starts(e, MARKERS.REVERTED_AFTER_REFUND)) return 'E-06'
      if (!e && c.refundId) {
        if (c.boundRow === undefined) return 'unread:bound_row'
        const row = c.boundRow
        if (row && row.orderId === c.orderId) {
          if (row.status === 'succeeded') return 'E-09'
          if (row.status === 'pending' || (row.status === 'failed' && !!row.stripeRefundId)) return 'E-07'
        }
      }
      return 'terminal'
    case 'refused_final': return 'terminal'
    default: return 'unknown_status'
  }
}

// ══ G5 — ENGINE MIRROR, HOLDS AND VERDICT ════════════════════════════════════════════════════════

/** G4: what a PENDING row's evidence says (loader output). */
export type PendingRowTruth =
  | { kind: 'at_stripe'; refundId: string; status: string }
  | { kind: 'absent_within_window'; until: Date }
  | { kind: 'absent_dead' }
  | { kind: 'contradiction'; detail: string }
  | { kind: 'unreadable' }

export type MoneyRow = {
  id: string
  status: string
  amountCents: number
  stripeRefundId: string | null
  reason: string | null
  idempotencyKey: string | null
  createdAt: Date
  royaltyRefundCents?: number | null
}

export type StripeRefundFact = {
  id: string
  status: string
  amount: number
  /** The charge id the refund sits on (the loader normalizes an expanded object to its id). */
  charge?: string | null
  metadata?: { grubano_refund_row?: string | null } | null
}

/** A claim counted by boundToWhere(owner, claimId) (B1). */
export type BinderFact = { id: string; status: string; refundError: string | null; refundId: string | null }

/** G4/G5 H1: a row marked succeeded here that Stripe does not count on this payment. */
export type SucceededNotCounted = {
  rowId: string
  how: 'reverted' | 'absent' | 'other_payment' | 'pending_at_stripe'
  refundId: string | null
  stripeStatus?: string | null
}
/** G4/G5 H3: a row whose Stripe read contradicts itself. */
export type RowContradiction = { rowId: string; rowStatus: string; detail: string }

/** G3 ReapprovalFacts, the fields the pure derivation reads (no ownStampedRowIds: the withdrawn engine guard is deleted). */
export type ReapprovalFacts = {
  orderId: string
  requestedAmountCents: number
  orderPaymentStatus: string
  hasPaymentIntent: boolean
  piStatus: string
  chargeId: string | null
  chargeAmountCents: number
  amountCapturedCents: number
  chargeDisputed: boolean
  amountRefundedCents: number
  /** true / false, or null when unknown (ROUTED copy has an « unknown » form). */
  routed: boolean | null
  royaltyStatus: string | null
  stripeListLength: number
  rows: MoneyRow[]
  /** L: every refund of the PaymentIntent (complete list). */
  L: StripeRefundFact[]
  /** Evidence for each PENDING row, by row id. */
  truths: Record<string, PendingRowTruth>
  /** Binders of each owner row (boundToWhere(owner.id, claimId)), by row id. */
  binders: Record<string, BinderFact[]>
  /** A stamp's claim Y when Y is not among the binders: null = not found. */
  stampedClaims: Record<string, { status: string; refundId: string | null } | null>
  succeededNotCounted: SucceededNotCounted[]
  rowContradictions: RowContradiction[]
}

export type PendingEvidence =
  | 'failed_at_stripe' | 'dead' | 'within_window' | 'pending_at_stripe'
  | 'succeeded_at_stripe_clawback' | 'succeeded_at_stripe'
  /** contradiction or unreadable evidence: never classified as a class above (N6 / N1 decide first). */
  | 'unclassified'

/** G5 pendingEvidence per pending row. The clawback class applies at ANY age (fail closed, R-A0-2). */
export function pendingEvidenceOf(row: MoneyRow, truth: PendingRowTruth | undefined, royaltyStatus: string | null): PendingEvidence {
  if (!truth) return 'unclassified'
  if (truth.kind === 'absent_dead') return 'dead'
  if (truth.kind === 'absent_within_window') return 'within_window'
  if (truth.kind !== 'at_stripe') return 'unclassified'
  if (truth.status === 'failed' || truth.status === 'canceled') return 'failed_at_stripe'
  if (truth.status === 'pending' || truth.status === 'requires_action') return 'pending_at_stripe'
  if (truth.status === 'succeeded') {
    const clawback = (row.royaltyRefundCents ?? 0) > 0 && (royaltyStatus === 'settled' || royaltyStatus === 'settling')
    return clawback ? 'succeeded_at_stripe_clawback' : 'succeeded_at_stripe'
  }
  return 'unclassified'
}

export type EngineRefusal =
  | { step: 'E1'; paymentStatus: string; hasPaymentIntent: boolean }
  | { step: 'E2'; rowIds: string[] }
  | { step: 'E1b'; piStatus: string }
  | { step: 'E3'; oldestRowIds: string[]; evidenceByRow: Record<string, PendingEvidence>; otherPendingRowIds: string[]; engineListTruncated: boolean }
  | { step: 'E4'; refundedCents: number; chargeAmountCents: number }
  | { step: 'E5'; requestedAmountCents: number; refundableCents: number }
  | { step: 'E6'; key: string; rowId: string }

/**
 * G5 engineRefusalOnReapproval: the FIRST refusal lib/refund.ts executeRefund reaches on these facts,
 * in its own order (724-839). PIX and E1c are not returned: the loader makes them unreadable / no_charge.
 */
export function engineRefusalOnReapproval(f: ReapprovalFacts): EngineRefusal | null {
  if ((f.orderPaymentStatus !== 'paid' && f.orderPaymentStatus !== 'reconcile_manual') || !f.hasPaymentIntent) {
    return { step: 'E1', paymentStatus: f.orderPaymentStatus, hasPaymentIntent: f.hasPaymentIntent }
  }
  const failedWithId = f.rows.filter((r) => r.status === 'failed' && !!r.stripeRefundId)
  if (failedWithId.length) return { step: 'E2', rowIds: failedWithId.map((r) => r.id) }
  if (f.piStatus !== 'succeeded') return { step: 'E1b', piStatus: f.piStatus }
  const pending = f.rows.filter((r) => r.status === 'pending')
  if (pending.length) {
    const min = Math.min(...pending.map((r) => r.createdAt.getTime()))
    const oldest = pending.filter((r) => r.createdAt.getTime() === min)
    const evidenceByRow: Record<string, PendingEvidence> = {}
    for (const r of pending) evidenceByRow[r.id] = pendingEvidenceOf(r, f.truths[r.id], f.royaltyStatus)
    return {
      step: 'E3',
      oldestRowIds: oldest.map((r) => r.id),
      evidenceByRow,
      otherPendingRowIds: pending.filter((r) => r.createdAt.getTime() !== min).map((r) => r.id),
      engineListTruncated: oldest.some((r) => !r.stripeRefundId) && f.stripeListLength > 100,
    }
  }
  const refundable = f.chargeAmountCents - f.amountRefundedCents
  if (refundable <= 0) return { step: 'E4', refundedCents: f.amountRefundedCents, chargeAmountCents: f.chargeAmountCents }
  const req = f.requestedAmountCents
  if (!Number.isInteger(req) || req <= 0 || req > refundable) {
    return { step: 'E5', requestedAmountCents: req, refundableCents: refundable }
  }
  const key = `refund:${f.orderId}:${f.amountRefundedCents}`
  const holder = f.rows.find((r) => r.idempotencyKey === key)
  if (holder) return { step: 'E6', key, rowId: holder.id }
  return null
}

export type SafetyHold =
  | { hold: 'H1'; rowId: string; how: SucceededNotCounted['how']; refundId: string | null; stripeStatus: string | null }
  | { hold: 'H2'; refundId: string; status: string }
  | { hold: 'H3'; rowId: string; rowStatus: string; detail: string }
  | { hold: 'H5'; cause: 'disputed'; chargeId: string | null }
  | { hold: 'H5'; cause: 'captured'; requestedAmountCents: number; remainingCapturedCents: number }

/** G5 reapprovalSafetyHolds: Claims-side holds the engine does not model. H2 counts ZERO-owner refunds only (B3). */
export function reapprovalSafetyHolds(f: ReapprovalFacts): SafetyHold[] {
  const holds: SafetyHold[] = []
  for (const s of f.succeededNotCounted) {
    holds.push({ hold: 'H1', rowId: s.rowId, how: s.how, refundId: s.refundId, stripeStatus: s.stripeStatus ?? null })
  }
  if (f.routed === true) {
    for (const r of f.L) {
      if ((r.status === 'failed' || r.status === 'canceled') && ownersOf(r, f.rows).length === 0) {
        holds.push({ hold: 'H2', refundId: r.id, status: r.status })
      }
    }
  }
  for (const k of f.rowContradictions) holds.push({ hold: 'H3', rowId: k.rowId, rowStatus: k.rowStatus, detail: k.detail })
  if (f.chargeDisputed === true) holds.push({ hold: 'H5', cause: 'disputed', chargeId: f.chargeId })
  const remaining = f.amountCapturedCents - f.amountRefundedCents
  // IMPLEMENTATION NOTE (W2) on G5/G8 H5 captured: the hold says the engine would insert its row before Stripe
  // refuses. That is true only where the engine passes E4/E5 (refundable = charge amount - refunded, refund.ts
  // 783-790); where E4/E5 apply the engine refuses before any insert, so the E4/E5 refusal speaks instead.
  const refundable = f.chargeAmountCents - f.amountRefundedCents
  const req = f.requestedAmountCents
  const engineWouldInsert = refundable > 0 && Number.isInteger(req) && req > 0 && req <= refundable
  if (engineWouldInsert && req > remaining) {
    holds.push({ hold: 'H5', cause: 'captured', requestedAmountCents: f.requestedAmountCents, remainingCapturedCents: remaining })
  }
  return holds
}

export type LockedVerdict = { locked: true; refusal: EngineRefusal | null; holds: SafetyHold[] }
export type ReapprovalVerdict = 'payable' | LockedVerdict

/** G5: payable only with no engine refusal and no hold. */
export function reapprovalVerdict(f: ReapprovalFacts): ReapprovalVerdict {
  const refusal = engineRefusalOnReapproval(f)
  const holds = reapprovalSafetyHolds(f)
  return refusal === null && holds.length === 0 ? 'payable' : { locked: true, refusal, holds }
}

/**
 * G9 lockIsTemporary: the ONLY lock whose cause can cease without a Claims action — no hold, the
 * refusal is E3, every oldest row's Stripe refund succeeded with no settled-royalty clawback, and the
 * engine's list is not truncated. Every other lock is permanent (LOCKED tail).
 */
export function lockIsTemporary(v: ReapprovalVerdict): boolean {
  if (v === 'payable') return false
  if (v.holds.length > 0 || !v.refusal || v.refusal.step !== 'E3') return false
  const e3 = v.refusal
  return !e3.engineListTruncated && e3.oldestRowIds.length > 0 && e3.oldestRowIds.every((id) => e3.evidenceByRow[id] === 'succeeded_at_stripe')
}

export type ProofPrefix =
  | typeof MARKERS.PROOF_PAYABLE_V13
  | typeof MARKERS.AWAITING_FINALIZATION
  | 'no_refund_proven_rail_locked:'

/** G8: verdict → prefix. */
export function proofPrefixFor(v: ReapprovalVerdict): ProofPrefix {
  if (v === 'payable') return MARKERS.PROOF_PAYABLE_V13
  return lockIsTemporary(v) ? MARKERS.AWAITING_FINALIZATION : 'no_refund_proven_rail_locked:'
}

// ══ G6 / G7 — N1-N8: THE PURE NO-ROW DERIVATION ══════════════════════════════════════════════════

/** G3 loader output: readable facts, or why they are not readable. */
export type OrderMoneyRead =
  | { readable: true; facts: ReapprovalFacts }
  /** Transient: Stripe or a row read failed. refundedCents when the charge was read before the failure. */
  | { readable: false; permanent: null; refundedCents?: number | null }
  | { readable: false; permanent: 'list_over_cap'; refundedCents?: number | null }
  /** hasPaymentIntent false: the order has no PaymentIntent — the engine refuses at E1 (IMPLEMENTATION NOTE (W2) on G3). */
  | { readable: false; permanent: 'no_charge'; rows: MoneyRow[]; paymentStatus: string; piStatus: string; hasPaymentIntent?: boolean }

/** A standing refund explained by another settled claim (G7 N3). */
export type ExplainedRefund = { refundId: string; rowId: string; claimId: string; stamped: boolean; amountCents: number; status: string }

export type NoRowPark = { kind: 'park'; reason: 'refund_moved_unattributed' | 'stripe_refund_contradiction'; detail: string }
export type NoRowOutcome =
  | NoRowPark
  /** G6: the canonical no-charge lock; its refusal is the first of E1 / E1b / E1c on the facts. */
  | { kind: 'proof'; basis: 'no_charge'; prefix: 'no_refund_proven_rail_locked:'; noChargeStep: 'E1' | 'E1b' | 'E1c' }
  /** G7 N8 → G8. The text is rendered by the G8 writer from these fields (IMPLEMENTATION NOTE (W1) on G7). */
  | { kind: 'proof'; basis: 'verdict'; prefix: ProofPrefix; verdict: ReapprovalVerdict; explained: ExplainedRefund[] }
  | { kind: 'no_write'; outcome: 'stripe_unreadable_retry' }
  | { kind: 'no_write'; outcome: 'unconfirmed_within_window'; until: Date }
  /** A standing refund owned by a row stamped for THIS claim: the no-row branch no longer applies. */
  | { kind: 'no_write'; outcome: 'changed_during_read' }

const STANDING = ['succeeded', 'pending', 'requires_action']
const park = (reason: NoRowPark['reason'], detail: string): NoRowPark => ({ kind: 'park', reason, detail })
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

/**
 * G6 N1 + G7 N2-N7 + the N8 verdict, on the loader's facts. Pure: reconcile (N0-N8) and T2 (e') call it
 * on the same facts and must reach the same outcome. It never reads a claim's identity from anything
 * but a stamp or a binding (B2), and never turns an unreadable fact into a proof.
 */
export function deriveNoRowOutcome(read: OrderMoneyRead, claimId: string): NoRowOutcome {
  if (!read.readable) {
    if (read.permanent === 'no_charge') {
      const variant = read.rows.find((r) => !!r.stripeRefundId) ?? read.rows.find((r) => r.status === 'pending')
      if (variant) {
        return park('stripe_refund_contradiction', `La ligne ${variant.id} enregistre un remboursement alors que le paiement Stripe de cette commande n’a pas de charge. Aucune conclusion tirée.`)
      }
      const noChargeStep = (read.paymentStatus !== 'paid' && read.paymentStatus !== 'reconcile_manual') || read.hasPaymentIntent === false ? 'E1'
        : read.piStatus !== 'succeeded' ? 'E1b' : 'E1c'
      return { kind: 'proof', basis: 'no_charge', prefix: 'no_refund_proven_rail_locked:', noChargeStep }
    }
    if (read.permanent === 'list_over_cap') {
      return park('refund_moved_unattributed', 'Stripe rapporte plus de 1 000 remboursements sur ce paiement : leur liste complète ne peut pas être lue, aucune attribution n’est établie.')
    }
    const r = read.refundedCents
    if (!r) return { kind: 'no_write', outcome: 'stripe_unreadable_retry' }
    return park('refund_moved_unattributed', `Stripe rapporte ${r} c remboursés sur ce paiement, mais la liste complète de ses remboursements, ou la lecture d’une ligne de remboursement, n’a pas pu être lue : aucune attribution n’est établie. Relancez « Réconcilier d’après la preuve ».`)
  }

  const f = read.facts
  const r = f.amountRefundedCents
  const standing = f.L.filter((s) => STANDING.includes(s.status))

  // N2 — a standing refund on another charge than the one Stripe counts.
  const offCharge = standing.filter((s) => s.charge != null && f.chargeId != null && s.charge !== f.chargeId)
  if (offCharge.length) {
    return park('stripe_refund_contradiction', `Stripe rapporte sur ce paiement ${offCharge.map((s) => s.id).join(', ')} sur une autre charge que ${f.chargeId}, la charge dont il compte ${r} c remboursés. Aucune conclusion tirée.`)
  }

  // N3 — owners, the explanation rule, AM-A5.
  const explained: ExplainedRefund[] = []
  const unexplained: string[] = []
  for (const s of standing) {
    const owners = ownersOf(s, f.rows)
    const failedOwner = owners.find((o) => o.status === 'failed')
    if (failedOwner) {
      return park('stripe_refund_contradiction', `La ligne ${failedOwner.id} est ÉCHOUÉE dans notre base, mais Stripe rapporte son remboursement ${s.id} « ${s.status} ». Aucune conclusion tirée.`)
    }
    if (owners.length !== 1) { unexplained.push(s.id); continue }
    const owner = owners[0]
    const binders = f.binders[owner.id] ?? []
    const stamp = stampedClaimId(owner.reason)
    if (stamp === claimId) return { kind: 'no_write', outcome: 'changed_during_read' }
    const x = binders.length === 1 && binders[0].status === 'refunded' && binders[0].refundError === null ? binders[0] : null
    if (x && (stamp === null || stamp === x.id)) {
      explained.push({ refundId: s.id, rowId: owner.id, claimId: x.id, stamped: stamp !== null, amountCents: s.amount, status: s.status })
      continue
    }
    if (stamp !== null) {
      const y = binders.find((b) => b.id === stamp) ?? f.stampedClaims[stamp] ?? null
      const other = binders.find((b) => b.id !== stamp) ?? null
      const settledElsewhere = !!y && y.status === 'refunded' && !!y.refundId && y.refundId !== owner.id
      return park('refund_moved_unattributed',
        `Le remboursement ${s.id} (ligne ${owner.id}) porte l’identité de la réclamation ${stamp}`
        + (y ? `, dont le statut est « ${y.status} »${settledElsewhere ? ` et qui est soldée sur une autre ligne (${y.refundId})` : ''}` : ', introuvable')
        + (other ? ` ; il est lié à la réclamation ${other.id}` : '')
        + ' : cet argent n’est ni attribuable à cette réclamation ni, de façon établie, à une autre. Anomalie à instruire ; aucune conclusion tirée.')
    }
    unexplained.push(s.id)
  }

  const sumSucc = sum(standing.filter((s) => s.status === 'succeeded').map((s) => s.amount))
  const sumPend = sum(standing.filter((s) => s.status !== 'succeeded').map((s) => s.amount))
  const sumAll = sumSucc + sumPend
  const explainedList = explained.map((x) => `${x.refundId} → ${x.claimId}`).join(', ')
  const detailUnattributed = (ids: string[] = unexplained, stillPending: boolean = standing.some((s) => s.status !== 'succeeded')) =>
    `Des remboursements existent sur cette commande (Stripe : ${r} c remboursés ; liste du paiement : ${sumSucc} c aboutis, ${sumPend} c en attente ; ${f.rows.length} ligne(s) Refund). `
    + `Au moins un remboursement (${ids.length ? ids.join(', ') : 'non identifié dans la liste'}) n’est rattaché ni à l’identité de cette réclamation ni, de façon établie, à une autre réclamation soldée`
    + (explained.length ? ' ; rattachés à d’autres réclamations soldées : ' + explainedList : '')
    + '. L’attribution ne peut pas être prouvée.'
    + (stillPending ? ' Un remboursement de ce paiement est encore en attente chez Stripe : relancez « Réconcilier d’après la preuve » lorsqu’il sera terminal.' : '')

  // N4 — Σsucceeded ≤ refunded ≤ Σstanding.
  if (!(sumSucc <= r && r <= sumAll)) {
    if (r === 0) {
      return park('stripe_refund_contradiction', `Stripe rapporte ${r} c remboursés sur la charge ${f.chargeId}, mais la liste complète des remboursements du paiement totalise ${sumSucc} c aboutis et ${sumAll} c aboutis ou en attente. Les deux lectures se contredisent ; aucune conclusion tirée. Relancez la réconciliation.`)
    }
    return park('refund_moved_unattributed', detailUnattributed())
  }

  // N5 — any standing refund not explained.
  if (unexplained.length) return park('refund_moved_unattributed', detailUnattributed())

  // N6 — a row whose Stripe reads contradict each other.
  if (f.rowContradictions.length) return park('stripe_refund_contradiction', f.rowContradictions[0].detail)

  // N7 — in flight, within the window, unclassifiable.
  const pendingRows = f.rows.filter((row) => row.status === 'pending')
  const inflight = new Set<string>(standing.filter((s) => s.status !== 'succeeded').map((s) => s.id))
  for (const row of pendingRows) {
    const t = f.truths[row.id]
    if (t && t.kind === 'at_stripe' && (t.status === 'pending' || t.status === 'requires_action')) {
      // IMPLEMENTATION NOTE (W3), W1 verifier P3: an in-flight refund of a row stamped for THIS claim (absent from L
      // by read skew) is never « rattaché ni à l’identité de cette réclamation » — the own-stamp outcome applies.
      if (stampedClaimId(row.reason) === claimId) return { kind: 'no_write', outcome: 'changed_during_read' }
      inflight.add(t.refundId)
    }
  }
  for (const s of f.succeededNotCounted) {
    if (s.how !== 'pending_at_stripe' || !s.refundId) continue
    if (stampedClaimId(f.rows.find((row) => row.id === s.rowId)?.reason) === claimId) return { kind: 'no_write', outcome: 'changed_during_read' }
    inflight.add(s.refundId)
  }
  if (inflight.size) {
    const ids = Array.from(inflight)
    // IMPLEMENTATION NOTE (W1) on G7 N7: an in-flight refund that no settled claim explains (a pending
    // row at Stripe absent from L by read skew) is not « rattaché à une AUTRE réclamation » — that
    // attribution is not established. It parks with DETAIL_UNATTRIBUTED naming it instead.
    const explainedIds = new Set(explained.map((x) => x.refundId))
    const unexplainedInflight = ids.filter((id) => !explainedIds.has(id))
    if (unexplainedInflight.length) return park('refund_moved_unattributed', detailUnattributed(unexplainedInflight, true))
    const map =explained.filter((x) => inflight.has(x.refundId)).map((x) => `${x.refundId} → ${x.claimId}`).join(', ')
    return park('refund_moved_unattributed', `Stripe rapporte ${r} c remboursés sur ce paiement ; ${ids.join(', ')} est rattaché à une AUTRE réclamation (${map}) mais encore EN ATTENTE chez Stripe : aucune conclusion pour cette réclamation avant qu’il soit terminal. Relancez alors « Réconcilier d’après la preuve ».`)
  }
  const within = pendingRows.map((row) => f.truths[row.id]).filter((t): t is Extract<PendingRowTruth, { kind: 'absent_within_window' }> => !!t && t.kind === 'absent_within_window')
  if (within.length) {
    return { kind: 'no_write', outcome: 'unconfirmed_within_window', until: new Date(Math.max(...within.map((t) => t.until.getTime()))) }
  }
  const CLASSIFIED: PendingEvidence[] = ['failed_at_stripe', 'dead', 'succeeded_at_stripe', 'succeeded_at_stripe_clawback']
  const unclassifiable = pendingRows.find((row) => !CLASSIFIED.includes(pendingEvidenceOf(row, f.truths[row.id], f.royaltyStatus)))
  if (unclassifiable) {
    return park('stripe_refund_contradiction', `La ligne ${unclassifiable.id} est en attente sans preuve classable ; aucune conclusion tirée.`)
  }

  // N8 — verdict → proof (G8 writes it).
  const verdict = reapprovalVerdict(f)
  return { kind: 'proof', basis: 'verdict', prefix: proofPrefixFor(verdict), verdict, explained }
}

// ══ F01-F05 — THE CUSTOMER STATUS CONTRACT ═══════════════════════════════════════════════════════

/** F01: the closed set. ClaimSection renders `status.${s}` from customerClaimStatus only. */
export const CUSTOMER_STATUSES = [
  'restaurant_review', 'refused', 'arbitration', 'approved', 'refunding', 'refunded', 'refund_unconfirmed',
  'refused_final', 'refused_by_grubano', 'closed_by_support', 'financial_verification',
] as const
export type CustomerStatus = typeof CUSTOMER_STATUSES[number]

/** F02: how a terminal claim was closed. null for a non-terminal claim and for a reverted settlement. */
export type ClosureKind = 'refunded' | 'settled_by_declaration' | 'closed_by_declaration' | 'refused_confirmed' | 'refused_by_grubano'
export function claimClosureKind(c: ClaimFacts): ClosureKind | null {
  if (c.status === 'refunded') {
    if (typeof c.refundError === 'string' && c.refundError.startsWith(MARKERS.REVERTED_AFTER_REFUND)) return null
    return c.refundError ? 'settled_by_declaration' : 'refunded'
  }
  if (c.status === 'refused_final') {
    if (c.arbitrationDecision !== 'refused_final') return 'closed_by_declaration'
    return c.restaurantResponse === 'refused' ? 'refused_confirmed' : 'refused_by_grubano'
  }
  return null
}
export const CLOSURE_TRIGGER: Record<ClosureKind, string> = {
  refunded: 'claim_decision_refunded',
  settled_by_declaration: 'claim_closed_by_support',
  closed_by_declaration: 'claim_closed_by_support',
  refused_confirmed: 'claim_decision_refused_final',
  refused_by_grubano: 'claim_decision_refused_final',
}
export function refusalEmailKind(c: ClaimFacts | null | undefined): 'refused_final' | 'refused_by_grubano' {
  return c && claimClosureKind(c) === 'refused_confirmed' ? 'refused_final' : 'refused_by_grubano'
}

/**
 * F08: the reasons the CUSTOMER is shown, by who wrote them. The restaurant's reason only for a restaurant refusal
 * (F10 (2)); Grubano's decision reason only for a Grubano decision, never on a declaration (R-D4: a declaration carries
 * no operator note to the customer, legacy rows included).
 */
export function customerClaimReasons(c: ClaimFacts & { restaurantResponseReason?: string | null; arbitrationReason?: string | null }): { restaurantResponseReason: string | null; arbitrationReason: string | null } {
  const k = claimClosureKind(c)
  const declaration = k === 'settled_by_declaration' || k === 'closed_by_declaration'
  return {
    restaurantResponseReason: c.restaurantResponse === 'refused' ? (c.restaurantResponseReason ?? null) : null,
    arbitrationReason: c.arbitrationDecision && !declaration ? (c.arbitrationReason ?? null) : null,
  }
}

/** H05: this build's closure record — the only closure-notice eligibility source. */
export const CLOSURE_RECORD_TRIGGER = 'claim_closure_record'
export const closureRecordKey = (id: string) => `claim:${id}`

/** F03: the bound row proves a settlement the customer may read as « Remboursée ». */
export function refundedRowProven(row: { orderId?: string | null; status?: string | null; amountCents?: number | null } | null | undefined, claimOrderId: string): boolean {
  return !!row && row.orderId === claimOrderId && (row.status === 'succeeded' || row.status === 'pending')
    && typeof row.amountCents === 'number' && Number.isInteger(row.amountCents) && row.amountCents > 0
}
/** F03: null when unreadable (binders null) or ambiguous (≥ 2 non-mismatch binders, A-S43). */
export function refundedRowTruth(row: Parameters<typeof refundedRowProven>[0], binders: number | null, claimOrderId: string): boolean | null {
  if (binders === null) return null
  if (binders >= 2) return null // A-S43: never « Remboursée » for any claim on an ambiguous row
  return refundedRowProven(row, claimOrderId)
}

/**
 * Whether a bound refund row lets the customer read « remboursement en cours »: it carries a Stripe
 * refund id AND is still pending in our base. null = the row could not be read.
 */
export function boundRowShowsInProgress(row: { status?: string | null; stripeRefundId?: string | null } | null | undefined): boolean | null {
  if (!row) return null
  return row.status === 'pending' && !!row.stripeRefundId
}

/**
 * F04: the status the CUSTOMER is shown — the single merged body. A money state whose truth is open
 * reads as the neutral manual review; « Remboursée » needs the F03 proof; an unknown raw status fails
 * closed (never a raw key path).
 */
export function customerClaimStatus(c: ClaimFacts, boundRowInProgress: boolean | null, refundedRow: boolean | null = null): CustomerStatus {
  const FV = MARKERS.FINANCIAL_VERIFICATION as 'financial_verification'
  if (c.status === FV) return FV
  if (c.status === 'refunding') return !c.refundError && !!c.refundId && boundRowInProgress === true ? 'refunding' : FV
  if (c.status === 'approved') return (c.refundError || c.refundAttempted === true) ? FV : 'approved'
  const kind = claimClosureKind(c)
  if (c.status === 'refunded' && kind === null) return FV // REVERTED_AFTER_REFUND
  if (kind === 'refunded') return refundedRow === true ? 'refunded' : refundedRow === false ? 'refund_unconfirmed' : FV
  if (kind === 'settled_by_declaration' || kind === 'closed_by_declaration') return 'closed_by_support'
  if (kind === 'refused_confirmed') return 'refused_final'
  if (kind === 'refused_by_grubano') return 'refused_by_grubano'
  if (c.status === 'restaurant_review' || c.status === 'refused' || c.status === 'arbitration') return c.status
  return FV
}

// ══ F15 — GUIDANCE AND THE absence_proven_payable MONEY LABEL ════════════════════════════════════

/**
 * The line an operator reads for a money state the stuck-money hatch does NOT accept: the fact, and
 * the one accepted action that moves it. Never a mechanism the code does not run, and never a Stripe
 * state this list did not read.
 */
const GUIDANCE: Record<string, string> = {
  reconcile_required:
    'Argent non établi. « Réconcilier d’après la preuve » (section « Vérification financière requise ») lit Stripe et nos lignes, et n’applique que ce qui est prouvé — refusé tant que la tentative a démarré il y a moins de 5 minutes.',
  // W3 round-2 fix (D0 / D5 / F16 (7)): the marker instant cannot be read, so the reconcile gate refuses and no exit is
  // accepted (acceptedExits []). The line states the server refusal and names no control.
  reconcile_marker_unreadable:
    `Argent non établi. ${RECONCILE_MARKER_UNREADABLE_TEXT} Aucune clôture manuelle sur cet état.`,
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
  // F15.
  approved_not_driven:
    'Approuvée, jamais payée. Elle ne se paie que par l’approbation admin (file d’arbitrage), réclamations et remboursements ouverts, et seulement si la vérification avant moteur le permet à ce moment. Aucune clôture manuelle sur cet état.',
  // F15 + ER-R27: « abouti ou en attente » — an ownerless FAILED Dashboard refund can stand beside a v13 proof (A-S08b).
  absence_proven_payable:
    'Rien à clôturer : approuvée et non payée ; à la preuve, Stripe ne rapportait aucun remboursement abouti ou en attente non expliqué. Elle ne se paie que par une nouvelle approbation admin, réclamations et remboursements ouverts, au plus tôt à l’instant écrit dans son détail, et seulement si la relecture avant moteur confirme encore la preuve.',
  refund_error_recorded:
    'Erreur de remboursement enregistrée : lisez le détail. « Clôturer ce dossier… » enregistre votre déclaration ; aucune action ici ne déplace d’argent.',
}

export function moneyStateGuidance(moneyState: string): string {
  return GUIDANCE[moneyState] ?? 'État non reconnu : aucune action proposée ici. Vérifiez la commande dans Stripe.'
}

/** F15 (+ ER-R27): AdminClaimsArbitration's MONEY label for absence_proven_payable, with the C4 instant. */
export function absenceProvenPayableLabel(refundError: string | null | undefined): string {
  const head = 'Aucun remboursement abouti ou en attente non expliqué rapporté par Stripe à la preuve (liste complète lue) — approuvée, non payée. Rien ne la paiera automatiquement : nouvelle approbation admin, réclamations et remboursements ouverts'
  const instant = proofInstant(refundError)
  return instant
    ? `${head}, au plus tôt le ${instant.toISOString()} (UTC), relue avant le moteur`
    : `${head} — instant illisible : approbation refusée, relancez « Réconcilier d’après la preuve »`
}

// ══ G8 — THE PROOF, LOCK AND SAFETY-HOLD TEXTS (pure) ═════════════════════════════════════════════
// Rendered here, written by the N8 writer (reconcile) and by T2 (lib/claims triggerClaimRefund). Every
// engine quote is verbatim lib/refund.ts. No sentence says a cause will cease or a claim will be paid.

export const HEAD_A = 'Stripe ne rapporte aujourd’hui aucun remboursement abouti ni en attente sur ce paiement (liste complète lue).'

/** G8 HEAD_B: every standing refund is explained by another settled claim. */
export function headB(amountRefundedCents: number, explained: ExplainedRefund[]): string {
  const items = explained.map((x) => `${x.refundId} (ligne ${x.rowId}, réclamation ${x.claimId}, ${x.stamped ? 'identité portée par la ligne' : 'liaison seule'}), ${x.amountCents} c`)
  return `Stripe rapporte ${amountRefundedCents} c remboursés sur ce paiement, et chacun de ses remboursements aboutis ou en attente est rattaché à une AUTRE réclamation, soldée sur sa ligne : ${items.join(' ; ')}. Aucun n’est rattaché à celle-ci.`
}

export const LOCKED_OPEN = 'MAIS une nouvelle approbation ne paierait pas cette réclamation :'
export const LOCKED_CLOSE = 'Rien ne sera payé par le rail pour cette réclamation tant que cet état est enregistré : l’approbation est refusée et le balayage automatique l’ignore. « Réconcilier d’après la preuve » réévalue toutes les conditions ; une cause qui ne dépend d’aucune action ultérieure ne cessera pas. Si elle a été remboursée hors système (Dashboard Stripe), déclarez-le (« Clôturer ce dossier… ») ; sinon clôturez sans paiement. Décision humaine requise.'
export const AWAITING_OPEN = 'MAIS une nouvelle approbation ne paierait pas cette réclamation tant que'
export const AWAITING_CLOSE = 'Relancez « Réconcilier d’après la preuve » lorsque cette ligne ne sera plus « en attente » dans notre base : la réconciliation réévaluera alors toutes les conditions. En attendant, rien ne sera payé par le rail pour cette réclamation (approbation refusée, balayage automatique ignoré). Si elle a été remboursée hors système (Dashboard Stripe), déclarez-le (« Clôturer ce dossier… »).'

/** G8 PAYABLE tail, with the C4 instant. */
export function payableTail(requestedAmountCents: number, instant: Date): string {
  return `Aucune ligne de remboursement de cette commande n’est en attente, et au moment de cette lecture aucune condition de refus du moteur ni aucun blocage de sûreté n’était rempli pour le montant de cette réclamation (${requestedAmountCents} c). La réclamation repasse en « approuvée, non payée ». Rien ne la paiera automatiquement : elle devra être approuvée à nouveau par un admin, réclamations et remboursements ouverts ; une vérification relira alors Stripe et nos lignes avant le moteur. Elle est payable au plus tôt le ${instant.toISOString()} (UTC).`
}

/** G8 ROUTED: true → the routed sentence; null (unknown) → its conditional form; false → ''. */
export function routedSentence(routed: boolean | null): string {
  if (routed === true) return 'Ce paiement est routé : un remboursement échoué a pu laisser le transfert du restaurant inversé, et Stripe ne le restaure pas — vérifiez-le dans le Dashboard Stripe.'
  if (routed === null) return 'Si ce paiement est routé, un remboursement échoué a pu laisser le transfert du restaurant inversé (Stripe ne le restaure pas) — vérifiez-le dans le Dashboard Stripe.'
  return ''
}

// ══ G11 — REVERTED_AFTER_REFUND: the claim-only marking of a settled claim whose refund failed or was canceled ══════════

/** F16 (3): the ONE customer-visibility sentence (R-X0-4). */
export const CUSTOMER_VISIBILITY_SENTENCE = 'Quand les réclamations sont ouvertes, le client lit « vérification manuelle » ; sinon il ne voit aucune réclamation.'

/**
 * G11 TEXT, one variant per bound-row status at the marking. `re` is the Stripe refund id (the recorded id for a failed
 * row), `status` the Stripe status read (unused for a failed row). IMPLEMENTATION NOTE (W5) on G11, ER-C24 / F16 (6):
 * the pending variant reads « si le moteur reprend cette ligne », never « la reprend » (round-10 PROMISES pin).
 */
export function reversalMarkerText(variant: 'succeeded' | 'failed' | 'pending', rowId: string, re: string, status: string, routed: boolean | null): string {
  const r = routedSentence(routed)
  const routedPart = r ? `${r} ` : ''
  // IMPLEMENTATION NOTE (W5) on G11: « si le client a reçu un paiement par un autre moyen » replaces « si le client a été payé
  // autrement » — same condition, but the round-7 FORBIDDEN pin (an unqualified customer outcome) matches the frozen wording.
  const tail = `${routedPart}${CUSTOMER_VISIBILITY_SENTENCE} Aucune action ici ne déplace d’argent : si le client a reçu un paiement par un autre moyen (Dashboard Stripe), déclarez-le ; sinon clôturez sans paiement.`
  if (variant === 'succeeded') {
    return `${MARKERS.REVERTED_AFTER_REFUND} la réclamation a été soldée sur la ligne ${rowId}, mais Stripe rapporte aujourd’hui son remboursement ${re} « ${status} » : il ne verse rien au titre de cette ligne. Notre ligne reste marquée ABOUTIE (le webhook ne la modifie pas). Vérifiez dans le ledger et la reprise de royalty ce qui a pu être écrit pour cette ligne ; révision humaine. ${tail}`
  }
  if (variant === 'failed') {
    return `${MARKERS.REVERTED_AFTER_REFUND} la réclamation a été soldée sur la ligne ${rowId}, mais notre ligne est désormais ÉCHOUÉE avec l’identifiant Stripe ${re} (statut enregistré d’après Stripe : échoué ou annulé) : ce remboursement ne verse rien au titre de cette ligne, et le moteur refuse tout nouveau remboursement sur cette commande tant que cette ligne reste échouée. Vérifiez dans le ledger et la reprise de royalty ce qui a pu être écrit pour cette ligne. ${tail}`
  }
  return `${MARKERS.REVERTED_AFTER_REFUND} la réclamation a été soldée sur la ligne ${rowId}, encore « en attente » dans notre base, mais Stripe rapporte aujourd’hui son remboursement ${re} « ${status} » : il ne verse rien au titre de cette ligne. Cette action ne modifie pas la ligne : si le moteur reprend cette ligne (il reprend la plus ancienne ligne en attente d’une commande avant tout nouveau remboursement), il la marquera en échec, ce qui verrouille la commande. Vérifiez dans le ledger et la reprise de royalty ce qui a pu être écrit pour cette ligne. ${tail}`
}

/** G10 toasts of the R0 outcomes (the console renders them verbatim). */
export const R0_TOASTS = {
  reverted_after_refund: `Preuve trouvée : le remboursement lié à cette réclamation soldée est ÉCHOUÉ ou annulé (d’après Stripe, ou d’après notre ligne marquée échouée avec son identifiant Stripe) — il ne verse rien au titre de cette ligne. La réclamation est marquée ; quand les réclamations sont ouvertes, le client lit « vérification manuelle » ; sinon il ne voit aucune réclamation. Le dossier est clôturable sur déclaration (« Clôturer ce dossier… »).`,
  refund_still_standing: 'Stripe rapporte toujours ce remboursement ABOUTI ou en attente : rien n’a été modifié.',
  refunded_row_unproven: 'La ligne liée n’a pas pu être établie chez Stripe (le détail dit pourquoi) : rien n’a été modifié.',
} as const
/** F14 refund_still_standing, by the Stripe status read (a pending refund is not « ABOUTI »). */
export function refundStillStandingToast(stripeStatus: string | null | undefined): string {
  if (stripeStatus === 'succeeded') return 'Stripe rapporte ce remboursement ABOUTI : rien n’a été modifié.'
  if (stripeStatus === 'pending' || stripeStatus === 'requires_action') return 'Stripe rapporte ce remboursement EN ATTENTE : rien n’a été modifié. Relancez « Réconcilier d’après la preuve » lorsqu’il sera terminal.'
  return R0_TOASTS.refund_still_standing
}
/** G10: a DB call of the marking helper threw. */
export const R0_DB_FAILED = 'La base n’a pas pu être lue ou écrite : rien n’est établi. Réessayez.'

const E1_SENTENCE = (s: string) => `le moteur refuse tout remboursement sur cette commande, dont le statut de paiement enregistré est « ${s} » (« Commande non payée — rien à rembourser. »).`
const E1B_SENTENCE = (piStatus: string) => `le paiement Stripe de cette commande est au statut « ${piStatus} », et le moteur ne rembourse qu’un paiement « succeeded » (« Paiement non débité — rien à rembourser. »).`

/** G8 E3 continuation for one oldest row, by its evidence (the no-row derivation classifies every row it reaches). */
function e3Continuation(evidence: PendingEvidence | undefined, re: string | null): string {
  const ref = re ?? '(sans identifiant Stripe enregistré)'
  switch (evidence) {
    case 'failed_at_stripe':
      // IMPLEMENTATION NOTE (W2) on G8, ER-C24: « reprend cette ligne », never « la reprend » (round-10 PROMISES scan, F15/J-C14 wording).
      return ` ; son remboursement Stripe ${ref} a ÉCHOUÉ ou a été annulé : si le moteur reprend cette ligne, il la marquera en échec, ce qui verrouille la commande.`
    case 'dead':
      return ' : Stripe ne connaît aucun remboursement pour elle et le moteur ne la créera plus (fenêtre d’idempotence expirée) ; il refuse donc sa reprise (« Reprise impossible : la fenêtre d’idempotence Stripe du remboursement initial a expiré… ») ; aucun code de l’application ne retire cette ligne.'
    case 'succeeded_at_stripe':
      return ` : son remboursement Stripe ${ref} est ABOUTI mais la ligne n’est pas finalisée ici ; le moteur finaliserait cette ligne, pas un remboursement de cette réclamation, tant qu’elle reste en attente.`
    case 'succeeded_at_stripe_clawback':
      // IMPLEMENTATION NOTE (W2) on G8, ER-R26: hedged — the clawback applies only if a settlement transfer exists.
      return ` : son remboursement Stripe ${ref} est ABOUTI mais la ligne n’est pas finalisée ici, et sa finalisation peut devoir d’abord reprendre au franchiseur une royalty (si un transfert de règlement existe) : le moteur peut la refuser à chaque appel, et la ligne reste alors en attente ; sa finalisation n’est pas établie.`
    default:
      return '.'
  }
}

/** G8 the E3 sentence: opener (single or tie), continuation by evidence, other pending rows. */
export function e3Sentence(r: Extract<EngineRefusal, { step: 'E3' }>, f: ReapprovalFacts): string {
  const rowOf = (id: string) => f.rows.find((x) => x.id === id)
  const reOf = (id: string): string | null => {
    const t = f.truths[id]
    return t && t.kind === 'at_stripe' ? t.refundId : rowOf(id)?.stripeRefundId ?? null
  }
  const truncated = ' ; Stripe rapporte plus de 100 remboursements sur ce paiement et cette ligne n’a pas d’identifiant Stripe enregistré : le moteur refuse alors la reprise (« Reprise impossible pour l’instant (liste Stripe indisponible) — réessayez. ») ; aucun code de l’application ne retire cette ligne.'
  const cont = (id: string) => (r.engineListTruncated && !rowOf(id)?.stripeRefundId ? truncated : e3Continuation(r.evidenceByRow[id], reOf(id)))
  let text: string
  if (r.oldestRowIds.length === 1) {
    const id = r.oldestRowIds[0]
    const stamp = stampedClaimId(rowOf(id)?.reason) ? rowOf(id)?.reason : null
    text = `la plus ancienne ligne en attente de la commande, ${id}${stamp ? ' (identité ' + stamp + ')' : ''}, est reprise par le moteur avant tout nouveau remboursement` + cont(id)
  } else {
    text = `les plus anciennes lignes en attente de la commande, créées au même instant (${r.oldestRowIds.join(', ')}), sont reprises par le moteur avant tout nouveau remboursement (il prend l’une d’elles)`
      + r.oldestRowIds.map((id, i) => (i === 0 ? '' : ' ;') + ` ligne ${id}` + cont(id).replace(/\.$/, '')).join('') + '.'
  }
  if (r.otherPendingRowIds.length) text = text.replace(/\.$/, '') + ` (ligne(s) aussi en attente : ${r.otherPendingRowIds.join(', ')}).`
  return text
}

/** G8 REFUSAL SENTENCES, the first engine refusal on the facts. */
export function refusalSentence(r: EngineRefusal, f: ReapprovalFacts): string {
  switch (r.step) {
    case 'E1': return E1_SENTENCE(r.paymentStatus)
    case 'E2': return `la ligne ${r.rowIds.join(', ')} est ÉCHOUÉE avec un identifiant Stripe : le moteur refuse tout remboursement sur une commande qui porte une telle ligne, et aucune action des réclamations ne modifie cette ligne.`
    case 'E1b': return E1B_SENTENCE(r.piStatus)
    case 'E3': return e3Sentence(r, f)
    case 'E4': return `le paiement est déjà intégralement remboursé chez Stripe (${r.refundedCents} c sur ${r.chargeAmountCents} c) ; le moteur refuserait (« Paiement déjà intégralement remboursé. »).`
    case 'E5': return `le montant de cette réclamation (${r.requestedAmountCents} c) dépasse ce qui reste remboursable sur ce paiement (${r.refundableCents} c) ; le moteur refuserait (« Montant invalide »).`
    case 'E6': return `le moteur calculerait la clé ${r.key} pour un nouveau remboursement, et la ligne ${r.rowId} la détient déjà ; il refuserait (« Un remboursement est déjà en cours sur ce montant cumulé. ») tant que le montant remboursé rapporté par Stripe reste ${f.amountRefundedCents} c.`
  }
}

/** G8 HOLD SENTENCES. */
export function holdSentence(h: SafetyHold): string {
  switch (h.hold) {
    case 'H1': {
      const re = h.refundId ?? '(sans identifiant Stripe enregistré)'
      const how = h.how === 'absent' ? `son remboursement ${re} est introuvable parmi les remboursements de ce paiement, lus en entier avec la clé qui lit ce paiement`
        : h.how === 'other_payment' ? `son remboursement ${re} porte sur un autre paiement`
          : `son remboursement ${re} est « ${h.stripeStatus ?? 'inconnu'} » chez Stripe`
      return `la ligne ${h.rowId} est marquée ABOUTIE dans notre base, mais Stripe ne la compte pas sur ce paiement (${how}) ; notre base la compte toujours comme remboursée et aucune action de l’application n’est prévue pour la corriger ; l’approbation est refusée par sûreté (blocage de sûreté, pas un refus du moteur).`
    }
    case 'H2': return `sur ce paiement routé, Stripe rapporte un remboursement « ${h.status} » (${h.refundId}) qui ne correspond à aucune ligne de notre base ; le moteur ne le voit pas, et l’approbation est refusée par sûreté (blocage de sûreté).`
    case 'H3': return `la ligne ${h.rowId} (« ${h.rowStatus} » dans notre base) enregistre un remboursement dont la lecture chez Stripe se contredit (${h.detail}) ; l’approbation est refusée par sûreté (blocage de sûreté).`
    case 'H5': return h.cause === 'disputed'
      ? `Stripe rapporte un litige sur la charge ${h.chargeId} de ce paiement : Stripe peut refuser le remboursement après que le moteur a enregistré sa ligne, qui resterait alors en attente et bloquerait la reprise sur cette commande ; l’approbation est refusée par sûreté (blocage de sûreté).`
      : `le montant de cette réclamation (${h.requestedAmountCents} c) dépasse ce qui reste remboursable sur le montant capturé de ce paiement (${h.remainingCapturedCents} c) ; le moteur calcule sur le montant de la charge et enregistrerait sa ligne avant que Stripe refuse, ligne qui resterait en attente ; l’approbation est refusée par sûreté (blocage de sûreté).`
  }
}

/** G8: ROUTED is appended when the causes include E2, E3 failed_at_stripe, H1 reverted or H2. */
export function routedApplies(refusal: EngineRefusal | null, holds: SafetyHold[]): boolean {
  if (refusal?.step === 'E2') return true
  if (refusal?.step === 'E3' && refusal.oldestRowIds.some((id) => refusal.evidenceByRow[id] === 'failed_at_stripe')) return true
  return holds.some((h) => (h.hold === 'H1' && h.how === 'reverted') || h.hold === 'H2')
}

const joinCauses = (sentences: string[]) => sentences.map((s, i) => (i === 0 ? s : `De plus, ${s}`)).join(' ')

/**
 * G8 TEXT = prefix + ' ' + HEAD + tail, for a proof outcome of deriveNoRowOutcome. ctx.preImage and ctx.now
 * feed the C4 instant of a payable proof; T2 never writes a payable proof (it calls the engine instead).
 */
export function absenceProofText(
  o: Extract<NoRowOutcome, { kind: 'proof' }>,
  read: OrderMoneyRead,
  ctx: { preImage: string | null | undefined; now: Date; requestedAmountCents: number },
): string {
  if (o.basis === 'no_charge') {
    const s = read.readable === false && read.permanent === 'no_charge' ? read : null
    const sentence = o.noChargeStep === 'E1' ? E1_SENTENCE(s?.paymentStatus ?? '')
      : o.noChargeStep === 'E1b' ? E1B_SENTENCE(s?.piStatus ?? '')
        : 'le moteur refuserait (« Charge introuvable sur le paiement. »).'
    return `${o.prefix} Le paiement Stripe de cette commande n’a pas de charge : aucun remboursement ne peut exister sur ce paiement. ${LOCKED_OPEN} ${sentence} ${LOCKED_CLOSE}`
  }
  if (!read.readable) return `${o.prefix} ${LOCKED_OPEN} ${LOCKED_CLOSE}` // unreachable: a verdict proof needs readable facts
  const f = read.facts
  const head = o.explained.length ? headB(f.amountRefundedCents, o.explained) : HEAD_A
  if (o.verdict === 'payable') return `${o.prefix} ${head} ${payableTail(ctx.requestedAmountCents, proofInstantFor(ctx.preImage, ctx.now))}`
  const v = o.verdict
  if (o.prefix === MARKERS.AWAITING_FINALIZATION && v.refusal?.step === 'E3') {
    return `${o.prefix} ${head} ${AWAITING_OPEN} ${e3Sentence(v.refusal, f)} ${AWAITING_CLOSE}`
  }
  const causes = [...(v.refusal ? [refusalSentence(v.refusal, f)] : []), ...v.holds.map(holdSentence)]
  const routed = routedApplies(v.refusal, v.holds) ? routedSentence(f.routed) : ''
  return [`${o.prefix} ${head}`, LOCKED_OPEN, joinCauses(causes), routed, LOCKED_CLOSE].filter(Boolean).join(' ')
}

/** C3 (b')/(c): the SAFETY_HOLD text around a clause S. */
export function safetyHoldText(clause: string): string {
  return `${MARKERS.SAFETY_HOLD} Aucun remboursement n’a été lancé pour cette réclamation : ${clause} Décision humaine requise ; « Clôturer ce dossier… » enregistre votre déclaration.`
}

export const LIST_OVER_CAP_CLAUSE = 'Stripe rapporte plus de 1 000 remboursements sur ce paiement : leur liste complète ne peut pas être lue, et aucune vérification n’est établie.'

/**
 * C3 (b') S for no_charge: the FIRST refusal refund.ts reaches on the facts — E1 (unpaid, or no PaymentIntent),
 * else E2 (a failed row with a Stripe id precedes the PI read, ER-M11/ER-M13), else E1b, else E1c.
 */
export function noChargeClause(read: Extract<OrderMoneyRead, { permanent: 'no_charge' }>): string {
  const head = 'le paiement Stripe de cette commande n’a pas de charge : aucune vérification ne peut être lue, et le moteur refuserait'
  if ((read.paymentStatus !== 'paid' && read.paymentStatus !== 'reconcile_manual') || read.hasPaymentIntent === false) {
    return `${head} (« Commande non payée — rien à rembourser. »).`
  }
  const failed = read.rows.filter((r) => r.status === 'failed' && !!r.stripeRefundId)
  if (failed.length) {
    return `${head} : la ligne ${failed.map((r) => r.id).join(', ')} est ÉCHOUÉE avec un identifiant Stripe, et le moteur refuse tout remboursement sur une commande qui porte une telle ligne ; aucune action des réclamations ne modifie cette ligne.`
  }
  if (read.piStatus !== 'succeeded') return `${head} (« Paiement non débité — rien à rembourser. »).`
  return `${head} (« Charge introuvable sur le paiement. »).`
}

/** C3 (c): the hold sentences (the first plain, the others « De plus, ») and ROUTED. */
export function holdsClause(holds: SafetyHold[], routed: boolean | null): string {
  const r = routedApplies(null, holds) ? routedSentence(routed) : ''
  return [joinCauses(holds.map(holdSentence)), r].filter(Boolean).join(' ')
}
