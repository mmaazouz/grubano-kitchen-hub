'use client'

// P4.5-C2 — admin arbitration console (neutral third party). Lists contested claims with
// both parties' evidence + read-only abuse signals, and decides each: approve (→ engine
// refund) or confirm the refusal. Renders nothing when CLAIMS_ENABLED is OFF.

import { useState, useEffect, useCallback } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Button, Badge, EmptyState, useToast } from '@/components/design-system'
import { formatEuros } from '@/lib/format-money'

type Stats = { recent?: number; approvalRate?: number; flagged?: boolean; refused?: number; overturned?: number }
type Claim = {
  id: string; orderId: string; reason: string; requestedAmountCents: number
  description?: string | null; restaurantResponseReason?: string | null; contestReason?: string | null; photoUrl?: string | null
  consumerStats?: Stats; restaurantStats?: Stats
}
// P0-39 — réclamation EN ATTENTE du restaurant (lecture seule : l'admin VOIT,
// aucune action possible — Q3 interdit de se substituer au restaurant).
type PendingClaim = {
  id: string; orderId: string; reason: string; requestedAmountCents: number
  description?: string | null; createdAt: string; responseDeadlineAt: string
}

export default function AdminClaimsArbitration() {
  const t = useTranslations('claims')
  const locale = useLocale()
  const toast = useToast()
  const [claims, setClaims] = useState<Claim[]>([])
  const [pending, setPending] = useState<PendingClaim[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [refusingId, setRefusingId] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/claims')
      if (!res.ok) return
      const data = await res.json()
      setClaims(Array.isArray(data.claims) ? data.claims : [])
      setPending(Array.isArray(data.pending) ? data.pending : [])
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
      toast.success(decision === 'approve' ? t('admin.approved') : t('admin.refusedFinalDone'))
      setRefusingId(null); setReason('')
      await load()
    } catch {
      toast.error(t('admin.processing'))
    } finally { setBusyId(null) }
  }, [load, t, toast])

  // P0-39 — ancienneté lisible dans la locale de l'admin (heures < 48 h, sinon jours).
  const ageOf = (iso: string) => {
    const hours = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000))
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'always' })
    return hours < 48 ? rtf.format(-hours, 'hour') : rtf.format(-Math.floor(hours / 24), 'day')
  }
  const isOverdue = (p: PendingClaim) => new Date(p.responseDeadlineAt).getTime() < Date.now()

  if (loaded && claims.length === 0 && pending.length === 0) {
    return <EmptyState emoji="⚖️" title={t('admin.empty')} />
  }

  return (
    <div className="space-y-4">
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
                  <p><span className="font-semibold">{t('admin.reason')}:</span> {t(`reason.${p.reason}`)}</p>
                  {p.description && <p><span className="font-semibold">{t('admin.clientDetails')}:</span> {p.description}</p>}
                </dl>
                <div className="mt-2 flex flex-wrap items-center gap-2">
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

            <dl className="mt-2 space-y-1 text-[13px] text-grubano-ink-muted">
              <p><span className="font-semibold">{t('admin.reason')}:</span> {t(`reason.${c.reason}`)}</p>
              {c.description && <p><span className="font-semibold">{t('admin.clientDetails')}:</span> {c.description}</p>}
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
