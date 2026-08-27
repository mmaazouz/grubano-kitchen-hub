'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Link, useRouter } from '@/navigation'
import { useTranslations, useLocale } from 'next-intl'
import StripeTicketPayment from '@/components/payments/StripeTicketPayment'
import WalletPaymentButton from '@/components/eat/WalletPaymentButton'
import { readAddresses, formatAddress, type EatAddress } from '@/lib/eat-addresses'
import { formatTime } from '@/lib/format'
import './checkout.css'
import './confirmed.css'
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'

// ── /eat/checkout/[orderId] — chantier checkout C2 (Agent 13) ──────────────────
//
// THE consumer payment journey for pickup/delivery orders, over Agent 14's C1
// contract:
//   GET  /api/orders/[id]          → recap (items, subtotal, deliveryFee, total)
//   POST /api/orders/[id]/pay      → { clientSecret, publishableKey, amount,
//                                      currency } — SAME contract as the bill
//                                      rail → <StripeTicketPayment/> reused
//                                      as-is (decline + retry handled inside).
//   POST /api/orders/[id]/confirm  → server-side confirmation email once the
//                                      webhook flipped paymentStatus='paid'
//                                      (polled a few times — webhook race).
//
// 🔒 MONEY / BYTE-IDENTICAL — VISUAL RE-SKIN ONLY (CD ref Notion 38efd2c9-…-810f):
//   The order is ALREADY created (by the cart's placeOrder) with a SERVER-FROZEN
//   total by the time this page loads. The « Payer » CTA still calls startPayment →
//   POST /api/orders/[id]/pay and Stripe/Wallet still confirm the SERVER amount
//   (payInit.amount). NONE of that math changed. The CD mock adds an address / slot /
//   tip / saved-card UI: the address selector is bound to REAL saved addresses; the
//   INERT placeholders (slot chips, tip selector, fabricated saved cards « Visa ••••
//   4242 » / Apple Pay) were REMOVED for the closed beta (LOT 4 — no fabricated data,
//   no dead controls). Only the REAL Stripe Elements / Wallet module remains.

interface OrderItem { itemId?: string; name: string; qty: number; price: number }
interface OrderInfo {
  id:              string
  status:          string
  fulfillmentType: string
  items:           OrderItem[]
  subtotal:        number
  deliveryFee:     number
  total:           number
  paymentStatus?:  string | null
  restaurant?:     { id: string; name: string } | null
  // Chantier P2 (additive GET fields) — the SERVER-resolved discount and its
  // promotion display name. No client computation, ever.
  discount?:       number
  promotion?:      { id: string; name: string } | null
  // Chantier fidélité L2 (additive GET fields) — the SERVER-resolved loyalty
  // credit in CENTS + the points it spent. Shown on its OWN line, never folded
  // into the promo discount. No client computation, ever (D4).
  loyaltyCreditCents?: number
  pointsRedeemed?:     number
  // Additive (read-only) — the SERVER fields the GET already returns. Used by the
  // « Commande confirmée » screen (CD 38efd2c9-…-81f8) for the real ETA window +
  // the delivery address line. No client computation of money, ever.
  estimatedTime?:      number
  createdAt?:          string
  deliveryAddress?:    string | null
}
interface PayInit {
  clientSecret:   string
  publishableKey: string
  amount:         number
  currency:       string
}

type Stage = 'loading' | 'review' | 'pay' | 'paid' | 'already-paid' | 'error'

const orderRefOf = (id: string) => `#${id.slice(-6).toUpperCase()}`
const ADDR_ICON: Record<EatAddress['kind'], string> = { home: 'home', work: 'work', other: 'location_on' }

export default function CheckoutPage() {
  const t = useTranslations('eat.checkout')
  // « Commande confirmée » screen (CD 38efd2c9-…-81f8) — its own i18n namespace.
  const tc = useTranslations('eat.confirmed')
  const locale = useLocale()
  const router = useRouter()
  const { data: session } = useSession()
  const params = useParams<{ orderId: string }>()
  const orderId = params?.orderId ?? ''

  const [stage,   setStage]   = useState<Stage>('loading')
  const [order,   setOrder]   = useState<OrderInfo | null>(null)
  const [error,   setError]   = useState('')
  const [payInit, setPayInit] = useState<PayInit | null>(null)
  const [starting, setStarting] = useState(false)

  // ── Visual-only selections (no money impact — see header note) ───────────────
  // Real saved addresses (Wave 4 localStorage store); the selected address is
  // display-only (the order's delivery details were frozen at creation).
  const [addresses, setAddresses] = useState<EatAddress[]>([])
  const [addrId, setAddrId]       = useState<string>('')

  // ── Load the recap ──────────────────────────────────────────────────────────
  const loadOrder = useCallback(async () => {
    setStage('loading')
    setError('')
    try {
      const r = await fetch(`/api/orders/${orderId}`, { cache: 'no-store' })
      if (r.status === 401) { router.push('/eat/auth'); return }
      if (!r.ok) throw new Error('load_failed')
      const body = await r.json() as { order: OrderInfo }
      setOrder(body.order)
      setStage(body.order.paymentStatus === 'paid' ? 'already-paid' : 'review')
    } catch {
      setError(t('errLoad'))
      setStage('error')
    }
  }, [orderId, router, t])

  useEffect(() => { if (orderId) loadOrder() }, [orderId, loadOrder])

  // Load the user's real saved addresses (visual delivery selector).
  useEffect(() => {
    const list = readAddresses()
    setAddresses(list)
    const def = list.find((a) => a.isDefault) ?? list[0]
    if (def) setAddrId(def.id)
  }, [])

  // ── Start the payment (C1 route — called, never modified) ───────────────────
  async function startPayment() {
    if (!order || starting) return
    setStarting(true)
    setError('')
    try {
      const r = await fetch(`/api/orders/${order.id}/pay`, { method: 'POST' })
      const body = await r.json().catch(() => null)
      if (r.status === 409) {
        // P0-29 (vague 2) : un 409 du rail /pay n'est PLUS forcément « déjà
        // payée » — il refuse aussi les commandes héritées NON-CARTE
        // (code 'payment_method_mismatch'). Sans cette branche, une commande
        // cash NON payée s'affichait avec la coche verte « Cette commande est
        // déjà payée » (fausse validation d'encaissement — trouvé en revue
        // adversariale). Message serveur VERBATIM, comme les 400 ci-dessous.
        if (body?.code === 'payment_method_mismatch') {
          setError((body?.error as string) || t('errPayInit'))
          return
        }
        setStage('already-paid')
        return
      }
      if (!r.ok || !body?.clientSecret || !body?.publishableKey) {
        // 400 cancelled / amount guard → the server message VERBATIM.
        setError((body?.error as string) || t('errPayInit'))
        return
      }
      setPayInit({
        clientSecret:   body.clientSecret,
        publishableKey: body.publishableKey,
        amount:         body.amount,
        currency:       body.currency,
      })
      setStage('pay')
    } catch {
      setError(t('errPayInit'))
    } finally {
      setStarting(false)
    }
  }

  // ── Server-side confirmation email (webhook race → bounded retries) ─────────
  const confirmFiredRef = useRef(false)
  useEffect(() => {
    if (stage !== 'paid' || confirmFiredRef.current || !orderId) return
    confirmFiredRef.current = true
    let cancelled = false
    ;(async () => {
      for (let attempt = 0; attempt < 5 && !cancelled; attempt++) {
        try {
          const r = await fetch(`/api/orders/${orderId}/confirm`, { method: 'POST' })
          if (!r.ok) break
          const d = await r.json() as { paymentStatus: string | null; emailSent: boolean }
          if (d.paymentStatus === 'paid') break // email sent (or already sent)
        } catch { /* best-effort */ }
        await new Promise((res) => setTimeout(res, 2000))
      }
    })()
    return () => { cancelled = true }
  }, [stage, orderId])

  // ── Formatting ──────────────────────────────────────────────────────────────
  const fmt = useMemo(
    () => new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }),
    [locale],
  )
  const isPickup = order?.fulfillmentType === 'pickup'
  // Chantier fidélité L2 — the loyalty credit (€) is a SERVER field, shown on
  // its own line. NEVER computed client-side (D4).
  const loyaltyCredit = order && typeof order.loyaltyCreditCents === 'number'
    ? order.loyaltyCreditCents / 100
    : 0
  // Chantier P2 — the promo discount is the SERVER field when exposed (P1
  // resolved it at creation); legacy fallback: derived from the frozen amounts
  // (C1: total = subtotal + deliveryFee − discount − loyaltyCredit). The
  // loyalty credit is SUBTRACTED out of the fallback so it is never folded into
  // the promo line (L2 de-conflation).
  const discount = order
    ? (typeof order.discount === 'number' && order.discount > 0
        ? order.discount
        : Math.max(0, order.subtotal + order.deliveryFee - order.total - loyaltyCredit))
    : 0
  const ref = order ? orderRefOf(order.id) : ''
  const selAddr = addresses.find((a) => a.id === addrId) ?? null

  // ── « Commande confirmée » derived view-data (REAL order fields, read-only) ───
  // The customer first name for the greeting (« Merci Sofia ! ») — from the real
  // session; falls back to a generic greeting when anonymous.
  const firstName = ((session?.user?.name as string | undefined) ?? '').trim().split(/\s+/)[0] || ''
  // ETA window — from the REAL estimatedTime (minutes) anchored on the REAL
  // createdAt. We render a tight window [eta, eta+15min] (the CD shows a 15-min
  // band) + a « dans ~N min » relative line from now. No money, purely display;
  // degrades to em-dash when the order has no ETA.
  const hasEta = order ? Number.isFinite(order.estimatedTime) && (order.estimatedTime ?? 0) > 0 : false
  const createdMs = order?.createdAt ? new Date(order.createdAt).getTime() : Date.now()
  const etaStart = new Date(createdMs + (order?.estimatedTime ?? 0) * 60_000)
  const etaEnd   = new Date(etaStart.getTime() + 15 * 60_000)
  const etaWindow = hasEta ? `${formatTime(etaStart, locale)} – ${formatTime(etaEnd, locale)}` : '—'
  const etaMinsFromNow = hasEta ? Math.max(1, Math.round((etaStart.getTime() - Date.now()) / 60_000)) : 0
  // The address shown in the ETA sub-line: prefer the real saved default address
  // label, fall back to the order's frozen delivery address string.
  const confAddr = selAddr?.label || (order?.deliveryAddress ?? '')

  // ── The pay CTA — review = start payment; pay = the wallet + Stripe Elements
  //    card (real payment). Money handlers BYTE-IDENTICAL. ──────────────────────
  const PayCta = ({ id }: { id: string }) => (
    <button
      id={id}
      type="button"
      className="cta"
      disabled={starting}
      onClick={startPayment}
    >
      <span className="ms" aria-hidden="true">{starting ? 'progress_activity' : 'lock'}</span>
      <span>{order ? t('payCta', { amount: fmt.format(order.total) }) : t('payCtaBare')}</span>
    </button>
  )

  return (
    <div className={`gb gb-checkout${stage === 'paid' ? ' gb-checkout--confirmed' : ''}`}>
      {/* top bar — hidden on the « Commande confirmée » success screen (full-page CD) */}
      {stage !== 'paid' && (
        <div className="co-top">
          <button className="back" type="button" onClick={() => router.back()} aria-label={t('title')}>
            <span className="ms ms-flip" aria-hidden="true">arrow_back</span>
          </button>
          <h1>{t('title')}</h1>
        </div>
      )}

      {stage === 'loading' && (
        <div className="loadrow"><span className="ms" aria-hidden="true">progress_activity</span>{t('loading')}</div>
      )}

      {stage === 'error' && (
        <div className="center">
          <div className="panel">
            {/* P0-30bis — no `.ms` ligature next to refusal messages (renders as a
                glued « error » word when the icon font is unavailable). */}
            <div className="notice notice--err" role="alert"><span>{error || t('errLoad')}</span></div>
            <div className="pcta"><button type="button" className="cta" onClick={loadOrder}><span className="ms" aria-hidden="true">refresh</span><span>{t('retry')}</span></button></div>
          </div>
        </div>
      )}

      {stage === 'already-paid' && order && (
        <div className="center">
          <div className="panel">
            <div className="seal"><span className="ms" aria-hidden="true">check</span></div>
            <h2>{t('errAlreadyPaid')}</h2>
            <div className="pcta">
              <button type="button" className="cta" onClick={() => router.push(`/eat/track/${order.id}`)}>
                <span className="ms" aria-hidden="true">local_shipping</span><span>{t('alreadyPaidCta')}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {(stage === 'review' || stage === 'pay') && order && (
        <>
          <div className="steps">
            <b>{t('stepCart')}</b><span className="ms" aria-hidden="true">chevron_right</span>
            <b className="cur">{t('stepPayment')}</b><span className="ms" aria-hidden="true">chevron_right</span>
            {t('stepConfirm')}
          </div>

          <div className="layout">
            {/* LEFT column — address / payment (LOT 4 : slot + tip retirés) */}
            <div>
              {/* Address (delivery only) — REAL saved addresses (visual selector) */}
              {!isPickup && (
                <section className="sec">
                  <div className="sec__h">
                    <span className="ms" aria-hidden="true">location_on</span>
                    <b>{t('addressTitle')}</b>
                    <button type="button" className="edit" onClick={() => router.push('/eat/account/addresses')}>{t('change')}</button>
                  </div>
                  {addresses.length === 0 ? (
                    <button type="button" className="opt" onClick={() => router.push('/eat/account/addresses')}>
                      <span className="ico"><span className="ms" aria-hidden="true">add_location_alt</span></span>
                      <div className="main"><b>{t('addAddress')}</b><span>{t('addAddressHint')}</span></div>
                    </button>
                  ) : addresses.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className={`opt${a.id === addrId ? ' sel' : ''}`}
                      onClick={() => setAddrId(a.id)}
                      aria-pressed={a.id === addrId}
                    >
                      <span className="ico"><span className="ms" aria-hidden="true">{ADDR_ICON[a.kind]}</span></span>
                      <div className="main">
                        <b>{a.label}{a.isDefault && <span className="badge-def">{t('default')}</span>}</b>
                        <span>{formatAddress(a)}</span>
                      </div>
                      <span className="radio" />
                    </button>
                  ))}
                </section>
              )}

              {/* Payment — the REAL Stripe module only (LOT 4 : the fabricated
                  saved-card radios, slot chips and tip selector were REMOVED). */}
              <section className="sec">
                <div className="sec__h">
                  <span className="ms" aria-hidden="true">credit_card</span>
                  <b>{t('paymentTitle')}</b>
                </div>
                {/* REAL payment lives here once the user taps « Payer » (stage 'pay').
                    Wallet + Stripe Elements are left BYTE-IDENTICAL — only re-skinned
                    around. They confirm the SAME PaymentIntent / server amount. */}
                {stage === 'pay' && payInit && (
                  <div className="pay-live">
                    <WalletPaymentButton
                      clientSecret={payInit.clientSecret}
                      publishableKey={payInit.publishableKey}
                      amount={payInit.amount}
                      currency={payInit.currency}
                      label={t('total')}
                      heading={t('walletHeading')}
                      errorLabel={t('walletError')}
                      onPaid={() => setStage('paid')}
                    />
                    <StripeTicketPayment
                      clientSecret={payInit.clientSecret}
                      publishableKey={payInit.publishableKey}
                      amount={payInit.amount}
                      currency={payInit.currency}
                      onPaid={() => setStage('paid')}
                    />
                  </div>
                )}
              </section>
            </div>

            {/* RIGHT — sticky order summary (REAL totals) */}
            <aside className="summary">
              <div className="summary__h">{t('summaryTitle')}</div>
              <div className="miniitems">
                {order.items.map((it, i) => (
                  <div className="mi" key={i}>
                    <span><b>{it.qty}×</b>{it.name}</span>
                    <span className="v">{fmt.format(it.price * it.qty)}</span>
                  </div>
                ))}
              </div>
              <div className="summary__b">
                <div className="srow"><span>{t('subtotal')}</span><b>{fmt.format(order.subtotal)}</b></div>
                <div className="srow">
                  <span>{isPickup ? t('pickupNoFee') : t('deliveryFee')}</span>
                  <b>{isPickup ? fmt.format(0) : fmt.format(order.deliveryFee)}</b>
                </div>
                {discount > 0.005 && (
                  <div className="srow disc">
                    <span>{order.promotion?.name ? t('promoLine', { name: order.promotion.name }) : t('discount')}</span>
                    <span>−{fmt.format(discount)}</span>
                  </div>
                )}
                {loyaltyCredit > 0.005 && (
                  <div className="srow disc">
                    <span>
                      {order.pointsRedeemed && order.pointsRedeemed > 0
                        ? t('loyaltyLinePoints', { points: order.pointsRedeemed })
                        : t('loyaltyLine')}
                    </span>
                    <span>−{fmt.format(loyaltyCredit)}</span>
                  </div>
                )}
                <div className="sdiv" />
                <div className="stotal"><span>{t('total')}</span><b>{fmt.format(order.total)}</b></div>

                {/* selected delivery address — quiet confirmation line (delivery only) */}
                {!isPickup && selAddr && (
                  <p className="reassure" style={{ marginTop: 0, marginBottom: 12 }}>
                    <span className="ms" aria-hidden="true">location_on</span>{formatAddress(selAddr)}
                  </p>
                )}

                {error && stage === 'review' && (
                  <div className="notice notice--err" role="alert"><span>{error}</span></div>
                )}

                {/* desktop CTA (hidden under the sticky mobile bar at ≤820px) */}
                {stage === 'review' && <PayCta id="pay-cta-desktop" />}

                <div className="reassure"><span className="ms" aria-hidden="true">verified_user</span>{t('reassure')}</div>
              </div>
            </aside>
          </div>

          {/* mobile sticky pay bar */}
          {stage === 'review' && (
            <div className="mbar">
              {error && <div className="notice notice--err" role="alert"><span>{error}</span></div>}
              <PayCta id="pay-cta-mobile" />
            </div>
          )}
        </>
      )}

      {/* ── « Commande confirmée » 🎉 (post-paiement) — VERBATIM CD 38efd2c9-…-81f8.
           Re-skins the previous 'paid' panel in place; payment/order flow untouched.
           REAL data: order ref, ETA window (estimatedTime+createdAt), mode (fulfill-
           mentType), items + Total payé (frozen order.total), restaurant name, address.
           « Suivre » → /eat/track ; « Voir le reçu » INERT (no receipt route yet). ─── */}
      {stage === 'paid' && order && (
        <div className="gb-confirmed">
          <div className="confetti" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>

          <div className="cf-body">
            <div className="hero-ic"><span className="ms" aria-hidden="true">check</span></div>
            <h1 className="h1">{tc('title')}</h1>
            <p className="cf-sub">
              {firstName ? tc('thanksNamed', { name: firstName }) : tc('thanks')}{' '}
              <b>{order.restaurant?.name ?? ''}</b> {tc('preparing')}
            </p>

            {/* ETA card — real estimated arrival window */}
            <div className="eta">
              <span className="ic"><span className="ms" aria-hidden="true">schedule</span></span>
              <div className="m">
                <small>{tc('etaLabel')}</small>
                <b><bdi>{etaWindow}</bdi></b>
                <span>
                  {hasEta ? tc('etaIn', { mins: etaMinsFromNow }) : tc('etaSoon')}
                  {!isPickup && confAddr ? ` · ${tc('etaAddress', { address: confAddr })}` : ''}
                </span>
              </div>
            </div>

            {/* meta — order number + mode */}
            <div className="cf-meta">
              <div className="box">
                <small>{tc('orderNo')}</small>
                <b><span className="ms" aria-hidden="true">tag</span><bdi>{ref}</bdi></b>
              </div>
              <div className="box">
                <small>{tc('mode')}</small>
                <b>
                  <span className="ms" aria-hidden="true">{isPickup ? 'storefront' : 'two_wheeler'}</span>
                  {isPickup ? tc('modePickup') : tc('modeDelivery')}
                </b>
              </div>
            </div>

            {/* items + Total payé (REAL frozen total) */}
            <div className="sum">
              {order.items.map((it, i) => (
                <div className="cf-r" key={i}>
                  <span className="nm"><span className="q">{it.qty}</span>{it.name}</span>
                  <span><bdi>{fmt.format(it.price * it.qty)}</bdi></span>
                </div>
              ))}
              <div className="cf-div" />
              <div className="cf-tot">
                <span>{tc('totalPaid')}</span>
                <span><bdi>{fmt.format(order.total)}</bdi></span>
              </div>
            </div>
          </div>

          <div className="foot"><div className="inner">
            <Link className="track-btn" href={`/eat/track/${order.id}`}>
              <span className="ms ms-flip" aria-hidden="true">near_me</span>
              <b>{tc('trackCta')}</b>
            </Link>
            {/* « Voir le reçu » — INERT (no receipt route yet, « bientôt ») */}
            <button type="button" className="cf-ghost" disabled aria-disabled="true">
              <span className="ms" aria-hidden="true" style={{ fontSize: 17 }}>receipt_long</span>
              {tc('receiptCta')}<span className="soon">{tc('soon')}</span>
            </button>
          </div></div>
        </div>
      )}
    </div>
  )
}
