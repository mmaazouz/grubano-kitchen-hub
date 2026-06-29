'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from '@/navigation'
import { formatEuros } from '@/lib/format-money'
import { formatTime } from '@/lib/format'
import './pickup.css'
// gb-* design FOUNDATION (Agent 168) — tokens + Material `.ms` font. The page wraps in
// `.gb` so the foundation tokens/font resolve; all component CSS lives in pickup.css.
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'

// ── /eat/order/[orderId]/pickup — « Code de retrait / commande prête » (C&C pickup
// pass) ────────────────────────────────────────────────────────────────────────────
//
// VERBATIM reproduction of the FROZEN CD ref (Notion 38efd2c9-…-81fd, file
// eat/pickup-ready.html). Material Symbols (NOT lucide), gb-foundation tokens, page CSS
// scoped under `.gb-pickup` (pickup.css). The route is IMMERSIVE in EatShell (desktop
// rail kept; top-bar + mobile chrome dropped) → the page provides its OWN back/header.
//
// REAL DATA (read-only) via GET /api/orders/[orderId]:
//  • PICKUP CODE   = the REAL order ref (refOf = 'GR-' + id.slice(-5)). This project has
//    NO separate pickup-code field — the orders page already shows the order ref AS the
//    pickup code (see /eat/orders). NEVER fabricated.
//  • RESTAURANT    = real name + address + city.
//  • RÉCAP         = real items (name/qty/price) + real total paid.
//  • STATUS        = real → drives the 2 CD states:
//        ready / picked_up      → « Prête »          (hero ✅ + active QR)
//        received / preparing   → « En préparation » (hero animé + stepper + QR dim)
//  • « Prête à » heure = real estimatedTime applied to createdAt (same as /eat/track).
//
// The QR is a STYLED visual placeholder (qr_code_2 glyph) — a visual representation of
// the real ref, NOT a scannable payload (no invented barcode data). Itinéraire / J'arrive
// / Me prévenir are INERT (no real geolocation/notify backend — C&C backend = chantier
// après Wave 5); they are non-mutating placeholders. NEVER fabricates a code/amount.

interface OrderItem { name: string; qty: number; price: number }
interface Order {
  id: string
  status: string
  fulfillmentType?: 'delivery' | 'pickup' | string
  total: number
  estimatedTime: number
  items: OrderItem[]
  restaurant?: { name?: string; address?: string; city?: string } | null
  createdAt: string
}

// Short, human-friendly reference derived from the real id (matches /api/eat/orders +
// /eat/order/[orderId]/help). This IS the pickup code — never fabricated.
const refOf = (id: string) => 'GR-' + id.slice(-5).toUpperCase()

export default function PickupPassScreen() {
  const t = useTranslations('eat.pickup')
  const locale = useLocale()
  const router = useRouter()
  const { orderId } = useParams<{ orderId: string }>()
  const { status: authStatus } = useSession()

  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)

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

  const items = useMemo<OrderItem[]>(() => (Array.isArray(order?.items) ? order!.items : []), [order])

  // Real « Prête à » time = createdAt + estimatedTime (same derivation as /eat/track).
  const readyAt = useMemo(() => {
    if (!order) return '—'
    const eta = Number(order.estimatedTime)
    if (!Number.isFinite(eta) || eta <= 0) return '—'
    return formatTime(new Date(new Date(order.createdAt).getTime() + eta * 60_000), locale)
  }, [order, locale])

  const Header = ({ ready }: { ready: boolean }) => (
    <div className="h2bar">
      <button type="button" className="back" onClick={() => router.back()} aria-label={t('back')}>
        <span className="ms ms-flip" aria-hidden="true">arrow_back</span>
      </button>
      <h2>{t('title')}</h2>
      <span className="badge">{ready ? t('badgeReady') : t('badgePreparing')}</span>
    </div>
  )

  // ── Not signed in → invite to sign in (the order needs a session) ────────────
  if (authStatus === 'unauthenticated') {
    return (
      <div className="gb gb-pickup">
        <Header ready />
        <div className="state">
          <div className="ico"><span className="ms" aria-hidden="true">lock</span></div>
          <h2>{t('signInTitle')}</h2>
          <p>{t('signInBody')}</p>
          <button type="button" className="cta" onClick={() => router.push('/eat/auth')}>
            <span className="ms" aria-hidden="true">login</span>{t('signInCta')}
          </button>
        </div>
      </div>
    )
  }

  // ── Loading skeleton (.sk foundation primitive) ──────────────────────────────
  if (loading) {
    return (
      <div className="gb gb-pickup">
        <Header ready />
        <div className="body">
          <div className="sk sk-hero" />
          <div className="sk sk-line lg" style={{ width: '70%', margin: '0 auto 8px' }} />
          <div className="sk sk-line" style={{ width: '85%', margin: '0 auto' }} />
          <div className="sk sk-qr" />
          <div className="sk sk-row" />
          <div className="sk sk-card" />
        </div>
      </div>
    )
  }

  // ── Not found ────────────────────────────────────────────────────────────────
  if (!order) {
    return (
      <div className="gb gb-pickup">
        <Header ready />
        <div className="state">
          <div className="ico"><span className="ms" aria-hidden="true">receipt_long</span></div>
          <h2>{t('notFoundTitle')}</h2>
          <p>{t('notFoundBody')}</p>
          <button type="button" className="cta" onClick={() => router.push('/eat')}>
            <span className="ms" aria-hidden="true">home</span>{t('backHome')}
          </button>
        </div>
      </div>
    )
  }

  // Real status → the 2 CD states. ready/picked_up = « Prête » ; otherwise « En préparation ».
  const ready = order.status === 'ready' || order.status === 'picked_up'
  const code = refOf(orderId)
  const restaurantName = order.restaurant?.name ?? '—'
  const restaurantAddress = [order.restaurant?.address, order.restaurant?.city].filter(Boolean).join(', ') || '—'

  return (
    <div className="gb gb-pickup">
      <Header ready={ready} />

      <div className="body">
        {/* status hero — real state */}
        {ready ? (
          <div className="pk-status ready">
            <span className="ic"><span className="ms" aria-hidden="true">shopping_bag</span></span>
            <h1>{t('readyTitle')}</h1>
            <p>{t.rich('readyBody', { name: restaurantName, b: (c) => <b>{c}</b> })}</p>
          </div>
        ) : (
          <div className="pk-status prep">
            <span className="ic"><span className="ms" aria-hidden="true">cooking</span></span>
            <h1>{t('prepTitle')}</h1>
            <p>{t.rich('prepBody', { time: readyAt, b: (c) => <b><bdi>{c}</bdi></b> })}</p>
          </div>
        )}

        {/* mini-stepper — only in « En préparation » */}
        {!ready && (
          <>
            <div className="pk-step">
              <span className="d done"><span className="ms" aria-hidden="true">check</span></span><span className="s done" />
              <span className="d cur" /><span className="s off" /><span className="d off" />
            </div>
            <div className="pk-lab">
              <span>{t('stepConfirmed')}</span>
              <span className="on">{t('stepPreparing')}</span>
              <span>{t('stepReady')}</span>
            </div>
          </>
        )}

        {/* GRAND code + QR — the QR is a styled visual of the real ref (not a scannable
            payload). Dimmed (.dim) while still preparing. */}
        <div className={`pk-code big${ready ? '' : ' dim'}`}>
          <span className="qr"><span className="ms" aria-hidden="true">qr_code_2</span></span>
          <small>{t('codeLabel')}</small>
          <b><bdi>{code}</bdi></b>
          <span className="hint">
            <span className="ms" aria-hidden="true">storefront</span>
            {ready ? t('codeHintReady') : t('codeHintPrep')}
          </span>
        </div>

        {/* resto + adresse + heure « Prête à » (real) */}
        <div className="pk-rrow">
          <span className="ic"><span className="ms" aria-hidden="true">storefront</span></span>
          <div className="m"><b>{restaurantName}</b><span>{restaurantAddress}</span></div>
          <div className="when"><small>{t('readyAtLabel')}</small><b><bdi>{readyAt}</bdi></b></div>
        </div>

        {/* récap — real items + total payé */}
        <div className="pk-ocard">
          {items.map((it, i) => (
            <div className="pk-oline" key={i}>
              <span>{it.qty}× {it.name}</span>
              <span><bdi>{formatEuros(it.price * (it.qty ?? 1), locale)}</bdi></span>
            </div>
          ))}
          {items.length > 0 && <div className="pk-oline"><span className="div" style={{ width: '100%' }} /></div>}
          <div className="pk-totrow tot">
            <span>{t('totalPaid')}</span>
            <span><bdi>{formatEuros(order.total, locale)}</bdi></span>
          </div>
        </div>
      </div>

      {/* actions — INERT placeholders (no real geoloc/notify backend; C&C backend after
          Wave 5). Itinéraire + J'arrive (ready) / Me prévenir (preparing). */}
      <div className="foot">
        <div className="inner">
          <div className="pk-acts">
            <button type="button" className="w">
              <span className="ms" aria-hidden="true">directions</span>{t('actRoute')}
            </button>
            {ready ? (
              <button type="button" className="o">
                <span className="ms" aria-hidden="true">directions_walk</span>{t('actArriving')}
              </button>
            ) : (
              <button type="button" className="o">
                <span className="ms" aria-hidden="true">notifications_active</span>{t('actNotify')}
              </button>
            )}
          </div>
          <small>{t('footNote')}</small>
        </div>
      </div>
    </div>
  )
}
