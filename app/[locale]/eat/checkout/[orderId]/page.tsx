'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { useRouter } from '@/navigation'
import { useTranslations, useLocale } from 'next-intl'
import {
  ArrowLeft, Loader2, AlertCircle, Check, ShoppingBag, Store, Bike,
} from 'lucide-react'
import { Button } from '@/components/design-system'
import StripeTicketPayment from '@/components/payments/StripeTicketPayment'
import WalletPaymentButton from '@/components/eat/WalletPaymentButton'

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
// Screens (mobile-first, bolt design):
//   review  — order recap: products subtotal, delivery fee (or "pickup, no
//             fee"), derived welcome discount, TOTAL + the explicit "charged
//             NOW by card" note → Payer.
//   pay     — Stripe Elements (reused component).
//   paid    — confirmation: order ref, short recap, "le restaurant prépare
//             votre commande", track CTA.
// Error states: already paid (409 → friendly + track CTA), cancelled/amount
// mismatch (server message VERBATIM), load failure.

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
}
interface PayInit {
  clientSecret:   string
  publishableKey: string
  amount:         number
  currency:       string
}

type Stage = 'loading' | 'review' | 'pay' | 'paid' | 'already-paid' | 'error'

const orderRefOf = (id: string) => `#${id.slice(-6).toUpperCase()}`

export default function CheckoutPage() {
  const t = useTranslations('eat.checkout')
  const locale = useLocale()
  const router = useRouter()
  const params = useParams<{ orderId: string }>()
  const orderId = params?.orderId ?? ''

  const [stage,   setStage]   = useState<Stage>('loading')
  const [order,   setOrder]   = useState<OrderInfo | null>(null)
  const [error,   setError]   = useState('')
  const [payInit, setPayInit] = useState<PayInit | null>(null)
  const [starting, setStarting] = useState(false)

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

  // ── Start the payment (C1 route — called, never modified) ───────────────────
  async function startPayment() {
    if (!order || starting) return
    setStarting(true)
    setError('')
    try {
      const r = await fetch(`/api/orders/${order.id}/pay`, { method: 'POST' })
      const body = await r.json().catch(() => null)
      if (r.status === 409) { setStage('already-paid'); return }
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

  // ── Screens ─────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto min-h-screen max-w-md bg-gb-surface pb-24 font-gb-sans text-gb-content lg:max-w-[920px] lg:pb-12">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-gb-stroke bg-gb-surface px-4 py-3 backdrop-blur">
        <button
          onClick={() => router.back()}
          aria-label={t('title')}
          className="grid h-9 w-9 place-items-center rounded-gb-lg bg-gb-oat-100"
        >
          <ArrowLeft size={16} className="text-gb-content" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="font-gb-display text-base font-extrabold text-gb-content">{t('title')}</h1>
          {order && <p className="text-[11px] text-gb-content-muted">{t('orderRef', { ref })}</p>}
        </div>
      </header>

      {stage === 'loading' && (
        <div className="mt-16 flex items-center justify-center gap-2 text-sm text-gb-content-muted">
          <Loader2 size={14} className="animate-spin" /> {t('loading')}
        </div>
      )}

      {stage === 'error' && (
        <div className="mt-10 px-4 lg:mx-auto lg:max-w-md">
          <p className="flex items-start gap-2 rounded-gb-lg bg-gb-error-soft px-3 py-2 text-[12px] text-gb-content">
            <AlertCircle size={13} className="mt-0.5 shrink-0 text-gb-error" />
            <span>{error || t('errLoad')}</span>
          </p>
          <button
            type="button"
            onClick={loadOrder}
            className="mt-3 w-full rounded-gb-full border-2 border-gb-accent py-3 text-[14px] font-bold text-gb-accent active:scale-95"
          >
            {t('retry')}
          </button>
        </div>
      )}

      {stage === 'already-paid' && order && (
        <div className="mt-10 px-4 lg:mx-auto lg:max-w-md">
          <div className="rounded-gb-xl bg-gb-surface-elevated p-5 text-center shadow-gb-md">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-gb-full bg-gb-success text-white">
              <Check size={20} />
            </span>
            <p className="mt-3 font-gb-display text-base font-extrabold text-gb-content">{t('errAlreadyPaid')}</p>
            <div className="mt-4">
              <Button
                type="button"
                variant="gb-primary"
                size="pill"
                fullWidth
                onClick={() => router.push(`/eat/track/${order.id}`)}
              >
                {t('alreadyPaidCta')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {(stage === 'review' || stage === 'pay') && order && (
        <div className="px-4 pt-4 lg:grid lg:grid-cols-[1fr_400px] lg:items-start lg:gap-6">
          {/* LEFT — order recap (what you're paying for) */}
          <div className="space-y-3 lg:min-w-0">
            {/* ── Recap card ─────────────────────────────────────────────────── */}
            <div className="rounded-gb-xl bg-gb-surface-elevated p-4 shadow-gb-md">
              <div className="mb-2 flex items-center gap-2">
                <span className="grid h-9 w-9 place-items-center rounded-gb-lg bg-gb-zest-50 text-gb-accent">
                  {isPickup ? <Store size={16} /> : <Bike size={16} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-extrabold text-gb-content">
                    {order.restaurant?.name ?? ''}
                  </p>
                  <p className="text-[11px] text-gb-content-muted">{t('recapTitle')}</p>
                </div>
              </div>

              <ul className="divide-y divide-gb-stroke">
                {order.items.map((it, i) => (
                  <li key={i} className="flex items-baseline gap-2.5 py-2 text-[13px]">
                    <span className="text-gb-content-muted">{it.qty}×</span>
                    <span className="flex-1 truncate text-gb-content">{it.name}</span>
                    <span className="font-semibold text-gb-content">{fmt.format(it.price * it.qty)}</span>
                  </li>
                ))}
              </ul>

              <div className="mt-2 space-y-1 border-t border-gb-stroke pt-2 text-[13px]">
                <div className="flex items-baseline justify-between">
                  <span className="text-gb-content-muted">{t('subtotal')}</span>
                  <span className="font-semibold text-gb-content">{fmt.format(order.subtotal)}</span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-gb-content-muted">{isPickup ? t('pickupNoFee') : t('deliveryFee')}</span>
                  <span className="font-semibold text-gb-content">
                    {isPickup ? fmt.format(0) : fmt.format(order.deliveryFee)}
                  </span>
                </div>
                {discount > 0.005 && (
                  <div className="flex items-baseline justify-between text-gb-basil-700">
                    {/* P2 — the promo's display name when the server resolved one;
                        generic label otherwise (welcome discount, legacy). */}
                    <span>{order.promotion?.name ? t('promoLine', { name: order.promotion.name }) : t('discount')}</span>
                    <span className="font-semibold">−{fmt.format(discount)}</span>
                  </div>
                )}
                {/* L2 — loyalty credit on its OWN line (Grubano-financed, distinct
                    from any promo). Server field only, never computed here. */}
                {loyaltyCredit > 0.005 && (
                  <div className="flex items-baseline justify-between text-gb-basil-700">
                    <span>
                      {order.pointsRedeemed && order.pointsRedeemed > 0
                        ? t('loyaltyLinePoints', { points: order.pointsRedeemed })
                        : t('loyaltyLine')}
                    </span>
                    <span className="font-semibold">−{fmt.format(loyaltyCredit)}</span>
                  </div>
                )}
                <div className="flex items-baseline justify-between pt-1 text-[15px] font-extrabold">
                  <span className="text-gb-content">{t('total')}</span>
                  <span className="text-gb-accent">{fmt.format(order.total)}</span>
                </div>
              </div>
            </div>

            {/* What is charged NOW — explicit, no surprise. */}
            <p className="rounded-gb-lg bg-gb-surface-elevated px-3 py-2.5 text-[11px] text-gb-content-muted shadow-gb-md">
              {t('payNowNote')}
            </p>
          </div>

          {/* RIGHT — the payment action (sticky on desktop). review = Pay CTA;
              pay = the wallet + Stripe Elements card. Only one is ever shown
              (mutually exclusive by `stage`) → no double-payment path. */}
          <aside className="mt-3 space-y-3 lg:mt-0 lg:sticky lg:top-4 lg:self-start">
            {stage === 'review' && (
              <>
                {error && (
                  <p className="flex items-start gap-2 rounded-gb-lg bg-gb-error-soft px-3 py-2 text-[12px] text-gb-content">
                    <AlertCircle size={13} className="mt-0.5 shrink-0 text-gb-error" />
                    <span>{error}</span>
                  </p>
                )}
                <Button
                  type="button"
                  variant="gb-primary"
                  size="pill"
                  fullWidth
                  loading={starting}
                  disabled={starting}
                  onClick={startPayment}
                >
                  {t('payCta', { amount: fmt.format(order.total) })}
                </Button>
              </>
            )}

            {stage === 'pay' && payInit && (
              <div className="space-y-3 rounded-gb-xl bg-gb-surface-elevated p-4 shadow-gb-md">
                {/* Wallet 1-tap (Apple/Google Pay) — CONFIRMS THE SAME PaymentIntent (payInit.clientSecret)
                    as the card, server amount (payInit.amount). Hidden when no wallet is available on the
                    device → card-only. Success → SAME onPaid as the card (setStage('paid') → confirm-poll
                    + tracking). The two payment components are left BYTE-IDENTICAL — only re-skinned around. */}
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
          </aside>
        </div>
      )}

      {/* ── Confirmation ─────────────────────────────────────────────────────── */}
      {stage === 'paid' && order && (
        <div className="px-4 pt-8 lg:mx-auto lg:max-w-md">
          <div className="rounded-gb-xl bg-gb-surface-elevated p-6 text-center shadow-gb-md">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-gb-full bg-gb-success text-white">
              <Check size={24} />
            </span>
            <p className="mt-4 font-gb-display text-[19px] font-extrabold text-gb-content">{t('confirmTitle')}</p>
            <p className="mt-1 text-[13px] font-semibold text-gb-content">{t('orderRef', { ref })}</p>
            <p className="mt-2 text-[13px] text-gb-content-muted">{t('confirmBody')}</p>
            <p className="text-[12px] text-gb-content-muted">
              {isPickup
                ? t('confirmPickup',   { restaurant: order.restaurant?.name ?? '' })
                : t('confirmDelivery', { restaurant: order.restaurant?.name ?? '' })}
            </p>

            {/* Short recap */}
            <div className="mt-4 rounded-gb-lg bg-gb-oat-100 p-3 text-start">
              <ul className="space-y-1">
                {order.items.map((it, i) => (
                  <li key={i} className="flex items-baseline gap-2 text-[12px]">
                    <span className="text-gb-content-muted">{it.qty}×</span>
                    <span className="flex-1 truncate text-gb-content">{it.name}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 border-t border-gb-stroke pt-2 text-[12px] font-bold text-gb-content">
                {t('paidAmount', { amount: fmt.format(order.total) })}
              </p>
            </div>

            <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-gb-content-muted">
              <ShoppingBag size={11} /> {t('confirmEmail')}
            </p>

            <div className="mt-5">
              <Button
                type="button"
                variant="gb-primary"
                size="pill"
                fullWidth
                onClick={() => router.push(`/eat/track/${order.id}`)}
              >
                {t('trackCta')}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
