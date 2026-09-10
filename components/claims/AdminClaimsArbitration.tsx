'use client'

// P4.5-C2 — admin arbitration console (neutral third party). Lists contested claims with
// both parties' evidence + read-only abuse signals, and decides each: approve (→ engine
// refund) or confirm the refusal. Renders nothing when CLAIMS_ENABLED is OFF.

import { useState, useEffect, useCallback } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Button, Badge, EmptyState, useToast } from '@/components/design-system'
import { formatEuros } from '@/lib/format-money'
import { approvalToast } from '@/lib/claim-approval-toast'

type Stats = { recent?: number; approvalRate?: number; flagged?: boolean; refused?: number; overturned?: number }
type Claim = {
  id: string; orderId: string; reason: string; requestedAmountCents: number
  description?: string | null; restaurantResponseReason?: string | null; contestReason?: string | null; photoUrl?: string | null
  consumerStats?: Stats; restaurantStats?: Stats
  /** Server-side safety triage — this queue carries the decision buttons, so it says so here too. */
  safety?: boolean
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
type ActionableRefundClaim = {
  id: string; orderId: string; reason: string; requestedAmountCents: number; status: string
  moneyState: MoneyState; safety?: boolean; refundError?: string | null
  /** The server says whether the escape hatch would accept this row — never guessed here. */
  resolvable?: boolean
  actualRefundedCents: number | null
  refund: { id: string; status: string; actualAmountCents: number; stripeRefundId: string | null } | null
}

export default function AdminClaimsArbitration() {
  const t = useTranslations('claims')
  const locale = useLocale()
  const toast = useToast()
  const [claims, setClaims] = useState<Claim[]>([])
  const [pending, setPending] = useState<PendingClaim[]>([])
  const [actionableRefunds, setActionableRefunds] = useState<ActionableRefundClaim[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [refusingId, setRefusingId] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  // BATCH 2 — the stuck-money control. `resolveStuckClaim` existed with no door; this is it.
  const [stuckId, setStuckId] = useState<string | null>(null)
  const [stuckReason, setStuckReason] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/claims')
      if (!res.ok) return
      const data = await res.json()
      setClaims(Array.isArray(data.claims) ? data.claims : [])
      setPending(Array.isArray(data.pending) ? data.pending : [])
      setActionableRefunds(Array.isArray(data.actionableRefunds) ? data.actionableRefunds : [])
    } catch { /* ignore */ } finally { setLoaded(true) }
  }, [])
  useEffect(() => { load() }, [load])

  const decide = useCallback(async (id: string, decision: 'approve' | 'refuse_final', r?: string) => {
    setBusyId(id)
    try {
      const res = await fetch(`/api/admin/claims/${id}/arbitrate`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, reason: r }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || t('admin.processing')); return }
      // AUDIT FIX (batch 2): this used to assert "remboursement déclenché" on EVERY approval —
      // including the ordinary case where the refund rail is closed and nothing moves, and the
      // RESUME-FIRST case where money DID move but the engine reports 'failed'. The mapping is a
      // pure function in lib/claim-approval-toast so it is tested, not re-derived here.
      if (decision !== 'approve') {
        toast.success(t('admin.refusedFinalDone'))
      } else {
        const m = approvalToast((data as { refund?: { state?: string; amountCents?: number; error?: string } }).refund)
        const text = m.key === 'approvedRefunded'
          ? t('admin.approvedRefunded', { amount: formatEuros(m.amountCents / 100, locale) })
          : t(`admin.${m.key}`)
        if (m.tone === 'error') toast.error(text)
        else toast.success(text)
      }
      setRefusingId(null); setReason('')
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
      toast.success(resolution === 'settled_out_of_band'
        ? 'Dossier clôturé : client payé hors rail. Aucun argent n’a bougé ici.'
        : 'Dossier clôturé sans paiement. Aucun argent n’a bougé.')
      setStuckId(null); setStuckReason('')
      await load()
    } catch {
      toast.error('Échec de la clôture.')
    } finally { setBusyId(null) }
  }, [load, stuckReason, toast])

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
  const isOverdue = (p: PendingClaim) => new Date(p.responseDeadlineAt).getTime() < Date.now()

  // CLAIMS BATCH 2 — a stuck refund is never "nothing to do": it must count here too, or the
  // console shows an empty state while money is waiting on a human.
  if (loaded && claims.length === 0 && pending.length === 0 && actionableRefunds.length === 0) {
    return <EmptyState emoji="⚖️" title={t('admin.empty')} />
  }

  // Truthful, distinct wording per money state. Pending is NEVER shown as succeeded, and a
  // failed refund never reads as "in progress".
  const MONEY_LABEL: Record<MoneyState, { text: string; tone: 'warning' | 'danger' | 'neutral' }> = {
    stripe_pending:                       { text: 'Remboursement envoyé à la banque — en attente de confirmation Stripe', tone: 'warning' },
    stripe_failed:                        { text: 'Remboursement ÉCHOUÉ chez Stripe — le client n’a rien reçu', tone: 'danger' },
    stripe_succeeded_claim_unreconciled:  { text: 'Remboursement réussi chez Stripe — réclamation non réconciliée', tone: 'warning' },
    stale_refunding_no_refund_row:        { text: 'En remboursement sans aucun remboursement Stripe associé', tone: 'danger' },
    refund_error_recorded:                { text: 'Erreur de remboursement enregistrée — décision humaine requise', tone: 'danger' },
    approved_not_driven:                  { text: 'Approuvée mais jamais remboursée — en attente de traitement', tone: 'warning' },
    reconcile_required:                   { text: 'Vérification financière requise — l’argent n’est pas établi (ni parti, ni non parti)', tone: 'danger' },
  }

  return (
    <div className="space-y-4">
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
              const label = MONEY_LABEL[r.moneyState] ?? { text: r.moneyState, tone: 'neutral' as const }
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
                      {r.actualRefundedCents === null
                        ? 'non déterminé ici — aucun remboursement n’est LIÉ à cette réclamation'
                        : formatEuros(r.actualRefundedCents / 100, locale)}
                    </p>
                    {r.actualRefundedCents === null && (
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
                      <p><span className="font-semibold">Statut Stripe :</span> {r.refund.status}</p>
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
                      {r.refund
                        ? 'Aucune clôture manuelle sur cet état : un remboursement est lié et son sort ' +
                          'sera appliqué par la réconciliation (webhook Stripe, ou le balayage de ' +
                          'récupération lorsqu’il est déclenché). Aucun mouvement d’argent.'
                        : 'Aucune clôture manuelle sur cet état, et AUCUNE réconciliation automatique ' +
                          'ne peut l’atteindre : aucun remboursement n’est lié à cette réclamation, or ' +
                          'le webhook comme le balayage joignent par cette liaison. Elle restera ainsi ' +
                          'jusqu’à une intervention humaine.'}
                    </p>
                  ) : stuckId === r.id ? (
                    <div className="mt-3 space-y-2 rounded-grubano-lg border border-grubano-border bg-grubano-surface-muted p-3">
                      <p className="text-[13px] text-grubano-ink-muted">
                        Aucune de ces actions ne rembourse ni ne relance quoi que ce soit. Elles
                        enregistrent la réalité et libèrent la commande pour le client.
                      </p>
                      <textarea
                        value={stuckReason}
                        onChange={(e) => setStuckReason(e.target.value)}
                        placeholder="Ce qui s’est réellement passé (facultatif)…"
                        rows={2}
                        className="w-full rounded-grubano-lg border border-grubano-border bg-grubano-surface p-2 text-[13px]"
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          disabled={busyId === r.id}
                          onClick={() => resolveStuck(r.id, 'settled_out_of_band')}
                        >
                          Le client a été payé autrement
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
      {claims.map((c) => {
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
              {c.restaurantResponseReason && <p><span className="font-semibold">{t('admin.refusalReason')}:</span> {c.restaurantResponseReason}</p>}
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
            ) : (
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="primary" loading={busyId === c.id} onClick={() => decide(c.id, 'approve')}>{t('admin.approve')}</Button>
                <Button size="sm" variant="secondary" disabled={busyId === c.id} onClick={() => setRefusingId(c.id)}>{t('admin.refuseFinal')}</Button>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
