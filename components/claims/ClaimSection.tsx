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

// L7 (T-50) — THE REASONS A CUSTOMER MAY FILE, and what each one requires them to SAY.
//
// Both lists come from lib/claim-reasons, the one owner of the per-reason decision, so this form
// cannot offer a reason the server refuses or demand a gesture the server does not ask for. Two
// things changed here in L7:
//   • `restaurant_closed` is GONE from the customer's choices. A paid order the restaurant cancelled
//     is Grubano's own question, answered by the SYSTEM claim the status route raises — asking the
//     customer to file a claim about it was asking them to do our work.
//   • there is NO preselected scope. The form used to open on « toute la commande », so an entire
//     order could be claimed without one deliberate gesture; the submit button now stays disabled
//     until the customer says what they are claiming.
import { CUSTOMER_SELECTABLE_REASONS, scopeRequirement, type ClaimScopeMode } from '@/lib/claim-reasons'

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']
/** '' = nothing chosen yet. It is a real state, not a placeholder: submit stays disabled on it. */
type ScopeChoice = '' | ClaimScopeMode

type ExistingClaim = { id: string; status: string; canContest: boolean; restaurantResponseReason: string | null; arbitrationReason: string | null }
/** Server-derived line scope. Values come from the stored order — never from this client. */
type ScopeLine = { index: number; name: string; maxQty: number; unitCents: number; lineCents: number }
type Eligibility = {
  canClaim: boolean
  reason?: string
  maxRefundableCents: number
  /** T-59: true only when the ceiling was proven against live Stripe cash truth. */
  ceilingVerified?: boolean
  windowHours: number
  existingClaim: ExistingClaim | null
  scope?: { maxAuthorityCents: number; alreadyRefundedCents: number; lines: ScopeLine[]; itemSelectionAvailable: boolean; ceilingVerified?: boolean }
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

  const [reason, setReason] = useState<string>('quality')
  // index → quantity, pointing INTO the server-derived scope lines (never a price or a total)
  const [picked, setPicked] = useState<Record<number, number>>({})
  const [scope, setScope] = useState<ScopeChoice>('')
  const [amountEuros, setAmountEuros] = useState('')

  /**
   * L7 — CHANGING YOUR MIND CLEARS WHAT NO LONGER APPLIES.
   *
   * The defect this closes: `picked` survived a change of reason, and the body sent
   * `items: itemSelection.length ? itemSelection : undefined` with the amount suppressed whenever
   * items existed. So a customer who ticked two dishes, then switched to a reason where items are not
   * asked for and typed an amount, silently filed the OLD selection and not the amount they had just
   * entered. Nothing invisible may reach the POST.
   */
  const changeReason = (next: string) => {
    setReason(next)
    setScope('')          // the matrix may differ for the new reason — say it again
    setPicked({})
    setAmountEuros('')
  }
  const changeScope = (next: ScopeChoice) => {
    setScope(next)
    if (next !== 'items') setPicked({})        // items → amount/whole: the picked lines go
    if (next !== 'amount') setAmountEuros('')  // amount → whole/items: the free amount goes
  }
  /**
   * Closing the form CLEARS it, for the same reason changing the reason does. A customer who opens the
   * modal, ticks two dishes, thinks better of it and closes must not find those ticks waiting the next
   * time — reopening would then file a selection they had abandoned, and the state is invisible until the
   * POST. Success clears it too (below); this is the other way out.
   */
  const closeForm = () => {
    setOpen(false)
    setScope(''); setPicked({}); setAmountEuros(''); setDescription(''); setFile(null)
  }
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
    // ROUND 13 (F08): the server sends the restaurant's reason only for a restaurant refusal, whatever the status shown.
    const showRefusalReason = !!ec.restaurantResponseReason
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
        {/* ROUND 13 (F08): Grubano's decision reason — never sent for a declaration. */}
        {ec.arbitrationReason && (
          <p className="mt-2 text-[13px] text-[#666]">
            <span className="font-semibold">{t('client.grubanoDecisionReason')}:</span> {ec.arbitrationReason}
          </p>
        )}
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
  const requirement = scopeRequirement(reason)
  /** Only one scope is possible ⇒ there is nothing to choose, and the lines must be named. */
  const itemsOnly = requirement === 'items_only'
  /** Several scopes are possible ⇒ the customer chooses, and nothing is preselected. */
  const showScopeChoice = requirement === 'explicit' || requirement === 'whole_derived'
  /** The mode this form will actually send. Never guessed: '' until the customer has spoken. */
  const effectiveScope: ScopeChoice = itemsOnly ? 'items' : scope
  const itemSelection = effectiveScope === 'items'
    ? Object.entries(picked)
        .map(([index, qty]) => ({ index: Number(index), qty }))
        .filter((x) => x.qty > 0)
    : []
  const amountCents = effectiveScope === 'amount'
    ? Math.round(Number.parseFloat(amountEuros.replace(',', '.')) * 100)
    : NaN
  const amountValid = Number.isInteger(amountCents) && amountCents > 0 && amountCents <= el.maxRefundableCents
  /**
   * L7 — THE BUTTON IS DISABLED UNTIL THE REQUIRED GESTURE EXISTS. Not merely validated on submit:
   * a customer should not be able to press a button that cannot succeed.
   */
  const canSubmit =
    effectiveScope === 'items'  ? itemSelection.length > 0 :
    effectiveScope === 'amount' ? amountValid :
    effectiveScope === 'whole'  ? true : false
  // Indicative only: the SERVER prices the claim. Shown so the customer is not surprised.
  // T-59 (same family): the figure is clamped to the server ceiling exactly as resolveClaimAmount
  // does (Math.min(total, maxAuthorityCents)), so a partially refunded order can never show an
  // indicative amount larger than what the claim may actually ask for.
  const selectionEstimateCents = Math.min(itemSelection.reduce((sum, sel) => {
    const line = scopeLines.find((l) => l.index === sel.index)
    return sum + (line ? line.unitCents * sel.qty : 0)
  }, 0), el.maxRefundableCents)
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
      // The button is already disabled unless the required gesture exists; this is the belt.
      if (!canSubmit || effectiveScope === '') { setSubmitting(false); return }
      const res = await fetch('/api/claims', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({
          orderId, reason, description: description || undefined,
          // L7 — the scope is STATED, and each field is sent only in the scope that uses it. Nothing
          // left over from an earlier choice can travel: the state was cleared when it changed.
          scope: effectiveScope,
          items: effectiveScope === 'items' ? itemSelection : undefined,
          requestedAmountCents: effectiveScope === 'amount' ? amountCents : undefined,
          imageBase64, mediaType,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { toast.error(data.error || t('client.errorGeneric')); return }
      toast.success(t('client.success'))
      setOpen(false)
      setFile(null); setDescription(''); setAmountEuros(''); setScope(''); setPicked({})
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

      <Modal open={open} onClose={closeForm} title={t('client.title')} description={t('client.description')}>
        <div className="space-y-4">
          {/* Reason */}
          <div>
            <label className="mb-1 block text-[13px] font-semibold text-[#1a1a1a]">{t('client.reasonLabel')}</label>
            <select
              value={reason}
              onChange={(e) => changeReason(e.target.value)}
              className="w-full rounded-grubano-lg border border-grubano-border-strong bg-white px-3 py-2.5 text-[14px] text-[#1a1a1a]"
            >
              {CUSTOMER_SELECTABLE_REASONS.map((r) => <option key={r} value={r}>{t(`reason.${r}`)}</option>)}
            </select>
          </div>

          {/* ── BATCH 2 — WHICH ARTICLE? ──────────────────────────────────────────────
              For "article manquant", "mauvais article" and "mauvaise quantité" the server
              refuses a whole-order ceiling, so the customer names the lines concerned. Only
              an index and a quantity are sent: prices come from the stored order. */}
          {/* ── L7 — WHAT ARE YOU CLAIMING? Nothing is preselected. ─────────────────────────── */}
          {showScopeChoice && (
            <div>
              <label className="mb-1 block text-[13px] font-semibold text-[#1a1a1a]">{t('client.scopeLabel')}</label>
              <div className="flex flex-col gap-2">
                {(['items', 'amount', 'whole'] as const).map((m) => (
                  <label key={m} className="flex items-center gap-2 text-[14px] text-[#1a1a1a]">
                    <input
                      type="radio" name="claim-scope" value={m}
                      checked={scope === m}
                      disabled={m === 'items' && scopeLines.length === 0}
                      onChange={() => changeScope(m)}
                    />
                    {t(`client.scope_${m}`)}
                  </label>
                ))}
              </div>
              {scope === '' && <p className="mt-1 text-xs text-[#888]">{t('client.scopeRequired')}</p>}
            </div>
          )}

          {effectiveScope === 'items' && (
            <div>
              <label className="mb-1 block text-[13px] font-semibold text-[#1a1a1a]">{t('client.itemsLabel')}</label>
              {scopeLines.length === 0 ? (
                <p className="text-[13px] text-[#888]">{t('client.itemsUnavailable')}</p>
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
                        aria-label={t('client.itemQtyLabel', { name: line.name })}
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
                      ? t('client.itemsRequiredHint')
                      : t('client.itemsEstimate', { amount: formatEuros(selectionEstimateCents / 100, locale) })}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* L7 — the amount block appears only for the scope that USES an amount. */}
          {effectiveScope === 'amount' && (
          <div>
            <label className="mb-1 block text-[13px] font-semibold text-[#1a1a1a]">{t('client.amountLabel')}</label>
            {/* T-59 — « Maximum remboursable » is a claim about CASH and may only be made when the
                ceiling was proven against live Stripe truth. Anything else (Stripe unreadable, no
                charge, older payload without the flag) gets the neutral request wording: the number
                is what you may ASK for, not money proven to be refundable. Fail-closed by default. */}
            <p className="mb-2 text-xs text-[#888]">
              {t(el.ceilingVerified === true ? 'client.maxRefundable' : 'client.maxRequestUnverified', { amount: formatEuros(el.maxRefundableCents / 100, locale) })}
            </p>
            <input
              type="number" inputMode="decimal" min="0" step="0.01" value={amountEuros}
              onChange={(e) => setAmountEuros(e.target.value)}
              className="mt-1 w-full rounded-grubano-lg border border-grubano-border-strong bg-white px-3 py-2.5 text-[14px]"
              placeholder="0,00"
            />
            {amountEuros !== '' && !amountValid && (
              <p className="mt-1 text-xs text-[#dc2626]">{t('client.amountInvalid')}</p>
            )}
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
            <Button variant="primary" loading={submitting} disabled={!canSubmit} onClick={submit}>{t('client.submit')}</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
