'use client'

/**
 * OrdersClient — full operator Orders page (client island). VERBATIM CD v1 re-skin
 * (Notion 390fd2c9-8146-8184-b762-f4b44adca0f6 — LOT 5) to the --op- operator design
 * (navy shell + Material Symbols, NO lucide). The shell (components/operator/
 * OperatorShell, mounted by AppChrome) already provides .gb-op + .op-content — this
 * component renders ONLY the screen content (a <section className="op-ord">) + its
 * two modals (detail / stock-out) as fixed overlays.
 *
 * 🔒 PRESENTATION ONLY. Every data path is byte-identical to the previous version:
 *   • near-real-time feed: GET /api/orders/live?locale= polled every 15 s while the
 *     tab is visible, seeded from server props.
 *   • Web-Audio chime (zero shipped asset) on a newly-seen order + a looping re-chime
 *     while ≥1 order is still UNACCEPTED ('received'), with the autoplay-unlock banner.
 *   • status transitions via the SHARED order-actions hook (useOrderAdvance →
 *     PATCH /api/orders/[id]/status) — the SERVER state machine is untouched. The op-
 *     styled action buttons call advance(id, target) with the EXACT same targets the
 *     shared OrderStatusActions component uses (received→preparing / →cancelled,
 *     preparing→ready, ready+pickup→delivered, picked_up→delivered).
 *   • pause / resume: PATCH /api/restaurants/[id]/pause.
 *   • stock-out toggle: PATCH /api/menu/[id]/availability.
 *
 * Money: Order.{subtotal,deliveryFee,discount,total} = Float EUROS via
 * formatEuros(x, locale) — NEVER recomputed. The multi-platform (UberEats / Deliveroo
 * / Just Eat) banner stays a VISUAL PLACEHOLDER → /pricing (no real aggregation).
 * Mounts its own ToastProvider (operator pages have no global one).
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations, useLocale } from 'next-intl'
import { formatEuros } from '@/lib/format-money'
import { Link } from '@/navigation'
import { ToastProvider, useToast } from '@/components/design-system'
import EstablishmentSwitcher, {
  type EstablishmentOption,
} from '@/components/dashboard/EstablishmentSwitcher'
import {
  KNOWN_STATUS, useOrderAdvance,
} from '@/components/orders/order-actions'
import {
  tabForStatus, hasUnacceptedOrder, type OrderView, type OrderItemView, type OrderTab,
} from '@/lib/orders-feed'

// ── Serializable view types ───────────────────────────────────────────────────
// OrderView / OrderItemView now live in lib/orders-feed (shared with the server
// page + the live endpoint). Re-exported so existing importers are unaffected.
export type { OrderView, OrderItemView }

export interface BrandView      { name: string; emoji: string }
export interface MenuItemView   { id: string; name: string; available: boolean; brandName: string; emoji: string }
export interface RestaurantView { id: string; name: string; isActive: boolean }

interface OrdersClientProps {
  restaurant:     RestaurantView
  // All of the operator's establishments (oldest first) for the header switcher.
  // ≤1 entry → the switcher renders nothing (mono behaviour preserved).
  establishments: EstablishmentOption[]
  orders:         OrderView[]
  brands:         BrandView[]
  menuItems:      MenuItemView[]
  // SEC1 — true only for admins. An owner may pause their restaurant (true→false)
  // but cannot bring it (back) online: publication is admin-validated. When false
  // and the restaurant is offline, the "Réactiver" action is replaced by a clear
  // "awaiting validation" state (the server enforces this regardless of the UI).
  canPublish?:    boolean
  initialOrderId?: string
}

const STATUS_FLOW = ['received', 'preparing', 'ready', 'picked_up', 'delivered'] as const
const POLL_INTERVAL_MS = 15_000   // near-real-time refresh while the tab is visible
const SOUND_REPEAT_MS  = 25_000   // re-chime cadence while an order awaits acceptance
const DONE_PAGE = 20              // "Terminées" history page size

// ── Root: own ToastProvider ───────────────────────────────────────────────────

export default function OrdersClient(props: OrdersClientProps) {
  return (
    <ToastProvider>
      <OrdersInner {...props} />
    </ToastProvider>
  )
}

function OrdersInner({ restaurant, establishments, orders, brands, menuItems, canPublish = false, initialOrderId }: OrdersClientProps) {
  const t      = useTranslations('orders')
  const ts     = useTranslations('dashboard.home.liveOrders') // status / type / action labels
  const toast  = useToast()
  const router = useRouter()
  const locale = useLocale()
  const { advance, pendingId } = useOrderAdvance()

  const [brandFilter,  setBrandFilter]  = useState<string>('all')
  const [tab,          setTab]           = useState<OrderTab>('todo')   // default: à traiter
  const [doneLimit,    setDoneLimit]     = useState(DONE_PAGE)
  const [soundOn,      setSoundOn]       = useState(true)
  const [detailId,     setDetailId]      = useState<string | null>(initialOrderId ?? null)
  const [stockOpen,    setStockOpen]     = useState(false)
  const [isActive,     setIsActive]      = useState(restaurant.isActive)
  const [pausePending, setPausePending]  = useState(false)
  const [availability, setAvailability]  = useState<Record<string, boolean>>(
    () => Object.fromEntries(menuItems.map(m => [m.id, m.available])),
  )
  const [availPending, setAvailPending]  = useState<string | null>(null)

  // ── Near-real-time feed (Orders v2) ─────────────────────────────────────────
  // liveOrders is seeded from the server props and refreshed by 15 s polling
  // (visible tab only). It resyncs whenever the server re-renders (an advance →
  // router.refresh, or an establishment switch) — resync never chimes.
  const [liveOrders, setLiveOrders] = useState<OrderView[]>(orders)
  const seenIds  = useRef<Set<string>>(new Set(orders.map(o => o.id)))
  const soundRef = useRef(soundOn)
  useEffect(() => { soundRef.current = soundOn }, [soundOn])
  // Latest list for the looping chime (the interval closure must not capture a
  // stale snapshot).
  const liveRef = useRef<OrderView[]>(orders)
  useEffect(() => { liveRef.current = liveOrders }, [liveOrders])
  useEffect(() => {
    setLiveOrders(orders)
    orders.forEach(o => seenIds.current.add(o.id))
  }, [orders])

  // ── Web Audio chime — ZERO shipped asset ────────────────────────────────────
  // Browser autoplay rule: an AudioContext created WITHOUT a user gesture starts
  // 'suspended', and resume() may stay pending until a gesture occurs. The resto
  // use-case is exactly "screen left open for hours with NO click" → the ctx
  // never unlocked and the chime was silently swallowed (the toast still fired =
  // the observed symptom). Fix: (1) best-effort create at mount; (2) playChime
  // resumes a suspended ctx and, if it still can't play, raises a VISIBLE unlock
  // banner whose click IS a gesture → reliable recovery; (3) any pointer gesture
  // also unlocks. Never plays on initial load (seenIds pre-seeded) — only on an
  // id first seen through polling. soundOn OFF = muted (toast still shows).
  const audioCtx = useRef<AudioContext | null>(null)
  const [audioBlocked, setAudioBlocked] = useState(false)

  const ensureCtx = useCallback((): AudioContext | null => {
    try {
      const Ctx = window.AudioContext
        || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!audioCtx.current && Ctx) audioCtx.current = new Ctx()
    } catch { /* audio unavailable — the toast still fires */ }
    return audioCtx.current
  }, [])

  // Emit the tone on an already-RUNNING context. Never throws.
  const emitTone = useCallback((ctx: AudioContext) => {
    try {
      const o = ctx.createOscillator(); const g = ctx.createGain()
      o.connect(g); g.connect(ctx.destination)
      o.type = 'sine'; o.frequency.value = 880
      const now = ctx.currentTime
      g.gain.setValueAtTime(0.0001, now)
      g.gain.exponentialRampToValueAtTime(0.18, now + 0.02)
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.45)
      o.start(now); o.stop(now + 0.45)
    } catch { /* ignore */ }
  }, [])

  // Gesture path — a user gesture (banner/toggle click, any pointerdown) is what
  // lets a suspended ctx actually resume. On success clear the banner and
  // optionally play a confirmation tone.
  const unlockAudio = useCallback((playTest = false) => {
    const ctx = ensureCtx()
    if (!ctx) return
    const done = () => { setAudioBlocked(false); if (playTest) emitTone(ctx) }
    if (ctx.state === 'running') { done(); return }
    void ctx.resume().then(() => { if (ctx.state === 'running') done() }).catch(() => { /* ignore */ })
  }, [ensureCtx, emitTone])

  // Automatic path (new order). Plays if the ctx is running; otherwise attempts a
  // resume and raises the unlock banner meanwhile (resume may stay pending until
  // a gesture). Never throws.
  const playChime = useCallback(() => {
    const ctx = ensureCtx()
    if (!ctx) { setAudioBlocked(true); return }
    if (ctx.state === 'running') { emitTone(ctx); return }
    setAudioBlocked(true)
    void ctx.resume().then(() => {
      if (ctx.state === 'running') { setAudioBlocked(false); emitTone(ctx) }
    }).catch(() => { /* ignore — banner stays up for an explicit unlock */ })
  }, [ensureCtx, emitTone])

  // Best-effort create at mount + unlock on the first pointer gesture anywhere.
  // PROACTIVE: if the browser created the ctx 'suspended' (autoplay policy), raise
  // the unlock banner immediately so the operator can enable sound at the START of
  // service — not only after a first order was already missed. Any gesture (the
  // banner, the toggle, or the once-listener below) clears it.
  useEffect(() => {
    const ctx = ensureCtx()
    if (ctx && ctx.state !== 'running') setAudioBlocked(true)
    const once = () => unlockAudio()
    window.addEventListener('pointerdown', once, { once: true })
    return () => window.removeEventListener('pointerdown', once)
  }, [ensureCtx, unlockAudio])

  const fetchLive = useCallback(async () => {
    try {
      const res = await fetch(`/api/orders/live?locale=${locale}`, { cache: 'no-store' })
      if (!res.ok) return
      const data = await res.json() as { orders?: OrderView[] }
      const incoming = Array.isArray(data.orders) ? data.orders : []
      const fresh = incoming.filter(o => !seenIds.current.has(o.id))
      incoming.forEach(o => seenIds.current.add(o.id))
      setLiveOrders(incoming)                       // React reconciles by id → no jump
      if (fresh.length > 0) {
        if (soundRef.current) playChime()           // instant feedback; the loop below keeps nagging until accepted
        toast.success(fresh.length === 1 ? t('newOrderToast') : t('newOrdersToast', { count: fresh.length }))
      }
    } catch { /* network blip — keep the current list */ }
  }, [locale, playChime, toast, t])

  // Poll every 15 s WHILE the tab is visible; immediate refresh on regaining focus.
  useEffect(() => {
    const tick  = () => { if (document.visibilityState === 'visible') void fetchLive() }
    const id    = setInterval(tick, POLL_INTERVAL_MS)
    const onVis = () => { if (document.visibilityState === 'visible') void fetchLive() }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [fetchLive])

  // ── Looping new-order chime (Mohammed) ──────────────────────────────────────
  // While at least one order is still UNACCEPTED ('received'), re-chime every
  // SOUND_REPEAT_MS so a busy kitchen can't miss it (the arrival itself already
  // chimed in fetchLive). The instant the last 'received' order is accepted/
  // advanced, liveOrders changes → hasPending flips false → this effect re-runs
  // and clears the interval → the sound STOPS at once. ONE interval at a time
  // (effect-managed, never stacked). Sound only — the arrival toast is NOT
  // repeated. soundOn OFF → silent (guarded per tick). 2.4: only 'received'
  // nags, never an order already in the kitchen. The per-tick gesture/ctx checks
  // in playChime keep the first-load-silent + autoplay-unlock guarantees intact.
  const hasPending = hasUnacceptedOrder(liveOrders)
  useEffect(() => {
    if (!hasPending) return
    const id = setInterval(() => {
      if (soundRef.current && hasUnacceptedOrder(liveRef.current)) playChime()
    }, SOUND_REPEAT_MS)
    return () => clearInterval(id)
  }, [hasPending, playChime])

  const statusLabel = (s: string): string =>
    KNOWN_STATUS.has(s) ? ts(`status_${s}`) : ts('status_unknown')

  // Brand-filtered orders, then split into tabs. Tab badge counts respect the
  // brand filter so the badges and the visible list stay consistent. A new order
  // increments the 'todo' badge whatever tab is open (counts span all tabs).
  const brandMatched = liveOrders.filter(o => brandFilter === 'all' || o.brandNames.includes(brandFilter))
  const counts: Record<OrderTab, number> = { todo: 0, inProgress: 0, done: 0 }
  for (const o of brandMatched) counts[tabForStatus(o.status)]++
  const activeCount = counts.todo + counts.inProgress

  const tabOrders = brandMatched.filter(o => tabForStatus(o.status) === tab)
  // 'Terminées' is history → capped at the last N with "Voir plus"; the
  // operational tabs (todo/inProgress) stay small and are shown in full.
  const visible     = tab === 'done' ? tabOrders.slice(0, doneLimit) : tabOrders
  const doneHasMore = tab === 'done' && tabOrders.length > doneLimit

  const detailOrder = detailId ? liveOrders.find(o => o.id === detailId) ?? null : null

  // ── Pause / resume the restaurant ──────────────────────────────────────────
  async function togglePause() {
    const next = !isActive
    setPausePending(true)
    setIsActive(next) // optimistic
    try {
      const res = await fetch(`/api/restaurants/${restaurant.id}/pause`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ isActive: next }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as { error?: string }))
        setIsActive(!next) // revert
        toast.error(t('pauseError'), {
          description: typeof data?.error === 'string' ? data.error : undefined,
        })
        return
      }
      toast.success(next ? t('pauseToastActive') : t('pauseToastPaused'))
      router.refresh()
    } catch {
      setIsActive(!next)
      toast.error(t('pauseError'))
    } finally {
      setPausePending(false)
    }
  }

  // ── Stock-out toggle for one dish ──────────────────────────────────────────
  async function toggleAvailability(item: MenuItemView) {
    const next = !availability[item.id]
    setAvailPending(item.id)
    setAvailability(p => ({ ...p, [item.id]: next })) // optimistic
    try {
      const res = await fetch(`/api/menu/${item.id}/availability`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ available: next }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({} as { error?: string }))
        setAvailability(p => ({ ...p, [item.id]: !next })) // revert
        toast.error(t('stock.error'), {
          description: typeof data?.error === 'string' ? data.error : undefined,
        })
        return
      }
      toast.success(next ? t('stock.toastBack', { name: item.name }) : t('stock.toastOut', { name: item.name }))
      router.refresh()
    } catch {
      setAvailability(p => ({ ...p, [item.id]: !next }))
      toast.error(t('stock.error'))
    } finally {
      setAvailPending(null)
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  const dateSub = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .format(new Date())

  return (
    <section className="op-ord">
      {/* Page head — title + live badge + sound toggle */}
      <div className="op-dash__head">
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <h1 className="op-dash__title">{t('title')}</h1>
            <span className="live-badge"><i className="pulse" />{t('liveBadge')}</span>
          </div>
          <p className="op-dash__sub">{t('subtitle', { count: activeCount })} · {dateSub}</p>
        </div>
        <div className="head-actions">
          {/* Switcher renders nothing at ≤1 establishment → mono header unchanged. */}
          <EstablishmentSwitcher establishments={establishments} currentId={restaurant.id} />
          <button
            className={'sound-toggle' + (soundOn ? '' : ' is-off')}
            onClick={() => { unlockAudio(); setSoundOn(s => !s) }}
          >
            <span className="ms">{soundOn ? 'volume_up' : 'volume_off'}</span>
            <span className="lbl">{soundOn ? t('soundOn') : t('soundOff')}</span>
          </button>
        </div>
      </div>

      {/* Real, honest counts strip (derived from the live feed — no invented figures) */}
      <div className="op-card stat-strip" style={{ marginBottom: 18 }}>
        <div className="stat">
          <span className="lbl">{t('statPending')}</span>
          <b className={counts.todo > 0 ? 'alert' : undefined}>{counts.todo}</b>
        </div>
        <div className="stat">
          <span className="lbl">{t('statInProgress')}</span>
          <b>{counts.inProgress}</b>
        </div>
        <div className="stat">
          <span className="lbl">{t('statDone')}</span>
          <b>{counts.done}</b>
        </div>
      </div>

      {/* Control row — pause / réactiver / awaiting-validation (real handlers) */}
      <div className="op-ctrls">
        {!isActive && !canPublish ? (
          // SEC1 — owner cannot self-publish; show the awaiting-validation state
          // instead of a "Réactiver" button the server would refuse (403).
          <button className="op-ctrl-btn" disabled>
            <span className="ms">schedule</span>{t('awaitingApproval')}
          </button>
        ) : (
          <button
            className={'op-ctrl-btn ' + (isActive ? 'danger' : 'primary')}
            disabled={pausePending}
            onClick={togglePause}
          >
            <span className="ms">{isActive ? 'pause_circle' : 'power_settings_new'}</span>
            {isActive ? t('pauseAll') : t('reactivate')}
          </button>
        )}
      </div>

      {/* Sound locked by the browser autoplay policy: the screen sits open for
          hours with no gesture → the ctx stays suspended. One explicit click
          here unlocks it (a gesture) and plays a test chime; the banner then
          disappears and subsequent orders chime on their own. */}
      {soundOn && audioBlocked && (
        <button type="button" className="op-callout unlock" onClick={() => unlockAudio(true)}>
          <span className="ms">volume_up</span>
          <div className="op-callout__t">
            <b>{t('soundUnlockTitle')}</b>
            <span>{t('soundUnlockDesc')}</span>
          </div>
          <span className="cta">{t('soundUnlockCta')}</span>
        </button>
      )}

      {/* Paused / awaiting-validation banner */}
      {!isActive && (
        <div className="op-callout warn">
          <span className="ms">{canPublish ? 'pause_circle' : 'schedule'}</span>
          <div className="op-callout__t">
            <b>{canPublish ? t('pausedTitle') : t('awaitingApproval')}</b>
            <span>{canPublish ? t('pausedDesc') : t('awaitingApprovalDesc')}</span>
          </div>
          {/* SEC1 — publication is admin-only: no "Réactiver" action for owners. */}
          {canPublish && (
            <button className="op-ctrl-btn primary actbtn" disabled={pausePending} onClick={togglePause}>
              {t('reactivate')}
            </button>
          )}
        </div>
      )}

      {/* Pro multi-platform placeholder (no real integration) — upsell lives on /pricing */}
      <Link href="/pricing" className="op-callout clickable">
        <span className="ms">lock</span>
        <div className="op-callout__t">
          <b>{t('proBannerTitle')}</b>
          <span>{t('proBannerDesc')}</span>
        </div>
        <span className="cta">{t('proBadge')}</span>
      </Link>

      {/* Brand filters + stock-out button */}
      <div className="op-filters">
        <span className="ms fico">filter_list</span>
        <button className={'op-chip' + (brandFilter === 'all' ? ' is-active' : '')} onClick={() => setBrandFilter('all')}>
          {t('filterAll')}
        </button>
        {brands.map(b => (
          <button
            key={b.name}
            className={'op-chip' + (brandFilter === b.name ? ' is-active' : '')}
            onClick={() => setBrandFilter(b.name)}
          >
            <span aria-hidden>{b.emoji}</span>{b.name}
          </button>
        ))}
        <span className="sep" />
        <button className="op-chip stock" onClick={() => setStockOpen(true)}>
          <span className="ms">remove_shopping_cart</span>{t('stockButton')}
        </button>
      </div>

      {/* Tabs — À traiter / En cours / Terminées, with live count badges */}
      <div className="order-tabs" role="tablist">
        {([
          ['todo',       t('tabTodo'),       counts.todo],
          ['inProgress', t('tabInProgress'), counts.inProgress],
          ['done',       t('tabDone'),       counts.done],
        ] as const).map(([k, label, n]) => (
          <button
            key={k}
            className={tab === k ? 'is-active' : undefined}
            onClick={() => setTab(k)}
          >
            {label}
            {n > 0 && <span className="tab-count">{n}</span>}
          </button>
        ))}
      </div>

      {/* Orders list */}
      {liveOrders.length === 0 ? (
        <div className="op-card">
          <div className="op-emptyline">
            <span className="ms">receipt_long</span>
            <b>{t('emptyTitle')}</b>
            <span>{t('emptyDesc')}</span>
          </div>
        </div>
      ) : visible.length === 0 ? (
        <div className="op-card">
          <div className="op-emptyline">
            <span className="ms">search_off</span>
            <b>{t('emptyFilteredTitle')}</b>
            <span>{t('emptyFilteredDesc')}</span>
          </div>
        </div>
      ) : (
        <div className="order-list">
          {visible.map(o => {
            const isPickup = o.fulfillmentType === 'pickup'
            const isNew    = o.status === 'received'
            const isDone   = o.status === 'delivered' || o.status === 'cancelled'
            return (
              <div
                key={o.id}
                className={'order-card' + (isNew ? ' is-new' : '') + (isDone ? ' is-done' : '')}
                onClick={() => setDetailId(o.id)}
              >
                <div className="oc-top">
                  <span className="oc-num">#{o.id.slice(-6).toUpperCase()}</span>
                  <span className={'channel-badge ' + (isPickup ? 'pickup' : 'delivery')}>
                    <span className="ms">{isPickup ? 'shopping_bag' : 'moped'}</span>
                    {isPickup ? ts('typePickup') : ts('typeDelivery')}
                  </span>
                  <span className={'oc-timer' + (isNew ? ' urgent' : '')}>
                    <span className="ms">schedule</span>{o.timeLabel}
                  </span>
                </div>

                {o.brandNames.length > 0 && (
                  <div className="oc-brand">{o.brandNames.join(' · ')}</div>
                )}
                <div className="oc-items">{o.itemsPreview}</div>

                <div className="oc-foot">
                  <span className="oc-total mono">{formatEuros(o.total, locale)}</span>
                  <MiniStepper status={o.status} fulfillmentType={o.fulfillmentType} />
                  <span className={'stage-label' + (o.status === 'delivered' ? ' done' : o.status === 'cancelled' ? ' cancelled' : '')}>
                    {statusLabel(o.status)}
                  </span>
                </div>

                {/* Actions — stop propagation so they don't open the detail. */}
                <div className="oc-actions" onClick={e => e.stopPropagation()}>
                  <OpOrderActions order={o} pendingId={pendingId} advance={advance} ts={ts} />
                </div>
              </div>
            )
          })}
          {doneHasMore && (
            <div className="op-see-more">
              <button onClick={() => setDoneLimit(n => n + DONE_PAGE)}>{t('seeMore')}</button>
            </div>
          )}
        </div>
      )}

      {/* Detail modal */}
      {detailOrder && (
        <div
          className="op-modal-backdrop"
          onClick={e => { if (e.target === e.currentTarget) setDetailId(null) }}
        >
          <div className="op-modal">
            <div className="op-modal__head">
              <div className="op-modal__headtext">
                <h3>{t('detail.title', { ref: `#${detailOrder.id.slice(-6).toUpperCase()}` })}</h3>
                <span className="sub">
                  {(detailOrder.fulfillmentType === 'pickup' ? ts('typePickup') : ts('typeDelivery'))}
                  {' · '}{detailOrder.dateLabel} · {detailOrder.timeLabel}
                </span>
              </div>
              <button className="op-modal__close" onClick={() => setDetailId(null)}>
                <span className="ms">close</span>
              </button>
            </div>

            <div className="op-modal__body">
              {/* Timeline */}
              {detailOrder.status === 'cancelled' ? (
                <div className="cancelled-box">
                  <span className="ms">block</span>{t('detail.cancelled')}
                </div>
              ) : (
                <FullStepper status={detailOrder.status} fulfillmentType={detailOrder.fulfillmentType} statusLabel={statusLabel} />
              )}

              {/* Customer */}
              <div className="od-cust-box">
                {detailOrder.customer ? (
                  <>
                    <div className="row"><span className="ms">person</span><b>{detailOrder.customer.name}</b></div>
                    <div className="row"><span className="ms">mail</span><span>{detailOrder.customer.email}</span></div>
                    {detailOrder.customer.phone && (
                      <div className="row"><span className="ms">call</span><span className="mono">{detailOrder.customer.phone}</span></div>
                    )}
                  </>
                ) : (
                  <div className="row"><span className="ms">person</span><span>{t('detail.noCustomer')}</span></div>
                )}
                {detailOrder.referralCode && (
                  <div className="row">
                    <span className="ms">sell</span>
                    <span>{t('detail.referral')}: <span className="referral">{detailOrder.referralCode}</span></span>
                  </div>
                )}
              </div>

              {/* Items */}
              <div>
                <div className="od-secttl" style={{ marginBottom: 8 }}>{t('detail.items')}</div>
                <div className="od-items">
                  {detailOrder.items.map((it, idx) => (
                    <div key={idx} className="od-row">
                      <span className="qty">{it.qty}×</span>
                      <div className="m">
                        <b>{it.emoji ? `${it.emoji} ` : ''}{it.name}</b>
                        {it.brandName && <span>{it.brandName}</span>}
                        {it.options?.size && <span>{t('detail.size')}: {it.options.size}</span>}
                        {it.options?.supplements && it.options.supplements.length > 0 && (
                          <span>{t('detail.supplements')}: {it.options.supplements.map(s => s.name).join(', ')}</span>
                        )}
                        {it.options?.exclusions && it.options.exclusions.length > 0 && (
                          <span className="excl">{t('detail.exclusions')}: {it.options.exclusions.join(', ')}</span>
                        )}
                        {it.options?.note && <span>{t('detail.note')}: “{it.options.note}”</span>}
                      </div>
                      <span className="price mono">{formatEuros(it.price * it.qty, locale)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Totals */}
              <div className="od-total">
                <div className="row"><span>{t('detail.subtotal')}</span><span>{formatEuros(detailOrder.subtotal, locale)}</span></div>
                {detailOrder.discount > 0 && (
                  <div className="row discount"><span>{t('detail.discount')}</span><span>−{formatEuros(detailOrder.discount, locale)}</span></div>
                )}
                <div className="row"><span>{t('detail.deliveryFee')}</span><span>{formatEuros(detailOrder.deliveryFee, locale)}</span></div>
                <div className="row grand"><span>{t('detail.total')}</span><b>{formatEuros(detailOrder.total, locale)}</b></div>
              </div>

              {/* Server-authority callout (money + transitions are server-side) */}
              <div className="op-callout">
                <span className="ms">info</span>
                <p>{t('detail.serverNote')}</p>
              </div>
            </div>

            <div className="op-modal__foot">
              <button
                className="op-btn-ghost mrauto"
                onClick={() => { setDetailId(null); setStockOpen(true) }}
              >
                <span className="ms">remove_shopping_cart</span>{t('detail.markOutOfStock')}
              </button>
              <div className="oc-actions" onClick={e => e.stopPropagation()}>
                <OpOrderActions order={detailOrder} pendingId={pendingId} advance={advance} ts={ts} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Stock-out modal */}
      {stockOpen && (
        <div
          className="op-modal-backdrop"
          onClick={e => { if (e.target === e.currentTarget) setStockOpen(false) }}
        >
          <div className="op-modal wide">
            <div className="op-modal__head">
              <div className="op-modal__headtext">
                <h3>{t('stock.title')}</h3>
                <span className="sub">{t('stock.desc')}</span>
              </div>
              <button className="op-modal__close" onClick={() => setStockOpen(false)}>
                <span className="ms">close</span>
              </button>
            </div>
            <div className="op-modal__body">
              {menuItems.length === 0 ? (
                <div className="op-emptyline">
                  <span className="ms">restaurant_menu</span>
                  <b>{t('stock.empty')}</b>
                </div>
              ) : (
                <>
                  {menuItems.map(m => {
                    const isAvail = availability[m.id]
                    const busy = availPending === m.id
                    return (
                      <div key={m.id} className="stock-row">
                        <span className="emoji" aria-hidden>{m.emoji}</span>
                        <div className="m">
                          <b>{m.name}</b>
                          <span>{m.brandName}</span>
                        </div>
                        <span className={'op-pill ' + (isAvail ? 'available' : 'out')}>
                          {isAvail ? t('stock.available') : t('stock.outOfStock')}
                        </span>
                        <button
                          className={'oc-btn' + (isAvail ? '' : ' primary')}
                          disabled={busy}
                          onClick={() => toggleAvailability(m)}
                        >
                          <span className="ms">{isAvail ? 'block' : 'check'}</span>
                          {isAvail ? t('stock.markOut') : t('stock.markBack')}
                        </button>
                      </div>
                    )
                  })}
                  <p className="oc-wait" style={{ paddingTop: 4 }}>
                    <span className="ms">warning</span>{t('stock.todoNote')}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

// ── Contextual action buttons — op-styled, EXACT same transitions as the shared
//    OrderStatusActions (components/orders/order-actions). Each button calls
//    advance(id, target) → PATCH /api/orders/[id]/status (server state machine).
//    NOT reimplemented: advance/pendingId come from the shared useOrderAdvance hook.
function OpOrderActions({
  order, pendingId, advance, ts,
}: {
  order:     { id: string; status: string; fulfillmentType: string }
  pendingId: string | null
  advance:   (orderId: string, target: string) => void
  ts:        (key: string) => string
}) {
  if (order.status === 'delivered' || order.status === 'cancelled') return null
  const busy = pendingId === order.id

  if (order.status === 'received') {
    return (
      <>
        <button className="oc-btn danger" disabled={busy} onClick={() => advance(order.id, 'cancelled')}>
          <span className="ms">close</span>{ts('refuse')}
        </button>
        <button className="oc-btn primary" disabled={busy} onClick={() => advance(order.id, 'preparing')}>
          <span className="ms">check</span>{ts('accept')}
        </button>
      </>
    )
  }

  if (order.status === 'preparing') {
    return (
      <button className="oc-btn primary" disabled={busy} onClick={() => advance(order.id, 'ready')}>
        <span className="ms">task_alt</span>{ts('markReady')}
      </button>
    )
  }

  if (order.status === 'ready') {
    const isPickup = order.fulfillmentType === 'pickup'
    return (
      <>
        <span className="oc-wait">
          <span className="ms">hourglass_top</span>
          {isPickup ? ts('waitingCustomer') : ts('waitingCourier')}
        </span>
        {isPickup && (
          // PICKUP has no courier leg: the hand-off COMPLETES the order
          // (ready → delivered directly, the state machine allows it).
          <button className="oc-btn primary" disabled={busy} onClick={() => advance(order.id, 'delivered')}>
            <span className="ms">inventory_2</span>{ts('handToCustomer')}
          </button>
        )}
      </>
    )
  }

  if (order.status === 'picked_up') {
    return (
      <button className="oc-btn primary" disabled={busy} onClick={() => advance(order.id, 'delivered')}>
        <span className="ms">check_circle</span>{ts('markDelivered')}
      </button>
    )
  }

  return null
}

// ── Mini-stepper on the order card (compact status progress) ──────────────────
function MiniStepper({ status, fulfillmentType }: { status: string; fulfillmentType: string }) {
  const isPickup = fulfillmentType === 'pickup'
  const flow: readonly string[] = isPickup
    ? ['received', 'preparing', 'ready', 'delivered']
    : STATUS_FLOW
  const currentIdx = isPickup && status === 'picked_up' ? flow.length - 1 : flow.indexOf(status)
  const cancelled = status === 'cancelled'
  return (
    <div className="mini-stepper" aria-hidden>
      {flow.map((step, i) => {
        const done    = !cancelled && currentIdx >= 0 && i < currentIdx
        const current = !cancelled && i === currentIdx
        return (
          <span key={step} style={{ display: 'contents' }}>
            {i > 0 && <span className={'line' + (done || current ? ' done' : '')} />}
            <span className={'node' + (current ? ' current' : done ? ' done' : '')} />
          </span>
        )
      })}
    </div>
  )
}

// ── Full stepper in the detail modal (icon steps + labels) ────────────────────
function FullStepper({
  status, fulfillmentType, statusLabel,
}: {
  status: string
  fulfillmentType: string
  statusLabel: (s: string) => string
}) {
  const isPickup = fulfillmentType === 'pickup'
  // DELIVERY = 5 icon steps; PICKUP = 4 (no courier "En route" leg).
  const steps: { key: string; icon: string }[] = isPickup
    ? [
        { key: 'received',  icon: 'check' },
        { key: 'preparing', icon: 'skillet' },
        { key: 'ready',     icon: 'task_alt' },
        { key: 'delivered', icon: 'flag' },
      ]
    : [
        { key: 'received',  icon: 'check' },
        { key: 'preparing', icon: 'skillet' },
        { key: 'ready',     icon: 'task_alt' },
        { key: 'picked_up', icon: 'two_wheeler' },
        { key: 'delivered', icon: 'flag' },
      ]
  const flow = steps.map(s => s.key)
  const currentIdx = isPickup && status === 'picked_up' ? flow.length - 1 : flow.indexOf(status)
  return (
    <div className="full-stepper">
      {steps.map((s, i) => {
        const done    = currentIdx >= 0 && i <= currentIdx
        const current = i === currentIdx
        return (
          <div key={s.key} className={'step' + (current ? ' current' : done ? ' done' : '')}>
            <span className="ln" />
            <span className="dot"><span className="ms">{done && !current ? 'check' : s.icon}</span></span>
            <span>{statusLabel(s.key)}</span>
          </div>
        )
      })}
    </div>
  )
}
