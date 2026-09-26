'use client'

import { useState, useEffect, useCallback } from 'react'
import { useLocale } from 'next-intl'
import { Button, Badge, useToast } from '@/components/design-system'
import { formatEuros } from '@/lib/format-money'
import { cardMoneyLine, financialVerificationCardVisible, financialVerificationHeadingVisible } from '@/lib/claim-money-line'
import { moneyStateGuidance, type ClosureKind } from '@/lib/claim-action-rules'
// ROUND 13 (F14, AMF-1, H10, D4, slice W7): the card's French copy as tested pure functions.
import {
  reconcileToast, settledReverifyToast, SETTLED_REVERIFY_BUTTON, SETTLED_REVERIFY_CAPTION, NO_MONEY_HERE, D4_PRECLICK_CAPTION,
  refundedUnprovenHeading, REFUNDED_UNPROVEN_TEXT, REFUNDED_UNPROVEN_RECONCILE_CAPTION, REFUNDED_UNPROVEN_NO_ACTION, REFUNDED_UNPROVEN_TRUNCATED,
  closureNoticesHeading, CLOSURE_NOTICES_INTRO, CLOSURE_NOTICE_BUTTON, CLOSURE_NOTICES_TRUNCATED, CLOSURE_KIND_LABEL, CLOSURE_BLOCKER_LINE,
  RESTAURANT_NOTICE_LINE, RESTAURANT_NOTICES_HEADING, RESTAURANT_NOTICES_INTRO, RESTAURANT_NOTICE_STATE_LINE,
  LIST_UNREADABLE_TEXT, itemsCappedText, type ClosureNoticeBlocker,
} from '@/lib/claim-console-copy'
// ROUND 13 (G12, B10): the attribution success copy and the pending-row legend come from the shared pure module.
import { attributionSuccessText, PENDING_ROW_LEGEND, adoptionRefusalWroteText } from '@/lib/claim-attribution-rules'
// ROUND 13 (H07, H11): the customer e-mail result of a closing action, as a toast (the card is French-only).
import { customerEmailLine, CUSTOMER_EMAIL_FR } from '@/lib/claim-email-toast'

// ── T-49 — THE FINANCIAL VERIFICATION QUEUE (founder decision, 2026-09-10) ────────
//
// Fail-closed financially is only acceptable if it is fail-VISIBLE operationally. This is that
// visibility. It renders even when CLAIMS_ENABLED is off, because a claim whose money truth is
// unresolved must never disappear because a feature flag moved.
//
// Everything here obeys one rule: state ONLY what is proven. The whole reason a claim is in this
// queue is that nobody knows whether the customer was paid, so this component never says money
// left, never says money did not leave, and never offers an action that would move money.

type Row = {
  id: string
  orderId: string
  reason: string
  requestedAmountCents: number
  refundId: string | null
  refundError: string | null
  createdAt: string
  safety?: boolean
  ambiguity?: string
  /** ROUND-9 (other_unsettled rows): the claim status and money state, and the SERVER's own verdicts —
   *  whether the reconcile gate admits it and whether the stuck-money hatch accepts it. */
  status?: string
  moneyState?: string
  resolvable?: boolean
  reconcilable?: boolean
  /** ROUND 13 (reconcile_required rows, W3): the reconcile gate's own refusal text when it refuses the claim. */
  reconcileRefusal?: string | null
  /** ROUND-11 (other_unsettled rows): the bound Refund row, as our base records it. */
  refund?: { id: string; status: string; stripeRefundId: string | null; reason?: string | null } | null
  /** The PaymentIntent that paid this order — which payment to open in the Stripe Dashboard. */
  orderStripePaymentIntentId?: string | null
  /** The refunds of THIS order, so the operator can attribute one without leaving the console. */
  candidateRefunds?: Array<{
    id: string; status: string; amountCents: number
    stripeRefundId: string | null; createdAt: string; belongsToAnotherClaim: boolean; alreadyBoundToAnotherClaim: boolean
    /** The row the engine stamped for THIS claim — the one the row path prefers. */
    belongsToThisClaim?: boolean
    /** ROUND-8 (parity): the server's own refusal code for this row, or null. */
    refusal?: string | null
  }>
}

type Payload = {
  financialVerification: Row[]
  reconcileRequired: Row[]
  /** Every other unsettled money state (pending, failed, unreconciled, never driven, legacy). */
  otherUnsettled: Row[]
  /** ROUND-10 AUDIT FIX (P2): pending Refund rows whose claim has moved on (read-only facts). */
  unfinalizedRefundRows?: Array<{
    /** ROUND 13 (D7 / J-M29, slice W7): the payload key; refundRowId carries the same id. */
    rowId?: string
    refundRowId: string; orderId: string; amountCents: number; stripeRefundId: string | null
    claimId: string | null; claimStatus: string | null
    /** ROUND 13 (D7 / D0, slice W5): the server's reconcile verdict for this claim and row, and its refusal text. */
    reconcilable?: boolean; reconcileRefusal?: string | null
  }>
  /** ROUND 13 (H10 / E-13, slice W7): settled claims whose bound row is not established — outside `total`. */
  refundedUnproven?: SectionList<{
    id: string; orderId: string; refundId: string | null; decidedAt?: string | null
    refund: { id: string; orderId: string; status: string; amountCents: number; stripeRefundId: string | null } | null
    reconcilable: boolean
  }>
  /** ROUND 13 (H10 / E-16, slice W7): this build's closures without a dispatched notice — outside `total`. */
  closureNotices?: SectionList<{ claimId: string; orderId: string; kind: ClosureKind; decidedAt: string | null; blocker: ClosureNoticeBlocker | null; restaurantNotice?: string }>
  /** D′ L8 (§18): settled refunds the RESTAURANT has not been told about — its own population. */
  restaurantNotices?: SectionList<{ claimId: string; orderId: string; decidedAt: string | null; state: 'pending' | 'ledger_incomplete' }>
  counts: {
    financialVerification: number; reconcileRequired: number; otherUnsettled: number; total: number; unfinalizedRefundRows?: number
    refundedUnproven?: number | null; closureNoticesMissing?: number | null
  }
}

/** H10: a section list, or the route's answer when that list could not be read. */
type SectionList<T> = { items: T[]; total: number; scanTruncated: boolean } | { error: string }
export type FinancialVerificationPayload = Payload
/** An unreadable section still renders (« Liste illisible »): fail visible, never an empty-looking card. */
const sectionWeight = (l: SectionList<unknown> | undefined): number => (!l ? 0 : 'error' in l ? 1 : l.total)

/** Why attribution failed, in words an operator can act on. Never a money claim. */
const AMBIGUITY_LABEL: Record<string, string> = {
  stripe_unreadable:          'La vérité Stripe n’a pas pu être lue. Aucune conclusion tirée. Réévaluée à chaque « Réconcilier d’après la preuve ».',
  refund_moved_unattributed:  'Des remboursements existent sur la commande, mais aucun ne porte l’identité de cette réclamation.',
  // ROUND-6 AUDIT FIX (P1): this path shared the label above, which is the OPPOSITE of its truth —
  // here exactly one refund DOES carry the identity, the reconciler just could not apply it.
  // ROUND-9: the same reason now also comes from a claim BOUND to a row (which may not carry the
  // claim's stamp), so the label states only what holds on both paths; the detail says which.
  reconcile_not_applied:      'La réconciliation n’a pas pu être appliquée sur la ligne de remboursement retenue pour cette réclamation — relancez « Réconcilier d’après la preuve ».',
  multiple_candidate_refunds: 'Plusieurs remboursements portent l’identité de cette réclamation.',
  no_payment_intent:          'Cette commande n’a aucun paiement Stripe enregistré : aucune preuve Stripe ne peut exister pour elle.',
  bound_row_missing:          'La réclamation est liée à une ligne de remboursement introuvable sur cette commande. Aucune conclusion tirée.',
  stripe_refund_contradiction: 'Ce que Stripe rapporte contredit ce qu’enregistre une ligne de remboursement (voir le détail). Aucune conclusion tirée.',
  unknown:                    'Cause d’ambiguïté non renseignée.',
}

/** ROUND-8 AUDIT FIX (P1, parity): one legend per SERVER refusal code (lib/claim-attribution-rules). */
const REFUSAL_LEGEND: Record<string, string> = {
  stamped_for_other_claim: 'porte l’identité d’une AUTRE réclamation — sera refusé',
  own_stamp_exists:        'une autre ligne porte déjà l’identité de CETTE réclamation — sera refusé',
  bound_to_other_claim:    'déjà LIÉ à une autre réclamation — sera refusé',
  unusable_status:         'statut inexploitable — sera refusé',
  // ROUND 13 (B10): the rule's full refusal order.
  other_order:             'appartient à une autre commande — sera refusé',
  row_failed:              'ligne échouée — ne peut solder aucune réclamation, sera refusé',
}

/**
 * `initialData` (ROUND 13, slice W7): the GET /api/admin/claims/financial-verification payload a test renders the card with
 * (J-M29 / J-C30 control parity). The page mounts the card without it; the load below then reads the route.
 */
export default function AdminFinancialVerification({ initialData }: { initialData?: Payload } = {}) {
  const locale = useLocale()
  const toast = useToast()
  const [data, setData] = useState<Payload | null>(initialData ?? null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/claims/financial-verification')
      if (!res.ok) { setLoadError(res.status === 403 ? 'accès refusé' : 'HTTP ' + res.status); return }
      setLoadError(null)
      setData((await res.json()) as Payload)
    } catch (e) {
      // AUDIT FIX (T-49 audit): silently returning made a FAILED load look exactly like an empty
      // queue — the one confusion this section cannot afford, since "nothing here" is the whole
      // reassurance it offers. A failure now says so.
      setLoadError(e instanceof Error ? e.message : 'erreur réseau')
    }
  }, [])
  useEffect(() => { void load() }, [load])

  // The ONLY action offered here. It reads Stripe and our own refund rows, identifies which
  // refund belongs to this claim, and applies the truth that already exists. It cannot create a
  // refund: there is no engine call behind it. When evidence is inconclusive the claim stays
  // exactly where it is — pressing the button again will not invent an answer.
  const reconcile = useCallback(async (id: string) => {
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/claims/${id}/reconcile`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error((body as { error?: string }).error || 'Échec de la réconciliation.'); return }
      const result = (body as { result?: { outcome?: string; reason?: string; until?: string; evidence?: string; payableFrom?: string; boundRowId?: string; stripeStatus?: string; detail?: string } }).result
      // ROUND-3 AUDIT FIX: every outcome rendered as a green success, including "still indeterminate", "the refund FAILED"
      // and "the rail is locked shut". A green tick on those is the tone telling the operator the opposite of the text.
      // ROUND 13 (F14, slice W7): the said map and its tone are the pure reconcileToast (lib/claim-console-copy), pinned per
      // outcome; an outcome it does not know is never rendered as a success.
      const { text, needsAttention } = reconcileToast(result, (iso) => new Date(iso).toLocaleString('fr-FR'))
      if (needsAttention) toast.error(text)
      else toast.success(text)
      // ROUND 13 (H07): the closure-notice attempt the server made after a 'refunded' outcome.
      const e = customerEmailLine((body as { customerEmail?: { status?: string; why?: string } | null }).customerEmail)
      if (e) toast[e.tone](CUSTOMER_EMAIL_FR[e.key])
      await load()
    } catch {
      toast.error('Échec de la réconciliation.')
    } finally { setBusyId(null) }
  }, [load, toast])

  // THE ESCALATION EXIT. The operator supplies the missing LINK — which existing refund of this
  // order belongs to this claim — and the server reads THAT row's status and amount and applies
  // it. The operator states no outcome and no amount, and this moves no money.
  const attribute = useCallback(async (claimId: string, refundRowId: string) => {
    setBusyId(claimId)
    try {
      const res = await fetch(`/api/admin/claims/${claimId}/attribute`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refundRowId }),
      })
      const body = await res.json().catch(() => ({}))
      // ROUND 13 (D8, G12): every refusal — identity, Stripe evidence not proven, a lost race (C7) — is a 409 whose
      // server text says exactly what was established. The console renders it verbatim.
      if (!res.ok) { toast.error((body as { error?: string }).error || 'Attribution refusée.'); return }
      const result = (body as { result?: { outcome?: string; rowStatusBefore?: string } }).result
      // ROUND 13 (G12): the only success is 'refunded' — a binding committed on Stripe evidence read before any write.
      // No other outcome exists; anything else is shown as unconfirmed, never as a success.
      if (result?.outcome !== 'refunded') {
        toast.error('Réponse inattendue : rien n’est confirmé. Relisez sa ligne dans la file.')
        await load()
        return
      }
      toast.success(attributionSuccessText(result.rowStatusBefore ?? ''))
      // ROUND 13 (H07): the closure-notice attempt the server made after the observed commit.
      const e = customerEmailLine((body as { customerEmail?: { status?: string; why?: string } | null }).customerEmail)
      if (e) toast[e.tone](CUSTOMER_EMAIL_FR[e.key])
      await load()
    } catch {
      toast.error('Attribution refusée.')
    } finally { setBusyId(null) }
  }, [load, toast])

  // ── ROUND-6 AUDIT FIX (filed P0, confirmed P1) — THE STRIPE-ANCHORED EXIT ─────────────
  // The attribution panel above needs a LOCAL refund row to offer. A refund issued from the Stripe
  // Dashboard leaves none, so a claim parked because "money moved but no row is ours" had NO exit
  // here short of paying twice. The operator now supplies the Stripe refund id they read in the
  // Dashboard — an IDENTIFIER, never an amount or an outcome — and the server proves at Stripe
  // that it sits on this order's payment before mirroring it. Two steps on purpose: « Vérifier »
  // is read-only and shows the facts Stripe returned; « Lier » is the single write.
  type StripeFacts = { stripeRefundId: string; stripeStatus: string; amountCents: number; paymentIntentId: string | null; chargeId: string | null; createdAt: string | null; source: 'stripe' | 'local_row' }
  const [stripeIdDraft, setStripeIdDraft] = useState<Record<string, string>>({})
  // ROUND-7 AUDIT FIX (P2): the preview is stored WITH the id it describes and whether « Lier »
  // would write; « Lier » is enabled only while the draft still equals the verified id, so a
  // preview never authorises a different identifier typed afterwards.
  const [stripePreview, setStripePreview] = useState<Record<string, (StripeFacts & { wouldWrite: boolean }) | null>>({})
  /** What a REFUSED verification read — shown, but never arming « Lier ». */
  const [refusedFacts, setRefusedFacts] = useState<Record<string, (StripeFacts & { wrote: boolean | null }) | null>>({})

  // ROUND-9 AUDIT FIX (P2): the declaration close existed only in the arbitration console, which is not
  // rendered while claims are closed — yet the rail-locked and dead-row copy sends the operator to it.
  // Same route (ungated), same toasts, on this card too.
  const [stuckId, setStuckId] = useState<string | null>(null)
  const [stuckReason, setStuckReason] = useState('')
  const resolveStuck = useCallback(async (id: string, resolution: 'settled_out_of_band' | 'closed_no_payment') => {
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/claims/${id}/resolve-stuck`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ resolution, reason: stuckReason || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error((data as { error?: string }).error || 'Échec de la clôture.'); return }
      toast.success(resolution === 'settled_out_of_band'
        ? 'Dossier clôturé sur votre déclaration (payé autrement, hors système). Cette action n’a déplacé aucun argent et n’a rien vérifié chez Stripe.'
        : 'Dossier clôturé sans paiement, sur votre déclaration. Cette action n’a déplacé aucun argent ; elle ne dit rien des remboursements déjà présents sur la commande.')
      // ROUND-11 AUDIT FIX (P3): the note lives only in the admin audit, which is best effort.
      if ((data as { noteRecorded?: boolean | null }).noteRecorded === false) toast.error('Votre note n’a pas pu être enregistrée dans le journal d’audit : conservez-la ailleurs.')
      // ROUND 13 (H07): the closure-notice attempt the server made after the declaration.
      const e = customerEmailLine((data as { customerEmail?: { status?: string; why?: string } | null }).customerEmail)
      if (e) toast[e.tone](CUSTOMER_EMAIL_FR[e.key])
      setStuckId(null); setStuckReason('')
      await load()
    } catch {
      toast.error('Échec de la clôture.')
    } finally { setBusyId(null) }
  }, [load, stuckReason, toast])

  const adoptStripe = useCallback(async (claimId: string, dryRun: boolean) => {
    const stripeRefundId = (stripeIdDraft[claimId] ?? '').trim()
    if (!stripeRefundId) { toast.error('Saisissez l’identifiant Stripe du remboursement (re_…).'); return }
    setBusyId(claimId)
    try {
      const res = await fetch(`/api/admin/claims/${claimId}/attribute`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ stripeRefundId, dryRun }),
      })
      const body = await res.json().catch(() => ({})) as { error?: string; facts?: StripeFacts | null; wrote?: boolean | null; result?: { outcome?: string; facts?: StripeFacts; wouldWrite?: boolean } }
      if (!res.ok) {
        // A refusal shows what was read, but never arms « Lier »: the preview is cleared.
        setStripePreview((p) => ({ ...p, [claimId]: null }))
        setRefusedFacts((p) => ({ ...p, [claimId]: body.facts ? { ...body.facts, wrote: body.wrote ?? null } : null }))
        toast.error(body.error || (dryRun ? 'Vérification refusée.' : 'Liaison refusée.'))
        return
      }
      if (dryRun) {
        const facts = body.result?.facts
        setRefusedFacts((p) => ({ ...p, [claimId]: null }))
        setStripePreview((p) => ({ ...p, [claimId]: facts ? { ...facts, wouldWrite: body.result?.wouldWrite !== false } : null }))
        toast.success(facts?.source === 'local_row'
          ? 'Ce remboursement est déjà enregistré ici pour cette réclamation — Stripe n’a pas été relu par cette vérification. « Lier » le relira chez Stripe, puis ne fera que la liaison.'
          : 'Vérifié chez Stripe — rien n’a été écrit. Relisez les faits ci-dessous avant de lier.')
        return
      }
      setStripePreview((p) => ({ ...p, [claimId]: null }))
      // ROUND 13 (B11 (a), W4 fixer): every adoption success is bound on the Stripe object read by this request (both
      // branches) — the former « Stripe n’a pas été relu » branch was unreachable and would now be false.
      toast.success('Remboursement Stripe lié : la réclamation reflète ce remboursement tel que Stripe vient de le rapporter.')
      // ROUND 13 (H07): the closure-notice attempt the server made after the observed commit.
      const e = customerEmailLine((body as { customerEmail?: { status?: string; why?: string } | null }).customerEmail)
      if (e) toast[e.tone](CUSTOMER_EMAIL_FR[e.key])
      await load()
    } catch {
      toast.error(dryRun ? 'Vérification impossible.' : 'Liaison impossible.')
    } finally { setBusyId(null) }
  }, [load, toast, stripeIdDraft])

  // ROUND 13 (H10 / D10 (iv), slice W7): « Envoyer l’avis au client » — the per-claim resend. The body is empty: the notice's
  // content comes from the database and, for a refunded claim, from Stripe's refund object the server reads. No money path.
  const sendClosureNotice = useCallback(async (claimId: string) => {
    setBusyId(claimId)
    try {
      const res = await fetch(`/api/admin/claims/${claimId}/closure-notice`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      // A refusal (no longer a closure, a reversal marked by the server's read, a claim that changed) renders the server text.
      if (!res.ok) { toast.error((body as { error?: string }).error || 'Envoi de l’avis refusé — rien n’est confirmé. Rechargez la liste.'); await load(); return }
      const e = customerEmailLine((body as { customerEmail?: { status?: string; why?: string } | null }).customerEmail)
      if (e) toast[e.tone](CUSTOMER_EMAIL_FR[e.key])
      else toast.error('Aucun avis n’a été tenté pour cette réclamation — rechargez la liste.')
      await load()
    } catch {
      toast.error('Envoi de l’avis impossible — rien n’est confirmé. Rechargez la liste.')
    } finally { setBusyId(null) }
  }, [load, toast])

  // ROUND 13 (AMF-1, slice W7): « Revérifier les remboursements soldés (35 jours) » — POST /api/admin/claims/reconcile-refunds
  // with the admin session. Read-only toward Stripe, claim-only markings: no engine call, no Refund write, no customer e-mail.
  const reverifySettled = useCallback(async () => {
    setBusyId('__settled_reverify__')
    try {
      const res = await fetch('/api/admin/claims/reconcile-refunds', { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(`Revérification refusée ou interrompue (${(body as { error?: string }).error || `HTTP ${res.status}`}) : son résultat n’est pas établi. ${NO_MONEY_HERE}`)
        return
      }
      const r = settledReverifyToast(body)
      if (r.needsAttention) toast.error(r.text)
      else toast.success(r.text)
      await load()
    } catch {
      toast.error(`Revérification impossible : son résultat n’est pas établi. ${NO_MONEY_HERE}`)
    } finally { setBusyId(null) }
  }, [load, toast])

  const rows = [
    ...(data?.reconcileRequired ?? []).map((r) => ({ ...r, kind: 'reconcile_required' as const })),
    ...(data?.financialVerification ?? []).map((r) => ({ ...r, kind: 'financial_verification' as const })),
    // AUDIT FIX: the reconciler's own success outcomes move a claim OUT of the two lists above
    // (a still-pending refund goes back to 'refunding' with the marker cleared), and legacy rows
    // never had a marker at all. Without this bucket those cases vanished from the only surface
    // that survives the feature flag.
    ...(data?.otherUnsettled ?? []).map((r) => ({ ...r, kind: 'other_unsettled' as const })),
  ]
  if (loadError) {
    return (
      <section className="mb-6 rounded-grubano-xl border border-red-400 bg-red-50 p-4">
        <h2 className="text-sm font-bold uppercase tracking-wide text-red-800">
          File « vérification financière » ILLISIBLE
        </h2>
        <p className="mt-1 text-[13px] text-grubano-ink">
          Impossible de charger la file ({loadError}). Une file vide et une file illisible ne se
          ressemblent pas : ceci n’est PAS une preuve qu’aucune réclamation n’attend. Rechargez, et
          si l’erreur persiste, traitez-la comme un incident.
        </p>
      </section>
    )
  }
  const unfinalized = data?.unfinalizedRefundRows ?? []
  const refundedList = data?.refundedUnproven
  const noticesList = data?.closureNotices
  const restoNoticesList = data?.restaurantNotices
  // ROUND 13 (AMF-1, slice W7): the re-verification control renders whatever the queue holds — an E-09 claim is in no list.
  const settledReverifyControl = (
    <div className="mb-3 rounded-grubano-xl border border-grubano-border bg-grubano-surface p-3" data-section="settled-reverify">
      <Button size="sm" variant="secondary" disabled={busyId === '__settled_reverify__'} onClick={() => void reverifySettled()}>
        {SETTLED_REVERIFY_BUTTON}
      </Button>
      <p className="mt-1 text-[12px] text-grubano-ink-muted">{SETTLED_REVERIFY_CAPTION}</p>
    </div>
  )
  // ROUND 13 (E0 / H10, slice W7): the card is visible for claim rows, unfinalized rows or either section; the red heading and
  // its banner only for claim rows or unfinalized rows (financialVerificationHeadingVisible).
  if (!financialVerificationCardVisible({ claimRows: rows.length, unfinalizedRows: unfinalized.length, closureNotices: sectionWeight(noticesList), refundedUnproven: sectionWeight(refundedList) })) {
    return <section className="mb-6">{settledReverifyControl}</section>
  }
  const headingVisible = financialVerificationHeadingVisible({ claimRows: rows.length, unfinalizedRows: unfinalized.length })

  return (
    <section className="mb-6">
      {settledReverifyControl}
      {headingVisible && (
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-red-800">
        Vérification financière requise ({rows.length}){unfinalized.length ? ` · ${unfinalized.length} ligne(s) de remboursement encore en attente` : ''}
      </h2>
      )}
      {headingVisible && (
      <p className="mb-3 text-[13px] text-grubano-ink-muted">
        {/* RE-AUDIT FIX: this banner promised things that are only true of the AMBIGUOUS rows.
            The third bucket holds ordinary unsettled cases whose truth IS known and which the
            claims rail can still pay, so a blanket promise over all of them was false. */}
        {/* ROUND-4 AUDIT FIX: the banner sorted the third bucket under « état connu » while the
            row line on those same rows can say the opposite. It no longer promises a category. */}
        Toutes les réclamations dont l’argent n’est pas soldé, quelle qu’en soit la raison. Ce qui
        est établi, et ce qui ne l’est pas, est dit <strong>ligne par ligne</strong> : ne déduisez
        rien de la présence d’une réclamation dans cette file, lisez la ligne « Argent ».
        {' '}
        <strong>
          Le rail de remboursement admin ne lit PAS la table des réclamations : un remboursement
          lancé depuis cet autre écran ne serait arrêté par rien de ce qui est écrit ici. Vérifiez
          la commande dans Stripe avant tout paiement.
        </strong>
      </p>
      )}

      {/* ROUND-10 AUDIT FIX (P2): reconciliation can conclude a claim from Stripe while our own Refund
          row stays pending. Facts only, no action: finalizing a row is the refund engine's work. */}
      {unfinalized.length > 0 && (
        <div className="mb-3 rounded-grubano-xl border border-red-300 bg-red-50 p-3">
          <p className="text-[13px] font-semibold text-grubano-ink">
            Lignes de remboursement encore « en attente » dont la réclamation n’est plus en cours de remboursement ({unfinalized.length})
          </p>
          <p className="mt-1 text-[12px] text-grubano-ink-muted">
            Aucune réconciliation ne les a finalisées ni annulées : ni ligne de ledger ni reprise de royalty n’ont été
            appliquées par elle. Avant tout nouveau remboursement d’une commande, le moteur reprend la plus ancienne
            ligne en attente de cette commande. Une ligne reste listée tant qu’elle est « en attente » dans notre base.
            {/* ROUND 13 (D7 CONSOLE, slice W5): replaces « Aucune action n’est proposée ici. » */}
            {' '}La seule action proposée ici est « Réconcilier d’après la preuve » : elle relit la preuve chez Stripe et dans nos lignes, et ne déplace aucun argent.
          </p>
          <ul className="mt-2 space-y-1 text-[12px] text-grubano-ink">
            {unfinalized.map((u) => (
              <li key={u.rowId ?? u.refundRowId}>
                Commande #{u.orderId.slice(-6)} — ligne {u.rowId ?? u.refundRowId} ({(u.amountCents / 100).toFixed(2)} €
                {u.stripeRefundId ? `, Stripe ${u.stripeRefundId}` : ', sans identifiant Stripe enregistré'}) — réclamation {u.claimId ?? '—'} ({u.claimStatus ?? '—'})
                {/* D0: the control is rendered iff the server's verdict admits it; otherwise its refusal text. */}
                {u.claimId && u.reconcilable === true && (
                  <>
                    {' '}
                    <Button size="sm" variant="secondary" disabled={busyId === u.claimId} onClick={() => void reconcile(u.claimId as string)}>
                      Réconcilier d’après la preuve
                    </Button>
                  </>
                )}
                {u.claimId && u.reconcilable !== true && u.reconcileRefusal && (
                  <span className="ml-1 text-grubano-ink-muted">— {u.reconcileRefusal}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.id} className="rounded-grubano-xl border border-red-300 bg-red-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-bold text-grubano-ink">
                Commande #{r.orderId.slice(-6)}
              </span>
              <span className="text-sm font-semibold text-grubano-primary">
                {formatEuros(r.requestedAmountCents / 100, locale)} demandés
              </span>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2">
              {r.safety && <Badge tone="danger">Allergène / sécurité</Badge>}
              <Badge tone="danger">
                {r.kind === 'reconcile_required' ? 'Tentative interrompue — identité non liée'
                  : r.kind === 'financial_verification' ? 'Attribution impossible'
                  : 'Argent non soldé — à vérifier'}
              </Badge>
            </div>

            <dl className="mt-2 space-y-1 text-[13px] text-grubano-ink-muted">
              {/* RE-AUDIT FIX: "INDÉTERMINÉ" was printed on EVERY row, including ones whose money
                  state is known (a succeeded refund awaiting reconciliation, for instance). Saying
                  "unknown" about something the system knows is the same class of lie as saying
                  "nothing was paid" about something it never looked at. */}
              <p>
                <span className="font-semibold">Argent :</span>{' '}
                {/* ROUND-4 AUDIT FIX: the refundId branch was FALSE on exactly the rows where the
                    engine refused to attribute the refund (resume_mismatch) — a bound refund that
                    answers for somebody else. The decision is a pure, tested function now. */}
                {/* ROUND 13 (F15): the claim id, the bound row's reason and the server's reconcile verdict
                    travel in the payload; the line never names an exit the server refuses. */}
                {cardMoneyLine(r).text}
              </p>
              <p><span className="font-semibold">Réclamation :</span> <code>{r.id}</code></p>
              <p>
                <span className="font-semibold">Ouverte depuis :</span>{' '}
                {new Date(r.createdAt).toLocaleString(locale)}
              </p>
              {r.kind === 'financial_verification' && (
                <p><span className="font-semibold">Cause :</span> {AMBIGUITY_LABEL[r.ambiguity ?? 'unknown'] ?? AMBIGUITY_LABEL.unknown}</p>
              )}
              <p><span className="font-semibold">Remboursement lié :</span> {r.refundId ? <code>{r.refundId}</code> : 'aucun'}</p>
              {/* ROUND-11 AUDIT FIX (P2 ×2): the money line says the bound row's state is what counts, and
                  the toasts point to the claim's recorded detail — both are now on the card itself. */}
              {r.kind === 'other_unsettled' && r.refund && (
                <p>
                  <span className="font-semibold">Statut de notre ligne liée :</span> {r.refund.status}
                  {r.refund.stripeRefundId ? ` (Stripe ${r.refund.stripeRefundId})` : ' (sans identifiant Stripe enregistré)'}
                </p>
              )}
              {r.kind !== 'financial_verification' && r.refundError && (
                <p><span className="font-semibold">Détail enregistré :</span> {r.refundError}</p>
              )}
            </dl>

            {/* ROUND-3 AUDIT FIX. I reported this button as scoped in the previous round; the
                string replacement silently no-oped and it shipped unconditional. Offered on an
                ordinary approved-but-unpaid claim it stamps a recovery error onto a healthy case
                and reconciles nothing. It belongs to the states whose money truth is open. */}
            {/* ROUND-9 AUDIT FIX (Class 3/4): which action this card offers comes from the SERVER's own
                rules, carried in the payload — reconcile where the reconcile gate admits the claim, the
                declaration close where the stuck-money hatch accepts it, and otherwise the one fact-only
                line for that money state (lib/claim-action-rules). */}
            {/* ROUND 13 (D0 / D14 / D5, W3 round-1 fix): the control is rendered only where the server's reconcilable
                flag is true, on every bucket; a refused reconcile shows the server's own refusal text and no control. */}
            {r.reconcilable !== true && r.reconcileRefusal && (
              <p className="mt-3 text-[12px] text-grubano-ink-muted">{r.reconcileRefusal}</p>
            )}
            {r.reconcilable === true && (
              <>
                <Button
                  size="sm"
                  className="mt-3"
                  disabled={busyId === r.id}
                  onClick={() => reconcile(r.id)}
                >
                  Réconcilier d’après la preuve
                </Button>
                <p className="mt-1 text-[12px] text-grubano-ink-muted">
                  Lit Stripe et les lignes de remboursement existantes. Ne crée aucun
                  remboursement, ne relance rien, ne déplace aucun argent.
                </p>
                {/* ROUND 13 (D4 / J-M33, slice W7): shown BEFORE the click on an approved claim — relire la preuve peut la parquer. */}
                {r.status === 'approved' && (
                  <p className="mt-1 text-[12px] text-amber-800">{D4_PRECLICK_CAPTION}</p>
                )}
              </>
            )}
            {r.kind === 'other_unsettled' && r.resolvable === true && (
              stuckId === r.id ? (
                <div className="mt-3 space-y-2 rounded-grubano-lg border border-grubano-border bg-grubano-surface p-3">
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
                    <Button size="sm" disabled={busyId === r.id} onClick={() => resolveStuck(r.id, 'settled_out_of_band')}>
                      Je déclare : payé autrement, hors système
                    </Button>
                    <Button size="sm" variant="secondary" disabled={busyId === r.id} onClick={() => resolveStuck(r.id, 'closed_no_payment')}>
                      Clôturer sans paiement
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busyId === r.id} onClick={() => { setStuckId(null); setStuckReason('') }}>
                      Annuler
                    </Button>
                  </div>
                </div>
              ) : (
                <Button size="sm" variant="secondary" className="mt-3" disabled={busyId === r.id} onClick={() => { setStuckId(r.id); setStuckReason('') }}>
                  Clôturer ce dossier…
                </Button>
              )
            )}
            {r.kind === 'other_unsettled' && (
              <p className="mt-3 text-[12px] text-grubano-ink-muted">{moneyStateGuidance(r.moneyState ?? '')}</p>
            )}

            {r.kind === 'financial_verification' && (
              <div className="mt-3 rounded-grubano-lg border border-grubano-border bg-grubano-surface p-3">
                <p className="text-[13px] font-semibold text-grubano-ink">
                  Lier un remboursement fait depuis le Dashboard Stripe (re_…)
                </p>
                <p className="mt-1 text-[12px] text-grubano-ink-muted">
                  Un remboursement lancé depuis le Dashboard Stripe ne laisse aucune ligne ici. Saisissez
                  son identifiant : le serveur vérifie chez Stripe qu’il porte sur le paiement de cette
                  commande{r.orderStripePaymentIntentId ? <> (<code>{r.orderStripePaymentIntentId}</code>)</> : null}
                  {' '}et ne l’enregistre que s’il a ABOUTI. Vous fournissez un identifiant, jamais un
                  montant ni un résultat. Aucun argent n’est déplacé.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
                  <input
                    className="rounded border border-grubano-border px-2 py-1 font-mono text-[12px]"
                    placeholder="re_…"
                    value={stripeIdDraft[r.id] ?? ''}
                    onChange={(e) => setStripeIdDraft((d) => ({ ...d, [r.id]: e.target.value }))}
                    disabled={busyId === r.id}
                  />
                  <Button size="sm" variant="secondary" disabled={busyId === r.id} onClick={() => adoptStripe(r.id, true)}>
                    Vérifier chez Stripe
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busyId === r.id || !stripePreview[r.id] || stripePreview[r.id]!.stripeRefundId !== (stripeIdDraft[r.id] ?? '').trim()}
                    onClick={() => adoptStripe(r.id, false)}
                  >
                    Lier
                  </Button>
                </div>
                {stripePreview[r.id] && (
                  <dl className="mt-2 space-y-0.5 text-[12px] text-grubano-ink-muted">
                    <p>
                      <span className="font-semibold">{stripePreview[r.id]!.source === 'local_row' ? 'Notre ligne dit :' : 'Stripe dit :'}</span>{' '}
                      <code>{stripePreview[r.id]!.stripeRefundId}</code> — statut <code>{stripePreview[r.id]!.stripeStatus}</code>, montant {formatEuros(stripePreview[r.id]!.amountCents / 100, locale)}
                    </p>
                    <p><span className="font-semibold">Paiement :</span> <code>{stripePreview[r.id]!.paymentIntentId ?? '—'}</code> · charge <code>{stripePreview[r.id]!.chargeId ?? '—'}</code></p>
                    <p>
                      {stripePreview[r.id]!.wouldWrite
                        ? 'Ce sont les valeurs qui seront enregistrées et liées telles quelles. « Lier » ne les modifie pas.'
                        : 'La ligne existe déjà : « Lier » relira ce remboursement chez Stripe, puis ne fera que la liaison, sans rien écrire d’autre.'}
                    </p>
                  </dl>
                )}
                {refusedFacts[r.id] && (
                  <p className="mt-2 text-[12px] text-red-700">
                    {/* ROUND-8 AUDIT FIX (P2): « Rien n’a été écrit » was printed on refusals that come AFTER
                        the mirror row was created. It is said only when the server proved it. */}
                    {/* ROUND 13 (B11 (a), W4 fixer): the facts say where they were read, and the wrote sentence comes from
                        the shared pure mapping (null after a binding commit reported lost or a failed re-read). */}
                    Refusé — {refusedFacts[r.id]!.source === 'local_row' ? 'notre ligne enregistre' : 'Stripe rapporte'} : <code>{refusedFacts[r.id]!.stripeRefundId}</code>, statut <code>{refusedFacts[r.id]!.stripeStatus}</code>, paiement <code>{refusedFacts[r.id]!.paymentIntentId ?? '—'}</code>.{' '}
                    {adoptionRefusalWroteText(refusedFacts[r.id]!.wrote)}
                  </p>
                )}
              </div>
            )}

            {r.kind === 'financial_verification' && (r.candidateRefunds?.length ?? 0) > 0 && (
              <div className="mt-3 rounded-grubano-lg border border-grubano-border bg-grubano-surface p-3">
                <p className="text-[13px] font-semibold text-grubano-ink">
                  Attribuer un remboursement existant de cette commande
                </p>
                <p className="mt-1 text-[12px] text-grubano-ink-muted">
                  À utiliser quand vous savez, hors système, lequel de ces remboursements correspond
                  à cette réclamation. Vous choisissez le LIEN, pas le résultat : Stripe est lu avant
                  toute écriture, et le lien n’est écrit que si Stripe rapporte ce remboursement ABOUTI.
                  Aucun argent n’est déplacé.
                </p>
                <ul className="mt-2 space-y-2">
                  {r.candidateRefunds!.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                      <code>{c.id}</code>
                      <span>{formatEuros(c.amountCents / 100, locale)}</span>
                      <Badge tone={c.status === 'succeeded' ? 'warning' : 'neutral'}>{c.status}</Badge>
                      {c.belongsToThisClaim && (
                        <Badge tone="warning">porte l’identité de CETTE réclamation</Badge>
                      )}
                      {/* ROUND-8 AUDIT FIX (P1, Class 3 a third time): legend and disable come from the
                          SERVER's own verdict for this row (lib/claim-attribution-rules), so a refusal
                          can no longer be added on one side only. */}
                      {c.refusal && (
                        <Badge tone="danger">{REFUSAL_LEGEND[c.refusal] ?? 'sera refusé'}</Badge>
                      )}
                      {/* ROUND 13 (B10, G12): a pending row is bound only on Stripe evidence read before any write. */}
                      {c.status === 'pending' && c.refusal == null && (
                        <Badge tone="neutral">{PENDING_ROW_LEGEND}</Badge>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busyId === r.id || c.refusal != null}
                        onClick={() => attribute(r.id, c.id)}
                      >
                        Attribuer
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {/* ROUND-4 AUDIT FIX: scoping the button left its caption behind here, so it rendered
                on EVERY card — twice on the ones that do have a button, and as a dangling promise
                about an action on the ones that do not. The caption now lives with the button. */}
          </div>
        ))}
      </div>

      {/* ROUND 13 (H10 / E0, slice W7): the two sections rendered OUTSIDE the red heading and kept out of `total`. An
          unreadable list still renders its section with « Liste illisible » (fail visible). */}
      {refundedList && sectionWeight(refundedList) > 0 && (
        <div className="mt-4 rounded-grubano-xl border border-amber-300 bg-amber-50 p-4" data-section="refunded-unproven">
          <h3 className="text-sm font-bold text-amber-900">
            {refundedUnprovenHeading('error' in refundedList ? null : refundedList.total, !('error' in refundedList) && refundedList.scanTruncated)}
          </h3>
          <p className="mt-1 text-[13px] text-grubano-ink">{REFUNDED_UNPROVEN_TEXT}</p>
          {'error' in refundedList ? (
            <p className="mt-2 text-[13px] text-red-700">{LIST_UNREADABLE_TEXT}</p>
          ) : (
            <>
              {refundedList.scanTruncated && <p className="mt-2 text-[12px] text-amber-900">{REFUNDED_UNPROVEN_TRUNCATED}</p>}
              {refundedList.items.length < refundedList.total && <p className="mt-2 text-[12px] text-amber-900">{itemsCappedText(refundedList.items.length, refundedList.total, 'oldest')}</p>}
              <ul className="mt-2 space-y-2 text-[13px] text-grubano-ink">
                {refundedList.items.map((c) => (
                  <li key={c.id}>
                    Commande #{c.orderId.slice(-6)} — réclamation <code>{c.id}</code> — ligne liée{' '}
                    {c.refundId ? <code>{c.refundId}</code> : 'aucune'}
                    {c.refund ? ` (statut enregistré : ${c.refund.status}${c.refund.orderId !== c.orderId ? ', autre commande' : ''})` : c.refundId ? ' (introuvable)' : ''}
                    {/* D0: the control iff the server's reconcile verdict admits the claim; otherwise the no-action line. */}
                    {c.reconcilable === true ? (
                      <>
                        {' '}
                        <Button size="sm" variant="secondary" disabled={busyId === c.id} onClick={() => reconcile(c.id)}>
                          Réconcilier d’après la preuve
                        </Button>
                        <span className="ml-1 text-[12px] text-grubano-ink-muted">— {REFUNDED_UNPROVEN_RECONCILE_CAPTION}</span>
                      </>
                    ) : (
                      <span className="ml-1 text-[12px] text-grubano-ink-muted">— {REFUNDED_UNPROVEN_NO_ACTION}</span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {noticesList && sectionWeight(noticesList) > 0 && (
        <div className="mt-4 rounded-grubano-xl border border-grubano-border bg-grubano-surface p-4" data-section="closure-notices">
          <h3 className="text-sm font-bold text-grubano-ink">
            {closureNoticesHeading('error' in noticesList ? null : noticesList.total, !('error' in noticesList) && noticesList.scanTruncated)}
          </h3>
          <p className="mt-1 text-[13px] text-grubano-ink-muted">{CLOSURE_NOTICES_INTRO}</p>
          {'error' in noticesList ? (
            <p className="mt-2 text-[13px] text-red-700">{LIST_UNREADABLE_TEXT}</p>
          ) : (
            <>
              {noticesList.scanTruncated && <p className="mt-2 text-[12px] text-grubano-ink-muted">{CLOSURE_NOTICES_TRUNCATED}</p>}
              {noticesList.items.length < noticesList.total && <p className="mt-2 text-[12px] text-grubano-ink-muted">{itemsCappedText(noticesList.items.length, noticesList.total, 'newest')}</p>}
              <ul className="mt-2 space-y-2 text-[13px] text-grubano-ink">
                {noticesList.items.map((n) => (
                  <li key={n.claimId}>
                    Commande #{n.orderId.slice(-6)} — réclamation <code>{n.claimId}</code> — {CLOSURE_KIND_LABEL[n.kind] ?? n.kind}
                    {n.decidedAt ? ` — clôturée le ${new Date(n.decidedAt).toLocaleString(locale)}` : ''}
                    {' '}
                    {/* H10: disabled when a blocker is set, and the blocker's line says why (D0: never a silent disabled button). */}
                    <Button size="sm" variant="secondary" disabled={busyId === n.claimId || n.blocker !== null} onClick={() => sendClosureNotice(n.claimId)}>
                      {CLOSURE_NOTICE_BUTTON}
                    </Button>
                    {n.blocker && <p className="mt-1 text-[12px] text-red-700">{CLOSURE_BLOCKER_LINE[n.blocker]}</p>}
                    {/* D′ L8 (§18): whether the RESTAURANT was told what the refund cost it, and if not, why.
                        A different message with different conditions from the customer's notice above. */}
                    {n.restaurantNotice && RESTAURANT_NOTICE_LINE[n.restaurantNotice] && (
                      <p className={`mt-1 text-[12px] ${n.restaurantNotice === 'ledger_incomplete' ? 'text-red-700' : 'text-grubano-ink-muted'}`}>
                        {RESTAURANT_NOTICE_LINE[n.restaurantNotice]}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {restoNoticesList && sectionWeight(restoNoticesList) > 0 && (
        <div className="mt-4 rounded-grubano-xl border border-grubano-border bg-grubano-surface p-4" data-section="restaurant-notices">
          <h3 className="text-sm font-bold text-grubano-ink">
            {RESTAURANT_NOTICES_HEADING('error' in restoNoticesList ? null : restoNoticesList.total)}
          </h3>
          <p className="mt-1 text-[13px] text-grubano-ink-muted">{RESTAURANT_NOTICES_INTRO}</p>
          {'error' in restoNoticesList ? (
            <p className="mt-2 text-[13px] text-red-700">{LIST_UNREADABLE_TEXT}</p>
          ) : (
            <ul className="mt-2 space-y-2 text-[13px] text-grubano-ink">
              {restoNoticesList.items.map((n) => (
                <li key={n.claimId}>
                  Commande #{n.orderId.slice(-6)} — réclamation <code>{n.claimId}</code>
                  {n.decidedAt ? ` — clôturée le ${new Date(n.decidedAt).toLocaleString(locale)}` : ''}
                  {' '}
                  {/* Same button as the customer notice: the route sends BOTH, each on its own conditions.
                      Disabled when the accounting proof is missing — never a silent disabled control. */}
                  <Button size="sm" variant="secondary" disabled={busyId === n.claimId || n.state !== 'pending'} onClick={() => sendClosureNotice(n.claimId)}>
                    {CLOSURE_NOTICE_BUTTON}
                  </Button>
                  <p className={`mt-1 text-[12px] ${n.state === 'pending' ? 'text-grubano-ink-muted' : 'text-red-700'}`}>
                    {RESTAURANT_NOTICE_STATE_LINE[n.state]}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
