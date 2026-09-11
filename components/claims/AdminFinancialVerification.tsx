'use client'

import { useState, useEffect, useCallback } from 'react'
import { useLocale } from 'next-intl'
import { Button, Badge, useToast } from '@/components/design-system'
import { formatEuros } from '@/lib/format-money'
import { moneyLineFor } from '@/lib/claim-money-line'
import { moneyStateGuidance } from '@/lib/claim-action-rules'

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
  counts: { financialVerification: number; reconcileRequired: number; otherUnsettled: number; total: number }
}

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
  pending_unconfirmed:     'en attente sans identifiant Stripe enregistré — sera refusé',
}

export default function AdminFinancialVerification() {
  const locale = useLocale()
  const toast = useToast()
  const [data, setData] = useState<Payload | null>(null)
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
      const result = (body as { result?: { outcome?: string; reason?: string; until?: string } }).result
      const outcome = result?.outcome
      const said: Record<string, string> = {
        refunded:               'Preuve trouvée : le remboursement a abouti. Réclamation réconciliée sur son identité exacte.',
        refund_failed:          'Preuve trouvée : cette ligne de remboursement a ÉCHOUÉ, elle n’a donc rien versé. La réclamation redevient traitable. (Cela ne dit rien des autres remboursements de la commande.)',
        // AUDIT FIX: this branch reads OUR row, not Stripe. Say that, rather than asserting a
        // Stripe state nobody consulted.
        // ROUND-9: this outcome now comes from a Stripe read that found the refund pending.
        still_pending:          'Stripe rapporte ce remboursement EN ATTENTE : rien n’est clos, aucun second remboursement. Relancez « Réconcilier d’après la preuve » lorsqu’il sera terminal.',
        stripe_unreadable_retry: 'Stripe n’a pas pu être lu complètement : rien n’est conclu, rien n’a été modifié. Relancez la réconciliation.',
        engine_row_dead:        'Stripe ne connaît aucun remboursement pour cette ligne, et le moteur ne la créera plus : elle n’a rien versé, et rien ne sera payé par Grubano pour cette réclamation. Le dossier est désormais clôturable (« Clôturer ce dossier… »).',
        // ROUND-6 AUDIT FIX (P2): « de nouveau payable par le rail normal » promised a payment the
        // closed rail will refuse. Say the state it returns to, and the only thing that will pay it.
        // ROUND-7 AUDIT FIX (P1): « ne sera versée que par le rail » still promised a payment no
        // reachable job performs — the auto-approve sweep is behind a flag documented OFF for the
        // whole beta and its cron is gone. What pays it is a human approving it again.
        no_refund_proven:       'Preuve d’absence : aucun remboursement n’a jamais déplacé d’argent et Stripe n’en rapporte aucun. La réclamation repasse en « approuvée, non payée ». Rien ne la paiera automatiquement : elle devra être approuvée à nouveau par un admin, réclamations et remboursements ouverts.',
        // ROUND-3 AUDIT FIX: this case previously received the message above. Nothing moved, which
        // is true — but a FAILED refund with a Stripe id locks the engine against every later
        // refund on that order, so "payable again" was the opposite of what will happen. Three
        // auditors flagged that the honest reason was written to a field no human reads.
        // ROUND-8 AUDIT FIX (P1): « tant que la reprise manuelle Stripe n’a pas été faite » said the
        // lock lifts. It never does — no code moves a Refund row out of 'failed'.
        // ROUND-9: the lock has two causes now (a failed refund with a Stripe id, or a dead pending
        // row), so the toast states what holds for both; the claim's detail says which. The close
        // control is on this card too.
        no_refund_proven_rail_locked:
          'Preuve d’absence : rien n’est parti. MAIS le moteur refusera tout remboursement sur cette commande, DÉFINITIVEMENT (voir le détail de la réclamation). Rien ne sera payé par le rail. Si un remboursement a été fait hors système (Dashboard Stripe), déclarez-le (« Clôturer ce dossier… ») ; sinon clôturez sans paiement.',
        financial_verification: 'Toujours indéterminé. Aucune conclusion, aucun argent, aucune clôture. Escalade opérateur requise.',
      }
      // ROUND-3 AUDIT FIX: every outcome rendered as a green success, including "still
      // indeterminate", "the refund FAILED" and "the rail is locked shut". A green tick on those
      // is the tone telling the operator the opposite of the text.
      const needsAttention = outcome === 'financial_verification'
        || outcome === 'refund_failed'
        || outcome === 'no_refund_proven_rail_locked'
        || outcome === 'stripe_unreadable_retry'
        || outcome === 'unconfirmed_within_window'
        || outcome === 'engine_row_dead'
      // ROUND-6 AUDIT FIX (P2): the library reports 'already_parked_or_moved' precisely when its
      // park CAS matched NOTHING — the claim was already parked, or a concurrent webhook moved it,
      // possibly to a terminal state. This handler ignored `reason` and announced « aucune
      // clôture » on the one outcome that means the claim may have just been closed. Say only
      // what is established: nothing was modified here; read the row again.
      const text = outcome === 'financial_verification' && result?.reason === 'already_parked_or_moved'
        // ROUND-8 AUDIT FIX (P3): since the relabel CAS, an already-parked claim is refreshed, never
        // reported here — this outcome now means the claim LEFT every modifiable state, maybe closed.
        ? 'Rien n’a été modifié : la réclamation a quitté les états modifiables entre-temps (peut-être clôturée). Relisez sa ligne dans la file.'
        : outcome === 'unconfirmed_within_window'
          ? `Stripe ne connaît aucun remboursement pour la ligne en attente, mais il est trop tôt pour conclure qu’il n’existera pas (fenêtre d’idempotence du moteur, plus une marge). Rien n’a été modifié. Conclusion possible à partir du ${result?.until ? new Date(result.until).toLocaleString('fr-FR') : '—'} : relancez alors la réconciliation.`
          : said[outcome ?? ''] ?? 'Réconciliation terminée.'
      if (needsAttention) toast.error(text)
      else toast.success(text)
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
      if (!res.ok) { toast.error((body as { error?: string }).error || 'Attribution refusée.'); return }
      const outcome = (body as { result?: { outcome?: string } }).result?.outcome
      // ROUND-4 AUDIT FIX: the tone fix was applied to reconcile() only, so attributing a FAILED
      // refund still announced itself with a green tick. Same rule on both handlers.
      const text = outcome === 'refunded'
        ? 'Remboursement attribué : la réclamation reflète désormais ce remboursement réel.'
        : outcome === 'refund_failed'
          // ROUND-5 AUDIT FIX: I added "Aucun argent n'a atteint le client" here in the round-4
          // pass — a blanket cash claim about the CUSTOMER derived from one ROW's status. The row
          // failing means that refund paid nothing; it says nothing about other refunds on the
          // order. Four rounds were spent removing exactly this shape and I reintroduced it.
          ? 'Remboursement attribué : cette ligne de remboursement avait ÉCHOUÉ, elle n’a donc rien versé. La réclamation redevient traitable. (Cela ne dit rien des autres remboursements de la commande.)'
          : 'Remboursement attribué : la ligne n’est pas encore terminale. Rien n’est clos.'
      if (outcome === 'refund_failed') toast.error(text)
      else toast.success(text)
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
          ? 'Ce remboursement est déjà enregistré ici pour cette réclamation — Stripe n’a pas été relu. « Lier » ne fera que la liaison.'
          : 'Vérifié chez Stripe — rien n’a été écrit. Relisez les faits ci-dessous avant de lier.')
        return
      }
      setStripePreview((p) => ({ ...p, [claimId]: null }))
      // ROUND-8 AUDIT FIX (P3): on the crash-resume branch Stripe is NOT re-read — say which it was.
      toast.success(body.result?.facts?.source === 'local_row'
        ? 'Remboursement lié : la réclamation reflète la ligne enregistrée plus tôt depuis Stripe. Stripe n’a pas été relu par cette action.'
        : 'Remboursement Stripe lié : la réclamation reflète ce remboursement tel que Stripe vient de le rapporter.')
      await load()
    } catch {
      toast.error(dryRun ? 'Vérification impossible.' : 'Liaison impossible.')
    } finally { setBusyId(null) }
  }, [load, toast, stripeIdDraft])

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
  if (!rows.length) return null

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-red-800">
        Vérification financière requise ({rows.length})
      </h2>
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
                {moneyLineFor({ kind: r.kind, refundId: r.refundId, refundError: r.refundError }).text}
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
            </dl>

            {/* ROUND-3 AUDIT FIX. I reported this button as scoped in the previous round; the
                string replacement silently no-oped and it shipped unconditional. Offered on an
                ordinary approved-but-unpaid claim it stamps a recovery error onto a healthy case
                and reconciles nothing. It belongs to the states whose money truth is open. */}
            {/* ROUND-9 AUDIT FIX (Class 3/4): which action this card offers comes from the SERVER's own
                rules, carried in the payload — reconcile where the reconcile gate admits the claim, the
                declaration close where the stuck-money hatch accepts it, and otherwise the one fact-only
                line for that money state (lib/claim-action-rules). */}
            {(r.kind !== 'other_unsettled' || r.reconcilable === true) && (
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
              </>
            )}
            {r.kind === 'other_unsettled' && r.resolvable === true && (
              stuckId === r.id ? (
                <div className="mt-3 space-y-2 rounded-grubano-lg border border-grubano-border bg-grubano-surface p-3">
                  <p className="text-[13px] text-grubano-ink-muted">
                    Aucune de ces actions ne rembourse ni ne relance quoi que ce soit. Elles enregistrent
                    votre déclaration et libèrent la commande pour le client.
                  </p>
                  <textarea
                    value={stuckReason}
                    onChange={(e) => setStuckReason(e.target.value)}
                    placeholder="Ce qui s’est réellement passé (facultatif)…"
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
            {r.kind === 'other_unsettled' && r.reconcilable !== true && r.resolvable !== true && (
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
                        : 'La ligne existe déjà : « Lier » ne fera que la liaison, sans rien écrire d’autre.'}
                    </p>
                  </dl>
                )}
                {refusedFacts[r.id] && (
                  <p className="mt-2 text-[12px] text-red-700">
                    {/* ROUND-8 AUDIT FIX (P2): « Rien n’a été écrit » was printed on refusals that come AFTER
                        the mirror row was created. It is said only when the server proved it. */}
                    Refusé — ce qui a été lu : <code>{refusedFacts[r.id]!.stripeRefundId}</code>, statut <code>{refusedFacts[r.id]!.stripeStatus}</code>, paiement <code>{refusedFacts[r.id]!.paymentIntentId ?? '—'}</code>.{' '}
                    {refusedFacts[r.id]!.wrote === false ? 'Rien n’a été écrit.'
                      : refusedFacts[r.id]!.wrote === true ? 'La ligne miroir a été enregistrée ; la liaison n’a pas abouti — relisez la ligne dans la file.'
                      : 'L’état a pu changer : relisez la ligne dans la file.'}
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
                  à cette réclamation. Vous choisissez le LIEN, pas le résultat : le statut et le
                  montant sont lus sur la ligne elle-même. Aucun argent n’est déplacé.
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
    </section>
  )
}
