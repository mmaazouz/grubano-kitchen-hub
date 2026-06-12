'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { useRouter } from '@/navigation'
import { useTranslations, useLocale } from 'next-intl'
import {
  ArrowLeft, Loader2, AlertCircle, Check, ShoppingBag, Store, Bike,
} from 'lucide-react'
import StripeTicketPayment from '@/components/payments/StripeTicketPayment'

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
  // Chantier P2 — the discount is the SERVER field when exposed (P1 resolved
  // it at creation); legacy fallback: derived from the frozen amounts (C1:
  // total = subtotal + deliveryFee − discount). Never computed from a promo.
  const discount = order
    ? (typeof order.discount === 'number' && order.discount > 0
        ? order.discount
        : Math.max(0, order.subtotal + order.deliveryFee - order.total))
    : 0
  const ref = order ? orderRefOf(order.id) : ''

  // ── Screens ─────────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto min-h-screen max-w-md bg-[#FAFAFA] pb-24">
      {/* Header */}
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-[#eee] bg-white/95 px-4 py-3 backdrop-blur">
        <button
          onClick={() => router.back()}
          aria-label={t('title')}
          className="grid h-9 w-9 place-items-center rounded-xl bg-[#f4f4f4]"
        >
          <ArrowLeft size={16} className="text-[#1a1a1a]" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-base font-extrabold text-[#1a1a1a]">{t('title')}</h1>
          {order && <p className="text-[11px] text-[#888]">{t('orderRef', { ref })}</p>}
        </div>
      </header>

      {stage === 'loading' && (
        <div className="mt-16 flex items-center justify-center gap-2 text-sm text-[#888]">
          <Loader2 size={14} className="animate-spin" /> {t('loading')}
        </div>
      )}

      {stage === 'error' && (
        <div className="mt-10 px-4">
          <p className="flex items-start gap-2 rounded-[16px] border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <span>{error || t('errLoad')}</span>
          </p>
          <button
            type="button"
            onClick={loadOrder}
            className="mt-3 w-full rounded-[20px] border-2 border-[#F97316] py-3 text-[14px] font-bold text-[#F97316] active:scale-95"
          >
            {t('retry')}
          </button>
        </div>
      )}

      {stage === 'already-paid' && order && (
        <div className="mt-10 px-4">
          <div className="rounded-[20px] bg-white p-5 text-center shadow-bolt-card">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#16a34a] text-white">
              <Check size={20} />
            </span>
            <p className="mt-3 text-base font-extrabold text-[#1a1a1a]">{t('errAlreadyPaid')}</p>
            <button
              type="button"
              onClick={() => router.push(`/eat/track/${order.id}`)}
              className="mt-4 w-full rounded-[20px] bg-[#F97316] py-3 text-[14px] font-bold text-white active:scale-95"
            >
              {t('alreadyPaidCta')}
            </button>
          </div>
        </div>
      )}

      {(stage === 'review' || stage === 'pay') && order && (
        <div className="space-y-3 px-4 pt-4">
          {/* ── Recap card ─────────────────────────────────────────────────── */}
          <div className="rounded-[20px] bg-white p-4 shadow-bolt-card">
            <div className="mb-2 flex items-center gap-2">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#FFF3ED] text-[#F97316]">
                {isPickup ? <Store size={16} /> : <Bike size={16} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-extrabold text-[#1a1a1a]">
                  {order.restaurant?.name ?? ''}
                </p>
                <p className="text-[11px] text-[#888]">{t('recapTitle')}</p>
              </div>
            </div>

            <ul className="divide-y divide-[#f4f4f4]">
              {order.items.map((it, i) => (
                <li key={i} className="flex items-baseline gap-2.5 py-2 text-[13px]">
                  <span className="text-[#888]">{it.qty}×</span>
                  <span className="flex-1 truncate text-[#1a1a1a]">{it.name}</span>
                  <span className="font-semibold text-[#1a1a1a]">{fmt.format(it.price * it.qty)}</span>
                </li>
              ))}
            </ul>

            <div className="mt-2 space-y-1 border-t border-[#f4f4f4] pt-2 text-[13px]">
              <div className="flex items-baseline justify-between">
                <span className="text-[#888]">{t('subtotal')}</span>
                <span className="font-semibold text-[#1a1a1a]">{fmt.format(order.subtotal)}</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-[#888]">{isPickup ? t('pickupNoFee') : t('deliveryFee')}</span>
                <span className="font-semibold text-[#1a1a1a]">
                  {isPickup ? fmt.format(0) : fmt.format(order.deliveryFee)}
                </span>
              </div>
              {discount > 0.005 && (
                <div className="flex items-baseline justify-between text-[#16a34a]">
                  {/* P2 — the promo's display name when the server resolved one;
                      generic label otherwise (welcome discount, legacy). */}
                  <span>{order.promotion?.name ? t('promoLine', { name: order.promotion.name }) : t('discount')}</span>
                  <span className="font-semibold">−{fmt.format(discount)}</span>
                </div>
              )}
              <div className="flex items-baseline justify-between pt-1 text-[15px] font-extrabold">
                <span className="text-[#1a1a1a]">{t('total')}</span>
                <span className="text-[#F97316]">{fmt.format(order.total)}</span>
              </div>
            </div>
          </div>

          {/* What is charged NOW — explicit, no surprise. */}
          <p className="rounded-[16px] bg-white px-3 py-2.5 text-[11px] text-[#888] shadow-bolt-card">
            {t('payNowNote')}
          </p>

          {stage === 'review' && (
            <>
              {error && (
                <p className="flex items-start gap-2 rounded-[16px] border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600">
                  <AlertCircle size={13} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </p>
              )}
              <button
                type="button"
                onClick={startPayment}
                disabled={starting}
                className="flex w-full items-center justify-center gap-2 rounded-[20px] bg-[#F97316] py-4 text-[15px] font-bold text-white active:scale-95 disabled:opacity-60"
              >
                {starting ? <Loader2 size={15} className="animate-spin" /> : null}
                {t('payCta', { amount: fmt.format(order.total) })}
              </button>
            </>
          )}

          {stage === 'pay' && payInit && (
            <div className="rounded-[20px] bg-white p-4 shadow-bolt-card">
              <StripeTicketPayment
                clientSecret={payInit.clientSecret}
                publishableKey={payInit.publishableKey}
                amount={payInit.amount}
                currency={payInit.currency}
                onPaid={() => setStage('paid')}
              />
            </div>
          )}
        </div>
      )}

      {/* ── Confirmation ─────────────────────────────────────────────────────── */}
      {stage === 'paid' && order && (
        <div className="px-4 pt-8">
          <div className="rounded-[20px] bg-white p-6 text-center shadow-bolt-card">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-[#16a34a] text-white">
              <Check size={24} />
            </span>
            <p className="mt-4 text-[19px] font-extrabold text-[#1a1a1a]">{t('confirmTitle')}</p>
            <p className="mt-1 text-[13px] font-semibold text-[#1a1a1a]">{t('orderRef', { ref })}</p>
            <p className="mt-2 text-[13px] text-[#888]">{t('confirmBody')}</p>
            <p className="text-[12px] text-[#888]">
              {isPickup
                ? t('confirmPickup',   { restaurant: order.restaurant?.name ?? '' })
                : t('confirmDelivery', { restaurant: order.restaurant?.name ?? '' })}
            </p>

            {/* Short recap */}
            <div className="mt-4 rounded-[16px] bg-[#FAFAFA] p-3 text-start">
              <ul className="space-y-1">
                {order.items.map((it, i) => (
                  <li key={i} className="flex items-baseline gap-2 text-[12px]">
                    <span className="text-[#888]">{it.qty}×</span>
                    <span className="flex-1 truncate text-[#1a1a1a]">{it.name}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 border-t border-[#eee] pt-2 text-[12px] font-bold text-[#1a1a1a]">
                {t('paidAmount', { amount: fmt.format(order.total) })}
              </p>
            </div>

            <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-[#888]">
              <ShoppingBag size={11} /> {t('confirmEmail')}
            </p>

            <button
              type="button"
              onClick={() => router.push(`/eat/track/${order.id}`)}
              className="mt-5 w-full rounded-[20px] bg-[#F97316] py-4 text-[15px] font-bold text-white active:scale-95"
            >
              {t('trackCta')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
