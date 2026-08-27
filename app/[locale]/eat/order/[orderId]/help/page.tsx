'use client'

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
//  • enabled === false  → CLAIMS_ENABLED is OFF (FINAL for the beta — founder D4).
//    LOT D (P-2): the inert refund form is MASKED entirely — the view renders ONLY the
//    human-support panel (mailto:contact@grubano.com with the order number in the
//    subject). No inert items/textarea/photo/« bientôt » banner/dead submit is shown.
//  • enabled === true   → real flow. Eligibility (owner + paid + within window + no active
//    claim) drives the submit. If not eligible we surface the reason and disable submit;
//    if an existing claim exists we show its status. On submit we POST a real claim.
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
  reason?: 'not_owner' | 'not_paid' | 'window_expired' | 'active_claim'
  maxRefundableCents: number
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
const refOf = (id: string) => 'GR-' + id.slice(-5).toUpperCase()

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
  const [selected, setSelected] = useState<Record<number, boolean>>({})
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
  // Refund estimate = sum of the SELECTED real item prices (× qty). Real data, not invented.
  const estimate = useMemo(
    () => items.reduce((s, it, i) => (selected[i] ? s + it.price * (it.qty ?? 1) : s), 0),
    [items, selected],
  )
  const anySelected = Object.values(selected).some(Boolean)

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
          requestedAmountCents: Math.round(estimate * 100),
        }),
      })
      if (res.status === 201) {
        setSubmitState('done')
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
      setSubmitError(typeof data?.error === 'string' ? data.error : t('claimError'))
    } catch {
      setSubmitState('error')
      setSubmitError(t('claimError'))
    }
  }

  // Eligibility → a human label for the disabled-submit reason (flag ON, not eligible).
  // Mirrors getClaimEligibility's reason union + the active-claim status.
  const eligibilityLabel = (): string => {
    const ex = eligibility?.existingClaim
    if (ex && (eligibility?.reason === 'active_claim' || !eligibility?.canClaim)) {
      // an existing claim takes precedence — show its review/decision status
      if (ex.status === 'restaurant_review') return t('claimAlreadyFiled')
      if (ex.status === 'approved' || ex.status === 'refunding') return t('claimApproved')
      if (ex.status === 'refunded') return t('claimRefunded')
      if (ex.status === 'refused' || ex.status === 'refused_final') return t('claimRefused')
      if (ex.status === 'arbitration') return t('claimInReview')
    }
    switch (eligibility?.reason) {
      case 'window_expired': return t('claimWindowExpired')
      case 'not_paid':       return t('claimNotPaid')
      case 'not_owner':      return t('claimNotEligible')
      case 'active_claim':   return t('claimAlreadyFiled')
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
                items.map((it, i) => (
                  <button
                    key={i}
                    type="button"
                    className="it"
                    aria-pressed={!!selected[i]}
                    onClick={() => setSelected((s) => ({ ...s, [i]: !s[i] }))}
                  >
                    <span className={`cb${selected[i] ? ' on' : ''}`}>
                      {selected[i] && <span className="ms" aria-hidden="true">check</span>}
                    </span>
                    <span className="nm">{it.qty > 1 ? `${it.qty}× ${it.name}` : it.name}</span>
                    <span className="pr">{formatEuros(it.price * (it.qty ?? 1), locale)}</span>
                  </button>
                ))
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
          <button type="button" className="opt info" onClick={() => router.push(`/eat/track/${orderId}`)}>
            <span className="ic"><span className="ms" aria-hidden="true">schedule</span></span>
            <div className="t"><b>{t('optLateTitle')}</b><span>{t('optLateSub')}</span></div>
            <span className="ms ms-flip" aria-hidden="true">chevron_right</span>
          </button>
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
