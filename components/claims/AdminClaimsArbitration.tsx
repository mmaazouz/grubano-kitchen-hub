'use client'

// P4.5-C2 — admin arbitration console (neutral third party). Lists contested claims with
// both parties' evidence + read-only abuse signals, and decides each: approve (→ engine
// refund) or confirm the refusal. Renders nothing when CLAIMS_ENABLED is OFF.

import { useState, useEffect, useCallback } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Button, Badge, EmptyState, useToast } from '@/components/design-system'
import { formatEuros } from '@/lib/format-money'
// ROUND 13 (H07, H11): the customer e-mail result of a decision or a declaration, as a toast.
import { customerEmailLine } from '@/lib/claim-email-toast'

// D′ L4 (spec v2 §7.4, T-07 / T-09): the confirmation words and the minimum motive lengths belong to the
// SERVER's contract (lib/claim-action-rules). They are IMPORTED, never retyped: a console that validated
// its own copy of the rule would go silently out of step with the route that actually refuses.
import {
  moneyStateGuidance, absenceProvenPayableLabel,
  APPROVE_CONFIRM_WORD, WITHDRAW_CONFIRM_WORD, PAY_CONFIRM_WORD, REDUCE_REASON_MIN, WITHDRAW_REASON_MIN,
} from '@/lib/claim-action-rules'
import { amountLineKind, identityUnreadText, BOUND_REVERTED_TEXT } from '@/lib/claim-money-line'

// D′ L5 (spec v2 §8.2 / §8.6): the rail's own vocabulary — the closed set of per-claim outcomes, the
// preflight causes and the batch counters. TYPE-ONLY, so none of the rail's server code is bundled
// here; the console names what the route answers instead of keeping a second copy of the list.
import type { RailOutcome, PreflightHold, RailCounts } from '@/lib/claims-pay-rail'

type Stats = { recent?: number; approvalRate?: number; flagged?: boolean; refused?: number; overturned?: number }
type Claim = {
  id: string; orderId: string; reason: string; requestedAmountCents: number
  description?: string | null; restaurantResponseReason?: string | null; contestReason?: string | null; photoUrl?: string | null
  /** ROUND 13 (F08): whether the restaurant accepted or refused — its note is labelled accordingly. */
  restaurantResponse?: string | null
  consumerStats?: Stats; restaurantStats?: Stats
  /** Server-side safety triage — this queue carries the decision buttons, so it says so here too. */
  safety?: boolean
  /** ROUND-9 (parity): the server's own refusal message for each decision, or null (lib/claim-action-rules). */
  approveRefusal?: string | null
  refuseFinalRefusal?: string | null
}
// P0-39 — réclamation EN ATTENTE du restaurant (lecture seule : l'admin VOIT,
// aucune action possible — Q3 interdit de se substituer au restaurant).
type PendingClaim = {
  id: string; orderId: string; reason: string; requestedAmountCents: number
  description?: string | null; createdAt: string; responseDeadlineAt: string
  /** Batch 2: the server triages safety reports to the top and says which they are. */
  safety?: boolean
}
// CLAIMS BATCH 2 — money that needs a human. Batch 1 exposed this through the API but the
// console never read it, so a stuck refund stayed invisible exactly where it matters.
type MoneyState =
  | 'stripe_pending' | 'stripe_failed' | 'stripe_succeeded_claim_unreconciled'
  | 'stale_refunding_no_refund_row' | 'refund_error_recorded' | 'approved_not_driven'
  // T-49: an interrupted attempt whose refund identity was never bound, or a claim parked
  // in FINANCIAL VERIFICATION. Money truth unknown — never asserted either way.
  | 'reconcile_required'
  // W3 round-2 fix (D0 / D5): the marker's start instant cannot be read — reconcile refused, no exit.
  | 'reconcile_marker_unreadable'
  // ROUND-6 AUDIT FIX (P2): the reconciler PROVED nothing ever left. A success, not an error.
  | 'absence_proven_payable'
  // ROUND-8 AUDIT FIX (P1): our row is pending with NO Stripe id — nothing is confirmed at Stripe.
  | 'local_pending_unconfirmed'
  // MODE B commit B: the bound row was released — proven never established at Stripe.
  | 'row_voided'
type ActionableRefundClaim = {
  id: string; orderId: string; reason: string; requestedAmountCents: number; status: string
  moneyState: MoneyState; safety?: boolean; refundError?: string | null
  /** The server says whether the escape hatch would accept this row — never guessed here. */
  resolvable?: boolean
  /** ROUND-9: whether the reconcile gate admits this claim (same rule as the route). */
  reconcilable?: boolean
  /** ROUND-6 AUDIT FIX (P1): a refund is bound, and the engine established it is NOT this claim's. */
  refundNotOurs?: boolean
  /** ROUND 13 (F15, A-S36-1): a resume_mismatch on a row that carries THIS claim's stamp. */
  refundIdentityUnread?: boolean
  actualRefundedCents: number | null
  refund: { id: string; status: string; actualAmountCents: number; stripeRefundId: string | null } | null
}

/**
 * D′ L4 (spec v2 §7.4 / §8.5) — a claim whose decision is TAKEN and whose money has not moved, as
 * GET /api/admin/claims serialises lib/claims' `AwaitingPaymentRow` (Date → ISO string over JSON).
 * `approvedAmountCents` is ABSENT on a ratification row: those claims were approved before the amount
 * existed, which is exactly why they are listed apart — nothing can pay a decision with no amount.
 */
type AwaitingPaymentRow = {
  id: string
  /** The customer-facing reference; the raw order id never reaches this list. */
  orderRef: string
  orderId: string
  requestedAmountCents: number
  approvedAmountCents?: number | null
  /** The FIFO key of the queue: the instant the decision was taken. */
  arbitratedAt?: string | null
  arbitrationReason?: string | null
  createdAt: string
}

/** What the mandatory approval dialog is deciding: a first decision, or the ratification of a legacy approval. */
type ApproveTarget = { id: string; orderLabel: string; requestedAmountCents: number; mode: 'approve' | 'ratify' }

/** The read-only ceiling of GET /api/admin/claims/[id]/ceiling. It DECIDES nothing — it is displayed. */
type Ceiling = {
  /** Whose ceiling this is. A slow response for a dialog the admin already closed must never be shown
   *  beside another claim's numbers — an amount decided against the wrong ceiling is a money mistake. */
  claimId: string
  requestedAmountCents: number
  approvedAmountCents: number | null
  maxRefundableCents: number
  alreadyRefundedCents: number
  /** T-59: false ⇒ Stripe was NOT read (or the charge is disputed) — the cap may be TOO HIGH. */
  ceilingVerified: boolean
  approvalBoundCents: number
}

/**
 * D′ L5 (spec v2 §8.2) — one row of a dryRun, as POST /api/admin/claims/pay-approved serialises it.
 * `payable` is the ONLY thing that puts a claim in the batch: a held row is listed, with its cause, and
 * is never added to a total. `hold` is the preflight cause; when it is null on a refused row, the row's
 * SHAPE refused it and the clause travels in `holdDetail`.
 */
type DryRunRow = {
  claimId: string
  orderId: string
  orderRef: string
  requestedAmountCents: number
  approvedAmountCents: number | null
  arbitratedAt: string | null
  payable: boolean
  hold: PreflightHold | null
  holdDetail: string | null
}

/** A dryRun answer. `token` is null ⇔ nothing is payable: there is then nothing signed, so nothing to pay. */
type DryRun = {
  sha: string
  claims: DryRunRow[]
  payableCount: number
  heldCount: number
  totalPayableCents: number
  lease:
    | { open: true; expiresAt: string; remainingMs: number; usable: boolean }
    | { open: false; reason: string; usable: false }
  surfaceEnabled: boolean
  auditEnabled: boolean
  token: string | null
  tokenExpiresAt: string | null
}

/** One line of the per-claim report of a PAYER batch (spec v2 §8.6). */
type PayRow = {
  claimId: string
  orderRef: string
  approvedAmountCents: number
  outcome: RailOutcome
  refundRowId: string | null
  /** What the engine actually refunded, read off the row it drove — never the approved figure. */
  engineAmountCents: number | null
  stripeRefundId: string | null
  error: string | null
  until: string | null
  evidence: string | null
  customerEmail: { status?: string; why?: string } | null
}

type PayReport = {
  stoppedBy: 'lease_expired' | 'crashed' | 'budget' | null
  leaseExpiresAt: string | null
  items: PayRow[]
  counts: RailCounts
}

/**
 * D′ L5 (spec v2 §8.6) — one i18n key and one tone per rail outcome. Declared as a TOTAL Record: an
 * outcome added to lib/claims-pay-rail without its sentence fails the build HERE, instead of printing a
 * raw engine literal to the one person reading the screen to decide whether money moved.
 */
const OUTCOME: Record<RailOutcome, { key: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  paid:                             { key: 'paid',                        tone: 'success' },
  accepted_pending:                 { key: 'acceptedPending',             tone: 'warning' },
  lease_closed:                     { key: 'leaseClosed',                 tone: 'neutral' },
  state_changed_since_dryrun:       { key: 'stateChanged',                tone: 'warning' },
  superseded:                       { key: 'superseded',                  tone: 'warning' },
  'not_paid:amount_not_ratified':   { key: 'notPaidAmountNotRatified',    tone: 'warning' },
  'not_paid:engine_failed':         { key: 'notPaidEngineFailed',         tone: 'danger'  },
  'held:safety_hold':               { key: 'heldSafetyHold',              tone: 'warning' },
  'held:proof_stale':               { key: 'heldProofStale',              tone: 'warning' },
  'held:own_row_exists':            { key: 'heldOwnRowExists',            tone: 'warning' },
  'held:unconfirmed_within_window': { key: 'heldUnconfirmedWithinWindow', tone: 'warning' },
  'held:safety_check_unreadable':   { key: 'heldSafetyCheckUnreadable',   tone: 'warning' },
  // The three buckets where money MAY have left: they are `danger`, and their copy asks for proof.
  'review:resume_mismatch':         { key: 'reviewResumeMismatch',        tone: 'danger'  },
  'review:identity_unverified':     { key: 'reviewIdentityUnverified',    tone: 'danger'  },
  'review:engine_own_row':          { key: 'reviewEngineOwnRow',          tone: 'danger'  },
  crashed:                          { key: 'crashed',                     tone: 'danger'  },
  not_attempted:                    { key: 'notAttempted',                tone: 'neutral' },
  'skipped:stale_dryrun':           { key: 'skippedStaleDryRun',          tone: 'neutral' },
  'skipped:not_selectable':         { key: 'skippedNotSelectable',        tone: 'neutral' },
  // Not « neutral »: a read that failed is a fact the admin should chase, not a quiet outcome.
  'skipped:claim_unreadable':       { key: 'skippedClaimUnreadable',      tone: 'warning' },
}

/** The preflight causes of a dryRun (spec v2 §8.2), each with its own sentence. */
const HOLD: Record<PreflightHold, string> = {
  routed_without_fee:    'routedWithoutFee',
  funding_unreadable:    'fundingUnreadable',
  exceeds_refundable:    'exceedsRefundable',
  ceiling_unreadable:    'ceilingUnreadable',
  order_has_pending_row: 'orderHasPendingRow',
  amount_not_ratified:   'amountNotRatified',
  not_selectable:        'notSelectable',
}

/** Why `refundGateState()` reports no window (lib/refund). An unknown value is said as unknown. */
const LEASE_REASON: Record<string, string> = {
  flag_off:         'flagOff',
  no_lease:         'noLease',
  lease_unreadable: 'leaseUnreadable',
  lease_expired:    'leaseExpired',
  lease_too_long:   'leaseTooLong',
}

/** What the rail stopped a batch on, when it did (spec v2 §8.6). */
const STOPPED: Record<'lease_expired' | 'crashed' | 'budget', string> = {
  lease_expired: 'leaseExpired',
  crashed:       'crashed',
  budget:        'budget',
}

/**
 * The clause of the payable shape that refused a claim (lib/claims-pay-rail payableShapeRefusal), said in
 * the admin's language. These are internal tokens; rendering them raw inside a French sentence is how an
 * English identifier ends up on a console. An unknown token falls back to itself rather than to silence.
 */
const CLAUSES = new Set([
  'status', 'arbitration_decision', 'refund_attempted', 'refund_id',
  'amount_not_ratified', 'refund_error', 'v13_before_instant', 'not_found', 'claim_unreadable',
])
const clauseOf = (token: string | null, t: (k: string) => string): string => {
  if (!token) return '—'
  return CLAUSES.has(token) ? t('admin.payBatch.clause.' + token) : token
}

/** How an ambiguous engine refusal was classified (lib/claims-pay-rail), when the rail says so. */
const EVIDENCE: Record<string, string> = {
  claim_reread:          'claimReread',
  claim_unreadable:      'claimUnreadable',
  engine_called_unknown: 'engineCalledUnknown',
  identity_moved:        'identityMoved',
}

/**
 * The euro amount the admin typed → integer cents. The French decimal comma is accepted, and the rounding
 * closes the float door (12,30 € → 1230, never 1229). A non-usable input yields null, which keeps the
 * submit button inactive — the server revalidates the number in any case (S-10).
 */
function parseCents(raw: string): number | null {
  const n = Number(raw.replace(',', '.').trim())
  if (!Number.isFinite(n)) return null
  return Math.round(n * 100)
}

/**
 * `initial` (ROUND 13, slice W7): the GET /api/admin/claims payload a test renders the console with (J-M29 control parity).
 * The page mounts the console without it; the load below then reads the route.
 */
// D′ L1: `surfaceOpen` (the claims SURFACE as the server page read it) only chooses the empty-state copy — the
// lists themselves come from GET /api/admin/claims, split server-side; the money list is returned either way.
export default function AdminClaimsArbitration({ initial, surfaceOpen = true }: { initial?: { claims?: Claim[]; pending?: PendingClaim[]; actionableRefunds?: ActionableRefundClaim[]; awaitingPayment?: AwaitingPaymentRow[]; awaitingRatification?: AwaitingPaymentRow[] }; surfaceOpen?: boolean } = {}) {
  const t = useTranslations('claims')
  const locale = useLocale()
  const toast = useToast()
  const [claims, setClaims] = useState<Claim[]>(initial?.claims ?? [])
  const [pending, setPending] = useState<PendingClaim[]>(initial?.pending ?? [])
  const [actionableRefunds, setActionableRefunds] = useState<ActionableRefundClaim[]>(initial?.actionableRefunds ?? [])
  // D′ L4 (§8.5): the two D′ queues, split server-side. « À rembourser » is MONEY and is returned even when
  // the claims surface is closed; « À ratifier » is workflow and comes back empty in that case.
  const [awaitingPayment, setAwaitingPayment] = useState<AwaitingPaymentRow[]>(initial?.awaitingPayment ?? [])
  const [awaitingRatification, setAwaitingRatification] = useState<AwaitingPaymentRow[]>(initial?.awaitingRatification ?? [])
  const [loaded, setLoaded] = useState(!!initial)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [refusingId, setRefusingId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  // BATCH 2 — the stuck-money control. `resolveStuckClaim` existed with no door; this is it.
  const [stuckId, setStuckId] = useState<string | null>(null)
  const [stuckReason, setStuckReason] = useState('')
  // ── D′ L4 — the APPROVAL dialog. One target at a time: an approval fixes an amount, so it is never a
  //    side effect of a click, and two half-filled forms open at once is how the wrong amount gets sent.
  const [approveTarget, setApproveTarget] = useState<ApproveTarget | null>(null)
  const [approveAmount, setApproveAmount] = useState('')
  const [reduceOn, setReduceOn] = useState(false)
  const [reduceReason, setReduceReason] = useState('')
  const [approveConfirm, setApproveConfirm] = useState('')
  /** The SERVER's refusal (400/409/503), shown inside the dialog: the client form is a convenience, not the authority. */
  const [approveError, setApproveError] = useState<string | null>(null)
  const [ceiling, setCeiling] = useState<Ceiling | null>(null)
  const [ceilingError, setCeilingError] = useState<string | null>(null)
  const [ceilingLoading, setCeilingLoading] = useState(false)
  // ── D′ L4 (T-09) — the audited reversal of a decision, before any money moved.
  const [withdrawId, setWithdrawId] = useState<string | null>(null)
  const [withdrawReason, setWithdrawReason] = useState('')
  const [withdrawConfirm, setWithdrawConfirm] = useState('')
  const [withdrawError, setWithdrawError] = useState<string | null>(null)
  // ── D′ L5 (spec v2 §8.2) — THE FINANCIAL RAIL, in two calls. `dryRun` is the simulation currently on
  //    screen, with the token that signs it; `payReport` is the per-claim report of the last batch. A
  //    payment NEVER runs off the queue above: it runs off the list the admin has just read.
  const [dryRun, setDryRun] = useState<DryRun | null>(null)
  const [dryRunError, setDryRunError] = useState<string | null>(null)
  const [simulating, setSimulating] = useState(false)
  const [payOpen, setPayOpen] = useState(false)
  const [payConfirm, setPayConfirm] = useState('')
  const [payError, setPayError] = useState<string | null>(null)
  const [paying, setPaying] = useState(false)
  const [payReport, setPayReport] = useState<PayReport | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/claims')
      if (!res.ok) return
      const data = await res.json()
      setClaims(Array.isArray(data.claims) ? data.claims : [])
      setPending(Array.isArray(data.pending) ? data.pending : [])
      setActionableRefunds(Array.isArray(data.actionableRefunds) ? data.actionableRefunds : [])
      setAwaitingPayment(Array.isArray(data.awaitingPayment) ? data.awaitingPayment : [])
      setAwaitingRatification(Array.isArray(data.awaitingRatification) ? data.awaitingRatification : [])
    } catch { /* ignore */ } finally { setLoaded(true) }
  }, [])
  useEffect(() => { load() }, [load])

  // D′ L4 (T-07): an approve now carries the DECIDED amount, the typed confirmation, and the motive of a
  // reduction — collected by the dialog below. `extra` is spread as-is: the route's zod schema and
  // lib/claims revalidate every field against the claim itself, so nothing here is an authority.
  const decide = useCallback(async (
    id: string,
    decision: 'approve' | 'refuse_final',
    r?: string,
    extra?: { approvedAmountCents?: number; confirm?: string; reduceReason?: string },
  ) => {
    setBusyId(id)
    if (decision === 'approve') setApproveError(null)
    try {
      const res = await fetch(`/api/admin/claims/${id}/arbitrate`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, reason: r, ...(extra ?? {}) }),
      })
      const data = await res.json().catch(() => ({}))
      // The server is the authority on an approval: its 400 / 409 / 503 text stays in the dialog, beside the
      // field that caused it, instead of vanishing with a toast the admin may already have dismissed.
      if (!res.ok) { if (decision === 'approve') setApproveError(data.error || t('admin.processing')); toast.error(data.error || t('admin.processing')); return }
      // D′ L2 (spec v2 S-02, F13 v1.1): an approval is a DECISION and moves no money — the route returns no
      // engine outcome any more, so the only honest toast is the nominal « décision enregistrée, aucun
      // remboursement lancé par cette action ». The rail (D′ L5) reports its own per-claim outcomes.
      if (decision !== 'approve') {
        toast.success(t('admin.refusedFinalDone'))
      } else {
        toast.success(t('admin.approvedNotSent'))
      }
      // ROUND 13 (H07, H11): what happened to the customer e-mail of this decision.
      const e = customerEmailLine((data as { customerEmail?: { status?: string; why?: string } | null }).customerEmail)
      if (e) toast[e.tone](t(`admin.customerEmail.${e.key}`))
      setRefusingId(null); setReason('')
      // D′ L4: the dialog closes only on a WON decision — a refused one keeps the typed amount on screen
      // beside the server's reason, so the admin corrects it instead of retyping everything from memory.
      setApproveTarget(null); setApproveConfirm(''); setReduceOn(false); setReduceReason('')
      await load()
    } catch {
      toast.error(t('admin.processing'))
    } finally { setBusyId(null) }
  }, [load, t, toast])

  // Closes a stuck money case by stating what is TRUE. It NEVER moves money and never retries:
  // the engine's cumulative cursor may already have advanced, so a blind re-drive could
  // double-refund. The route is deliberately NOT gated by CLAIMS_ENABLED.
  const resolveStuck = useCallback(async (id: string, resolution: 'settled_out_of_band' | 'closed_no_payment') => {
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/claims/${id}/resolve-stuck`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resolution, reason: stuckReason || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error((data as { error?: string }).error || 'Échec de la clôture.'); return }
      // ROUND-7 AUDIT FIX (P1): these said « client payé hors rail » and « Aucun argent n’a bougé »
      // in the SYSTEM's voice. The route reads no Refund row and no Stripe object — it records an
      // operator DECLARATION. The first is now attributed; the second is scoped to this action,
      // because on a disowned-binding row that followed a Stripe SUCCESS the engine itself recorded
      // that money moved (for somebody else) — this action cannot speak for the order.
      toast.success(resolution === 'settled_out_of_band'
        ? 'Dossier clôturé sur votre déclaration (payé autrement, hors système). Cette action n’a déplacé aucun argent et n’a rien vérifié chez Stripe.'
        : 'Dossier clôturé sans paiement, sur votre déclaration. Cette action n’a déplacé aucun argent ; elle ne dit rien des remboursements déjà présents sur la commande.')
      // ROUND-11 AUDIT FIX (P3): the note lives only in the admin audit, which is best effort.
      if ((data as { noteRecorded?: boolean | null }).noteRecorded === false) toast.error('Votre note n’a pas pu être enregistrée dans le journal d’audit : conservez-la ailleurs.')
      // ROUND 13 (H07, H11): what happened to the closure notice of this declaration.
      const e = customerEmailLine((data as { customerEmail?: { status?: string; why?: string } | null }).customerEmail)
      if (e) toast[e.tone](t(`admin.customerEmail.${e.key}`))
      setStuckId(null); setStuckReason('')
      await load()
    } catch {
      toast.error('Échec de la clôture.')
    } finally { setBusyId(null) }
  }, [load, stuckReason, t, toast])

  // ── D′ L4 (spec v2 §7.4) — OPENING THE APPROVAL DIALOG ────────────────────────────────────────
  // Reading the ceiling is part of opening it: the admin must see what is already refunded on the order
  // and what is still refundable BEFORE choosing a number. The read is advisory — the server's bound is
  // the REQUESTED amount (S-10) — so a ceiling that cannot be read never blocks the decision; it is said.
  const openApprove = useCallback(async (target: ApproveTarget) => {
    setRefusingId(null); setWithdrawId(null); setWithdrawError(null)
    setApproveTarget(target)
    setApproveError(null); setReason('')
    setReduceOn(false); setReduceReason(''); setApproveConfirm('')
    setApproveAmount((target.requestedAmountCents / 100).toFixed(2))
    setCeiling(null); setCeilingError(null); setCeilingLoading(true)
    try {
      const res = await fetch(`/api/admin/claims/${target.id}/ceiling`)
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setCeilingError((data as { error?: string }).error || t('admin.approveDialog.ceilingError')); return }
      setCeiling(data as Ceiling)
    } catch {
      setCeilingError(t('admin.approveDialog.ceilingError'))
    } finally { setCeilingLoading(false) }
  }, [t])

  const closeApprove = useCallback(() => {
    setApproveTarget(null); setApproveError(null); setApproveConfirm('')
    setReduceOn(false); setReduceReason(''); setReason('')
    setCeiling(null); setCeilingError(null); setCeilingLoading(false)
  }, [])

  // ── D′ L4 (spec v2 T-09) — WITHDRAWING AN APPROVAL ────────────────────────────────────────────
  // The ONLY legitimate way to change an amount already fixed. It moves no money and never writes a
  // refusal: the claim goes back to the arbitration queue and a human decides again. Every precondition
  // lives in the route (a real attempt, a stamped Refund row, a disabled audit trail, a lost race all
  // refuse), so this handler only collects the motive kept in the audit row and the typed confirmation.
  const withdrawApproval = useCallback(async (id: string) => {
    setBusyId(id); setWithdrawError(null)
    try {
      const res = await fetch(`/api/admin/claims/${id}/withdraw-approval`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: withdrawReason.trim(), confirm: withdrawConfirm.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const message = (data as { error?: string }).error || t('admin.processing')
        setWithdrawError(message); toast.error(message); return
      }
      toast.success(t('admin.withdraw.done'))
      // ROUND 13 (H07, H11): what happened to the customer notice of this reversal.
      const e = customerEmailLine((data as { customerEmail?: { status?: string; why?: string } | null }).customerEmail)
      if (e) toast[e.tone](t(`admin.customerEmail.${e.key}`))
      setWithdrawId(null); setWithdrawReason(''); setWithdrawConfirm('')
      await load()
    } catch {
      toast.error(t('admin.processing'))
    } finally { setBusyId(null) }
  }, [load, t, toast, withdrawConfirm, withdrawReason])

  // ── D′ L5 (spec v2 §8.2) — THE SIMULATION ─────────────────────────────────────────────────────
  // Read-only on both sides: it needs neither an open window nor the product flag, because an admin
  // must be able to see what is waiting — and why a claim would be held — BEFORE anyone opens
  // anything. It writes nothing, it pays nothing, and the token it brings back is what makes the
  // payment possible at all: the rail pays a list that was read, never a query run again later.
  const simulate = useCallback(async () => {
    setSimulating(true); setDryRunError(null); setPayError(null); setPayReport(null)
    setPayOpen(false); setPayConfirm('')
    try {
      const res = await fetch('/api/admin/claims/pay-approved', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dryRun: true }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setDryRun(null); setDryRunError((data as { error?: string }).error || t('admin.payBatch.dryRunFailed')); return }
      setDryRun(data as DryRun)
    } catch {
      setDryRun(null); setDryRunError(t('admin.payBatch.dryRunFailed'))
    } finally { setSimulating(false) }
  }, [t])

  // ── D′ L5 (spec v2 §8.2) — THE PAYMENT ────────────────────────────────────────────────────────
  // It sends the signed batch back and nothing else: the rail pays exactly those claims, in that
  // order, re-reading each one first. A refusal (400 / 403 / 409) is taken BEFORE anything is read,
  // which is the one case where « nothing was attempted » is a fact the console may state. An answer
  // that never arrives is NOT that case, and says so instead of guessing.
  // The simulation is spent either way — a second click can never replay a batch from this screen.
  const payApproved = useCallback(async () => {
    const token = dryRun?.token
    if (!token) return
    setPaying(true); setPayError(null)
    try {
      const res = await fetch('/api/admin/claims/pay-approved', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ confirm: PAY_CONFIRM_WORD, token }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        // « Refused before any read » is only true of a refusal THIS RAIL produced — each one carries a
        // `reason` and a status below 500, and each one happens before a claim is offered to the engine.
        // A 502, a 504 or a proxy page is not that: it can arrive after claims were paid, so it falls back
        // to the « answer lost » wording, which asserts nothing about what the batch did.
        const refusal = (data as { reason?: string; error?: string })
        const isOwnRefusal = res.status < 500 && typeof refusal.reason === 'string' && refusal.reason.length > 0
        setPayError(isOwnRefusal ? (refusal.error || t('admin.payBatch.refused')) : t('admin.payBatch.answerLost'))
        return
      }
      setPayReport(data as PayReport)
    } catch {
      setPayError(t('admin.payBatch.answerLost'))
    } finally {
      setDryRun(null); setPayOpen(false); setPayConfirm(''); setPaying(false)
      // §7.4: the queue is re-read after a batch — a claim that was paid must leave « À rembourser ».
      await load()
    }
  }, [dryRun, load, t])

  // V5-3 — une demande dont le reason porte le marqueur P0-08 'system_' a été
  // créée par le SYSTÈME (rail remboursement d'annulation), pas par le client :
  // ses étiquettes doivent le dire. Une demande client garde les siennes.
  const isSystemClaim = (reason: string) => reason.startsWith('system_')

  // P0-39 — ancienneté lisible dans la locale de l'admin (heures < 48 h, sinon jours).
  const ageOf = (iso: string) => {
    const hours = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000))
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'always' })
    return hours < 48 ? rtf.format(-hours, 'hour') : rtf.format(-Math.floor(hours / 24), 'day')
  }
  // D′ L4: the ids the two D′ sections already render, so the arbitration list does not repeat them.
  const dprimeIds = new Set([...awaitingPayment.map((r) => r.id), ...awaitingRatification.map((r) => r.id)])

  const isOverdue = (p: PendingClaim) => new Date(p.responseDeadlineAt).getTime() < Date.now()

  // D′ L4 — the DECISION instant, absolute (the « À rembourser » queue is FIFO on it, so « il y a 3 h »
  // would hide the ordering the list is built on). null when the row carries no readable instant.
  const instantOf = (iso: string | null | undefined) => {
    if (!iso) return null
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? null : new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(d)
  }

  // CLAIMS BATCH 2 — a stuck refund is never "nothing to do": it must count here too, or the
  // console shows an empty state while money is waiting on a human.
  // D′ L4: the two D′ queues count as well — a decided, unpaid claim behind an « aucune réclamation »
  // empty state is exactly the silence this lot exists to remove.
  if (loaded && claims.length === 0 && pending.length === 0 && actionableRefunds.length === 0
      && awaitingPayment.length === 0 && awaitingRatification.length === 0) {
    return <EmptyState emoji="⚖️" title={t(surfaceOpen ? 'admin.empty' : 'admin.surfaceClosedEmpty')} />
  }

  // ── D′ L4 (spec v2 §7.4) — THE MANDATORY APPROVAL DIALOG ──────────────────────────────────────
  // An approval FIXES AN AMOUNT that a separate financial rail will later pay. It therefore shows the
  // three numbers that make the choice informed — what the customer asked, what has ALREADY been
  // refunded on the order, and what is still refundable — and it demands the server's confirmation word
  // typed in full, plus a motive whenever the approved amount goes below the requested one.
  // It is rendered by the arbitration queue AND by the ratification sub-list: same endpoint, same rules
  // (D1 v1.1 'ratify'), so there is exactly one place where an amount can be decided.
  const approveDialog = () => {
    if (!approveTarget) return null
    const requested = approveTarget.requestedAmountCents
    const ratify = approveTarget.mode === 'ratify'
    // Unchecked box ⇒ the approved amount IS the requested one: the full-amount case can never be
    // mistyped, and the reduction is a deliberate, motivated branch rather than a slip of the keyboard.
    const cents = reduceOn ? parseCents(approveAmount) : requested
    const reduced = cents != null && cents < requested
    const amountOk = cents != null && cents >= 1 && cents <= requested
    const motiveOk = !reduced || reduceReason.trim().length >= REDUCE_REASON_MIN
    const confirmOk = approveConfirm.trim() === APPROVE_CONFIRM_WORD
    // §7.4 « avertissement BLOQUANT si > reste ». It blocks only when a ceiling was actually read: the
    // DB-derived ceiling ignores refunds issued outside the rail, so it is an OVER-estimate — an amount
    // above it is certainly unpayable, and letting it through would mint a decision the rail must fail.
    // When the ceiling could not be read at all there is no number to block against, so the dialog warns
    // and lets the admin decide (a missing read must not veto a legitimate decision).
    // Guarded at RENDER: whatever was fetched is only shown, and only blocks, when it belongs to the
    // claim currently in the dialog. A response that arrives after the admin moved on is simply ignored.
    const ceilingShown = ceiling != null && ceiling.claimId === approveTarget.id ? ceiling : null
    const aboveRemaining = ceilingShown != null && cents != null && cents > ceilingShown.maxRefundableCents
    const valid = amountOk && motiveOk && confirmOk && !aboveRemaining
    return (
      <div className="mt-3 space-y-3 rounded-grubano-lg border border-grubano-border-strong bg-grubano-surface-muted p-3">
        <p className="text-sm font-bold text-grubano-ink">{t(ratify ? 'admin.approveDialog.titleRatify' : 'admin.approveDialog.title')}</p>
        <dl className="space-y-1 text-[13px] text-grubano-ink-muted">
          <p><span className="font-semibold">{t('admin.order')}:</span> {approveTarget.orderLabel}</p>
          <p><span className="font-semibold">{t('admin.approveDialog.requested')}:</span> {formatEuros(requested / 100, locale)}</p>
          {ceilingLoading && <p>{t('admin.approveDialog.ceilingLoading')}</p>}
          {ceilingError && <p className="text-red-700">{ceilingError}</p>}
          {ceilingShown && (
            <>
              <p><span className="font-semibold">{t('admin.approveDialog.alreadyRefunded')}:</span> {formatEuros(ceilingShown.alreadyRefundedCents / 100, locale)}</p>
              <p><span className="font-semibold">{t('admin.approveDialog.remaining')}:</span> {formatEuros(ceilingShown.maxRefundableCents / 100, locale)}</p>
              {!ceilingShown.ceilingVerified && (
                // T-59: without a Stripe read (or on a disputed charge) that number is derived from OUR
                // rows alone. A refund issued outside the rail makes it TOO HIGH, so it is worded as an
                // unconfirmed estimate — never as cash the admin can count on.
                <p className="text-amber-800">{t('admin.approveDialog.remainingUnverified')}</p>
              )}
            </>
          )}
        </dl>

        {/* §7.4: BLOCKING when a ceiling was read (see `aboveRemaining` above) — the remaining amount is an
            over-estimate, so exceeding it means the rail could not pay this decision. The server keeps its own
            bound (the requested amount, S-10); this guard only stops a decision that is already unpayable. */}
        {aboveRemaining && (
          <p className="text-[13px] font-semibold text-amber-800">{t('admin.approveDialog.aboveRemaining')}</p>
        )}

        <label className="flex items-start gap-2 text-[13px] text-grubano-ink">
          <input
            type="checkbox"
            checked={reduceOn}
            className="mt-[3px]"
            onChange={(e) => {
              setReduceOn(e.target.checked)
              if (!e.target.checked) { setApproveAmount((requested / 100).toFixed(2)); setReduceReason('') }
            }}
          />
          <span>{t('admin.approveDialog.reduceCheckbox')}</span>
        </label>

        {reduceOn && (
          <div className="space-y-2">
            <label className="block text-[13px] font-semibold text-grubano-ink" htmlFor="claim-approved-amount">
              {t('admin.approveDialog.amountLabel')}
            </label>
            <input
              id="claim-approved-amount" type="text" inputMode="decimal" autoComplete="off"
              value={approveAmount} onChange={(e) => setApproveAmount(e.target.value)}
              className="w-40 rounded-grubano-lg border border-grubano-border-strong bg-white px-3 py-2 text-[13px]"
            />
            <p className="text-[12px] text-grubano-ink-muted">
              {t('admin.approveDialog.amountHelp', { max: formatEuros(requested / 100, locale) })}
            </p>
            <label className="block text-[13px] font-semibold text-grubano-ink">
              {t('admin.approveDialog.reduceReasonLabel', { min: REDUCE_REASON_MIN })}
            </label>
            <textarea
              value={reduceReason} onChange={(e) => setReduceReason(e.target.value)} rows={2} maxLength={1000}
              placeholder={t('admin.approveDialog.reduceReasonPlaceholder')}
              className="w-full rounded-grubano-lg border border-grubano-border-strong bg-white px-3 py-2 text-[13px]"
            />
          </div>
        )}

        <label className="block text-[13px] font-semibold text-grubano-ink">{t('admin.decisionReasonLabel')}</label>
        <textarea
          value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={1000}
          placeholder={t('admin.decisionReasonPlaceholder')}
          className="w-full rounded-grubano-lg border border-grubano-border-strong bg-white px-3 py-2 text-[13px]"
        />

        <label className="block text-[13px] font-semibold text-grubano-ink" htmlFor="claim-approve-confirm">
          {t('admin.approveDialog.confirmLabel', { word: APPROVE_CONFIRM_WORD })}
        </label>
        <input
          id="claim-approve-confirm" type="text" autoComplete="off"
          value={approveConfirm} onChange={(e) => setApproveConfirm(e.target.value)}
          placeholder={APPROVE_CONFIRM_WORD}
          className="w-48 rounded-grubano-lg border border-grubano-border-strong bg-white px-3 py-2 text-[13px]"
        />

        {/* Spec v2 §7.4 — the sentence that stops a decision from being read as a payment. */}
        <p className="text-[13px] font-semibold text-grubano-ink">{t('admin.approveDialog.noRefundNotice')}</p>
        {approveError && <p className="text-[12px] text-red-700">{approveError}</p>}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" disabled={busyId === approveTarget.id} onClick={closeApprove}>{t('client.cancel')}</Button>
          <Button
            size="sm" variant="primary" loading={busyId === approveTarget.id} disabled={!valid}
            onClick={() => decide(approveTarget.id, 'approve', reason || undefined, {
              approvedAmountCents: cents as number,
              confirm: approveConfirm.trim(),
              reduceReason: reduced ? reduceReason.trim() : undefined,
            })}
          >
            {t(ratify ? 'admin.approveDialog.submitRatify' : 'admin.approveDialog.submit')}
          </Button>
        </div>
      </div>
    )
  }

  // ── D′ L4 (spec v2 T-09) — THE WITHDRAWAL PANEL ───────────────────────────────────────────────
  // The motive is not decoration: it is written in the SAME transaction as the reversal, and the route
  // refuses the whole operation when it cannot be recorded. A reversal nobody can trace never happens.
  const withdrawPanel = (id: string) => {
    const ok = withdrawReason.trim().length >= WITHDRAW_REASON_MIN && withdrawConfirm.trim() === WITHDRAW_CONFIRM_WORD
    return (
      <div className="mt-3 space-y-2 rounded-grubano-lg border border-grubano-border bg-grubano-surface-muted p-3">
        <p className="text-[13px] text-grubano-ink-muted">{t('admin.withdraw.hint')}</p>
        <label className="block text-[13px] font-semibold text-grubano-ink">
          {t('admin.withdraw.reasonLabel', { min: WITHDRAW_REASON_MIN })}
        </label>
        <textarea
          value={withdrawReason} onChange={(e) => setWithdrawReason(e.target.value)} rows={2} maxLength={1000}
          placeholder={t('admin.withdraw.reasonPlaceholder')}
          className="w-full rounded-grubano-lg border border-grubano-border-strong bg-white px-3 py-2 text-[13px]"
        />
        <label className="block text-[13px] font-semibold text-grubano-ink" htmlFor="claim-withdraw-confirm">
          {t('admin.withdraw.confirmLabel', { word: WITHDRAW_CONFIRM_WORD })}
        </label>
        <input
          id="claim-withdraw-confirm" type="text" autoComplete="off"
          value={withdrawConfirm} onChange={(e) => setWithdrawConfirm(e.target.value)}
          placeholder={WITHDRAW_CONFIRM_WORD}
          className="w-48 rounded-grubano-lg border border-grubano-border-strong bg-white px-3 py-2 text-[13px]"
        />
        {withdrawError && <p className="text-[12px] text-red-700">{withdrawError}</p>}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm" variant="ghost" disabled={busyId === id}
            onClick={() => { setWithdrawId(null); setWithdrawReason(''); setWithdrawConfirm(''); setWithdrawError(null) }}
          >
            {t('client.cancel')}
          </Button>
          <Button size="sm" variant="danger" loading={busyId === id} disabled={!ok} onClick={() => withdrawApproval(id)}>
            {t('admin.withdraw.submit')}
          </Button>
        </div>
      </div>
    )
  }

  // ── D′ L5 (spec v2 §8.2) — WHY « PAYER LE LOT » IS NOT AVAILABLE ──────────────────────────────
  // Every condition is the SERVER's own answer, never a guess: a signed batch, a window with more
  // than its safety margin left, the claims surface on, the audit trail on. A control greyed out with
  // no reason is how an admin concludes the console is broken and goes looking for another door, so
  // each missing condition is said in words beside the button.
  const payBlockers = (d: DryRun): string[] => {
    const out: string[] = []
    if (!d.token) out.push(t('admin.payBatch.blocked.noPayable'))
    if (!d.lease.usable) {
      out.push(d.lease.open
        ? t('admin.payBatch.blocked.leaseClosing')
        : t('admin.payBatch.blocked.leaseClosed', { reason: t(`admin.payBatch.leaseReason.${LEASE_REASON[d.lease.reason] ?? 'unknown'}`) }))
    }
    if (!d.surfaceEnabled) out.push(t('admin.payBatch.blocked.surfaceClosed'))
    if (!d.auditEnabled) out.push(t('admin.payBatch.blocked.auditDisabled'))
    return out
  }

  // ── D′ L5 (spec v2 §8.2) — THE PAYMENT DIALOG ─────────────────────────────────────────────────
  // Same idiom as the L4 approval dialog: it restates the two numbers the admin is committing to, says
  // plainly that the money leaves now, and demands the route's confirmation word typed in full.
  const payDialog = (d: DryRun) => {
    const ok = payConfirm.trim() === PAY_CONFIRM_WORD
    return (
      <div className="mt-3 space-y-3 rounded-grubano-lg border border-grubano-border-strong bg-grubano-surface p-3">
        <p className="text-sm font-bold text-grubano-ink">{t('admin.payBatch.confirmTitle')}</p>
        <p className="text-[13px] text-grubano-ink-muted">
          {t('admin.payBatch.confirmBody', { count: d.payableCount, total: formatEuros(d.totalPayableCents / 100, locale) })}
        </p>
        <p className="text-[13px] font-semibold text-grubano-ink">{t('admin.payBatch.confirmNotice')}</p>

        <label className="block text-[13px] font-semibold text-grubano-ink" htmlFor="claim-pay-confirm">
          {t('admin.payBatch.confirmLabel', { word: PAY_CONFIRM_WORD })}
        </label>
        <input
          id="claim-pay-confirm" type="text" autoComplete="off"
          value={payConfirm} onChange={(e) => setPayConfirm(e.target.value)}
          placeholder={PAY_CONFIRM_WORD}
          className="w-48 rounded-grubano-lg border border-grubano-border-strong bg-white px-3 py-2 text-[13px]"
        />

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" disabled={paying} onClick={() => { setPayOpen(false); setPayConfirm('') }}>{t('client.cancel')}</Button>
          <Button size="sm" variant="danger" loading={paying} disabled={!ok} onClick={payApproved}>{t('admin.payBatch.submit')}</Button>
        </div>
      </div>
    )
  }

  // ── D′ L5 (spec v2 §8.2) — THE BATCH SUMMARY ──────────────────────────────────────────────────
  // What the rail WOULD pay, claim by claim. A held claim is shown with its cause and is counted in
  // no total: the two figures an admin reads before typing the word are the payable count and the
  // payable sum, and both come from the server's own arithmetic.
  const dryRunSummary = (d: DryRun) => {
    const blockers = payBlockers(d)
    return (
      <div className="space-y-3">
        <dl className="space-y-1 text-[13px] text-grubano-ink-muted">
          <p className="font-semibold text-grubano-ink">
            {t('admin.payBatch.summary', { payable: d.payableCount, total: formatEuros(d.totalPayableCents / 100, locale), held: d.heldCount })}
          </p>
          <p>
            {d.lease.open
              ? t('admin.payBatch.leaseOpen', { until: instantOf(d.lease.expiresAt) ?? d.lease.expiresAt })
              : t('admin.payBatch.leaseNone', { reason: t(`admin.payBatch.leaseReason.${LEASE_REASON[d.lease.reason] ?? 'unknown'}`) })}
          </p>
          {d.tokenExpiresAt && <p>{t('admin.payBatch.tokenExpiresAt', { until: instantOf(d.tokenExpiresAt) ?? d.tokenExpiresAt })}</p>}
          {d.heldCount > 0 && <p>{t('admin.payBatch.heldNotCounted')}</p>}
        </dl>

        <div className="space-y-2">
          {d.claims.map((r) => (
            <div key={r.claimId} className="rounded-grubano-lg border border-grubano-border bg-grubano-surface p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-bold text-grubano-ink">{t('admin.order')} {r.orderRef}</span>
                <span className="text-[13px] font-semibold text-grubano-primary">
                  {/* Never « 0,00 € » for a claim whose amount was never ratified: the absence is said. */}
                  {r.approvedAmountCents === null ? t('admin.payBatch.noAmount') : formatEuros(r.approvedAmountCents / 100, locale)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge tone={r.payable ? 'success' : 'warning'}>{t(r.payable ? 'admin.payBatch.rowPayable' : 'admin.payBatch.rowHeld')}</Badge>
                <Badge tone="neutral">{t('admin.awaitingPayment.decidedAt')} {instantOf(r.arbitratedAt) ?? t('admin.awaitingPayment.decidedAtUnknown')}</Badge>
              </div>
              {!r.payable && (
                <p className="mt-2 text-[13px] text-amber-800">
                  {/* `detail` is passed to every hold sentence: `notSelectable` names the clause that
                      refused the claim, the others ignore the parameter. A hold is always set when a row
                      is not payable, so the fallback is a defence, not a path. */}
                  {t(`admin.payBatch.hold.${HOLD[r.hold ?? 'not_selectable']}`, { detail: clauseOf(r.holdDetail, t) })}
                  {r.hold && r.hold !== 'not_selectable' && r.holdDetail ? ` (${r.holdDetail})` : ''}
                </p>
              )}
            </div>
          ))}
        </div>

        {blockers.length > 0 ? (
          <div className="space-y-1">
            <Button size="sm" variant="primary" disabled title={blockers.join(' ')} aria-label={blockers.join(' ')}>
              {t('admin.awaitingPayment.payBatch', { count: d.payableCount })}
            </Button>
            <p className="text-[12px] text-grubano-ink-muted">{t('admin.payBatch.blockedIntro')}</p>
            <ul className="list-disc space-y-1 pl-5 text-[12px] text-grubano-ink-muted">
              {blockers.map((b) => <li key={b}>{b}</li>)}
            </ul>
          </div>
        ) : payOpen ? payDialog(d) : (
          <Button size="sm" variant="primary" onClick={() => { setPayOpen(true); setPayConfirm('') }}>
            {t('admin.awaitingPayment.payBatch', { count: d.payableCount })}
          </Button>
        )}
      </div>
    )
  }

  // ── D′ L5 (spec v2 §8.6) — THE PER-CLAIM REPORT ───────────────────────────────────────────────
  // One line per claim of the batch, in the order the rail ran them, each saying what happened to THAT
  // claim's money — and, when a notice was due, what happened to the customer e-mail, through the same
  // helper every other action of this console already uses.
  const payReportPanel = (p: PayReport) => (
    <div className="space-y-3 rounded-grubano-lg border border-grubano-border-strong bg-grubano-surface p-3">
      <p className="text-sm font-bold text-grubano-ink">{t('admin.payBatch.reportTitle')}</p>
      <p className="text-[13px] text-grubano-ink-muted">
        {t('admin.payBatch.reportCounts', {
          requested: p.counts.requested, paid: p.counts.paid, pending: p.counts.pending, held: p.counts.held,
          review: p.counts.review, failed: p.counts.failed, skipped: p.counts.skipped, notAttempted: p.counts.notAttempted,
        })}
      </p>
      {p.stoppedBy && <p className="text-[13px] font-semibold text-amber-800">{t(`admin.payBatch.stopped.${STOPPED[p.stoppedBy]}`)}</p>}

      <div className="space-y-2">
        {p.items.map((it) => {
          const o = OUTCOME[it.outcome]
          // ROUND 13 (H07, H11): the SAME customer-e-mail helper as every other action of this console.
          const e = customerEmailLine(it.customerEmail)
          return (
            <div key={it.claimId} className="rounded-grubano-lg border border-grubano-border bg-grubano-surface-muted p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-[13px] font-bold text-grubano-ink">{t('admin.order')} {it.orderRef || it.claimId}</span>
                <span className="text-[13px] font-semibold text-grubano-primary">{formatEuros(it.approvedAmountCents / 100, locale)}</span>
              </div>
              <div className="mt-2"><Badge tone={o.tone}>{t(`admin.payBatch.outcome.${o.key}`)}</Badge></div>
              <dl className="mt-2 space-y-1 text-[13px] text-grubano-ink-muted">
                {/* The amount the ENGINE drove, read off its refund row — never the approved figure. */}
                {it.engineAmountCents !== null && (
                  <p><span className="font-semibold">{t('admin.payBatch.engineAmount')}:</span> {formatEuros(it.engineAmountCents / 100, locale)}</p>
                )}
                {it.stripeRefundId && <p><span className="font-semibold">{t('admin.payBatch.refundId')}:</span> {it.stripeRefundId}</p>}
                {it.until && <p><span className="font-semibold">{t('admin.payBatch.until')}:</span> {instantOf(it.until) ?? it.until}</p>}
                {/* A known evidence value has its own sentence; a SKIP carries the clause that refused the
                    claim (lib/claims-pay-rail payableShapeRefusal), which is said with the clause inside
                    rather than dropped — the reason a claim was not attempted is the useful part. */}
                {it.evidence && EVIDENCE[it.evidence]
                  ? <p>{t(`admin.payBatch.evidence.${EVIDENCE[it.evidence]}`)}</p>
                  : it.evidence && it.outcome.startsWith('skipped:')
                    ? <p>{t('admin.payBatch.evidence.shapeRefused', { clause: clauseOf(it.evidence, t) })}</p>
                    : null}
                {it.error && <p className="text-red-700"><span className="font-semibold">{t('admin.payBatch.engineMessage')}:</span> {it.error}</p>}
                {e && <p className={e.tone === 'error' ? 'text-red-700' : undefined}>{t(`admin.customerEmail.${e.key}`)}</p>}
              </dl>
            </div>
          )
        })}
      </div>
    </div>
  )

  // ── D′ L5 (spec v2 §8.2, §7.4) — THE RAIL'S PANEL, under the « À rembourser » queue ────────────
  // Two steps in the order the rail imposes: simulate, read what would happen, then pay. Nothing on
  // this panel moves money before the word is typed, and the panel never re-selects the queue itself.
  const payRail = () => (
    <div className="mt-4 space-y-3 rounded-grubano-xl border border-grubano-border-strong bg-grubano-surface-muted p-4">
      <p className="text-sm font-bold text-grubano-ink">{t('admin.payBatch.title')}</p>
      <p className="text-[13px] text-grubano-ink-muted">{t('admin.payBatch.hint')}</p>
      <Button size="sm" variant="secondary" loading={simulating} disabled={paying} onClick={simulate}>
        {t(dryRun || payReport ? 'admin.payBatch.simulateAgain' : 'admin.payBatch.simulate')}
      </Button>
      {dryRunError && <p className="text-[13px] text-red-700">{dryRunError}</p>}
      {dryRun && dryRunSummary(dryRun)}
      {payError && <p className="text-[13px] font-semibold text-red-700">{payError}</p>}
      {payReport && payReportPanel(payReport)}
    </div>
  )

  // Truthful, distinct wording per money state. Pending is NEVER shown as succeeded, and a
  // failed refund never reads as "in progress".
  const MONEY_LABEL: Record<MoneyState, { text: string; tone: 'warning' | 'danger' | 'neutral' }> = {
    stripe_pending:                       { text: 'Remboursement envoyé à la banque — en attente de confirmation Stripe', tone: 'warning' },
    // ROUND-8 AUDIT FIX (P1): « envoyé à la banque » was shown for OUR pending row with no Stripe id —
    // the crash window, where nothing is confirmed at Stripe. Only a row with a Stripe id reached it.
    // ROUND-9: a fact about OUR row only — Stripe may hold a refund for it; only a Stripe read says.
    local_pending_unconfirmed:            { text: 'Ligne de remboursement liée en attente, sans identifiant Stripe enregistré — l’argent n’est pas établi ici (ni parti, ni non parti)', tone: 'danger' },
    row_voided:                           { text: 'Ligne de remboursement LIBÉRÉE — il est prouvé qu’aucun remboursement Stripe n’a existé pour elle : le client n’a PAS été payé, et le rail de la commande est rouvert', tone: 'danger' },
    // ROUND-6 AUDIT FIX (P1 class): « le client n’a rien reçu » was a claim about the CUSTOMER read
    // off ONE row's status. The row paid nothing; the order's other refunds are not read here.
    stripe_failed:                        { text: 'Remboursement ÉCHOUÉ chez Stripe — cette ligne n’a rien versé (ne dit rien des autres remboursements de la commande)', tone: 'danger' },
    stripe_succeeded_claim_unreconciled:  { text: 'Remboursement réussi chez Stripe — réclamation non réconciliée', tone: 'warning' },
    // ROUND-8 AUDIT FIX (P2): « sans aucun remboursement Stripe associé » asserted a Stripe fact nothing
    // had checked. The unbound legacy shape is now classified reconcile_required (money unknown);
    // this label only remains for a claim bound to a Refund row that cannot be found.
    stale_refunding_no_refund_row:        { text: 'En remboursement, liée à une ligne de remboursement INTROUVABLE — l’argent n’est pas établi (ni parti, ni non parti)', tone: 'danger' },
    refund_error_recorded:                { text: 'Erreur de remboursement enregistrée — décision humaine requise', tone: 'danger' },
    approved_not_driven:                  { text: 'Approuvée mais jamais remboursée — en attente de traitement', tone: 'warning' },
    reconcile_required:                   { text: 'Vérification financière requise — l’argent n’est pas établi (ni parti, ni non parti)', tone: 'danger' },
    // W3 round-2 fix (D0 / D5): the refusal fact, no control named.
    reconcile_marker_unreadable:          { text: 'Vérification financière requise — l’argent n’est pas établi (ni parti, ni non parti) ; heure de la tentative illisible, réconciliation refusée', tone: 'danger' },
    // ROUND-7 AUDIT FIX (P1): « sera versée par le rail » promised a payment nothing performs —
    // the auto-approve sweep is flag-gated OFF for the beta and its cron is gone. A human pays it.
    // ROUND 13 (F15): the proof's own instant is part of the label — the row lookup below renders it per claim.
    absence_proven_payable:               { text: absenceProvenPayableLabel(null), tone: 'warning' },
  }

  return (
    <div className="space-y-4">
      {/* ── D′ L4 (spec v2 §7.4, §8.5) — « À REMBOURSER » : les décisions PRISES et non encore payées,
          dans l'ordre où elles ont été prises (FIFO sur l'instant de décision, comme la sélection du
          rail). Cette liste est en LECTURE SEULE côté argent : la console ne paie rien. La seule action
          offerte est le RETRAIT de l'approbation, que le serveur refuse dès qu'un paiement a été tenté. */}
      {awaitingPayment.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-grubano-ink-muted">
            {t('admin.awaitingPayment.title')} ({awaitingPayment.length})
          </h2>
          <p className="mb-3 text-[13px] text-grubano-ink-muted">{t('admin.awaitingPayment.hint')}</p>
          <div className="space-y-3">
            {awaitingPayment.map((r) => (
              <div key={r.id} className="rounded-grubano-xl border border-grubano-border bg-grubano-surface p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-bold text-grubano-ink">{t('admin.order')} {r.orderRef}</span>
                  <span className="text-sm font-semibold text-grubano-primary">
                    {t('admin.awaitingPayment.approved')}: {formatEuros((r.approvedAmountCents ?? 0) / 100, locale)}
                  </span>
                </div>
                <dl className="mt-2 space-y-1 text-[13px] text-grubano-ink-muted">
                  {/* Les deux montants côte à côte : une réduction décidée reste lisible après coup. */}
                  <p><span className="font-semibold">{t('admin.awaitingPayment.requested')}:</span> {formatEuros(r.requestedAmountCents / 100, locale)}</p>
                  <p><span className="font-semibold">{t('admin.awaitingPayment.decidedAt')}:</span> {instantOf(r.arbitratedAt) ?? t('admin.awaitingPayment.decidedAtUnknown')}</p>
                  {r.arbitrationReason && <p><span className="font-semibold">{t('admin.awaitingPayment.decisionReason')}:</span> {r.arbitrationReason}</p>}
                </dl>
                {withdrawId === r.id ? withdrawPanel(r.id) : (
                  <Button
                    size="sm" variant="secondary" className="mt-3" disabled={busyId === r.id}
                    onClick={() => { setWithdrawId(r.id); setWithdrawReason(''); setWithdrawConfirm(''); setWithdrawError(null) }}
                  >
                    {t('admin.withdraw.open')}
                  </Button>
                )}
              </div>
            ))}
          </div>
          {/* D′ L5 (spec v2 §8.2) — LE RAIL FINANCIER. La file ci-dessus reste en lecture seule : le
              paiement se fait en deux appels, une simulation puis un lot signé, et il se lit ici. */}
          {payRail()}
        </section>
      )}

      {/* ── D′ L4 (spec v2 §7.4) — « À RATIFIER » : approuvées AVANT que le montant n'existe. Aucun montant
          n'y est fixé, donc rien ne peut les payer — elles sont listées à part pour être ratifiées, avec
          le même dialogue, le même endpoint et les mêmes règles qu'une première décision. */}
      {awaitingRatification.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-grubano-ink-muted">
            {t('admin.awaitingRatification.title')} ({awaitingRatification.length})
          </h2>
          <p className="mb-3 text-[13px] text-grubano-ink-muted">{t('admin.awaitingRatification.hint')}</p>
          <div className="space-y-3">
            {awaitingRatification.map((r) => (
              <div key={r.id} className="rounded-grubano-xl border border-amber-300 bg-amber-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-bold text-grubano-ink">{t('admin.order')} {r.orderRef}</span>
                  <span className="text-sm font-semibold text-grubano-primary">{formatEuros(r.requestedAmountCents / 100, locale)}</span>
                </div>
                <dl className="mt-2 space-y-1 text-[13px] text-grubano-ink-muted">
                  <p><span className="font-semibold">{t('admin.awaitingPayment.requested')}:</span> {formatEuros(r.requestedAmountCents / 100, locale)}</p>
                  <p><span className="font-semibold">{t('admin.awaitingPayment.decidedAt')}:</span> {instantOf(r.arbitratedAt) ?? t('admin.awaitingPayment.decidedAtUnknown')}</p>
                  {r.arbitrationReason && <p><span className="font-semibold">{t('admin.awaitingPayment.decisionReason')}:</span> {r.arbitrationReason}</p>}
                </dl>
                {approveTarget?.id === r.id ? approveDialog() : (
                  <Button
                    size="sm" variant="primary" className="mt-3" disabled={busyId === r.id}
                    onClick={() => openApprove({ id: r.id, orderLabel: r.orderRef, requestedAmountCents: r.requestedAmountCents, mode: 'ratify' })}
                  >
                    {t('admin.awaitingRatification.ratify')}
                  </Button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── BATCH 2 — ARGENT BLOQUÉ : la seule liste où un remboursement en attente, échoué
          ou non réconcilié devient visible ET actionnable. Aucune relance automatique. */}
      {actionableRefunds.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-grubano-ink-muted">
            Remboursements à traiter ({actionableRefunds.length})
          </h2>
          <p className="mb-3 text-[13px] text-grubano-ink-muted">
            Ces réclamations attendent une décision humaine sur l’argent. Aucun nouvel essai n’est
            déclenché automatiquement.
          </p>
          <div className="space-y-3">
            {actionableRefunds.map((r) => {
              // ROUND 13 (F15): the absence_proven_payable label states the proof's own instant (C4).
              const label = r.moneyState === 'absence_proven_payable'
                ? { text: absenceProvenPayableLabel(r.refundError), tone: 'warning' as const }
                : MONEY_LABEL[r.moneyState] ?? { text: r.moneyState, tone: 'neutral' as const }
              return (
                <div key={r.id} className="rounded-grubano-xl border border-grubano-border bg-grubano-surface p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-bold text-grubano-ink">{t('admin.order')} #{r.orderId.slice(-6)}</span>
                    <span className="text-sm font-semibold text-grubano-primary">
                      {formatEuros(r.requestedAmountCents / 100, locale)}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {r.safety && <Badge tone="danger">Allergène / sécurité</Badge>}
                    <Badge tone={label.tone}>{label.text}</Badge>
                  </div>
                  <dl className="mt-2 space-y-1 text-[13px] text-grubano-ink-muted">
                    {/* The amount ACTUALLY refunded, which can differ from what was requested. */}
                    <p>
                      <span className="font-semibold">Montant réellement remboursé :</span>{' '}
                      {/* ROUND-6 AUDIT FIX (P1): `actualRefundedCents === null` covers THREE facts —
                          nothing bound; something bound but not succeeded; something bound that
                          succeeded for SOMEBODY ELSE (the engine disowned it). One sentence claimed
                          the first for all three, two lines above « Statut Stripe : pending ». */}
                      {/* ROUND 13 (F15): the branch is the tested pure amountLineKind (lib/claim-money-line) — a
                          reversal marker pays nothing, and the A-S36-1 sentence names reconcile only when the
                          server's reconcile verdict for this claim accepts it. */}
                      {(() => {
                        switch (amountLineKind(r)) {
                          case 'amount': return formatEuros((r.actualRefundedCents ?? 0) / 100, locale)
                          case 'reverted': return `non établi pour cette réclamation — ${BOUND_REVERTED_TEXT}`
                          case 'identity_unread': return `non établi pour cette réclamation — ${identityUnreadText(r.reconcilable)}`
                          case 'not_ours': return `non établi pour cette réclamation — un remboursement est lié (statut ${r.refund?.status}), mais le moteur a établi qu’il n’appartient PAS à cette réclamation : son montant n’est pas le sien`
                          case 'bound_not_succeeded': return `rien n’a encore abouti sur la ligne liée (statut de notre ligne : ${r.refund?.status})`
                          default: return 'non déterminé ici — aucun remboursement n’est LIÉ à cette réclamation'
                        }
                      })()}
                    </p>
                    {r.actualRefundedCents === null && !r.refund && (
                      // AUDIT FIX (gate T-49). This block used to read « aucun (rien n’a encore
                      // atteint le client) » — a positive statement about cash that nothing in the
                      // code had checked: the classifier resolves Refund rows ONLY by claim.refundId,
                      // never by orderId, and never calls Stripe. On a claim whose binding was lost
                      // mid-refund, a succeeded refund can exist on that order and be invisible here.
                      // Telling an admin no money left is exactly how a second payment gets issued.
                      <p className="text-amber-800">
                        L’absence de lien ne prouve pas qu’aucun argent n’est parti. Vérifiez la
                        commande dans Stripe avant toute action.
                      </p>
                    )}
                    {r.refund && (
                      // ROUND-8 AUDIT FIX (P1): this is OUR row's status, not a Stripe read.
                      <p><span className="font-semibold">Statut de notre ligne :</span> {r.refund.status}</p>
                    )}
                    {r.refundError && (
                      <p className="text-red-700"><span className="font-semibold">Détail :</span> {r.refundError}</p>
                    )}
                  </dl>
                  {/* ── AUDIT FIX (batch 2) — THE MISSING DOOR. `resolveStuckClaim` shipped in
                      batch 1 behind no route and no control, so this list could show stuck money
                      and offer nothing to do about it — and the claim kept `activeOrderKey`,
                      locking the customer out of ever re-filing on that order. Neither button
                      moves money: they RECORD what is true and close the case. */}
                  {!r.resolvable ? (
                    // The route refuses this row on purpose, for two different reasons depending on
                    // the state: a BOUND refund may still pay out or already did, while an UNBOUND
                    // one means we do not know what happened. Offering a button here would be a lie
                    // in the first case and a guess in the second.
                    <p className="mt-3 text-[13px] text-grubano-ink-muted">
                      {/* AUDIT FIX (gate T-49). This paragraph promised « réconciliation rejouée
                          chaque jour ». It rendered on FIVE of the six money states and was untrue
                          for three of them, and the daily schedule is not even live: GitHub fires
                          `schedule` only from the default branch, and origin/main carries no
                          .github/ directory. Say per state what can actually reach the row. */}
                      {/* ROUND-9 AUDIT FIX (P2 + Class 1): one fact-only line per money state, from the shared
                          module. The round-8 branches promised a webhook, a sweep and an engine re-drive the
                          code does not reliably run, and one branch condition was pinned by nothing. */}
                      {moneyStateGuidance(r.moneyState)}
                    </p>
                  ) : stuckId === r.id ? (
                    <div className="mt-3 space-y-2 rounded-grubano-lg border border-grubano-border bg-grubano-surface-muted p-3">
                      <p className="text-[13px] text-grubano-ink-muted">
                        {/* ROUND 13 (H14, slice W7): the panel states the closure e-mail attempt and its gate. */}
                        {'Aucune de ces actions ne rembourse ni ne relance quoi que ce soit. Elles enregistrent votre déclaration, libèrent la commande pour le client et tentent de lui envoyer un e-mail de clôture, sans votre note ni aucun montant — aucun e-mail n’est envoyé tant que les réclamations sont fermées (le résultat de l’envoi s’affiche ensuite).'}
                      </p>
                      <textarea
                        value={stuckReason}
                        onChange={(e) => setStuckReason(e.target.value)}
                        placeholder="Ce qui s’est réellement passé (facultatif, jamais montré au client)…"
                        rows={2}
                        className="w-full rounded-grubano-lg border border-grubano-border bg-grubano-surface p-2 text-[13px]"
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          disabled={busyId === r.id}
                          onClick={() => resolveStuck(r.id, 'settled_out_of_band')}
                        >
                          {/* ROUND-7: this is the operator's DECLARATION, recorded as such — not a
                              fact the system established. The label now says who is asserting. */}
                          Je déclare : payé autrement, hors système
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busyId === r.id}
                          onClick={() => resolveStuck(r.id, 'closed_no_payment')}
                        >
                          Clôturer sans paiement
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busyId === r.id}
                          onClick={() => { setStuckId(null); setStuckReason('') }}
                        >
                          Annuler
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="mt-3"
                      disabled={busyId === r.id}
                      onClick={() => { setStuckId(r.id); setStuckReason('') }}
                    >
                      Clôturer ce dossier…
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── P0-39 — EN ATTENTE DU RESTAURANT (lecture seule, distincte de l'arbitrage :
          fond ambré, ancienneté, badge « délai dépassé » — AUCUN bouton d'action). */}
      {pending.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-grubano-ink-muted">
            {t('admin.pendingTitle')} ({pending.length})
          </h2>
          <p className="mb-3 text-[13px] text-grubano-ink-muted">{t('admin.pendingHint')}</p>
          <div className="space-y-3">
            {pending.map((p) => (
              <div key={p.id} className="rounded-grubano-xl border border-amber-300 bg-amber-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-bold text-grubano-ink">{t('admin.order')} #{p.orderId.slice(-6)}</span>
                  <span className="text-sm font-semibold text-grubano-primary">{formatEuros(p.requestedAmountCents / 100, locale)}</span>
                </div>
                <dl className="mt-2 space-y-1 text-[13px] text-grubano-ink-muted">
                  <p><span className="font-semibold">{t(isSystemClaim(p.reason) ? 'admin.reasonSystem' : 'admin.reason')}:</span> {t(`reason.${p.reason}`)}</p>
                  {p.description && <p><span className="font-semibold">{t(isSystemClaim(p.reason) ? 'admin.systemDetails' : 'admin.clientDetails')}:</span> {p.description}</p>}
                </dl>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {p.safety && <Badge tone="danger">Allergène / sécurité</Badge>}
                  <Badge tone="neutral">{ageOf(p.createdAt)}</Badge>
                  {isOverdue(p) && <Badge tone="warning">{t('admin.pendingOverdue')}</Badge>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {claims.length > 0 && pending.length > 0 && (
        <h2 className="mb-2 mt-6 text-sm font-bold uppercase tracking-wide text-grubano-ink-muted">
          {t('admin.arbitrationTitle')} ({claims.length})
        </h2>
      )}
      {/* D′ L4: an approved-unpaid claim is ALSO matched by the arbitration queue's legacy branch, so the
          same row could appear twice — once under « Réclamations en arbitrage » and once under « À rembourser »
          or « À ratifier », with different controls. The D′ sections above own those rows; the arbitration
          list renders what is left. The server lists are unchanged: this is a rendering choice, not a filter
          on what the admin may see. */}
      {claims.filter((c) => !dprimeIds.has(c.id)).map((c) => {
        const cs = c.consumerStats ?? {}
        const rs = c.restaurantStats ?? {}
        return (
          <div key={c.id} className="rounded-grubano-xl border border-grubano-border bg-grubano-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-bold text-grubano-ink">{t('admin.order')} #{c.orderId.slice(-6)}</span>
              <span className="text-sm font-semibold text-grubano-primary">{formatEuros(c.requestedAmountCents / 100, locale)}</span>
            </div>

            {c.safety && (
              <div className="mt-2">
                <Badge tone="danger">Allergène / sécurité</Badge>
              </div>
            )}

            <dl className="mt-2 space-y-1 text-[13px] text-grubano-ink-muted">
              <p><span className="font-semibold">{t(isSystemClaim(c.reason) ? 'admin.reasonSystem' : 'admin.reason')}:</span> {t(`reason.${c.reason}`)}</p>
              {c.description && <p><span className="font-semibold">{t(isSystemClaim(c.reason) ? 'admin.systemDetails' : 'admin.clientDetails')}:</span> {c.description}</p>}
              {/* ROUND 13 (F08): a note written while ACCEPTING is not a refusal reason. */}
              {c.restaurantResponseReason && <p><span className="font-semibold">{t(c.restaurantResponse === 'accepted' ? 'admin.restaurantNote' : 'admin.refusalReason')}:</span> {c.restaurantResponseReason}</p>}
              {c.contestReason && <p><span className="font-semibold">{t('admin.contestReason')}:</span> {c.contestReason}</p>}
              {c.photoUrl && (
                <a href={c.photoUrl} target="_blank" rel="noopener noreferrer" className="inline-block font-semibold text-grubano-primary underline">
                  {t('admin.viewPhoto')}
                </a>
              )}
            </dl>

            {/* Read-only abuse signals (no money sanction). */}
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge tone={cs.flagged ? 'warning' : 'neutral'}>
                {t('admin.consumerSignal', { recent: cs.recent ?? 0, rate: Math.round((cs.approvalRate ?? 0) * 100) })}
              </Badge>
              {cs.flagged && <Badge tone="danger">{t('admin.flaggedConsumer')}</Badge>}
              <Badge tone={rs.flagged ? 'warning' : 'neutral'}>
                {t('admin.restaurantSignal', { overturned: rs.overturned ?? 0, refused: rs.refused ?? 0 })}
              </Badge>
              {rs.flagged && <Badge tone="danger">{t('admin.flaggedRestaurant')}</Badge>}
            </div>

            {refusingId === c.id ? (
              <div className="mt-3 space-y-2">
                <label className="block text-[13px] font-semibold text-grubano-ink">{t('admin.decisionReasonLabel')}</label>
                <textarea
                  value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={1000}
                  placeholder={t('admin.decisionReasonPlaceholder')}
                  className="w-full rounded-grubano-lg border border-grubano-border-strong bg-white px-3 py-2 text-[13px]"
                />
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => { setRefusingId(null); setReason('') }} disabled={busyId === c.id}>{t('client.cancel')}</Button>
                  <Button size="sm" variant="danger" loading={busyId === c.id} onClick={() => decide(c.id, 'refuse_final', reason || undefined)}>{t('admin.refuseFinal')}</Button>
                </div>
              </div>
            ) : approveTarget?.id === c.id ? (
              approveDialog()
            ) : (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {/* ROUND-9 AUDIT FIX (P1, Class 3 again): both decisions are enabled on the SERVER's own
                    verdict (lib/claim-action-rules via listArbitrationQueue). Round 9 disabled approve on a
                    rail-locked claim and left « Refuser » live — which arbitrateClaim always refused there. */}
                {/* D′ L4 (T-07): « Approuver » no longer decides — it OPENS the approval dialog, where the
                    amount, the motive of a reduction and the typed confirmation are collected. */}
                <Button size="sm" variant="primary" loading={busyId === c.id} disabled={c.approveRefusal != null} onClick={() => openApprove({ id: c.id, orderLabel: `#${c.orderId.slice(-6)}`, requestedAmountCents: c.requestedAmountCents, mode: 'approve' })}>{t('admin.approve')}</Button>
                <Button size="sm" variant="secondary" disabled={busyId === c.id || c.refuseFinalRefusal != null} onClick={() => setRefusingId(c.id)}>{t('admin.refuseFinal')}</Button>
                {(c.approveRefusal || c.refuseFinalRefusal) && (
                  <span className="text-[12px] text-red-700">
                    {Array.from(new Set([c.approveRefusal, c.refuseFinalRefusal].filter((x): x is string => !!x))).join(' ')}
                  </span>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
