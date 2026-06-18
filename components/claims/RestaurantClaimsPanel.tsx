'use client'

// P4.5-C1 — restaurant claims panel, mounted on the operator Orders page (server-gated
// by isClaimsEnabled() → not mounted at all when OFF, byte-identical). Lists the claims
// awaiting a response on the operator's OWN orders (owner-scoped server-side), with the
// 24h countdown, and Accept (→ triggers the refund engine) / Refuse (motivated) actions.
// Renders nothing while the feature is off OR there are no pending claims.

import { useState, useEffect, useCallback } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Button, useToast } from '@/components/design-system'
import { formatEuros } from '@/lib/format-money'

type Claim = {
  id: string
  orderId: string
  reason: string
  requestedAmountCents: number
  description?: string | null
  photoUrl?: string | null
  responseDeadlineAt: string
  status: string
}

export default function RestaurantClaimsPanel() {
  const t = useTranslations('claims')
  const locale = useLocale()
  const toast = useToast()
  const [claims, setClaims] = useState<Claim[]>([])
  const [enabled, setEnabled] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [refusingId, setRefusingId] = useState<string | null>(null)
  const [refuseReason, setRefuseReason] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/claims/restaurant')
      if (!res.ok) return
      const data = await res.json()
      setEnabled(!!data.enabled)
      setClaims(Array.isArray(data.claims) ? data.claims : [])
    } catch { /* render nothing on failure */ }
  }, [])

  useEffect(() => { load() }, [load])

  const respond = useCallback(async (claimId: string, action: 'accept' | 'refuse', reason?: string) => {
    setBusyId(claimId)
    try {
      const res = await fetch(`/api/claims/${claimId}/respond`, {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ action, reason }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || t('client.errorGeneric')); return }
      if (action === 'refuse') toast.success(t('restaurant.refused'))
      else toast.success(data.refund?.state === 'pending' ? t('restaurant.refundPending') : t('restaurant.accepted'))
      setRefusingId(null); setRefuseReason('')
      await load()
    } catch {
      toast.error(t('client.errorGeneric'))
    } finally {
      setBusyId(null)
    }
  }, [load, t, toast])

  if (!enabled || claims.length === 0) return null

  return (
    <div className="mx-auto max-w-3xl px-4 pt-4">
      <div className="rounded-2xl border border-[#FFD9C9] bg-[#FFF7F3] p-4">
        <p className="text-[15px] font-extrabold text-[#1a1a1a]">{t('restaurant.title')}</p>
        <p className="mt-0.5 text-xs text-[#888]">{t('restaurant.autoApproveNote')}</p>

        <div className="mt-3 space-y-3">
          {claims.map((c) => {
            const hoursLeft = Math.floor((new Date(c.responseDeadlineAt).getTime() - Date.now()) / 3_600_000)
            const expired = hoursLeft <= 0
            return (
              <div key={c.id} className="rounded-xl border border-[#f0e0d8] bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13px] font-bold text-[#1a1a1a]">
                    {t('restaurant.order')} #{c.orderId.slice(-6)}
                  </span>
                  <span className={`text-xs font-semibold ${expired ? 'text-[#d4380d]' : 'text-[#F97316]'}`}>
                    {expired ? t('restaurant.expired') : t('restaurant.timeLeft', { hours: hoursLeft })}
                  </span>
                </div>
                <p className="mt-1 text-[13px] text-[#444]">
                  <span className="font-semibold">{t('restaurant.reason')}:</span> {t(`reason.${c.reason}`)}
                </p>
                <p className="text-[13px] text-[#444]">
                  <span className="font-semibold">{t('restaurant.requested')}:</span> {formatEuros(c.requestedAmountCents / 100, locale)}
                </p>
                {c.description && (
                  <p className="mt-1 text-[13px] text-[#666]">
                    <span className="font-semibold">{t('restaurant.details')}:</span> {c.description}
                  </p>
                )}
                {c.photoUrl && (
                  <a href={c.photoUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-[13px] font-semibold text-[#F97316] underline">
                    {t('restaurant.viewPhoto')}
                  </a>
                )}

                {refusingId === c.id ? (
                  <div className="mt-3 space-y-2">
                    <label className="block text-[13px] font-semibold text-[#1a1a1a]">{t('restaurant.refuseReasonLabel')}</label>
                    <textarea
                      value={refuseReason} onChange={(e) => setRefuseReason(e.target.value)} rows={2} maxLength={1000}
                      placeholder={t('restaurant.refuseReasonPlaceholder')}
                      className="w-full rounded-grubano-lg border border-grubano-border-strong bg-white px-3 py-2 text-[13px]"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" variant="ghost" onClick={() => { setRefusingId(null); setRefuseReason('') }} disabled={busyId === c.id}>
                        {t('client.cancel')}
                      </Button>
                      <Button size="sm" variant="danger" loading={busyId === c.id} onClick={() => respond(c.id, 'refuse', refuseReason || undefined)}>
                        {t('restaurant.confirmRefuse')}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" variant="primary" loading={busyId === c.id} onClick={() => respond(c.id, 'accept')}>
                      {t('restaurant.accept')}
                    </Button>
                    <Button size="sm" variant="secondary" disabled={busyId === c.id} onClick={() => setRefusingId(c.id)}>
                      {t('restaurant.refuse')}
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
