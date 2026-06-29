'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { formatEuros } from '@/lib/format-money'
import { useParams } from 'next/navigation'
import { useRouter } from '@/navigation'
import ClaimSection from '@/components/claims/ClaimSection'
import { formatTime } from '@/lib/format'
import '../track.css'
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'

/* ─────────────────────────────────────────────────────────────────────────────
 * /eat/track/[orderId] — VERBATIM re-skin of the FROZEN CD ref (Notion 38efd2c9-…-8152,
 * file eat/order-tracking.html). Material Symbols (NOT lucide), gb-foundation tokens,
 * page CSS scoped under `.gb-track` (track.css). The route is IMMERSIVE in EatShell
 * (desktop rail kept; top-bar + mobile chrome dropped) → the page provides its own
 * back affordance (the panel `arrow_back`).
 *
 * REAL WIRING KEPT: GET /api/orders/[id] (real status/items/totals) + 15s polling.
 * The 5 CD steps reflect the REAL order status. ETA = real estimatedTime when present.
 * The recap = REAL items + fees. The MAP is an INERT stylised placeholder (no carto
 * lib, no geolocation data on the order). The « IA » note stays INERT (« bientôt »).
 * The DRIVER card is a NEUTRAL placeholder — the API exposes NO real driver model
 * (name/vehicle/rating/phone); we do NOT fabricate one (see report).
 * ───────────────────────────────────────────────────────────────────────────── */

interface OrderItem { name: string; qty: number; price: number }
interface Order {
  id: string
  status: string
  fulfillmentType?: 'delivery' | 'pickup' | string
  subtotal?: number
  deliveryFee?: number
  total: number
  estimatedTime: number
  items: OrderItem[]
  restaurant: { name: string; address: string; city?: string; logo?: string }
  pointsEarned: number
  createdAt: string
  deliveryAddress: string
}

/** Real status → CD step index (0-based, 5 steps).  The CD stepper is the delivery
 *  journey: confirmée → préparation → récupérée → en route → livrée. */
const STATUS_TO_STEP: Record<string, number> = {
  received: 0,
  preparing: 1,
  ready: 2,
  picked_up: 3,
  delivered: 4,
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

  // ── Loading skeleton ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="gb gb-track" data-theme="light">
        <div className="skel-map" />
        <aside className="panel">
          <div className="panel__h">
            <div className="skel-line" style={{ width: '60%', height: 18 }} />
          </div>
          <div className="steps" style={{ display: 'grid', gap: 14 }}>
            <div className="skel-line" /><div className="skel-line" style={{ width: '80%' }} />
            <div className="skel-line" style={{ width: '70%' }} />
          </div>
        </aside>
      </div>
    )
  }

  // ── Not found ───────────────────────────────────────────────────────────────
  if (!order) {
    return (
      <div className="gb gb-track gb-track--single" data-theme="light">
        <div className="state">
          <div className="state__h">
            <button className="back ms" onClick={() => router.push('/eat')} aria-label={t('backHome')}>arrow_back</button>
            <b>{t('title')}</b>
          </div>
          <div className="state__box">
            <div className="ico">😕</div>
            <h2>{t('notFound')}</h2>
            <button className="state__cta" onClick={() => router.push('/eat')}>
              <span className="ms">home</span>{t('backHome')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Awaiting-payment / expired — dedicated states (kept, re-skinned) ─────────
  if (order.status === 'awaiting_payment' || order.status === 'expired') {
    const awaiting = order.status === 'awaiting_payment'
    return (
      <div className="gb gb-track gb-track--single" data-theme="light">
        <div className="state">
          <div className="state__h">
            <button className="back ms" onClick={() => router.back()} aria-label={t('backHome')}>arrow_back</button>
            <b>{t('title')}</b>
          </div>
          <div className={`state__box${awaiting ? '' : ' warn'}`}>
            <div className="ico">{awaiting ? '💳' : '⌛'}</div>
            <h2>{awaiting ? t('awaitingTitle') : t('expiredTitle')}</h2>
            <p>{awaiting ? t('awaitingDesc') : t('expiredDesc')}</p>
            {awaiting && (
              <button className="state__cta" onClick={() => router.push(`/eat/checkout/${order.id}`)}>
                <span className="ms">payments</span>{t('awaitingCta')}
              </button>
            )}
          </div>
          <button className="state__back" onClick={() => router.push('/eat')}>{t('backHome')}</button>
        </div>
      </div>
    )
  }

  // ── Real status → CD stepper ─────────────────────────────────────────────────
  const isPickup = order.fulfillmentType === 'pickup'
  const isCancelled = order.status === 'cancelled'
  const isDelivered = order.status === 'delivered' || (isPickup && order.status === 'picked_up')
  const currentStep = STATUS_TO_STEP[order.status] ?? 0

  // Short order ref + real ETA / status label
  const shortRef = `#GR-${order.id.slice(-4).toUpperCase()}`
  const created = new Date(order.createdAt).getTime()
  const etaDate = new Date(created + order.estimatedTime * 60_000)
  const hasEta = Number.isFinite(order.estimatedTime) && order.estimatedTime > 0
  const etaTime = hasEta ? formatTime(etaDate, locale) : '—'

  // CD's 5 steps, label + sub-line keys + dot icon. `picked_up` for a pickup order
  // means "récupérée par le client" (terminal) — but the CD 5-step delivery journey is
  // the frozen design; we render it for both and only swap a couple of labels.
  const stepLabelKey = isPickup
    ? ['stepConfirmed', 'stepPreparing', 'stepReadyPickup', 'stepEnRoutePickup', 'stepCollected']
    : ['stepConfirmed', 'stepPreparing', 'stepPickedUp', 'stepEnRoute', 'stepDelivered']

  const statusBadgeKey: Record<string, string> = {
    received: 'statusReceived', preparing: 'statusPreparing', ready: 'statusReady',
    picked_up: isPickup ? 'statusCollected' : 'statusPickedUp', delivered: 'statusDelivered',
    cancelled: 'statusCancelled',
  }

  const restoLine = [order.restaurant.name].filter(Boolean).join('')
  const itemsCount = order.items.reduce((n, it) => n + it.qty, 0)
  const modeLabel = isPickup ? t('pickupMode') : t('modeDelivery')

  // Recap fee line: prefer the real delivery fee; fall back to total − items subtotal.
  const itemsSubtotal = order.items.reduce((s, it) => s + it.price * it.qty, 0)
  const feeAmount = typeof order.deliveryFee === 'number'
    ? order.deliveryFee
    : Math.max(0, order.total - itemsSubtotal)

  // ── The CD vertical stepper (5 steps), real status drives done/cur/todo ──────
  const Stepper = (
    <div className="steps">
      {stepLabelKey.map((labelKey, i) => {
        const done = !isCancelled && i < currentStep
        const cur = !isCancelled && i === currentStep && !isDelivered
        const allDone = !isCancelled && isDelivered
        const klass = allDone || done ? 'done' : cur ? 'cur' : 'todo'
        // sub-line: real time on the active step; em-dash otherwise
        const sub =
          klass === 'cur' && hasEta ? t('etaApprox', { time: etaTime })
          : klass === 'cur' ? t('inProgress')
          : ''
        const dotIcon = klass === 'done' ? 'check'
          : i === 3 ? (isPickup ? 'storefront' : 'two_wheeler')
          : 'check'
        return (
          <div key={labelKey} className={`tk-step ${klass === 'done' || allDone ? 'done' : ''}`}>
            <span className={`dot ${allDone ? 'done' : klass}`}>
              {(klass === 'done' || allDone) && <span className="ms">check</span>}
              {klass === 'cur' && !allDone && <span className="ms">{dotIcon}</span>}
            </span>
            <span className="line" />
            <div className="tx">
              <b>{t(labelKey)}</b>
              {sub && <span>{sub}</span>}
            </div>
          </div>
        )
      })}
    </div>
  )

  // ── Panel (header + steps + driver + IA + recap + help/claim) ────────────────
  const Panel = (
    <aside className="panel">
      <div className="panel__h">
        <div className="top">
          <button className="back ms" onClick={() => router.back()} aria-label={t('backHome')}>arrow_back</button>
          <b>{t('title')}</b>
          <span className="id">{shortRef}</span>
        </div>
        <div className="rest">
          <b>{restoLine}</b> · {t('articlesCount', { count: itemsCount })} · {modeLabel}
        </div>
      </div>

      {Stepper}

      {/* Driver / courier — NEUTRAL placeholder. No real driver model on the order
          (the API exposes none); we do NOT fabricate a named driver/phone. Stays
          inert until a real courier source exists (Uber Direct / own fleet). */}
      {!isPickup && !isCancelled && (
        <div className="tk-driver">
          <span className="av"><span className="ms">sports_motorsports</span></span>
          <div className="main">
            <b>{t('driverPending')}</b>
            <span>{t('driverPendingHint')}</span>
          </div>
          <span className="act call" aria-disabled="true"><span className="ms">call</span></span>
          <span className="act chat" aria-disabled="true"><span className="ms">chat_bubble</span></span>
        </div>
      )}

      {/* Points earned (real loyalty data) on completion */}
      {isDelivered && order.pointsEarned > 0 && (
        <div className="earned">
          <span className="ms">redeem</span>
          <div>
            <b>{t('enjoy')}</b>
            <span>{t('pointsCredited', { points: order.pointsEarned })}</span>
          </div>
        </div>
      )}

      {/* IA note — INERT (« bientôt ») */}
      <div className="ainote">
        <div className="ainote__in">
          <span className="ms">auto_awesome</span>
          <p>{t('iaSoonText')}</p>
          <span className="soon">{t('iaSoonBadge')}</span>
        </div>
      </div>

      {/* Recap — REAL items + fees + total */}
      <div className="recap">
        <div className="lab">{t('items')}</div>
        {order.items.map((item, i) => (
          <div className="row" key={i}>
            <span>{item.qty}× {item.name}</span>
            <b>{formatEuros(item.price * item.qty, locale)}</b>
          </div>
        ))}
        {feeAmount > 0 && (
          <div className="row">
            <span>{isPickup ? t('serviceFee') : t('deliveryService')}</span>
            <b>{formatEuros(feeAmount, locale)}</b>
          </div>
        )}
        <div className="row tot">
          <span>{t('totalPaid')}</span>
          <b>{formatEuros(order.total, locale)}</b>
        </div>
        <button className="help" onClick={() => router.push('/eat')}>
          <span className="ms">support_agent</span>{t('needHelp')}
        </button>
      </div>

      {/* Claims (real) */}
      <div className="claimwrap">
        <ClaimSection orderId={order.id} />
      </div>
    </aside>
  )

  // ── Map (inert stylised placeholder — verbatim CD geometry) ──────────────────
  const Map = (
    <div className="map" aria-hidden="true">
      <span className="resto"><span className="ms">storefront</span></span>
      <svg viewBox="0 0 600 800" fill="none" preserveAspectRatio="none">
        <path
          d="M168 190 C 290 270, 250 420, 360 470 C 430 500, 450 560, 452 600"
          stroke="#F2570E" strokeWidth="5" strokeDasharray="3 13" strokeLinecap="round"
        />
      </svg>
      <span className="driver"><span className="ms">{isPickup ? 'storefront' : 'two_wheeler'}</span></span>
      <span className="home"><span className="ms">home_pin</span></span>
      <div className="eta">
        <small>{isDelivered ? t('arrived') : t('estimatedArrival')}</small>
        <b>{isDelivered ? '✓' : etaTime}</b>
        <span className="live">
          <i />
          {isCancelled ? t('statusCancelled')
            : isDelivered ? (statusBadgeKey[order.status] ? t(statusBadgeKey[order.status]) : order.status)
            : (statusBadgeKey[order.status] ? t(statusBadgeKey[order.status]) : order.status)}
        </span>
      </div>
      <span className="recenter"><span className="ms">my_location</span></span>
    </div>
  )

  return (
    <div className="gb gb-track" data-theme="light">
      {Map}
      {Panel}
    </div>
  )
}
