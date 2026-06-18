'use client'

// P4.5-C1 — consumer claim widget, mounted on the order-tracking page. Renders NOTHING
// when CLAIMS_ENABLED is OFF (the API returns enabled:false) → the page stays
// byte-identical. Shows the existing claim's status, or a "report a problem" CTA when
// the order is still eligible (owner + paid + within the window + no active claim — all
// decided server-side by /api/claims?orderId=).

import { useState, useEffect, useCallback } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { AlertCircle } from 'lucide-react'
import { Button, Modal, useToast } from '@/components/design-system'
import { formatEuros } from '@/lib/format-money'

const REASONS = ['missing_item', 'wrong_order', 'quality', 'not_delivered', 'other'] as const
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']

type Eligibility = {
  canClaim: boolean
  reason?: string
  maxRefundableCents: number
  windowHours: number
  existingClaim: { id: string; status: string } | null
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(new Error('read_failed'))
    r.readAsDataURL(file)
  })
}

export default function ClaimSection({ orderId }: { orderId: string }) {
  const t = useTranslations('claims')
  const locale = useLocale()
  const toast = useToast()
  const [el, setEl] = useState<Eligibility | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [open, setOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [reason, setReason] = useState<(typeof REASONS)[number]>('quality')
  const [wholeOrder, setWholeOrder] = useState(true)
  const [amountEuros, setAmountEuros] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/claims?orderId=${encodeURIComponent(orderId)}`)
      if (!res.ok) return
      const data = await res.json()
      setEnabled(!!data.enabled)
      if (data.enabled) setEl(data.eligibility as Eligibility)
    } catch { /* render nothing on failure */ }
  }, [orderId])

  useEffect(() => { load() }, [load])

  if (!enabled || !el) return null

  // Existing claim → show its status (+ refusal reason).
  if (el.existingClaim) {
    const s = el.existingClaim.status
    return (
      <div className="mt-4 rounded-2xl border border-[#f0f0f0] bg-[#fafafa] p-4">
        <p className="text-sm font-bold text-[#1a1a1a]">{t('client.statusTitle')}</p>
        <p className="mt-1 text-[13px] text-[#666]">{t(`status.${s}`)}</p>
      </div>
    )
  }

  if (!el.canClaim) return null // not eligible (window expired / not paid) → no clutter

  async function submit() {
    setSubmitting(true)
    try {
      let imageBase64: string | undefined
      let mediaType: string | undefined
      if (file) {
        if (!ALLOWED.includes(file.type)) { toast.error(t('client.errorGeneric')); setSubmitting(false); return }
        imageBase64 = await fileToBase64(file)
        mediaType = file.type
      }
      const requestedAmountCents = wholeOrder
        ? undefined
        : Math.round(Number.parseFloat(amountEuros.replace(',', '.')) * 100)
      if (!wholeOrder && (!requestedAmountCents || requestedAmountCents <= 0)) {
        toast.error(t('client.errorGeneric')); setSubmitting(false); return
      }
      const res = await fetch('/api/claims', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ orderId, reason, description: description || undefined, requestedAmountCents, imageBase64, mediaType }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || t('client.errorGeneric')); return }
      toast.success(t('client.success'))
      setOpen(false)
      setFile(null); setDescription(''); setAmountEuros(''); setWholeOrder(true)
      await load()
    } catch {
      toast.error(t('client.errorGeneric'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="mt-4">
      <Button variant="secondary" fullWidth leftIcon={<AlertCircle size={16} />} onClick={() => setOpen(true)}>
        {t('client.reportProblem')}
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title={t('client.title')} description={t('client.description')}>
        <div className="space-y-4">
          {/* Reason */}
          <div>
            <label className="mb-1 block text-[13px] font-semibold text-[#1a1a1a]">{t('client.reasonLabel')}</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as (typeof REASONS)[number])}
              className="w-full rounded-grubano-lg border border-grubano-border-strong bg-white px-3 py-2.5 text-[14px] text-[#1a1a1a]"
            >
              {REASONS.map((r) => <option key={r} value={r}>{t(`reason.${r}`)}</option>)}
            </select>
          </div>

          {/* Amount */}
          <div>
            <label className="mb-1 block text-[13px] font-semibold text-[#1a1a1a]">{t('client.amountLabel')}</label>
            <p className="mb-2 text-xs text-[#888]">{t('client.maxRefundable', { amount: formatEuros(el.maxRefundableCents / 100, locale) })}</p>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-2 text-[14px] text-[#1a1a1a]">
                <input type="radio" checked={wholeOrder} onChange={() => setWholeOrder(true)} /> {t('client.wholeOrder')}
              </label>
              <label className="flex items-center gap-2 text-[14px] text-[#1a1a1a]">
                <input type="radio" checked={!wholeOrder} onChange={() => setWholeOrder(false)} /> {t('client.customAmount')}
              </label>
              {!wholeOrder && (
                <input
                  type="number" inputMode="decimal" min="0" step="0.01" value={amountEuros}
                  onChange={(e) => setAmountEuros(e.target.value)}
                  className="mt-1 w-full rounded-grubano-lg border border-grubano-border-strong bg-white px-3 py-2.5 text-[14px]"
                  placeholder="0,00"
                />
              )}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-[13px] font-semibold text-[#1a1a1a]">{t('client.descriptionLabel')}</label>
            <textarea
              value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={1000}
              placeholder={t('client.descriptionPlaceholder')}
              className="w-full rounded-grubano-lg border border-grubano-border-strong bg-white px-3 py-2.5 text-[14px]"
            />
          </div>

          {/* Photo (optional) */}
          <div>
            <label className="mb-1 block text-[13px] font-semibold text-[#1a1a1a]">{t('client.photoLabel')}</label>
            <input type="file" accept={ALLOWED.join(',')} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-[13px] text-[#666]" />
            <p className="mt-1 text-xs text-[#999]">{t('client.photoHint')}</p>
          </div>

          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>{t('client.cancel')}</Button>
            <Button variant="primary" loading={submitting} onClick={submit}>{t('client.submit')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
