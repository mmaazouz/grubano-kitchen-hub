'use client'
import { orderRef } from '@/lib/order-ref'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from '@/navigation'
import { formatEuros, formatAmount } from '@/lib/format-money'
import './help.css'
// gb-* design FOUNDATION (Agent 168) — tokens + Material `.ms` font. The page wraps in
// `.gb` so the foundation tokens/font resolve; all component CSS lives in help.css.
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'

// ── /eat/order/[orderId]/help — « Aide & problème de commande » ────────────────
//
// VERBATIM reproduction of the FROZEN CD ref (Notion 38efd2c9-…-81f5). Three views,
// client-toggled on ONE screen (the CD file ships A active + B/C in its project):
//   A « Aide »          : search + REAL order banner + 3 problem options + topics + contact
//   B « Remboursement » : REAL per-item list (checkboxes) + reason + photo + estimate
//   C « Support »       : chat bubbles + « IA bientôt » pill + composer
//
// REAL DATA (read-only): the order banner + the refund item list come from the REAL
// order via GET /api/orders/[orderId] (restaurant name, ref, items, prices, total,
// status). NO amount is fabricated — the refund estimate is the SUM of the selected
// REAL item prices.
//
// REFUND SUBMIT (B) — now wired to the REAL /api/claims (P2-CLAIMS), but ONLY when the
// feature is live. On entering the refund view (when authenticated) we GET
// /api/claims?orderId= which returns { enabled, eligibility }:
//  • enabled === false  → the claims SURFACE is closed (D′ L1: CLAIMS_SURFACE_ENABLED, or the legacy lease
//    when no product flag is set; the original « CLAIMS_ENABLED is OFF » of founder D4).
//    LOT D (P-2): the inert refund form is MASKED entirely — the view renders ONLY the
//    human-support panel (mailto:contact@grubano.com with the order number in the
//    subject). No inert items/textarea/photo/« bientôt » banner/dead submit is shown.
//  • enabled === true   → real flow. Eligibility (owner + paid + within window + no active
//    claim) drives the submit. If not eligible we surface the reason and disable submit;
//    if an existing claim exists we show its status. On submit we POST a real claim.
//    D′ L1: with the intake paused (CLAIMS_INTAKE_ENABLED off) the route overlays
//    { canClaim:false, reason:'intake_closed' } — the reason is shown, submit stays disabled.
//
// LOT 4 (closed beta — support honnête, plus de mise en scène) :
//  • The scripted chat (fake agent bubbles, « ● En ligne » badge, disabled composer)
//    and the fabricated « ~2 min » / « < 24 h » contact ETAs were REMOVED — no
//    support-chat backend exists. The « Support » view is now an honest e-mail
//    contact: mailto:contact@grubano.com (the product's ONLY real support channel,
//    same address as the dine-in receipt + PartnerShell).
//  • « Annuler la commande » was REMOVED — no cancel API exists.
//  • The refund estimate line only renders when claimsEnabled === true.
// STILL INERT (no live backend — see report):
//  • « Retard » routes to the EXISTING /eat/track.
//  • Help topics are inert placeholders (no help-article backend).
//  • The refund PHOTO button stays INERT — the photo is OPTIONAL per /api/claims; we do
//    NOT wire the moderated upload here (future nicety, noted in report).
//  • `reason` is fixed to 'missing_item' (this entry = « article manquant / erroné »); a
//    reason picker is a future nicety (the API accepts the full CLAIM_REASONS enum).

interface OrderItem { name: string; qty: number; price: number }
interface Order {
  id: string
  status: string
  total: number
  items: OrderItem[]
  restaurant?: { name?: string } | null
  // P0-19 — served by GET /api/orders/[id]; drives pickup-aware status labels.
  fulfillmentType?: string
}

type View = 'help' | 'refund' | 'chat'

// Mirror of lib/claims.getClaimEligibility's return shape (the only fields the UI reads).
interface ClaimEligibility {
  canClaim: boolean
  // D' L6 (spec v2 §7.1): 'not_delivered' (E3) and 'no_refundable_amount' (E6) joined the server's union.
  // L7 (T-50): this union is the ELIGIBILITY codes — the ones GET /api/claims can answer about the order.
  // The POST answers those too, plus a second family about WHAT was claimed (items_required,
  // qty_over_purchased, …). Those never appear here because they are not properties of the order; they
  // arrive on the POST response and are rendered through the same REFUSAL_LABEL map below.
  reason?: 'not_owner' | 'not_paid' | 'not_delivered' | 'window_expired' | 'active_claim' | 'no_refundable_amount' | 'intake_closed'
  /**
   * D′ L6: with `reason: 'active_claim'`, the id of the claim that HOLDS the key — which is not always
   * `existingClaim`, the NEWEST one. When they differ, the claim shown below is not the one that blocks.
   */
  blockingClaimId?: string
  maxRefundableCents: number
  /** T-59: true only when the ceiling was proven against live Stripe cash truth. */
  ceilingVerified?: boolean
  windowHours: number
  existingClaim:
    | { id: string; status: string; canContest: boolean; restaurantResponseReason: string | null; arbitrationReason: string | null }
    | null
}

// Submit lifecycle for the REAL claim POST (flag ON). 'idle' before submit; 'sending'
// disables the button (no double-submit); 'done' shows the « réclamation envoyée » state;
// 'error' surfaces the API error string.
type SubmitState = 'idle' | 'sending' | 'done' | 'error'

// Short, human-friendly reference derived from the real id (matches /api/eat/orders).
const refOf = orderRef

export default function OrderHelpScreen() {
  const t = useTranslations('eat.help')
  const locale = useLocale()
  const router = useRouter()
  const { orderId } = useParams<{ orderId: string }>()
  const { status: authStatus } = useSession()

  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>('help')
  // refund view local state — which REAL items are flagged + the description.
  /**
   * L7 (T-50) — index → the QUANTITY the customer disputes on that line. 0 (or absent) = not selected.
   *
   * It was a boolean, and the claim then sent the FULL purchased quantity for every ticked line: a
   * customer who received three gnocchi and had a problem with one could only say « the gnocchi », and
   * the claim recorded three. The snapshot must hold the quantity actually contested, so the customer
   * has to be able to say it.
   */
  const [picked, setPicked] = useState<Record<number, number>>({})
  const [desc, setDesc] = useState('')
  // INERT (flag OFF) fallback flag — exactly the prior behaviour, kept byte-identical.
  const [submitted, setSubmitted] = useState(false)
  // CLAIMS feature gate + eligibility (driven by GET /api/claims?orderId=).
  // `claimsEnabled` defaults to false → the inert path is taken until proven otherwise,
  // so a slow/failed GET can NEVER turn an OFF page into a live one.
  const [claimsEnabled, setClaimsEnabled] = useState(false)
  const [eligibility, setEligibility] = useState<ClaimEligibility | null>(null)
  // REAL-claim submit lifecycle (only used when claimsEnabled === true).
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (authStatus === 'loading') return
    if (authStatus !== 'authenticated') { setLoading(false); return }
    let alive = true
    fetch(`/api/orders/${orderId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setOrder(d?.order ?? null) })
      .catch(() => { if (alive) setOrder(null) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [authStatus, orderId])

  // Fetch the claim feature-gate + eligibility. On ANY failure (network / non-OK / parse)
  // we leave claimsEnabled=false → the page stays on the inert path, never exposing a
  // half-wired live submit. { enabled:false } (flag OFF) does the same. Returns nothing.
  const refetchEligibility = useCallback(async () => {
    try {
      const r = await fetch(`/api/claims?orderId=${encodeURIComponent(orderId)}`)
      if (!r.ok) { setClaimsEnabled(false); return }
      const d = await r.json()
      if (d?.enabled === true) {
        setClaimsEnabled(true)
        setEligibility((d.eligibility as ClaimEligibility) ?? null)
      } else {
        setClaimsEnabled(false)
        setEligibility(null)
      }
    } catch {
      setClaimsEnabled(false)
    }
  }, [orderId])

  // Load the gate + eligibility once authenticated (and whenever the order changes).
  useEffect(() => {
    if (authStatus !== 'authenticated') return
    void refetchEligibility()
  }, [authStatus, refetchEligibility])

  const items = useMemo<OrderItem[]>(() => (Array.isArray(order?.items) ? order!.items : []), [order])
  const itemsCount = useMemo(() => items.reduce((s, it) => s + (it.qty ?? 1), 0), [items])
  // RE-AUDIT FIX (batch 2). This figure is what the CUSTOMER is told they are asking for. It was
  // summed from `Order.items[].price`, the MenuItem LIST price, and shown raw — so on a discounted
  // order, or one already partly refunded (including from the Stripe Dashboard, which the rail's
  // own Refund table never sees), it exceeded what the server actually records. The customer read
  // one number and the acknowledgement e-mail then stated a smaller one. The server's ceiling is
  // already fetched here; the displayed figure is now clamped to it, so the page cannot promise
  // money the server will not grant. It can only ever shrink — never inflate.
  const rawEstimate = useMemo(
    () => items.reduce((s, it, i) => s + it.price * Math.min(picked[i] ?? 0, it.qty ?? 1), 0),
    [items, picked],
  )
  const ceilingEuros = (eligibility?.maxRefundableCents ?? 0) / 100
  const estimate = eligibility ? Math.min(rawEstimate, ceilingEuros) : rawEstimate
  /** True when the server ceiling, not the selection, is what caps the figure shown. */
  const estimateCapped = !!eligibility && rawEstimate > ceilingEuros
  /**
   * L7 — only a selection that still POINTS AT SOMETHING counts.
   *
   * It was `Object.values(selected).some(Boolean)`, true for any truthy key — including an index past
   * the end of the list after the order reloaded shorter. The button was then enabled while the body
   * built an EMPTY items array, so the customer pressed « envoyer » and got a 400 they could not act
   * on. A stale index is not a selection.
   */
  const anySelected = items.some((it, i) => (picked[i] ?? 0) > 0 && (picked[i] ?? 0) <= Math.max(1, Math.floor(it.qty ?? 1)))

  // P0-19 — on a pickup order, 'picked_up'/'delivered' mean "collected by the
  // client": never « En route »/« Livrée » (delivery vocabulary). Display only.
  const isPickupOrder = order?.fulfillmentType === 'pickup'
  const statusLabel = (s?: string) =>
    isPickupOrder && (s === 'picked_up' || s === 'delivered') ? t('statusCollected')
      : s === 'received' ? t('statusReceived')
        : s === 'preparing' ? t('statusPreparing')
          : s === 'ready' ? t('statusReady')
            : s === 'picked_up' ? t('statusEnRoute')
              : s === 'delivered' ? t('statusDelivered')
                : s === 'cancelled' ? t('statusCancelled')
                  : t('statusReceived')

  const restaurantName = order?.restaurant?.name ?? '—'

  function goBack() {
    if (view !== 'help') {
      setView('help'); setSubmitted(false); setSubmitState('idle'); setSubmitError(null)
      return
    }
    // L7 — leaving the form CLEARS it. `selected` and `desc` used to survive both a goBack and a
    // successful submit, so the next visit opened with the previous visit's ticks and description
    // already in place, ready to be filed again without the customer having chosen anything.
    setPicked({})
    setDesc('')
    router.back()
  }

  // ── REAL claim submit (flag ON + eligible) ─────────────────────────────────
  // POST a claim for the selected items: reason fixed to 'missing_item' (this entry),
  // requestedAmountCents = the SELECTED real-item estimate (server re-caps at order total).
  // 201 → success + refetch eligibility (so it reflects the now-active/auto-resolved claim);
  // 4xx → surface the API error; 403 {gated} → fall back to the inert « bientôt » state.
  async function submitClaim() {
    if (!claimsEnabled || !eligibility?.canClaim || !anySelected || submitState === 'sending') return
    setSubmitState('sending'); setSubmitError(null)
    try {
      const res = await fetch('/api/claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          reason: 'missing_item',
          description: desc.trim() || undefined,
          // CLAIMS BATCH 2 — 'missing_item' is ITEM_REQUIRED server-side: a whole-order ceiling
          // is refused for it, so sending only an amount would now be rejected. This page
          // ALREADY tracks which lines the customer ticked, so it sends that SELECTION
          // (index + purchased quantity). The server prices it from the stored order; no price
          // or total from this client is ever read.
          // L7 — the scope is STATED, not inferred. 'missing_item' is items-only, so there is nothing for
          // the customer to choose here; saying it anyway means the server never has to guess, and a future
          // change of reason on this page cannot silently become a whole-order claim.
          scope: 'items',
          items: items
            .map((it, i) => ({ index: i, qty: Math.min(picked[i] ?? 0, it.qty ?? 1) }))
            .filter((x) => x.qty > 0),
        }),
      })
      if (res.status === 201) {
        setSubmitState('done')
        // The claim is filed: the form's content is spent. Leaving it in place invited a second,
        // identical claim built from state the customer had already used.
        setPicked({})
        setDesc('')
        await refetchEligibility() // reflect the filed claim (active / auto-resolved)
        return
      }
      const data = await res.json().catch(() => ({} as { error?: string; gated?: boolean }))
      // Gate flipped off between the GET and the POST → honest inert fallback.
      if (res.status === 403 && data?.gated) {
        setClaimsEnabled(false); setSubmitState('idle'); setSubmitError(null)
        return
      }
      setSubmitState('error')
      // D' L6: an eligibility refusal now carries its CODE, so the customer reads the refusal in their own
      // language instead of the server's French sentence. Anything without a code keeps the server text.
      const code = typeof data?.reason === 'string' ? (data.reason as string) : null
      const localized = code ? REFUSAL_LABEL[code] : null
      setSubmitError(localized ? t(localized) : typeof data?.error === 'string' ? data.error : t('claimError'))
    } catch {
      setSubmitState('error')
      setSubmitError(t('claimError'))
    }
  }

/**
 * D' L6 (spec v2 §7.1): the server's refusal CODE → the i18n key the customer reads. The POST and the GET
 * answer the same codes because they ask the same rules (lib/claim-eligibility), so one map serves both.
 * A code with no entry falls back to the server's own sentence rather than to silence.
 */
const REFUSAL_LABEL: Record<string, string> = {
  not_owner:            'claimNotEligible',
  not_paid:             'claimNotPaid',
  not_delivered:        'claimNotDelivered',
  window_expired:       'claimWindowExpired',
  active_claim:         'claimAlreadyFiled',
  no_refundable_amount: 'claimNoRefundableAmount',
  intake_closed:        'claimIntakeClosed',
  // L7 (T-50) — the refusals about WHAT WAS CLAIMED, as opposed to whether the order is claimable.
  //
  // This page files ONE reason (`missing_item`, items-only) and always states `scope: 'items'`, so the
  // codes it can actually meet are the selection ones: a quantity above what was purchased, an index the
  // order no longer has after a reload, a duplicate, or an order whose lines are unreadable. The rest of
  // the family is mapped anyway — the same map serves any surface that reuses it, and a code with no
  // label falls back to the server's French sentence, which is exactly what should not happen twice.
  // Left UNMAPPED on purpose: `items_not_allowed`, `amount_not_allowed`, `invalid_scope` and
  // `reason_not_selectable`. Those require a client that contradicts itself or offers a withdrawn reason;
  // writing five translations for a state no working client can reach is noise in five locales.
  scope_required:         'claimScopeRequired',
  scope_not_allowed:      'claimItemsRequired',
  items_required:         'claimItemsRequired',
  item_lines_unavailable: 'claimItemLinesUnavailable',
  invalid_selection:      'claimInvalidSelection',
  duplicate_selection:    'claimDuplicateSelection',
  invalid_qty:            'claimInvalidQty',
  qty_over_purchased:     'claimQtyOverPurchased',
  amount_required:        'claimAmountRequired',
  amount_over_ceiling:    'claimAmountOverCeiling',
}

  // Eligibility → a human label for the disabled-submit reason (flag ON, not eligible).
  // Mirrors getClaimEligibility's reason union + the active-claim status.
  const eligibilityLabel = (): string => {
    const ex = eligibility?.existingClaim
    // D′ L6: an OLDER claim can hold the @unique activeOrderKey while the newest claim of the order is
    // closed. Showing that closed claim's status (« refusée ») next to a refusal that means « one is still
    // in progress » read as a contradiction, and told the customer to do the wrong thing. When the blocking
    // claim is not the one we are about to describe, say what actually blocks.
    if (eligibility?.reason === 'active_claim' && eligibility.blockingClaimId && eligibility.blockingClaimId !== ex?.id) {
      return t('claimAlreadyFiled')
    }
    if (ex && (eligibility?.reason === 'active_claim' || !eligibility?.canClaim)) {
      // an existing claim takes precedence — show its review/decision status
      if (ex.status === 'restaurant_review') return t('claimAlreadyFiled')
      // ROUND-8 AUDIT FIX (P2): an APPROVED claim was told « remboursement en cours » — nothing pays an
      // approved claim until a refund is actually driven. Only 'refunding' is in progress.
      // ROUND-9: the server now derives the status a customer sees; a recovery state reads as a review.
      if (ex.status === 'financial_verification') return t('claimInReview')
      if (ex.status === 'refunding') return t('claimRefunding')
      if (ex.status === 'approved') return t('claimApproved')
      if (ex.status === 'refunded') return t('claimRefunded')
      // ROUND 13 (F07): « Remboursée » needs a proven row (F03); otherwise the customer reads it unconfirmed.
      if (ex.status === 'refund_unconfirmed') return t('claimRefundUnconfirmed')
      // ROUND-11 AUDIT FIX (P1): a declaration close is not a refusal (lib/claim-action-rules customerClaimStatus).
      if (ex.status === 'closed_by_support') return t('claimClosedBySupport')
      if (ex.status === 'refused' || ex.status === 'refused_final' || ex.status === 'refused_by_grubano') return t('claimRefused')
      if (ex.status === 'arbitration') return t('claimInReview')
    }
    switch (eligibility?.reason) {
      case 'window_expired': return t('claimWindowExpired')
      case 'not_paid':       return t('claimNotPaid')
      // D′ L1 (S-23): the surface is open, the intake is paused — an existing claim above still shows its status.
      case 'intake_closed':  return t('claimIntakeClosed')
      case 'not_owner':      return t('claimNotEligible')
      case 'active_claim':   return t('claimAlreadyFiled')
      // D' L6 (spec v2 §7.1): the two refusals the server added. Without their own sentence they would fall
      // to « pas éligible », which tells a customer nothing about what to do next — and what to do differs:
      // wait for the delivery, or write to support because the money is already back.
      case 'not_delivered':  return t('claimNotDelivered')
      case 'no_refundable_amount': return t('claimNoRefundableAmount')
      default:               return t('claimNotEligible')
    }
  }

  // ── Not signed in → invite to sign in (the order needs a session) ──────────
  if (authStatus === 'unauthenticated') {
    return (
      <div className="gb gb-help">
        <div className="bar">
          <button type="button" className="back" onClick={() => router.back()} aria-label={t('back')}>
            <span className="ms ms-flip" aria-hidden="true">arrow_back</span>
          </button>
          <h1>{t('title')}</h1>
        </div>
        <div className="body">
          <div className="ord" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
            <b style={{ fontFamily: 'var(--gb-font-display)', fontSize: 15 }}>{t('signInTitle')}</b>
            <button className="submit" type="button" style={{ width: 'auto', padding: '12px 20px' }} onClick={() => router.push('/eat/auth')}>
              <span className="ms" aria-hidden="true">login</span><b>{t('signInCta')}</b>
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ════════════════════════════ VIEW HEADER (shared) ════════════════════════
  const Header = ({ titleKey }: { titleKey: string }) => (
    <div className="bar">
      <button type="button" className="back" onClick={goBack} aria-label={t('back')}>
        <span className="ms ms-flip" aria-hidden="true">arrow_back</span>
      </button>
      <h1>{t(titleKey)}</h1>
    </div>
  )

  // ════════════════════════════ B) REFUND VIEW ══════════════════════════════
  if (view === 'refund') {
    // LOT D (P-2, décision fondateur D4) — CLAIMS_ENABLED=false est FINAL pour la
    // bêta : la vue « Remboursement » inerte (items/textarea/photo/bannière
    // « bientôt »/submit mort) est MASQUÉE au profit du seul canal réel, le
    // support humain (même adresse que toutes les autres surfaces support).
    // `claimsEnabled` défaute à false → un GET lent/échoué atterrit TOUJOURS ici,
    // jamais sur un formulaire à moitié câblé. Le flux flag-ON ci-dessous reste
    // STRICTEMENT intouché (ses branches !claimsEnabled sont désormais
    // inatteignables — conservées telles quelles pour ne pas toucher au flux ON).
    if (!claimsEnabled) {
      const refundMailto = `mailto:contact@grubano.com?subject=${encodeURIComponent(`Remboursement — commande ${refOf(orderId)}`)}`
      return (
        <div className="gb gb-help">
          <Header titleKey="refundTitle" />
          <div className="body">
            <p className="lbl">{t('refundOffTitle')}</p>
            <div className="rcard" style={{ fontSize: 12.5, color: 'var(--gb-muted)', lineHeight: 1.55 }}>
              {t('refundOffBody')}
            </div>
            <div className="contact">
              <a className="cbtn" href={refundMailto}>
                <span className="ms" aria-hidden="true">mail</span>
                <b>{t('contactEmail')}</b><span>contact@grubano.com</span>
              </a>
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className="gb gb-help">
        <Header titleKey="refundTitle" />
        <div className="body">
          <p className="lbl">{t('refundWhich')}</p>
          <div className="rcard">
            <div className="items">
              {loading ? (
                [0, 1].map((i) => <div key={i} className="sk" style={{ height: 22 }} />)
              ) : items.length ? (
                items.map((it, i) => {
                  const maxQty = Math.max(1, Math.floor(it.qty ?? 1))
                  const qty = Math.min(picked[i] ?? 0, maxQty)
                  const on = qty > 0
                  return (
                    <div key={i} className="it" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {/* Tapping the line selects it (qty 1) or clears it — the same gesture as before. */}
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => setPicked((p) => ({ ...p, [i]: on ? 0 : 1 }))}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, background: 'none', border: 0, padding: 0, textAlign: 'start' }}
                      >
                        <span className={`cb${on ? ' on' : ''}`}>
                          {on && <span className="ms" aria-hidden="true">check</span>}
                        </span>
                        <span className="nm">{maxQty > 1 ? `${maxQty}× ${it.name}` : it.name}</span>
                      </button>
                      {/* L7 — HOW MANY of them. Shown only when more than one was bought: a stepper on a
                          single item would be a control with one position. Min 1 on a selected line; the
                          maximum is what was purchased, and the server re-checks both. */}
                      {on && maxQty > 1 && (
                        <select
                          aria-label={t('claimQtyLabel', { name: it.name })}
                          value={qty}
                          onChange={(e) => setPicked((p) => ({ ...p, [i]: Number(e.target.value) }))}
                          style={{ borderRadius: 8, border: '1px solid var(--gb-border)', padding: '2px 6px', background: 'var(--gb-surface)', color: 'inherit' }}
                        >
                          {Array.from({ length: maxQty }, (_, k) => k + 1).map((q) => (
                            <option key={q} value={q}>{q}</option>
                          ))}
                        </select>
                      )}
                      <span className="pr">{formatEuros(it.price * (on ? qty : maxQty), locale)}</span>
                    </div>
                  )
                })
              ) : (
                <span className="nm" style={{ color: 'var(--gb-muted)' }}>{t('refundNoItems')}</span>
              )}
            </div>
          </div>

          <p className="lbl">{t('refundWhat')}</p>
          <div className="field">
            {/* Bound. value='' keeps the rendered textarea identical to the prior
                uncontrolled one; the API enforces the 1000-char cap (a 4xx is surfaced). */}
            <textarea
              placeholder={t('refundPlaceholder')}
              aria-label={t('refundWhat')}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
          </div>

          {/* INERT — the photo is OPTIONAL per /api/claims; the moderated upload is not
              wired here (future nicety). The button has no handler. */}
          <button type="button" className="photo">
            <span className="ms" aria-hidden="true">add_a_photo</span>{t('refundAddPhoto')}
          </button>

          {/* FLAG OFF (claimsEnabled === false, the default) → the original inert
              « bientôt » banner, byte-identical to before. */}
          {!claimsEnabled && (
            <div className="soon">
              <span className="ms" aria-hidden="true">schedule</span>{t('refundSoon')}
              <span className="pill">{t('soonBadge')}</span>
            </div>
          )}

          {/* FLAG ON, claim FILED → confirmation. */}
          {claimsEnabled && submitState === 'done' && (
            <div className="soon" role="status">
              <span className="ms" aria-hidden="true">check_circle</span>{t('claimFiledSub')}
            </div>
          )}

          {/* FLAG ON, NOT eligible (and no claim just filed) → the reason. */}
          {claimsEnabled && submitState !== 'done' && eligibility && !eligibility.canClaim && (
            <div className="soon" role="status">
              <span className="ms" aria-hidden="true">info</span>{eligibilityLabel()}
            </div>
          )}

          {/* FLAG ON, submit ERROR → the API error, verbatim. */}
          {claimsEnabled && submitState === 'error' && submitError && (
            <div className="soon" role="alert">
              {/* P0-30bis — no `.ms` ligature glued to the refusal message. */}
              {submitError}
            </div>
          )}

          {/* LOT 4 — the « Remboursement estimé … sous 3–5 jours » promise only renders
              when the claims feature is LIVE (claimsEnabled). Flag OFF → no promise. */}
          {claimsEnabled && (
            <div className="refund-note">
              <span className="ms" aria-hidden="true">verified_user</span>
              <p>
                {anySelected
                  ? t.rich('refundEstimate', { amount: formatAmount(estimate, locale), b: (c) => <b><bdi>{c} €</bdi></b> })
                  : t('refundPickToEstimate')}
              </p>
              {/* T-59 — the cap sentence says « ce qui reste remboursable », a cash claim. It may only
                  be shown when the ceiling was proven against live Stripe truth; otherwise the cap is
                  DB-derived and is described as the maximum of the REQUEST, still to be verified. */}
              {estimateCapped && (
                <p className="refund-note-cap">{t(eligibility?.ceilingVerified === true ? 'refundEstimateCapped' : 'refundEstimateCappedUnverified')}</p>
              )}
            </div>
          )}
        </div>

        <div className="foot">
          <div className="inner">
            {!claimsEnabled ? (
              /* FLAG OFF → the ORIGINAL inert submit (sets `submitted`, no POST). Byte-identical. */
              <button type="button" className="submit" disabled={!anySelected || submitted} onClick={() => setSubmitted(true)}>
                <span className="ms" aria-hidden="true">{submitted ? 'schedule' : 'send'}</span>
                <b>{submitted ? t('refundSubmittedSoon') : t('refundSubmit')}</b>
              </button>
            ) : submitState === 'done' ? (
              /* FLAG ON, claim FILED → success, button locked. */
              <button type="button" className="submit" disabled>
                <span className="ms" aria-hidden="true">check_circle</span>
                <b>{t('claimFiledTitle')}</b>
              </button>
            ) : (
              /* FLAG ON → REAL submit; disabled if not eligible / nothing selected / sending. */
              <button
                type="button"
                className="submit"
                disabled={!eligibility?.canClaim || !anySelected || submitState === 'sending'}
                onClick={submitClaim}
              >
                <span className="ms" aria-hidden="true">{submitState === 'sending' ? 'schedule' : 'send'}</span>
                <b>{submitState === 'sending' ? t('claimSending') : t('refundSubmit')}</b>
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ═══════════════ C) SUPPORT VIEW — honest e-mail contact (LOT 4) ══════════
  // The scripted chat was REMOVED (no support-chat backend). This view is a
  // minimal honest state: the ONLY real support channel, a real mailto.
  if (view === 'chat') {
    return (
      <div className="gb gb-help">
        <Header titleKey="supportTitle" />
        <div className="body">
          <p className="lbl">{t('contactLabel')}</p>
          <div className="contact">
            <a className="cbtn" href="mailto:contact@grubano.com">
              <span className="ms" aria-hidden="true">mail</span>
              <b>{t('contactEmail')}</b><span>contact@grubano.com</span>
            </a>
          </div>
        </div>
      </div>
    )
  }

  // ════════════════════════════ A) HELP CENTRE VIEW ═════════════════════════
  return (
    <div className="gb gb-help">
      <Header titleKey="title" />
      <div className="body">
        <div className="hp-search">
          <span className="ms" aria-hidden="true">search</span>
          <input placeholder={t('searchPlaceholder')} aria-label={t('searchPlaceholder')} />
        </div>

        <p className="lbl">{t('problemLabel')}</p>
        {loading ? (
          <div className="sk" style={{ height: 72, marginBottom: 16 }} />
        ) : (
          <div className="ord">
            <span className="th" />
            <div className="m">
              <b>{restaurantName}</b>
              <span>
                <bdi>{refOf(orderId)}</bdi> · {t('items', { count: itemsCount })} · <bdi>{formatEuros(order?.total ?? 0, locale)}</bdi>
              </span>
            </div>
            <span className="st">{statusLabel(order?.status)}</span>
          </div>
        )}

        <div className="opts">
          <button type="button" className="opt warn" onClick={() => setView('refund')}>
            <span className="ic"><span className="ms" aria-hidden="true">remove_shopping_cart</span></span>
            <div className="t"><b>{t('optMissingTitle')}</b><span>{t('optMissingSub')}</span></div>
            <span className="ms ms-flip" aria-hidden="true">chevron_right</span>
          </button>
          {/* Lot véracité : « Voir où en est le livreur » est du vocabulaire de
              LIVRAISON — sur un retrait il promettait un livreur qui n'existe pas
              (constat humain de la répétition). Le motif n'apparaît que pour une
              commande livrée ; le retrait garde son propre chemin (pass + statut). */}
          {!isPickupOrder && (
            <button type="button" className="opt info" onClick={() => router.push(`/eat/track/${orderId}`)}>
              <span className="ic"><span className="ms" aria-hidden="true">schedule</span></span>
              <div className="t"><b>{t('optLateTitle')}</b><span>{t('optLateSub')}</span></div>
              <span className="ms ms-flip" aria-hidden="true">chevron_right</span>
            </button>
          )}
          {/* LOT 4 : l'option « Annuler la commande — Possible avant la préparation »
              est RETIRÉE — aucune API d'annulation n'existe ; elle routait vers un
              faux chat. */}
        </div>

        <p className="lbl">{t('topicsLabel')}</p>
        <div className="topics">
          <button type="button" className="topic">
            <span className="ms" aria-hidden="true">payments</span>
            <span>{t('topicPayments')}</span>
            <span className="ms chev ms-flip" aria-hidden="true">chevron_right</span>
          </button>
          <button type="button" className="topic">
            <span className="ms" aria-hidden="true">account_circle</span>
            <span>{t('topicAccount')}</span>
            <span className="ms chev ms-flip" aria-hidden="true">chevron_right</span>
          </button>
          <button type="button" className="topic">
            <span className="ms" aria-hidden="true">redeem</span>
            <span>{t('topicRewards')}</span>
            <span className="ms chev ms-flip" aria-hidden="true">chevron_right</span>
          </button>
        </div>

        <p className="lbl">{t('contactLabel')}</p>
        {/* LOT 4 : ETA fabriquées (« ~2 min », « < 24 h ») RETIRÉES ; l'e-mail est un
            vrai mailto (le seul canal support réel du produit). */}
        <div className="contact">
          <button type="button" className="cbtn" onClick={() => setView('chat')}>
            <span className="ms" aria-hidden="true">support_agent</span>
            <b>{t('supportTitle')}</b>
          </button>
          <a className="cbtn" href="mailto:contact@grubano.com">
            <span className="ms" aria-hidden="true">mail</span>
            <b>{t('contactEmail')}</b><span>contact@grubano.com</span>
          </a>
        </div>
      </div>
    </div>
  )
}
