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

// CLAIMS BATCH 2 — canonical taxonomy. The three ITEM_REQUIRED reasons name specific lines:
// the server refuses a whole-order ceiling for them, so the form must let the customer say
// WHICH article is concerned instead of silently claiming the entire order.
const REASONS = [
  'missing_item', 'wrong_item', 'wrong_quantity', 'quality', 'restaurant_closed',
  'excessive_wait', 'not_received', 'payment_issue', 'allergen_safety', 'other',
] as const
const ITEM_REQUIRED_REASONS: readonly string[] = ['missing_item', 'wrong_item', 'wrong_quantity']
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']

type ExistingClaim = { id: string; status: string; canContest: boolean; restaurantResponseReason: string | null; arbitrationReason: string | null }
/** Server-derived line scope. Values come from the stored order — never from this client. */
type ScopeLine = { index: number; name: string; maxQty: number; unitCents: number; lineCents: number }
type Eligibility = {
  canClaim: boolean
  reason?: string
  maxRefundableCents: number
  windowHours: number
  existingClaim: ExistingClaim | null
  scope?: { maxAuthorityCents: number; alreadyRefundedCents: number; lines: ScopeLine[]; itemSelectionAvailable: boolean }
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
  // index → quantity, pointing INTO the server-derived scope lines (never a price or a total)
  const [picked, setPicked] = useState<Record<number, number>>({})
  const [wholeOrder, setWholeOrder] = useState(true)
  const [amountEuros, setAmountEuros] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  // C2 contest
  const [contesting, setContesting] = useState(false)
  const [contestReason, setContestReason] = useState('')
  const [contestBusy, setContestBusy] = useState(false)

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

  // Existing claim → status (+ refusal reason) + (C2) contest a refusal within the delay.
  if (el.existingClaim) {
    const ec = el.existingClaim
    const s = ec.status
    const showRefusalReason = (s === 'refused' || s === 'refused_final') && ec.restaurantResponseReason
    const submitContest = async () => {
      setContestBusy(true)
      try {
        const res = await fetch(`/api/claims/${ec.id}/contest`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ reason: contestReason || undefined }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) { toast.error(data.error || t('client.errorGeneric')); return }
        toast.success(t('client.contestSuccess'))
        setContesting(false); setContestReason('')
        await load()
      } catch {
        toast.error(t('client.errorGeneric'))
      } finally { setContestBusy(false) }
    }
    return (
      <div className="mt-4 rounded-2xl border border-[#f0f0f0] bg-[#fafafa] p-4">
        <p className="text-sm font-bold text-[#1a1a1a]">{t('client.statusTitle')}</p>
        <p className="mt-1 text-[13px] text-[#666]">{t(`status.${s}`)}</p>
        {showRefusalReason && (
          <p className="mt-2 text-[13px] text-[#666]">
            <span className="font-semibold">{t('client.refusalReasonShown')}:</span> {ec.restaurantResponseReason}
          </p>
        )}
        {s === 'arbitration' && <p className="mt-2 text-[13px] text-[#F97316]">{t('client.arbitrationInfo')}</p>}
        {ec.canContest && !contesting && (
          <Button className="mt-3" size="sm" variant="secondary" onClick={() => setContesting(true)}>{t('client.contest')}</Button>
        )}
        {ec.canContest && contesting && (
          <div className="mt-3 space-y-2">
            <p className="text-[13px] font-semibold text-[#1a1a1a]">{t('client.contestTitle')}</p>
            <p className="text-xs text-[#888]">{t('client.contestDescription')}</p>
            <textarea
              value={contestReason} onChange={(e) => setContestReason(e.target.value)} rows={3} maxLength={1000}
              placeholder={t('client.contestReasonPlaceholder')}
              className="w-full rounded-grubano-lg border border-grubano-border-strong bg-white px-3 py-2.5 text-[14px]"
            />
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setContesting(false); setContestReason('') }} disabled={contestBusy}>{t('client.cancel')}</Button>
              <Button size="sm" variant="primary" loading={contestBusy} onClick={submitContest}>{t('client.contestSubmit')}</Button>
            </div>
          </div>
        )}
      </div>
    )
  }

  if (!el.canClaim) return null // not eligible (window expired / not paid) → no clutter

  // Lines the customer may point at, straight from the server-derived scope.
  const scopeLines: ScopeLine[] = el.scope?.lines ?? []
  const needsItems = ITEM_REQUIRED_REASONS.includes(reason)
  const itemSelection = Object.entries(picked)
    .map(([index, qty]) => ({ index: Number(index), qty }))
    .filter((x) => x.qty > 0)
  // Indicative only: the SERVER prices the claim. Shown so the customer is not surprised.
  const selectionEstimateCents = itemSelection.reduce((sum, sel) => {
    const line = scopeLines.find((l) => l.index === sel.index)
    return sum + (line ? line.unitCents * sel.qty : 0)
  }, 0)
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
      // An item-required reason must name at least one line — the server refuses it otherwise.
      if (needsItems && itemSelection.length === 0) {
        toast.error("Sélectionnez le ou les articles concernés."); setSubmitting(false); return
      }
      if (!needsItems && !wholeOrder && (!requestedAmountCents || requestedAmountCents <= 0)) {
        toast.error(t('client.errorGeneric')); setSubmitting(false); return
      }
      const res = await fetch('/api/claims', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({
          orderId, reason, description: description || undefined,
          // A SELECTION, never money: the server prices it from the stored order.
          items: itemSelection.length ? itemSelection : undefined,
          requestedAmountCents: itemSelection.length ? undefined : requestedAmountCents,
          imageBase64, mediaType,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || t('client.errorGeneric')); return }
      toast.success(t('client.success'))
      setOpen(false)
      setFile(null); setDescription(''); setAmountEuros(''); setWholeOrder(true); setPicked({})
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

          {/* ── BATCH 2 — WHICH ARTICLE? ──────────────────────────────────────────────
              For "article manquant", "mauvais article" and "mauvaise quantité" the server
              refuses a whole-order ceiling, so the customer names the lines concerned. Only
              an index and a quantity are sent: prices come from the stored order. */}
          {needsItems && (
            <div>
              <label className="mb-1 block text-[13px] font-semibold text-[#1a1a1a]">Articles concernés</label>
              {scopeLines.length === 0 ? (
                <p className="text-[13px] text-[#888]">
                  Le détail des articles de cette commande est indisponible : choisissez un autre motif
                  ou contactez le support.
                </p>
              ) : (
                <div className="space-y-2">
                  {scopeLines.map((line) => (
                    <div key={line.index} className="flex items-center justify-between gap-3 rounded-grubano-lg border border-grubano-border px-3 py-2">
                      <span className="text-[14px] text-[#1a1a1a]">
                        {line.name}
                        <span className="ml-1 text-xs text-[#888]">
                          ({formatEuros(line.unitCents / 100, locale)} × {line.maxQty})
                        </span>
                      </span>
                      <select
                        aria-label={`Quantité concernée pour ${line.name}`}
                        value={picked[line.index] ?? 0}
                        onChange={(e) => setPicked((p) => ({ ...p, [line.index]: Number(e.target.value) }))}
                        className="rounded-grubano-lg border border-grubano-border-strong bg-white px-2 py-1 text-[14px]"
                      >
                        {Array.from({ length: line.maxQty + 1 }, (_, q) => (
                          <option key={q} value={q}>{q}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                  <p className="text-xs text-[#888]">
                    {itemSelection.length === 0
                      ? 'Sélectionnez au moins un article : ce motif ne permet pas de réclamer la commande entière.'
                      : `Montant indicatif : ${formatEuros(selectionEstimateCents / 100, locale)} — le montant définitif est calculé par Grubano à partir de votre commande.`}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Amount — only for reasons where the whole order can legitimately be in scope. */}
          {!needsItems && (
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
          )}

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
