'use client'
import { orderRef } from '@/lib/order-ref'

/**
 * /prep — operator CUISINE (KDS) — real-time kitchen display (Phase 3, wired).
 *
 * The page is wrapped by AppChrome → OperatorShell (navy --op-* chrome, « Cuisine »
 * active). This component renders ONLY the screen content = a <section> in op-content.
 *
 * REAL, not a mock:
 *  • Reads the CURRENT establishment's kitchen-active orders (received | preparing | ready)
 *    from GET /api/orders/kitchen (session/cookie-scoped, owner-scoped — never client-scoped),
 *    polled every 8 s while the tab is visible.
 *  • Cards carry a REAL elapsed timer derived from the server Order.createdAt (not a DOM
 *    counter) — see lib/kds.elapsedMin / ageOf.
 *  • The « bump » button advances the order through the REAL state machine via
 *    PATCH /api/orders/[id]/status (received → preparing → ready) — the SAME endpoint the
 *    Orders screen uses; not duplicated. Optimistic + resync; no backward transition (the
 *    server forbids it), so there is no undo.
 *  • No money on this screen (kitchen): the read + the ready-bump touch no ledger/Stripe.
 *    Loyalty credit only fires server-side on 'delivered', which the KDS never sets.
 *
 * The CD KDS design (board + .kt-card) is reused verbatim from the LOT 5 preview — only the
 * data + the bump are now real, and the « aperçu / bientôt » banner is removed.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import type { OrderView } from '@/lib/orders-feed'
import { KITCHEN_COLUMNS, bumpTarget, elapsedMin, ageOf, type KitchenStatus } from '@/lib/kds'
import './prep.css'

const POLL_MS = 8_000
const CHANNEL_ICON: Record<string, string> = { delivery: 'moped', pickup: 'shopping_bag', dinein: 'table_restaurant' }
const COL_KEY: Record<KitchenStatus, string> = { received: 'colNew', preparing: 'colPreparing', ready: 'colReady' }

export default function PrepPage() {
  const t = useTranslations('operator')
  const locale = useLocale()

  const [orders, setOrders] = useState<OrderView[] | null>(null) // null = first load
  const [error, setError] = useState(false)
  const [now, setNow] = useState<number | null>(null)             // set after mount → no SSR mismatch
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [bumpError, setBumpError] = useState(false)
  const busy = useRef(false)

  const fetchKitchen = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    try {
      const res = await fetch(`/api/orders/kitchen?locale=${locale}`, { cache: 'no-store' })
      if (!res.ok) throw new Error(String(res.status))
      const data = (await res.json()) as { orders?: OrderView[] }
      setOrders(Array.isArray(data.orders) ? data.orders : [])
      setError(false)
    } catch {
      setError(true)
    } finally {
      busy.current = false
      setNow(Date.now())
    }
  }, [locale])

  // Poll while the tab is visible; refetch immediately on regaining focus.
  useEffect(() => {
    fetchKitchen()
    const id = setInterval(() => { if (document.visibilityState === 'visible') fetchKitchen() }, POLL_MS)
    const onVis = () => { if (document.visibilityState === 'visible') fetchKitchen() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [fetchKitchen])

  // Independent clock so the timer keeps ticking between polls (minute resolution).
  useEffect(() => {
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(id)
  }, [])

  async function bump(order: OrderView, target: KitchenStatus) {
    setPendingId(order.id)
    setBumpError(false)
    // Optimistic: move the card to the next column immediately.
    setOrders(prev => (prev ? prev.map(o => (o.id === order.id ? { ...o, status: target } : o)) : prev))
    try {
      const res = await fetch(`/api/orders/${order.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: target }),
      })
      if (!res.ok) throw new Error(String(res.status))
    } catch {
      setBumpError(true)
    } finally {
      setPendingId(null)
      fetchKitchen() // resync with the server (corrects the optimistic guess either way)
    }
  }

  const dateLabel = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()),
    [locale],
  )

  const byStatus = useMemo(() => {
    const g: Record<KitchenStatus, OrderView[]> = { received: [], preparing: [], ready: [] }
    for (const o of orders ?? []) if (o.status in g) g[o.status as KitchenStatus].push(o)
    return g
  }, [orders])

  // Real stats from the active (received + preparing) tickets' age.
  const stats = useMemo(() => {
    const active = [...byStatus.received, ...byStatus.preparing]
    if (now == null || active.length === 0) return { open: active.length, avg: 0, oldest: 0 }
    const ages = active.map(o => elapsedMin(o.createdAt, now))
    return { open: active.length, avg: Math.round(ages.reduce((s, a) => s + a, 0) / ages.length), oldest: Math.max(...ages) }
  }, [byStatus, now])

  const total = (orders ?? []).length

  return (
    <section className="op-kit">
      <div className="op-dash__head">
        <h1 className="op-dash__title">
          {t('kitchen.title')}
          <span className="kt-live"><i className="dot" aria-hidden="true" />{t('kitchen.liveBadge')}</span>
        </h1>
        <p className="op-dash__sub">{dateLabel}</p>
      </div>

      {bumpError && (
        <div className="op-callout warn kt-toast" role="alert">
          <span className="ms" aria-hidden="true">error</span>
          <p>{t('kitchen.bumpError')}</p>
        </div>
      )}

      {error && orders === null ? (
        <div className="op-card"><div className="op-error__card">
          <span className="ms" aria-hidden="true">cloud_off</span>
          <h2>{t('dash.errorTitle')}</h2>
          <p>{t('dash.errorBody')}</p>
          <button type="button" className="op-btn-primary" onClick={() => fetchKitchen()}>
            <span className="ms" aria-hidden="true">refresh</span>{t('dash.retry')}
          </button>
        </div></div>
      ) : orders === null ? (
        <div className="op-card"><div className="op-emptyline">
          <span className="ms" aria-hidden="true">skillet</span>
          <b>{t('kitchen.loading')}</b>
        </div></div>
      ) : total === 0 ? (
        <div className="op-card"><div className="op-emptyline">
          <span className="ms" aria-hidden="true">soup_kitchen</span>
          <b>{t('kitchen.emptyTitle')}</b>
          <span>{t('kitchen.emptyBody')}</span>
        </div></div>
      ) : (
        <>
          <div className="op-card stat-strip">
            <div className="stat"><span className="lbl">{t('kitchen.statOpen')}</span><b className="mono">{String(stats.open)}</b></div>
            <div className="stat"><span className="lbl">{t('kitchen.statAvg')}</span><b className="mono">{t('kitchen.elapsed', { minutes: stats.avg })}</b></div>
            <div className="stat"><span className="lbl">{t('kitchen.statOldest')}</span><b className={`mono${stats.oldest >= 20 ? ' alert' : ''}`}>{t('kitchen.elapsed', { minutes: stats.oldest })}</b></div>
          </div>

          <div className="kt-board">
            {KITCHEN_COLUMNS.map(col => (
              <div className="kt-col" key={col}>
                <div className="kt-col__head">
                  <b>{t(`kitchen.${COL_KEY[col]}`)}</b>
                  <span className="cnt mono">{String(byStatus[col].length)}</span>
                </div>
                <div className="kt-col__cards">
                  {byStatus[col].length === 0 ? (
                    <div className="kt-col__empty">{t('kitchen.colEmpty')}</div>
                  ) : (
                    byStatus[col].map(o => {
                      const min = now != null ? elapsedMin(o.createdAt, now) : 0
                      const stateCls = o.status === 'ready' ? 'ready' : ageOf(min)
                      const target = bumpTarget(o.status)
                      const ch = o.fulfillmentType in CHANNEL_ICON ? o.fulfillmentType : 'pickup'
                      return (
                        <div key={o.id} className={`kt-card ${stateCls}`} data-status={o.status}>
                          <div className="kt-top">
                            <span className="kt-num">{orderRef(o.id)}</span>
                            <span className={`kt-channel ${ch}`}>
                              <span className="ms" aria-hidden="true">{CHANNEL_ICON[ch]}</span>
                              {t(`kitchen.channel.${ch}`)}
                            </span>
                            <span className="kt-timer mono">
                              <span className="ms" aria-hidden="true">{o.status === 'ready' ? 'check' : 'schedule'}</span>
                              {t('kitchen.elapsed', { minutes: min })}
                            </span>
                          </div>
                          <div className="kt-items">
                            {o.items.map((it, i) => (
                              <div className="kt-item" key={i}>
                                <span className="qty mono">{it.qty}×</span>
                                <div className="m">
                                  <b>{it.name}{it.options?.size ? ` · ${it.options.size}` : ''}</b>
                                  {it.options?.supplements?.map((s, j) => (
                                    <span className="note add" key={`s${j}`}><span className="ms" aria-hidden="true">add</span>{s.name}</span>
                                  ))}
                                  {it.options?.exclusions?.length ? (
                                    <span className="note"><span className="ms" aria-hidden="true">warning</span>{t('kitchen.without', { items: it.options.exclusions.join(', ') })}</span>
                                  ) : null}
                                  {it.options?.note ? (
                                    <span className="note"><span className="ms" aria-hidden="true">sticky_note_2</span>{it.options.note}</span>
                                  ) : null}
                                </div>
                              </div>
                            ))}
                          </div>
                          <div className="kt-foot">
                            {target ? (
                              <button type="button" className="kt-bump" disabled={pendingId === o.id} onClick={() => bump(o, target)}>
                                <span className="ms" aria-hidden="true">{target === 'preparing' ? 'skillet' : 'check_circle'}</span>
                                {target === 'preparing' ? t('kitchen.start') : t('kitchen.bump')}
                              </button>
                            ) : (
                              <div className="kt-ready-tag">
                                <span className="ms" aria-hidden="true">check_circle</span>{t('kitchen.ready')}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
