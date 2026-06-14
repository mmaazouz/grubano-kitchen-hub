'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { formatEuros } from '@/lib/format-money'
import { useParams } from 'next/navigation'
import { useRouter } from '@/navigation'
import { ArrowLeft, Navigation, MessageCircle, Phone, Check, MapPin, Store } from 'lucide-react'
import FoodImage from '@/components/eat/FoodImage'
import { Button } from '@/components/design-system'
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
                className={`absolute left-[15px] top-[34px] w-[2px] ${done ? 'bg-[#F97316]' : 'bg-[#eee]'}`}
                style={{ height: 'calc(100% - 18px)' }}
                aria-hidden
              />
            )}
            {/* Step bullet */}
            <div
              className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm shadow-sm transition-colors ${
                done
                  ? 'bg-[#F97316] text-white'
                  : active
                    ? 'bg-white text-[#F97316] ring-2 ring-[#F97316]'
                    : 'bg-[#f5f5f5] text-[#bbb]'
              }`}
            >
              {done ? <Check size={16} strokeWidth={3} /> : <span>{step.emoji}</span>}
            </div>
            {/* Label */}
            <div className="flex-1 pt-0.5">
              <p className={`text-[14px] font-bold ${done || active ? 'text-[#1a1a1a]' : 'text-[#bbb]'}`}>
                {t(step.labelKey)}
              </p>
              {active && (
                <p className="mt-0.5 text-xs text-[#F97316]">{t('pickupCurrentStep')}</p>
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
      <div className="min-h-screen bg-white">
        <div className="h-[280px] w-full animate-pulse bg-gray-200" />
        <div className="space-y-3 p-5">
          <div className="mx-auto h-6 w-1/2 animate-pulse rounded bg-gray-200" />
          <div className="h-16 animate-pulse rounded-2xl bg-gray-100" />
        </div>
      </div>
    )
  }

  if (!order) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-3 bg-white text-[#888]">
        <div className="text-5xl">😕</div>
        <p>{t('notFound')}</p>
        <button onClick={() => router.push('/eat')} className="text-sm font-bold text-[#F97316]">{t('backHome')}</button>
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
      <div className="min-h-screen bg-white">
        <div className="flex items-center border-b border-[#f0f0f0] bg-white px-4 pb-4 pt-3">
          <button onClick={() => router.back()} className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f5f5f5] active:scale-90">
            <ArrowLeft size={20} className="text-[#1a1a1a]" />
          </button>
          <h1 className="flex-1 text-center font-sans text-[18px] font-extrabold text-[#1a1a1a]">{t('title')}</h1>
          <div className="w-10" />
        </div>
        <div className="px-5 pt-6">
          <div className={`rounded-2xl p-5 text-center ${awaiting ? 'bg-[#FFF7F3]' : 'bg-[#f5f5f5]'}`}>
            <div className="text-4xl">{awaiting ? '💳' : '⌛'}</div>
            <p className="mt-2 text-[20px] font-extrabold text-[#1a1a1a]">
              {awaiting ? t('awaitingTitle') : t('expiredTitle')}
            </p>
            <p className="mt-1 text-[13px] text-[#888]">
              {awaiting ? t('awaitingDesc') : t('expiredDesc')}
            </p>
            {awaiting && (
              <button
                onClick={() => router.push(`/eat/checkout/${order.id}`)}
                className="mt-4 rounded-full bg-[#F97316] px-6 py-3 text-sm font-bold text-white active:scale-95"
              >
                {t('awaitingCta')}
              </button>
            )}
          </div>
          <div className="mt-6">
            <Button variant="primary" size="pill" fullWidth onClick={() => router.push('/eat')}>
              {t('backHome')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // ── Shared header ──────────────────────────────────────────────────────────
  const Header = (
    <div className="flex items-center border-b border-[#f0f0f0] bg-white px-4 pb-4 pt-3">
      <button onClick={() => router.back()} className="flex h-10 w-10 items-center justify-center rounded-full bg-[#f5f5f5] active:scale-90">
        <ArrowLeft size={20} className="text-[#1a1a1a]" />
      </button>
      <h1 className="flex-1 text-center font-sans text-[18px] font-extrabold text-[#1a1a1a]">{t('title')}</h1>
      <div className="w-10" />
    </div>
  )

  // ── Shared: items, total, points, back ─────────────────────────────────────
  const Summary = (
    <>
      <p className="mb-3 text-base font-extrabold text-[#1a1a1a]">{t('items')}</p>
      {order.items.map((item, i) => (
        <div key={i} className="mb-3.5 flex items-center gap-3 border-b border-[#f8f8f8] pb-3.5 last:border-0">
          <FoodImage
            name={item.name}
            src={getFoodImage(inferCategory(item.name), item.name)}
            className="h-14 w-14 shrink-0 rounded-[10px]"
            glyphClassName="text-xl"
          />
          <div className="flex-1">
            <p className="text-sm font-bold text-[#1a1a1a]">{item.name}</p>
            <p className="mt-0.5 text-xs text-[#888]">x{item.qty}</p>
          </div>
          <span className="text-sm font-bold text-[#1a1a1a]">{formatEuros(item.price * item.qty, locale)}</span>
        </div>
      ))}
      <div className="mb-4 flex justify-between border-t border-[#f0f0f0] pt-3">
        <span className="text-base font-extrabold text-[#1a1a1a]">{t('totalPaid')}</span>
        <span className="text-base font-extrabold text-[#F97316]">{formatEuros(order.total, locale)}</span>
      </div>
      {(order.status === 'delivered' || (isPickup && order.status === 'picked_up')) && (
        <div className="mb-4 rounded-2xl bg-[#F0FDF4] p-4 text-center">
          <p className="font-bold text-[#16A34A]">{t('enjoy')}</p>
          <p className="mt-0.5 text-xs text-[#22C55E]">{t('pointsCredited', { points: order.pointsEarned })}</p>
        </div>
      )}
      <div className="mb-6">
        <Button variant="primary" size="pill" fullWidth onClick={() => router.push('/eat')}>
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
      <div className="min-h-screen bg-white">
        {Header}

        <div className="px-5 pt-5">
          {/* Pickup hero — no map, no driver. Just status + headline */}
          <div className="rounded-2xl bg-[#FFF7F3] p-5 text-center">
            <p className="text-[13px] font-semibold text-[#F97316]">{t('pickupMode')}</p>
            <p className="mt-1 text-[22px] font-extrabold text-[#1a1a1a]">{pickupHeadline()}</p>
            <div className="mt-2 flex justify-center">
              <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-[#F97316] shadow-sm">
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
            <div className="mt-4 flex items-start gap-3 rounded-2xl border-2 border-[#F97316] bg-[#FFF7F3] p-4">
              <Store size={22} className="mt-0.5 shrink-0 text-[#F97316]" />
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-extrabold text-[#1a1a1a]">
                  {t('pickupReadyHeadline', { restaurant: order.restaurant.name })}
                </p>
                {restoAddress && (
                  <p className="mt-1 flex items-start gap-1 text-[13px] text-[#444]">
                    <MapPin size={13} className="mt-0.5 shrink-0 text-[#F97316]" />
                    <span className="break-words">{restoAddress}</span>
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Vertical timeline (shared component) */}
          <div className="my-5 rounded-2xl border border-[#f0f0f0] bg-white p-4">
            <p className="mb-3 text-sm font-bold text-[#1a1a1a]">{t('pickupTimelineHeader')}</p>
            <StepTimeline steps={PICKUP_STEPS} currentStep={currentStep} completed={isCollected} t={t} />
          </div>

          {/* Restaurant card (always shown for pickup, so customer knows the spot) */}
          {!isReady && !isCollected && restoAddress && (
            <div className="mb-4 flex items-start gap-3 rounded-2xl border border-[#f0f0f0] bg-[#fafafa] p-4">
              <Store size={20} className="mt-0.5 shrink-0 text-[#888]" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-[#1a1a1a]">{order.restaurant.name}</p>
                <p className="mt-0.5 flex items-start gap-1 text-xs text-[#888]">
                  <MapPin size={11} className="mt-0.5 shrink-0" />
                  <span className="break-words">{restoAddress}</span>
                </p>
              </div>
            </div>
          )}

          {Summary}
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
    <div className="min-h-screen bg-white">
      {Header}

      {/* Faux map */}
      <div className="relative h-[280px] overflow-hidden bg-gradient-to-br from-[#e9efe6] via-[#eef1ee] to-[#e6ebf0]">
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              'linear-gradient(#d8ded6 1px, transparent 1px), linear-gradient(90deg, #d8ded6 1px, transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />
        <div className="absolute left-1/2 top-[20%] h-[55%] w-[3px] -translate-x-1/2 rounded-full bg-[#1a1a1a]" />
        <div className="absolute left-[46%] top-[12%]">
          <div className="flex h-11 w-11 items-center justify-center rounded-full border-[3px] border-white bg-[#F97316] text-base shadow-md">🏠</div>
        </div>
        <div
          className="absolute left-[44%] transition-all duration-700"
          style={{ top: step >= 3 ? '76%' : step >= 2 ? '44%' : '24%' }}
        >
          <div className="flex h-[34px] w-[34px] items-center justify-center rounded-full border-2 border-[#F97316] bg-white text-base shadow">🛵</div>
        </div>
        <div className="absolute bottom-[12%] left-[44%]">
          <div className="flex h-11 w-11 items-center justify-center rounded-full border-[3px] border-white bg-[#F97316] text-base shadow-md">📍</div>
        </div>
        <button className="absolute bottom-3 right-3 flex h-10 w-10 items-center justify-center rounded-full bg-white shadow-md active:scale-90">
          <Navigation size={18} className="text-[#F97316]" />
        </button>
      </div>

      {/* Bottom sheet */}
      <div className="px-5 pt-5">
        <p className="text-center text-[13px] text-[#888]">
          {isDelivered ? t('arrived') : t('estimatedArrival')}
        </p>
        <p className="text-center text-xl font-extrabold text-[#1a1a1a]">{isDelivered ? t('deliveredCelebrate') : etaWindow()}</p>
        <div className="mt-2 flex justify-center">
          <span className="rounded-full bg-[#FFF3ED] px-3 py-1 text-xs font-bold text-[#F97316]">{STATUS_LABEL_KEY[order.status] ? t(STATUS_LABEL_KEY[order.status]) : order.status}</span>
        </div>

        {/* Étapes — harmonized with pickup (and the resto side): the journey
            is now visible for delivery too; the courier card below stays as a
            complement. Display only — existing statuses/labels, no new logic. */}
        {!isCancelled && (
          <div className="my-3.5 rounded-2xl border border-[#f0f0f0] bg-white p-4">
            <p className="mb-3 text-sm font-bold text-[#1a1a1a]">{t('pickupTimelineHeader')}</p>
            <StepTimeline
              steps={DELIVERY_STEPS}
              currentStep={DELIVERY_STATUS_TO_STEP[order.status] ?? 0}
              completed={isDelivered}
              t={t}
            />
          </div>
        )}

        <div className="my-3.5 h-px bg-[#f0f0f0]" />

        {/* Driver */}
        <div className="flex items-center gap-3">
          <div className="flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[#FFF3ED] text-xl">🧑‍✈️</div>
          <div className="flex-1">
            <p className="text-[15px] font-bold text-[#1a1a1a]">Charlotte Taylor</p>
            <p className="mt-0.5 text-xs text-[#888]">{t('deliveryPartner')}</p>
          </div>
          <div className="flex gap-2.5">
            <button className="flex h-10 w-10 items-center justify-center rounded-full border-[1.5px] border-[#f0f0f0] active:scale-90"><MessageCircle size={18} className="text-[#F97316]" /></button>
            <button className="flex h-10 w-10 items-center justify-center rounded-full border-[1.5px] border-[#f0f0f0] active:scale-90"><Phone size={18} className="text-[#F97316]" /></button>
          </div>
        </div>

        <div className="my-3.5 h-px bg-[#f0f0f0]" />

        {/* Route */}
        <div>
          <div className="flex items-center gap-3">
            <span className="h-3.5 w-3.5 rounded-full border-[3px] border-[#FFF3ED] bg-[#F97316]" />
            <span className="text-sm font-medium text-[#444]">{order.restaurant.name}</span>
          </div>
          <div className="ml-[6px] h-[18px] w-0.5 bg-[#ddd]" />
          <div className="flex items-center gap-3">
            <span className="h-3.5 w-3.5 rounded-full border-2 border-[#888] bg-white" />
            <span className="truncate text-sm font-medium text-[#444]">{order.deliveryAddress}</span>
          </div>
        </div>

        <div className="my-3.5 h-px bg-[#f0f0f0]" />

        {Summary}
      </div>
    </div>
  )
}
