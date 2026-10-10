'use client'
import { orderRef } from '@/lib/order-ref'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { Link, useRouter } from '@/navigation'
import { useTranslations, useLocale } from 'next-intl'
import StripeTicketPayment from '@/components/payments/StripeTicketPayment'
import WalletPaymentButton from '@/components/eat/WalletPaymentButton'
import { readAddresses, formatAddress, currentAddressStamp, sessionAddressStamp, ADDRESS_EVENT, type EatAddress } from '@/lib/eat-addresses'
import { sessionCartStamp } from '@/lib/eat-cart'
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
  restaurant?:     { id: string; name: string; address?: string | null; city?: string | null; pickupPrepTime?: number | null; deliveryPrepTime?: number | null } | null
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

/** Everything on this page that belongs to ONE account on ONE order — the recap, the LIVE
 *  Stripe PaymentIntent and the stage that mounts the Elements — stored WITH the stamp of
 *  the identity + route it was obtained under. A null stamp matches nothing (fail closed). */
interface ScopedState {
  stamp:   string | null
  order:   OrderInfo | null
  payInit: PayInit | null
  stage:   Stage
}
const EMPTY_SCOPE: ScopedState = { stamp: null, order: null, payInit: null, stage: 'loading' }

const orderRefOf = orderRef
const ADDR_ICON: Record<EatAddress['kind'], string> = { home: 'home', work: 'work', other: 'location_on' }

export default function CheckoutPage() {
  const t = useTranslations('eat.checkout')
  // « Commande confirmée » screen (CD 38efd2c9-…-81f8) — its own i18n namespace.
  const tc = useTranslations('eat.confirmed')
  const locale = useLocale()
  const router = useRouter()
  const { data: session, status } = useSession()
  const params = useParams<{ orderId: string }>()
  const orderId = params?.orderId ?? ''
  // The identity, reused — same shape as EatShell / track / rewards (lib/eat-cart
  // sessionCartStamp). `userId` is the raw next-auth id compared with the SERVER-echoed
  // `ownerId` of GET /api/orders/[id] — the identity the request was actually issued UNDER.
  const userId = (session?.user as { id?: string } | undefined)?.id

  // P1 (same-tab A → B switch). The recap, the LIVE PaymentIntent (`payInit.clientSecret`)
  // and the stage that mounts the Stripe Elements used to sit in plain state behind an
  // effect keyed on `[orderId]`. NextAuth broadcasts `setSession` without flipping through
  // 'unauthenticated', so after A → B nothing re-fired: the next account inherited A's
  // recap AND A's mounted Stripe form — a confirm would have charged B's card for A's order
  // (the owner check of POST /pay never ran again; the secret was already in the client).
  // They now live in ONE record stamped with the identity + route they were obtained under,
  // surfaced only through the render-time gate below.
  const [scoped, setScoped] = useState<ScopedState>(EMPTY_SCOPE)
  const [error,   setError]   = useState('')
  const [starting, setStarting] = useState(false)
  /** « Réessayer » re-arms the load effect through a tick — never a captured loader. */
  const [reloadTick, setReloadTick] = useState(0)
  /** Scope GENERATION — bumped on every run of the load effect (identity, route or retry).
   *  « Payer » captures it; a /pay response that lands after it moved is discarded. */
  const scopeGenRef = useRef(0)

  // ── Visual-only selections (no money impact — see header note) ───────────────
  // Real saved addresses (Wave 4 localStorage store); the selected address is
  // display-only (the order's delivery details were frozen at creation).
  const [addresses, setAddresses] = useState<EatAddress[]>([])
  const [addrId, setAddrId]       = useState<string>('')
  /** The identity the saved list was read under (first-frame guard, see below). */
  const [addrStamp, setAddrStamp] = useState<string | null>(null)

  // FIRST-FRAME GUARD — the stamp the SESSION implies, available in the SAME render as the
  // new session (effects run AFTER that render). The route is part of it: the same person
  // navigating from order X to Y must never see X's recap or X's PaymentIntent in Y's first
  // committed frame. JSON.stringify is unambiguous even when an id contains delimiters.
  const identityStamp = sessionCartStamp(status, userId)
  const checkoutStamp = identityStamp !== null && orderId.length > 0
    ? JSON.stringify([identityStamp, orderId]) : null

  // ── Load the recap — keyed on IDENTITY + orderId (+ retry tick), FAIL-CLOSED FIRST ──
  // The previous scope leaves the screen BEFORE any request. `requestOwner`, `requestUserId`
  // and `requestOrderId` are captured together so the response is refused unless the server
  // echoed the SAME RAW ID for the SAME order (closes the window where React still believes
  // A but the browser cookie is already B). `alive` closes the opposite window — React moved
  // on, but a late response for the previous scope is still inbound. 401/403/404 FAIL CLOSED
  // without a redirect: a redirect fired from a stale identity would trampoline a signed-in B
  // through /eat/auth on A's defunct call.
  useEffect(() => {
    scopeGenRef.current += 1
    setScoped(EMPTY_SCOPE)
    setError('')
    if (status === 'loading') return
    // UNAUTHENTICATED → /eat/auth, but ONLY off the live session (never off a polled 401).
    if (status === 'unauthenticated') { router.push('/eat/auth'); return }
    if (!userId) return
    const requestOwner = checkoutStamp
    const requestUserId = userId
    const requestOrderId = orderId
    if (requestOwner === null) return
    let alive = true
    const failClosed = () => {
      if (alive) setScoped({ stamp: requestOwner, order: null, payInit: null, stage: 'error' })
    }
    ;(async () => {
      try {
        const r = await fetch(`/api/orders/${requestOrderId}`, { cache: 'no-store' })
        if (!alive) return
        if (!r.ok) { failClosed(); return }
        const body = (await r.json()) as { ownerId?: unknown; order?: OrderInfo }
        if (!alive) return
        // NEVER STAMP A BODY THE SERVER DID NOT ATTRIBUTE TO THE SAME RAW ID. The `typeof`
        // half matters: a response that OMITS the field must not slip through on
        // `undefined === undefined`. The order must also be the ROUTE's order.
        if (typeof body?.ownerId !== 'string' || body.ownerId !== requestUserId) { failClosed(); return }
        if (!body.order || body.order.id !== requestOrderId) { failClosed(); return }
        setScoped({
          stamp:   requestOwner,
          order:   body.order,
          payInit: null,
          stage:   body.order.paymentStatus === 'paid' ? 'already-paid' : 'review',
        })
      } catch {
        failClosed()
      }
    })()
    return () => { alive = false }
    // `userId` AND `orderId` ARE DEPENDENCIES: `status` alone cannot see A → logout → B when
    // the broadcast moves the id without touching `status`; switching to another order's URL
    // on the same mount must re-fire too. `checkoutStamp` derives from them, so pinning the
    // primitives keeps it current without an extra dep that would re-fire every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, /* checkout-deps */ [status, userId, orderId, reloadTick])

  // RENDER-TIME GATE — a value is shown only when its stamp matches the identity + route the
  // SESSION implies right now, which changes in the same render as the session. On an A → B
  // switch inside this component this is what prevents one committed frame of A's recap — and
  // A's mounted Stripe Elements — painting under B; the stage falls back to 'loading' on that
  // very frame. An authenticated session with no usable id fails closed VISIBLY (error).
  const inScope = scoped.stamp !== null && scoped.stamp === checkoutStamp
  const order   = inScope ? scoped.order : null
  const payInit = inScope ? scoped.payInit : null
  const identityUnusable = status === 'authenticated' && !userId
  const stage: Stage = inScope ? scoped.stage : (identityUnusable ? 'error' : 'loading')
  const errorText = inScope ? error : ''

  // Scope-bound stage setter: a closure created in a render carries THAT render's stamp and
  // can only touch a record still stamped with it. The `onPaid` closure the Stripe Elements
  // hold therefore cannot flip the NEXT account's record to 'paid' after an A → B switch.
  const setStage = (next: Stage) =>
    setScoped((cur) => (cur.stamp !== null && cur.stamp === checkoutStamp ? { ...cur, stage: next } : cur))

  // Load the user's real saved addresses (visual delivery selector) — and KEEP THEM LIVE.
  //
  // ⚠️ This used to read once on mount with no listener, so the list stayed in React state
  // after the signed-in identity changed in this tab: the previous account's whole address
  // book, and its selected address, remained on screen on the NEW account's payment page.
  // The address cache is owner-scoped now, but only a re-read sees that — hence the same
  // ADDRESS_EVENT / storage subscription every other consumer has. The selection is
  // dropped whenever the refreshed list no longer contains it.
  useEffect(() => {
    const sync = () => {
      const list = readAddresses()
      setAddresses(list)
      setAddrStamp(currentAddressStamp())
      setAddrId((cur) => {
        if (list.some((a) => a.id === cur)) return cur
        return (list.find((a) => a.isDefault) ?? list[0])?.id ?? ''
      })
    }
    sync()
    window.addEventListener(ADDRESS_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(ADDRESS_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  // ── Start the payment (C1 route — called, never modified) ───────────────────
  // Only ever issued off the GATED `order` (in scope right now). The response — a LIVE
  // PaymentIntent — is adopted only if the scope generation has not moved since the click
  // (identity, route, retry) AND only into a record still carrying the same stamp. POST
  // /pay does not echo an owner id; the server's own owner check (403) is the other half.
  async function startPayment() {
    if (!order || starting) return
    const requestOwner = checkoutStamp
    const requestGen = scopeGenRef.current
    setStarting(true)
    setError('')
    try {
      const r = await fetch(`/api/orders/${order.id}/pay`, { method: 'POST' })
      const body = await r.json().catch(() => null)
      if (scopeGenRef.current !== requestGen) return
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
      const init: PayInit = {
        clientSecret:   body.clientSecret,
        publishableKey: body.publishableKey,
        amount:         body.amount,
        currency:       body.currency,
      }
      setScoped((cur) => (cur.stamp !== null && cur.stamp === requestOwner ? { ...cur, payInit: init, stage: 'pay' } : cur))
    } catch {
      if (scopeGenRef.current === requestGen) setError(t('errPayInit'))
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
  // FIRST-FRAME GUARD. The identity is declared in an effect, and effects run after the
  // render that introduced a new session: this page would paint the PREVIOUS account's
  // address book for one committed frame on an A -> B switch in the same tab, which no
  // ADDRESS_EVENT can prevent (the effect that emits it has not run yet). The stamp the
  // list was read under is compared with the stamp this render's session implies.
  const sessionStamp = sessionAddressStamp(status, userId)
  const visibleAddrs = addrStamp !== null && addrStamp === sessionStamp ? addresses : []
  const selAddr = visibleAddrs.find((a) => a.id === addrId) ?? null

  // ── « Commande confirmée » derived view-data (REAL order fields, read-only) ───
  // The customer first name for the greeting (« Merci Sofia ! ») — from the real
  // session; falls back to a generic greeting when anonymous.
  const firstName = ((session?.user?.name as string | undefined) ?? '').trim().split(/\s+/)[0] || ''
  // LOT VÉRACITÉ (2026-09-01) — l'« ARRIVÉE ESTIMÉE HH:MM–HH:MM · Dans ~N min »
  // était dérivée d'Order.estimatedTime = Restaurant.deliveryTime, un champ que
  // AUCUNE UI ne permet de saisir (défaut de schéma 30) — et « arrivée » est du
  // vocabulaire de livraison, affiché tel quel sur un RETRAIT (prouvé par la
  // répétition humaine). Aucun moteur ne calcule d'heure ⇒ aucune heure promise.
  // La seule donnée temps que le restaurateur SAISIT réellement (/dashboard/
  // fulfillment) est sa durée de préparation : exposée comme durée ATTRIBUÉE,
  // jamais comme promesse horaire ; absente ⇒ pas de carte du tout.
  const prepMins = (() => {
    const v = Number(isPickup ? order?.restaurant?.pickupPrepTime : order?.restaurant?.deliveryPrepTime)
    return Number.isFinite(v) && v > 0 ? Math.round(v) : null
  })()

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
            <div className="notice notice--err" role="alert"><span>{errorText || t('errLoad')}</span></div>
            <div className="pcta"><button type="button" className="cta" onClick={() => setReloadTick((n) => n + 1)}><span className="ms" aria-hidden="true">refresh</span><span>{t('retry')}</span></button></div>
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
              {/* P1 PRE-CLEAN (2026-08-29) — PICKUP : le sélecteur d'adresse CONSOMMATEUR
                  n'a aucune fonction transactionnelle en retrait → à la place, le POINT
                  DE RETRAIT réel (nom + adresse du restaurant). Aucune distance, aucun
                  ETA, aucune promesse de délai. */}
              {isPickup && (
                <section className="sec">
                  <div className="sec__h">
                    <span className="ms" aria-hidden="true">storefront</span>
                    <b>{t('pickupTitle')}</b>
                  </div>
                  <div className="opt sel" data-testid="pickup-point">
                    <span className="ico"><span className="ms" aria-hidden="true">storefront</span></span>
                    <div className="main">
                      <b>{t('pickupAt', { name: order.restaurant?.name ?? '' })}</b>
                      <span>{[order.restaurant?.address, order.restaurant?.city].filter(Boolean).join(', ')}</span>
                    </div>
                  </div>
                </section>
              )}
              {/* Address (delivery only) — REAL saved addresses (visual selector) */}
              {!isPickup && (
                <section className="sec">
                  <div className="sec__h">
                    <span className="ms" aria-hidden="true">location_on</span>
                    <b>{t('addressTitle')}</b>
                    <button type="button" className="edit" onClick={() => router.push('/eat/account/addresses')}>{t('change')}</button>
                  </div>
                  {visibleAddrs.length === 0 ? (
                    <button type="button" className="opt" onClick={() => router.push('/eat/account/addresses')}>
                      <span className="ico"><span className="ms" aria-hidden="true">add_location_alt</span></span>
                      <div className="main"><b>{t('addAddress')}</b><span>{t('addAddressHint')}</span></div>
                    </button>
                  ) : visibleAddrs.map((a) => (
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

                {errorText && stage === 'review' && (
                  <div className="notice notice--err" role="alert"><span>{errorText}</span></div>
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
              {errorText && <div className="notice notice--err" role="alert"><span>{errorText}</span></div>}
              <PayCta id="pay-cta-mobile" />
            </div>
          )}
        </>
      )}

      {/* ── « Commande confirmée » 🎉 (post-paiement) — VERBATIM CD 38efd2c9-…-81f8.
           Re-skins the previous 'paid' panel in place; payment/order flow untouched.
           REAL data: order ref, prep duration (restaurateur-entered), mode (fulfill-
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

            {/* Durée de préparation SAISIE par le restaurateur — pas d'heure promise,
                pas de « fenêtre d'arrivée ». Donnée absente ⇒ carte absente. */}
            {prepMins != null && (
              <div className="eta">
                <span className="ic"><span className="ms" aria-hidden="true">schedule</span></span>
                <div className="m">
                  <small>{tc('prepLabel')}</small>
                  <b><bdi>{tc('prepMins', { mins: prepMins })}</bdi></b>
                  <span>{tc('prepNote')}</span>
                </div>
              </div>
            )}

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
