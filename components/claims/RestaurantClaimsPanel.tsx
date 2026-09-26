'use client'

// P4.5-C1 — restaurant claims panel, mounted on the operator Orders page (server-gated
// by claimsSurfaceOpen() → not mounted at all when OFF, byte-identical). Lists the claims
// awaiting a response on the operator's OWN orders (owner-scoped server-side), with the
// 24h countdown, and Accept (P0-24 : routes the claim to the ADMIN queue — no refund is
// ever triggered from here) / Refuse (motivated) actions.
//
// ── D′ L8 (S-19 / T-46) — WHAT THIS PANEL GAINED, AND WHY EACH PIECE IS HERE ────────────────────────
//
// Until L8 the panel rendered seven fields of a payload that carried twenty-seven, and a restaurateur
// could answer a claim without ever learning what the customer had asked for, what happened to it
// afterwards, or what a refund had cost them. Four additions, in the order a restaurateur needs them:
//
//  1. THE LIFECYCLE. A derived business label (`status`), never `Claim.status` and never anything derived
//     from `refundError` — those are operator prose carrying marker tokens, Refund row ids and Stripe
//     refund ids. The server decides the label; this file only prints `claims.restaurant.status.<token>`.
//  2. WHAT THE CUSTOMER ASKED FOR. L7's frozen snapshot, rendered. `selection: null` prints « Sélection
//     non enregistrée » and NEVER « toute la commande » — the claims filed before L7 recorded no scope,
//     and inventing one on this screen would change what those rows mean.
//  3. THE EARLIER-CLAIM SIGNAL. Informational, and labelled as such: invariant S-26 means a dish claimed
//     once is NOT blocked for a later claim, so the note says so in words rather than leaving a
//     restaurateur to assume a right has been used up.
//  4. THE CONFIRMED FINANCIAL EFFECT. Shown only when the server says `confirmed: true`, i.e. when the
//     ledger line of the Stripe refund can state the three figures. When it cannot, the panel says there
//     is no confirmed effect — it never shows an estimate, and it never reconstructs one from a Refund row.
//
// Plus the two views: « À répondre » (the set the respond route actually accepts) and « Historique ». The
// tab is the ONLY thing this component may ask the server for; the old `?status=` parameter, which let the
// client choose which claims came back, is gone.

import { useState, useEffect, useCallback } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { Button, useToast } from '@/components/design-system'
import { formatEuros } from '@/lib/format-money'

/** The CURATED server view (lib/claim-restaurant-view). No field here is a raw Claim column. */
// The server strips its own diagnosis from the unconfirmed shape (spec §10): a reason like
// « ledger_inconsistent » is written for whoever repairs the accounting, not for a restaurateur.
type FinancialEffect =
  | { confirmed: true; customerRefundCents: number; grubanoFeeReturnedCents: number; restaurantNetImpactCents: number; source: 'ledger' }
  | { confirmed: false }

type Claim = {
  id: string
  orderRef: string
  reason: string
  status: string
  safety?: boolean
  requestedAmountCents: number
  approvedAmountCents: number | null
  customerMessage?: string | null
  photoUrl?: string | null
  createdAt: string
  responseDeadlineAt: string
  decidedAt: string | null
  restaurantResponse: 'accepted' | 'refused' | null
  restaurantResponseReason: string | null
  selection: { mode: 'items' | 'amount' | 'whole'; lines: string[]; requestedCents: number } | null
  previouslyClaimed: { byLine: Record<string, Array<{ claimRef: string; status: string; qty: number; name: string }>>; unattributableCount: number; incomplete: boolean }
  financialEffect: FinancialEffect
  canRespond: boolean
}

type View = 'pending' | 'history'

export default function RestaurantClaimsPanel() {
  const t = useTranslations('claims')
  const locale = useLocale()
  const toast = useToast()
  const [claims, setClaims] = useState<Claim[]>([])
  const [enabled, setEnabled] = useState(false)
  const [view, setView] = useState<View>('pending')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [refusingId, setRefusingId] = useState<string | null>(null)
  const [refuseReason, setRefuseReason] = useState('')

  const load = useCallback(async (v: View) => {
    try {
      const res = await fetch(`/api/claims/restaurant?view=${v}`)
      if (!res.ok) return
      const data = await res.json()
      setEnabled(!!data.enabled)
      setClaims(Array.isArray(data.claims) ? data.claims : [])
    } catch { /* render nothing on failure */ }
  }, [])

  useEffect(() => { load(view) }, [load, view])

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
      await load(view)
    } catch {
      toast.error(t('client.errorGeneric'))
    } finally {
      setBusyId(null)
    }
  }, [load, view, t, toast])

  // The panel appears as soon as the surface is open: a restaurateur must be able to reach their history
  // even when nothing is waiting, so only the flag hides it now.
  if (!enabled) return null

  /** L7's snapshot, in one line. `null` is « not recorded » and is never rendered as a scope. */
  const selectionLine = (c: Claim) => {
    if (!c.selection) return t('restaurant.selectionNotRecorded')
    if (c.selection.mode === 'items') {
      return c.selection.lines.length
        ? `${t('restaurant.selectionItems')}: ${c.selection.lines.join(', ')}`
        : t('restaurant.selectionNotRecorded')
    }
    if (c.selection.mode === 'amount') {
      return `${t('restaurant.selectionAmount')}: ${formatEuros(c.selection.requestedCents / 100, locale)}`
    }
    return t('restaurant.selectionWhole')
  }

  const statusLabel = (s: string) => {
    // The server's vocabulary is closed and its fall-through is `under_review`; an unknown token here
    // would mean the two sides disagree, so it degrades to the same neutral label rather than printing a
    // key path on a restaurateur's screen.
    const known = ['received', 'answered_refused', 'grubano_deciding', 'approved_awaiting_refund',
      'refunding', 'refunded', 'refusal_confirmed', 'refused_by_grubano', 'closed', 'under_review']
    return t(`restaurant.status.${known.includes(s) ? s : 'under_review'}`)
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pt-4">
      <div className="rounded-2xl border border-[#FFD9C9] bg-[#FFF7F3] p-4">
        <p className="text-[15px] font-extrabold text-[#1a1a1a]">{t('restaurant.title')}</p>
        <p className="mt-0.5 text-xs text-[#888]">{t('restaurant.responseNote')}</p>

        <div className="mt-2 flex gap-2" role="tablist">
          {(['pending', 'history'] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${view === v ? 'bg-[#F97316] text-white' : 'bg-white text-[#666] border border-[#f0e0d8]'}`}
            >
              {t(v === 'pending' ? 'restaurant.tabPending' : 'restaurant.tabHistory')}
            </button>
          ))}
        </div>

        {claims.length === 0 && (
          <p className="mt-3 text-[13px] text-[#888]">{t('restaurant.historyEmpty')}</p>
        )}

        <div className="mt-3 space-y-3">
          {claims.map((c) => {
            const hoursLeft = Math.floor((new Date(c.responseDeadlineAt).getTime() - Date.now()) / 3_600_000)
            const expired = hoursLeft <= 0
            const prior = Object.values(c.previouslyClaimed?.byLine ?? {}).flat()
            const fin = c.financialEffect
            return (
              <div key={c.id} className="rounded-xl border border-[#f0e0d8] bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[13px] font-bold text-[#1a1a1a]">
                    {t('restaurant.order')} {c.orderRef}
                  </span>
                  {/* The countdown only means something while an answer is still accepted. */}
                  {c.canRespond ? (
                    <span className={`text-xs font-semibold ${expired ? 'text-[#d4380d]' : 'text-[#F97316]'}`}>
                      {expired ? t('restaurant.expired') : t('restaurant.timeLeft', { hours: hoursLeft })}
                    </span>
                  ) : (
                    <span className="text-xs font-semibold text-[#666]">{statusLabel(c.status)}</span>
                  )}
                </div>
                {c.canRespond && (
                  <p className="mt-1 text-[13px] text-[#444]">
                    <span className="font-semibold">{t('restaurant.statusLabel')}:</span> {statusLabel(c.status)}
                  </p>
                )}
                <p className="mt-1 text-[13px] text-[#444]">
                  <span className="font-semibold">{t('restaurant.reason')}:</span> {t(`reason.${c.reason}`)}
                </p>
                <p className="text-[13px] text-[#444]">
                  <span className="font-semibold">{t('restaurant.requested')}:</span> {formatEuros(c.requestedAmountCents / 100, locale)}
                </p>
                {/* L7's snapshot — what the customer actually pointed at. */}
                <p className="text-[13px] text-[#444]">
                  <span className="font-semibold">{t('restaurant.selectionLabel')}:</span> {selectionLine(c)}
                </p>
                {c.approvedAmountCents !== null && (
                  <p className="text-[13px] text-[#444]">
                    <span className="font-semibold">{t('restaurant.approvedLabel')}:</span> {formatEuros(c.approvedAmountCents / 100, locale)}
                  </p>
                )}
                {c.customerMessage && (
                  <p className="mt-1 text-[13px] text-[#666]">
                    <span className="font-semibold">{t('restaurant.details')}:</span> {c.customerMessage}
                  </p>
                )}
                {c.photoUrl && (
                  <a href={c.photoUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-[13px] font-semibold text-[#F97316] underline">
                    {t('restaurant.viewPhoto')}
                  </a>
                )}
                {c.restaurantResponse && (
                  <p className="mt-1 text-[13px] text-[#444]">
                    <span className="font-semibold">{t('restaurant.yourAnswer')}:</span>{' '}
                    {t(c.restaurantResponse === 'accepted' ? 'restaurant.yourAnswerAccepted' : 'restaurant.yourAnswerRefused')}
                    {c.restaurantResponseReason ? ` — ${c.restaurantResponseReason}` : ''}
                  </p>
                )}

                {/* ── The earlier-claim signal. INFORMATIONAL: S-26 means nothing is consumed. ───────── */}
                {(prior.length > 0 || (c.previouslyClaimed?.unattributableCount ?? 0) > 0 || c.previouslyClaimed?.incomplete) && (
                  <div className="mt-2 rounded-lg border border-[#f0e0d8] bg-[#FFFBF8] p-2">
                    <p className="text-[13px] font-semibold text-[#1a1a1a]">{t('restaurant.previouslyClaimed')}</p>
                    {/* One line per (earlier claim, article) — the article is the point of the signal. A
                        claim that named two dishes is genuinely two facts, and each says WHICH dish. */}
                    {prior.map((p, i) => (
                      <p key={`${p.claimRef}-${i}`} className="text-xs text-[#666]">
                        {t('restaurant.previouslyClaimedLine', { name: p.name, ref: p.claimRef, status: statusLabel(p.status), qty: p.qty })}
                      </p>
                    ))}
                    {(c.previouslyClaimed?.unattributableCount ?? 0) > 0 && (
                      <p className="text-xs text-[#666]">
                        {t('restaurant.previouslyClaimedOther', { count: c.previouslyClaimed.unattributableCount })}
                      </p>
                    )}
                    {c.previouslyClaimed?.incomplete && (
                      <p className="text-xs text-[#666]">{t('restaurant.previouslyClaimedIncomplete')}</p>
                    )}
                    <p className="mt-1 text-xs text-[#888]">{t('restaurant.previouslyClaimedNote')}</p>
                  </div>
                )}

                {/* ── T-46: the CONFIRMED financial effect, or the explicit absence of one. ──────────── */}
                {fin?.confirmed === true ? (
                  <div className="mt-2 rounded-lg border border-[#e0e7f0] bg-[#F7FAFF] p-2">
                    <p className="text-[13px] font-semibold text-[#1a1a1a]">{t('restaurant.financeTitle')}</p>
                    <p className="text-xs text-[#444]">
                      {t('restaurant.financeRefund')}: <strong>{formatEuros(fin.customerRefundCents / 100, locale)}</strong>
                    </p>
                    <p className="text-xs text-[#444]">
                      {t('restaurant.financeFee')}: <strong>{formatEuros(fin.grubanoFeeReturnedCents / 100, locale)}</strong>
                    </p>
                    <p className="text-xs text-[#444]">
                      {t('restaurant.financeNet')}: <strong>{formatEuros(fin.restaurantNetImpactCents / 100, locale)}</strong>
                    </p>
                    <p className="mt-1 text-xs text-[#888]">{t('restaurant.financeNote')}</p>
                  </div>
                ) : (
                  // Only worth saying once the claim is past the restaurant's own answer: before that,
                  // « no confirmed financial effect » is trivially true and would read as a warning.
                  !c.canRespond && (
                    <p className="mt-2 text-xs text-[#888]">{t('restaurant.financeUnconfirmed')}</p>
                  )
                )}

                {/* The controls exist only where the server would accept them (control parity). */}
                {c.canRespond && (refusingId === c.id ? (
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
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
