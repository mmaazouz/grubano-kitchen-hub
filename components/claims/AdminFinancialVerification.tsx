'use client'

import { useState, useEffect, useCallback } from 'react'
import { useLocale } from 'next-intl'
import { Button, Badge, useToast } from '@/components/design-system'
import { formatEuros } from '@/lib/format-money'
import { moneyLineFor } from '@/lib/claim-money-line'

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
  /** The refunds of THIS order, so the operator can attribute one without leaving the console. */
  candidateRefunds?: Array<{
    id: string; status: string; amountCents: number
    stripeRefundId: string | null; createdAt: string; belongsToAnotherClaim: boolean; alreadyBoundToAnotherClaim: boolean
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
  stripe_unreadable:          'La vérité Stripe n’a pas pu être lue. Aucune conclusion tirée.',
  refund_moved_unattributed:  'Des remboursements existent sur la commande, mais aucun ne porte l’identité de cette réclamation.',
  multiple_candidate_refunds: 'Plusieurs remboursements portent l’identité de cette réclamation.',
  unknown:                    'Cause d’ambiguïté non renseignée.',
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
      const outcome = (body as { result?: { outcome?: string } }).result?.outcome
      const said: Record<string, string> = {
        refunded:               'Preuve trouvée : le remboursement a abouti. Réclamation réconciliée sur son identité exacte.',
        refund_failed:          'Preuve trouvée : le remboursement a ÉCHOUÉ. La réclamation redevient traitable.',
        // AUDIT FIX: this branch reads OUR row, not Stripe. Say that, rather than asserting a
        // Stripe state nobody consulted.
        still_pending:          'La ligne de remboursement liée n’est pas encore terminale (ni aboutie, ni échouée). Rien n’est clos, aucun second remboursement. Vérifiez Stripe pour l’état réel.',
        no_refund_proven:       'Preuve d’absence : aucun remboursement n’a jamais déplacé d’argent et Stripe n’en rapporte aucun. La réclamation est de nouveau payable par le rail normal.',
        // ROUND-3 AUDIT FIX: this case previously received the message above. Nothing moved, which
        // is true — but a FAILED refund with a Stripe id locks the engine against every later
        // refund on that order, so "payable again" was the opposite of what will happen. Three
        // auditors flagged that the honest reason was written to a field no human reads.
        no_refund_proven_rail_locked:
          'Preuve d’absence : rien n’est parti. MAIS un remboursement ÉCHOUÉ verrouille cette commande côté moteur — toute nouvelle tentative sera REFUSÉE tant que la reprise manuelle Stripe n’a pas été faite. Reprise humaine requise.',
        financial_verification: 'Toujours indéterminé. Aucune conclusion, aucun argent, aucune clôture. Escalade opérateur requise.',
      }
      // ROUND-3 AUDIT FIX: every outcome rendered as a green success, including "still
      // indeterminate", "the refund FAILED" and "the rail is locked shut". A green tick on those
      // is the tone telling the operator the opposite of the text.
      const needsAttention = outcome === 'financial_verification'
        || outcome === 'refund_failed'
        || outcome === 'no_refund_proven_rail_locked'
      const text = said[outcome ?? ''] ?? 'Réconciliation terminée.'
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
          ? 'Remboursement attribué : il avait ÉCHOUÉ. Aucun argent n’a atteint le client. La réclamation redevient traitable.'
          : 'Remboursement attribué : la ligne n’est pas encore terminale. Rien n’est clos.'
      if (outcome === 'refund_failed') toast.error(text)
      else toast.success(text)
      await load()
    } catch {
      toast.error('Attribution refusée.')
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
            {r.kind !== 'other_unsettled' ? (
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
            ) : (
              <p className="mt-3 text-[12px] text-grubano-ink-muted">
                Listée ici pour qu’elle ne disparaisse pas quand les réclamations sont fermées.
                Son traitement se fait dans la file « Remboursements à traiter » de la console
                d’arbitrage, qui n’est visible que lorsque les réclamations sont ouvertes.
              </p>
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
                      {c.belongsToAnotherClaim && (
                        <Badge tone="danger">porte l’identité d’une AUTRE réclamation</Badge>
                      )}
                      {c.alreadyBoundToAnotherClaim && (
                        <Badge tone="danger">déjà LIÉ à une autre réclamation — sera refusé</Badge>
                      )}
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={busyId === r.id || c.alreadyBoundToAnotherClaim}
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
