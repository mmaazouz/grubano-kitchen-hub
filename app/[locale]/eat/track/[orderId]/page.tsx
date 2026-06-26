'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { formatEuros } from '@/lib/format-money'
import { useParams } from 'next/navigation'
import { useRouter } from '@/navigation'
import { ArrowLeft, Navigation, MessageCircle, Phone, Check, MapPin, Store } from 'lucide-react'
import FoodImage from '@/components/eat/FoodImage'
import { Button } from '@/components/design-system'
import ClaimSection from '@/components/claims/ClaimSection'
import { getFoodImage, inferCategory } from '@/lib/food-images'
import { formatTime } from '@/lib/format'

interface Order {
  id: string
  status: string
  /** 'delivery' | 'pickup' — added to the API response (see /api/orders/[id]). */
  fulfillmentType?: 'delivery' | 'pickup' | string
  total: number
  estimatedTime: number
  items: { name: string; qty: number; price: number }[]
  restaurant: { name: string; address: string; city?: string; logo?: string }
  pointsEarned: number
  createdAt: string
  deliveryAddress: string
}

// Mapping for the OLD delivery flow (kept untouched).
const STATUS_TO_STEP: Record<string, number> = { received: 0, preparing: 1, ready: 1, picked_up: 2, delivered: 3 }
const STATUS_LABEL_KEY: Record<string, string> = {
  received: 'statusReceived',
  preparing: 'statusPreparing',
  ready: 'statusReady',
  picked_up: 'statusPickedUp',
  delivered: 'statusDelivered',
  cancelled: 'statusCancelled',
}

/**
 * Pickup-specific 4-step timeline. The terminal step covers both `picked_up`
 * and `delivered` because, for a pickup order, "delivered" is meaningless —
 * the restaurant marks it `picked_up` when the customer collects it, and the
 * legacy "delivered" status is just an alias for "all done".
 */
const PICKUP_STEPS = [
  { key: 'received', labelKey: 'statusReceived', emoji: '📥' },
  { key: 'preparing', labelKey: 'statusPreparing', emoji: '👨‍🍳' },
  { key: 'ready', labelKey: 'statusReadyPickup', emoji: '🥡' },
  { key: 'collected', labelKey: 'statusCollected', emoji: '✅' },
] as const

const PICKUP_STATUS_TO_STEP: Record<string, number> = {
  received: 0,
  preparing: 1,
  ready: 2,
  picked_up: 3,
  delivered: 3,
}

/**
 * Delivery 5-step timeline (UI-fix harmonisation): the SAME step journey the
 * restaurant sees and the pickup client already had — Reçue → En préparation →
 * Prête → En route → Livrée. Display only: statuses and labels are the
 * existing ones, zero new status logic. The courier card stays below as a
 * complement.
 */
const DELIVERY_STEPS = [
  { key: 'received',  labelKey: 'statusReceived',  emoji: '📥' },
  { key: 'preparing', labelKey: 'statusPreparing', emoji: '👨‍🍳' },
  { key: 'ready',     labelKey: 'statusReady',     emoji: '🛍️' },
  { key: 'picked_up', labelKey: 'statusPickedUp',  emoji: '🛵' },
  { key: 'delivered', labelKey: 'statusDelivered', emoji: '✅' },
] as const

const DELIVERY_STATUS_TO_STEP: Record<string, number> = {
  received: 0,
  preparing: 1,
  ready: 2,
  picked_up: 3,
  delivered: 4,
}

/** Vertical step timeline — extracted from the pickup branch verbatim so both
 *  fulfilment modes render the exact same component. */
function StepTimeline({
  steps, currentStep, completed, t,
}: {
  steps:       ReadonlyArray<{ key: string; labelKey: string; emoji: string }>
  currentStep: number
  completed:   boolean
  t:           (key: string) => string
}) {
  return (
    <div className="space-y-0">
      {steps.map((step, i) => {
        const done = i < currentStep || completed
        const active = i === currentStep && !completed
        const isLast = i === steps.length - 1
        return (
          <div key={step.key} className="relative flex gap-3 pb-4 last:pb-0">
            {/* Vertical connector */}
            {!isLast && (
              <span
                className={`absolute left-[15px] top-[34px] w-[2px] ${done ? 'bg-gb-accent-strong' : 'bg-gb-oat-200'}`}
                style={{ height: 'calc(100% - 18px)' }}
                aria-hidden
              />
            )}
            {/* Step bullet — status conveyed by icon/emoji + label, never colour alone */}
            <div
              className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-gb-full text-sm shadow-gb-sm transition-colors ${
                done
                  ? 'bg-gb-accent-strong text-white'
                  : active
                    ? 'bg-gb-surface-elevated text-gb-accent-strong ring-2 ring-gb-accent-strong'
                    : 'bg-gb-oat-100 text-gb-oat-400'
              }`}
            >
              {done ? <Check size={16} strokeWidth={3} /> : <span>{step.emoji}</span>}
            </div>
            {/* Label */}
            <div className="flex-1 pt-0.5">
              <p className={`text-[14px] font-bold ${done || active ? 'text-gb-content' : 'text-gb-content-muted'}`}>
                {t(step.labelKey)}
              </p>
              {active && (
                <p className="mt-0.5 text-xs font-semibold text-gb-accent-strong">{t('pickupCurrentStep')}</p>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function OrderTrackingScreen() {
  const t = useTranslations('eat.track')
  const locale = useLocale()
  const { orderId } = useParams<{ orderId: string }>()
  const router = useRouter()
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchOrder = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/${orderId}`)
      if (res.status === 401) { router.push('/eat/auth'); return }
      if (!res.ok) return
      const data = await res.json()
      setOrder(data.order)
    } catch {
      /* ignore */
    } finally {
      setLoading(false)
    }
  }, [orderId, router])

  useEffect(() => {
    fetchOrder()
    const poll = setInterval(fetchOrder, 15_000)
    return () => clearInterval(poll)
  }, [fetchOrder])

  if (loading) {
    return (
      <div className="min-h-screen bg-gb-surface font-gb-sans lg:mx-auto lg:max-w-[900px]">
        <div className="h-[280px] w-full animate-pulse bg-gb-oat-200 lg:mt-5 lg:rounded-gb-xl" />
        <div className="space-y-3 p-5">
          <div className="mx-auto h-6 w-1/2 animate-pulse rounded-gb-md bg-gb-oat-200" />
          <div className="h-16 animate-pulse rounded-gb-xl bg-gb-oat-100" />
        </div>
      </div>
    )
  }

  if (!order) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-gb-surface font-gb-sans text-gb-oat-600">
        <div className="text-5xl">😕</div>
        <p>{t('notFound')}</p>
        <button onClick={() => router.push('/eat')} className="text-sm font-bold text-gb-accent-strong">{t('backHome')}</button>
      </div>
    )
  }

  const isPickup = order.fulfillmentType === 'pickup'
  const isCancelled = order.status === 'cancelled'

  // ── Ghost-orders fix: the CUSTOMER sees their order from checkout on (it is
  // THEIR order) — but while the card payment isn't server-confirmed the rest
  // of the tracking timeline makes no sense. Clean dedicated states:
  //   awaiting_payment → "finish your payment" + CTA back to the checkout;
  //   expired          → abandoned > 24 h, the order will not be prepared.
  if (order.status === 'awaiting_payment' || order.status === 'expired') {
    const awaiting = order.status === 'awaiting_payment'
    return (
      <div className="min-h-screen bg-gb-surface font-gb-sans text-gb-content lg:mx-auto lg:max-w-[560px]">
        <div className="flex items-center border-b border-gb-stroke bg-gb-surface px-4 pb-4 pt-3">
          <button onClick={() => router.back()} className="flex h-10 w-10 items-center justify-center rounded-gb-full bg-gb-oat-100 active:scale-90">
            <ArrowLeft size={20} className="text-gb-content" />
          </button>
          <h1 className="flex-1 text-center font-gb-display text-[18px] font-extrabold text-gb-content">{t('title')}</h1>
          <div className="w-10" />
        </div>
        <div className="px-5 pt-6">
          <div className={`rounded-gb-xl p-5 text-center ${awaiting ? 'bg-gb-zest-50' : 'bg-gb-oat-100'}`}>
            <div className="text-4xl">{awaiting ? '💳' : '⌛'}</div>
            <p className="mt-2 font-gb-display text-[20px] font-extrabold text-gb-content">
              {awaiting ? t('awaitingTitle') : t('expiredTitle')}
            </p>
            <p className="mt-1 text-[13px] text-gb-content">
              {awaiting ? t('awaitingDesc') : t('expiredDesc')}
            </p>
            {awaiting && (
              <button
                onClick={() => router.push(`/eat/checkout/${order.id}`)}
                className="mt-4 rounded-gb-full bg-gb-accent-strong px-6 py-3 text-sm font-bold text-white active:scale-95"
              >
                {t('awaitingCta')}
              </button>
            )}
          </div>
          <div className="mt-6">
            <Button variant="gb-primary" size="pill" fullWidth onClick={() => router.push('/eat')}>
              {t('backHome')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // ── Shared header ──────────────────────────────────────────────────────────
  const Header = (
    <div className="flex items-center border-b border-gb-stroke bg-gb-surface px-4 pb-4 pt-3">
      <button onClick={() => router.back()} className="flex h-10 w-10 items-center justify-center rounded-gb-full bg-gb-oat-100 active:scale-90">
        <ArrowLeft size={20} className="text-gb-content" />
      </button>
      <h1 className="flex-1 text-center font-gb-display text-[18px] font-extrabold text-gb-content">{t('title')}</h1>
      <div className="w-10" />
    </div>
  )

  // ── Shared: items, total, points, back ─────────────────────────────────────
  const Summary = (
    <>
      <p className="mb-3 font-gb-display text-base font-extrabold text-gb-content">{t('items')}</p>
      {order.items.map((item, i) => (
        <div key={i} className="mb-3.5 flex items-center gap-3 border-b border-gb-stroke pb-3.5 last:border-0">
          <FoodImage
            name={item.name}
            src={getFoodImage(inferCategory(item.name), item.name)}
            className="h-14 w-14 shrink-0 rounded-gb-md"
            glyphClassName="text-xl"
          />
          <div className="flex-1">
            <p className="text-sm font-bold text-gb-content">{item.name}</p>
            <p className="mt-0.5 text-xs text-gb-oat-600">x{item.qty}</p>
          </div>
          <span className="text-sm font-bold text-gb-content">{formatEuros(item.price * item.qty, locale)}</span>
        </div>
      ))}
      <div className="mb-4 flex justify-between border-t border-gb-stroke pt-3">
        <span className="text-base font-extrabold text-gb-content">{t('totalPaid')}</span>
        <span className="text-base font-extrabold text-gb-accent-strong">{formatEuros(order.total, locale)}</span>
      </div>
      {(order.status === 'delivered' || (isPickup && order.status === 'picked_up')) && (
        <div className="mb-4 flex items-center gap-3 rounded-gb-xl bg-gb-success-soft p-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-gb-full bg-gb-success text-white">
            <Check size={18} strokeWidth={3} />
          </span>
          <div className="min-w-0">
            <p className="font-bold text-gb-content">{t('enjoy')}</p>
            <p className="mt-0.5 text-xs text-gb-content">{t('pointsCredited', { points: order.pointsEarned })}</p>
          </div>
        </div>
      )}
      <div className="mb-6">
        <Button variant="gb-primary" size="pill" fullWidth onClick={() => router.push('/eat')}>
          {t('backHome')}
        </Button>
      </div>
    </>
  )

  // ── PICKUP branch ──────────────────────────────────────────────────────────
  if (isPickup) {
    const currentStep = PICKUP_STATUS_TO_STEP[order.status] ?? 0
    const isReady = order.status === 'ready'
    const isCollected = order.status === 'picked_up' || order.status === 'delivered'
    const restoAddress = [order.restaurant.address, order.restaurant.city].filter(Boolean).join(', ')

    const pickupHeadline = (): string => {
      if (isCancelled) return t('statusCancelled')
      if (isCollected) return t('pickupCollectedTitle')
      if (isReady) return t('pickupReadyNow')
      // Otherwise show "Prête vers HH:MM"
      const created = new Date(order!.createdAt).getTime()
      const eta = new Date(created + order!.estimatedTime * 60_000)
      return t('pickupReadyAt', { time: formatTime(eta, locale) })
    }

    return (
      <div className="min-h-screen bg-gb-surface font-gb-sans text-gb-content lg:mx-auto lg:max-w-[900px]">
        {Header}

        <div className="px-5 pt-5 lg:grid lg:grid-cols-[1fr_340px] lg:items-start lg:gap-6 lg:px-6 lg:pt-6">
          <div className="lg:min-w-0">
            {/* Pickup hero — no map, no driver. Just status + headline */}
            <div className="rounded-gb-xl bg-gb-zest-50 p-5 text-center">
              <p className="text-[13px] font-semibold text-gb-accent-strong">{t('pickupMode')}</p>
              <p className="mt-1 font-gb-display text-[22px] font-extrabold text-gb-content">{pickupHeadline()}</p>
              <div className="mt-2 flex justify-center">
                <span className="rounded-gb-full bg-gb-surface-elevated px-3 py-1 text-xs font-bold text-gb-accent-strong shadow-gb-sm">
                  {/* Pickup-aware badge: a collected pickup must read "Récupérée"
                      (matching the headline above + the timeline below), never the
                      delivery wording "En route vers vous"; "ready" reads the
                      pickup-specific "Prête à récupérer". */}
                  {isCollected
                    ? t('statusCollected')
                    : isReady
                      ? t('statusReadyPickup')
                      : STATUS_LABEL_KEY[order.status]
                        ? t(STATUS_LABEL_KEY[order.status])
                        : order.status}
                </span>
              </div>
            </div>

            {/* Ready callout — bold action: where to go now */}
            {isReady && !isCancelled && (
              <div className="mt-4 flex items-start gap-3 rounded-gb-xl border-2 border-gb-accent-strong bg-gb-zest-50 p-4">
                <Store size={22} className="mt-0.5 shrink-0 text-gb-accent-strong" />
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-extrabold text-gb-content">
                    {t('pickupReadyHeadline', { restaurant: order.restaurant.name })}
                  </p>
                  {restoAddress && (
                    <p className="mt-1 flex items-start gap-1 text-[13px] text-gb-content">
                      <MapPin size={13} className="mt-0.5 shrink-0 text-gb-accent-strong" />
                      <span className="break-words">{restoAddress}</span>
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Vertical timeline (shared component) */}
            <div className="my-5 rounded-gb-xl border border-gb-stroke bg-gb-surface-elevated p-4">
              <p className="mb-3 text-sm font-bold text-gb-content">{t('pickupTimelineHeader')}</p>
              <StepTimeline steps={PICKUP_STEPS} currentStep={currentStep} completed={isCollected} t={t} />
            </div>

            {/* Restaurant card (always shown for pickup, so customer knows the spot) */}
            {!isReady && !isCollected && restoAddress && (
              <div className="mb-4 flex items-start gap-3 rounded-gb-xl border border-gb-stroke bg-gb-surface-elevated p-4">
                <Store size={20} className="mt-0.5 shrink-0 text-gb-content-muted" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-gb-content">{order.restaurant.name}</p>
                  <p className="mt-0.5 flex items-start gap-1 text-xs text-gb-content-muted">
                    <MapPin size={11} className="mt-0.5 shrink-0" />
                    <span className="break-words">{restoAddress}</span>
                  </p>
                </div>
              </div>
            )}
          </div>

          <aside className="lg:sticky lg:top-4 lg:h-fit">
            {Summary}
          </aside>
        </div>

        <div className="px-5 lg:px-6">
          <ClaimSection orderId={order.id} />
        </div>
      </div>
    )
  }

  // ── DELIVERY branch (kept unchanged — Uber Direct is a separate workstream)
  const step = STATUS_TO_STEP[order.status] ?? 0
  const isDelivered = order.status === 'delivered'

  function etaWindow() {
    const created = new Date(order!.createdAt).getTime()
    const eta = new Date(created + order!.estimatedTime * 60_000)
    const end = new Date(created + (order!.estimatedTime + 5) * 60_000)
    return `${formatTime(eta, locale)} - ${formatTime(end, locale)}`
  }

  return (
    <div className="min-h-screen bg-gb-surface font-gb-sans text-gb-content lg:mx-auto lg:max-w-[900px]">
      {Header}

      {/* Decorative tracking illustration (pre-existing "faux map" — NOT a real
          geolocation map; the 🛵 position reflects the real status step only).
          Re-skinned to a neutral gb surface; a real-time courier map is DEFERRED
          (no geolocation data on the order). */}
      <div className="relative h-[280px] overflow-hidden bg-gradient-to-br from-gb-oat-100 via-gb-surface to-gb-oat-200 lg:mt-5 lg:rounded-gb-xl">
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              'linear-gradient(var(--border-subtle) 1px, transparent 1px), linear-gradient(90deg, var(--border-subtle) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
        <div className="absolute left-1/2 top-[20%] h-[55%] w-[3px] -translate-x-1/2 rounded-full bg-gb-oat-300" />
        <div className="absolute left-[46%] top-[12%]">
          <div className="flex h-11 w-11 items-center justify-center rounded-gb-full border-[3px] border-white bg-gb-accent-strong text-base shadow-gb-md">🏠</div>
        </div>
        <div
          className="absolute left-[44%] transition-all duration-700"
          style={{ top: step >= 3 ? '76%' : step >= 2 ? '44%' : '24%' }}
        >
          <div className="flex h-[34px] w-[34px] items-center justify-center rounded-gb-full border-2 border-gb-accent-strong bg-gb-surface-elevated text-base shadow-gb-sm">🛵</div>
        </div>
        <div className="absolute bottom-[12%] left-[44%]">
          <div className="flex h-11 w-11 items-center justify-center rounded-gb-full border-[3px] border-white bg-gb-accent-strong text-base shadow-gb-md">📍</div>
        </div>
        <button className="absolute bottom-3 right-3 flex h-10 w-10 items-center justify-center rounded-gb-full bg-gb-surface-elevated shadow-gb-md active:scale-90">
          <Navigation size={18} className="text-gb-accent-strong" />
        </button>
      </div>

      {/* Bottom sheet */}
      <div className="px-5 pt-5 lg:grid lg:grid-cols-[1fr_340px] lg:items-start lg:gap-6 lg:px-6 lg:pt-6">
        <div className="lg:min-w-0">
          <p className="text-center text-[13px] text-gb-oat-600 lg:text-start">
            {isDelivered ? t('arrived') : t('estimatedArrival')}
          </p>
          <p className="text-center font-gb-display text-xl font-extrabold text-gb-content lg:text-start">{isDelivered ? t('deliveredCelebrate') : etaWindow()}</p>
          <div className="mt-2 flex justify-center lg:justify-start">
            <span className="rounded-gb-full bg-gb-zest-50 px-3 py-1 text-xs font-bold text-gb-accent-strong">{STATUS_LABEL_KEY[order.status] ? t(STATUS_LABEL_KEY[order.status]) : order.status}</span>
          </div>

          {/* Étapes — harmonized with pickup (and the resto side): the journey
              is now visible for delivery too; the courier card below stays as a
              complement. Display only — existing statuses/labels, no new logic. */}
          {!isCancelled && (
            <div className="my-3.5 rounded-gb-xl border border-gb-stroke bg-gb-surface-elevated p-4">
              <p className="mb-3 text-sm font-bold text-gb-content">{t('pickupTimelineHeader')}</p>
              <StepTimeline
                steps={DELIVERY_STEPS}
                currentStep={DELIVERY_STATUS_TO_STEP[order.status] ?? 0}
                completed={isDelivered}
                t={t}
              />
            </div>
          )}

          <div className="my-3.5 h-px bg-gb-stroke" />

          {/* Courier — pre-existing placeholder (no real driver/contact data on the
              order yet); re-skinned only. Real driver identity + working call/message
              are DEFERRED to the delivery (Uber Direct) workstream. */}
          <div className="flex items-center gap-3">
            <div className="flex h-[52px] w-[52px] items-center justify-center rounded-gb-full bg-gb-zest-50 text-xl">🧑‍✈️</div>
            <div className="flex-1">
              <p className="text-[15px] font-bold text-gb-content">Charlotte Taylor</p>
              <p className="mt-0.5 text-xs text-gb-oat-600">{t('deliveryPartner')}</p>
            </div>
            <div className="flex gap-2.5">
              <button className="flex h-10 w-10 items-center justify-center rounded-gb-full border-[1.5px] border-gb-stroke active:scale-90"><MessageCircle size={18} className="text-gb-accent-strong" /></button>
              <button className="flex h-10 w-10 items-center justify-center rounded-gb-full border-[1.5px] border-gb-stroke active:scale-90"><Phone size={18} className="text-gb-accent-strong" /></button>
            </div>
          </div>

          <div className="my-3.5 h-px bg-gb-stroke" />

          {/* Route */}
          <div>
            <div className="flex items-center gap-3">
              <span className="h-3.5 w-3.5 rounded-gb-full border-[3px] border-gb-zest-50 bg-gb-accent-strong" />
              <span className="text-sm font-medium text-gb-content">{order.restaurant.name}</span>
            </div>
            <div className="ml-[6px] h-[18px] w-0.5 bg-gb-stroke" />
            <div className="flex items-center gap-3">
              <span className="h-3.5 w-3.5 rounded-gb-full border-2 border-gb-content-muted bg-gb-surface-elevated" />
              <span className="truncate text-sm font-medium text-gb-content">{order.deliveryAddress}</span>
            </div>
          </div>

          <div className="my-3.5 h-px bg-gb-stroke lg:hidden" />
        </div>

        <aside className="lg:sticky lg:top-4 lg:h-fit">
          {Summary}
        </aside>
      </div>

      <div className="px-5 lg:px-6">
        <ClaimSection orderId={order.id} />
      </div>
    </div>
  )
}
