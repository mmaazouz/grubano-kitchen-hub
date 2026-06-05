'use client'

/**
 * OrdersClient — full operator Orders page (client island).
 *
 * Renders the connected restaurant's REAL orders (fetched server-side in
 * app/[locale]/orders/page.tsx) with:
 *   • contextual status actions (shared with the dashboard via
 *     components/orders/order-actions → consumes PATCH /api/orders/[id]/status)
 *   • brand + status filters driven by the operator's real brands
 *   • a click-to-open detail view (items + options, customer, totals, status
 *     timeline, referral code) — actions also reachable from the detail
 *   • stock-out: toggle a dish unavailable (PATCH /api/menu/[id]/availability)
 *   • pause: stop taking orders (PATCH /api/restaurants/[id]/pause)
 *
 * The "Son activé" button is a local/decorative toggle. The multi-platform
 * (UberEats / Deliveroo / Just Eat) banner is a VISUAL PLACEHOLDER — no real
 * aggregation. Mounts its own ToastProvider (operator pages have no global one).
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Volume2, VolumeX, Pause, Power, Filter, Lock,
  ShoppingBasket, Truck, Clock, PackageX, AlertTriangle,
  User, Phone, Mail, Tag, Check, Ban,
} from 'lucide-react'
import { Link } from '@/navigation'
import {
  Badge, Button, Card, Modal, EmptyState, ToastProvider, useToast,
} from '@/components/design-system'
import EstablishmentSwitcher, {
  type EstablishmentOption,
} from '@/components/dashboard/EstablishmentSwitcher'
import {
  KNOWN_STATUS, statusTone, useOrderAdvance, OrderStatusActions,
} from '@/components/orders/order-actions'

// ── Serializable view types (shared with the server page) ─────────────────────

export interface OrderItemView {
  name:      string
  qty:       number
  price:     number
  options:   {
    size?:        string
    supplements?: { name: string; price: number }[]
    exclusions?:  string[]
    note?:        string
  } | null
  brandName: string | null
  emoji:     string | null
}

export interface OrderView {
  id:              string
  status:          string
  fulfillmentType: string
  subtotal:        number
  deliveryFee:     number
  discount:        number
  total:           number
  referralCode:    string | null
  timeLabel:       string
  dateLabel:       string
  items:           OrderItemView[]
  itemsPreview:    string
  brandNames:      string[]
  customer:        { name: string; email: string; phone: string | null } | null
}

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
  initialOrderId?: string
}

const ACTIVE_STATUSES = new Set(['received', 'preparing', 'ready', 'picked_up'])
const STATUS_FLOW = ['received', 'preparing', 'ready', 'picked_up', 'delivered'] as const

// ── Root: own ToastProvider ───────────────────────────────────────────────────

export default function OrdersClient(props: OrdersClientProps) {
  return (
    <ToastProvider>
      <OrdersInner {...props} />
    </ToastProvider>
  )
}

function OrdersInner({ restaurant, establishments, orders, brands, menuItems, initialOrderId }: OrdersClientProps) {
  const t      = useTranslations('orders')
  const ts     = useTranslations('dashboard.home.liveOrders') // status / type / action labels
  const toast  = useToast()
  const router = useRouter()
  const { advance, pendingId } = useOrderAdvance()

  const [brandFilter,  setBrandFilter]  = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'live' | 'done'>('all')
  const [soundOn,      setSoundOn]       = useState(true)
  const [detailId,     setDetailId]      = useState<string | null>(initialOrderId ?? null)
  const [stockOpen,    setStockOpen]     = useState(false)
  const [isActive,     setIsActive]      = useState(restaurant.isActive)
  const [pausePending, setPausePending]  = useState(false)
  const [availability, setAvailability]  = useState<Record<string, boolean>>(
    () => Object.fromEntries(menuItems.map(m => [m.id, m.available])),
  )
  const [availPending, setAvailPending]  = useState<string | null>(null)

  const statusLabel = (s: string): string =>
    KNOWN_STATUS.has(s) ? ts(`status_${s}`) : ts('status_unknown')

  const activeCount = orders.filter(o => ACTIVE_STATUSES.has(o.status)).length

  const visible = orders.filter(o => {
    if (brandFilter !== 'all' && !o.brandNames.includes(brandFilter)) return false
    if (statusFilter === 'live' && !ACTIVE_STATUSES.has(o.status)) return false
    if (statusFilter === 'done' &&  ACTIVE_STATUSES.has(o.status)) return false
    return true
  })

  const detailOrder = detailId ? orders.find(o => o.id === detailId) ?? null : null

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
  return (
    <div className="mx-auto max-w-2xl px-5 pb-24 pt-4 md:max-w-3xl">
      {/* Header */}
      <div className="mb-1 flex items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-grubano-ink">
            {t('title')}
          </h1>
          <p className="mt-0.5 text-sm text-grubano-ink-muted">
            {t('subtitle', { count: activeCount })}
          </p>
        </div>
        {/* Switcher renders nothing at ≤1 establishment → mono header unchanged. */}
        <div className="flex flex-col items-end gap-2">
          <EstablishmentSwitcher establishments={establishments} currentId={restaurant.id} />
          {!isActive && (
            <Badge tone="danger" size="md" icon={<Pause size={11} />}>{t('pausedBadge')}</Badge>
          )}
        </div>
      </div>

      {/* Control buttons */}
      <div className="mb-4 mt-3 grid grid-cols-2 gap-2">
        <Button
          variant={soundOn ? 'secondary' : 'ghost'}
          size="md"
          fullWidth
          leftIcon={soundOn ? <Volume2 size={15} /> : <VolumeX size={15} />}
          onClick={() => setSoundOn(s => !s)}
        >
          {soundOn ? t('soundOn') : t('soundOff')}
        </Button>
        <Button
          variant={isActive ? 'danger' : 'primary'}
          size="md"
          fullWidth
          loading={pausePending}
          leftIcon={isActive ? <Pause size={15} /> : <Power size={15} />}
          onClick={togglePause}
        >
          {isActive ? t('pauseAll') : t('reactivate')}
        </Button>
      </div>

      {/* Paused banner */}
      {!isActive && (
        <Card elevation="sm" padding="md" className="mb-3 border border-grubano-danger/30 bg-grubano-danger-tint">
          <div className="flex items-start gap-3">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-grubano-lg bg-grubano-danger/15 text-grubano-danger">
              <Pause size={16} />
            </span>
            <div className="flex-1">
              <p className="text-sm font-bold text-grubano-ink">{t('pausedTitle')}</p>
              <p className="mt-0.5 text-xs text-grubano-ink-muted">{t('pausedDesc')}</p>
            </div>
            <Button variant="primary" size="sm" loading={pausePending} onClick={togglePause}>
              {t('reactivate')}
            </Button>
          </div>
        </Card>
      )}

      {/* Pro multi-platform placeholder (no real integration) */}
      <Link
        href="/premium"
        className="mb-3 flex items-center gap-3 rounded-grubano-xl border border-dashed border-grubano-primary/40 bg-grubano-tint/30 p-3"
      >
        <Lock size={14} className="text-grubano-primary" />
        <div className="flex-1">
          <p className="text-[11px] font-bold text-grubano-ink">{t('proBannerTitle')}</p>
          <p className="text-[10px] text-grubano-ink-muted">{t('proBannerDesc')}</p>
        </div>
        <span className="rounded-full bg-grubano-primary px-2 py-1 text-[10px] font-bold text-white">
          {t('proBadge')}
        </span>
      </Link>

      {/* Filters */}
      <div className="mb-3 flex items-center gap-2 overflow-x-auto pb-1">
        <Filter size={13} className="shrink-0 text-grubano-ink-muted" />
        <FilterChip active={brandFilter === 'all'} onClick={() => setBrandFilter('all')}>
          {t('filterAll')}
        </FilterChip>
        {brands.map(b => (
          <FilterChip key={b.name} active={brandFilter === b.name} onClick={() => setBrandFilter(b.name)}>
            <span className="mr-1">{b.emoji}</span>{b.name}
          </FilterChip>
        ))}
        <span className="mx-1 h-3 w-px shrink-0 bg-grubano-border" />
        {([['all', t('statusAll')], ['live', t('statusLive')], ['done', t('statusDone')]] as const).map(([k, l]) => (
          <FilterChip key={k} dark active={statusFilter === k} onClick={() => setStatusFilter(k)}>
            {l}
          </FilterChip>
        ))}
        <span className="mx-1 h-3 w-px shrink-0 bg-grubano-border" />
        <button
          onClick={() => setStockOpen(true)}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-grubano-border bg-grubano-surface px-2.5 py-1 text-[10px] font-semibold text-grubano-ink-muted hover:border-grubano-primary/40 hover:text-grubano-primary"
        >
          <PackageX size={11} /> {t('stockButton')}
        </button>
      </div>

      {/* Orders list */}
      {orders.length === 0 ? (
        <Card elevation="sm" padding="lg">
          <EmptyState emoji="🍽️" title={t('emptyTitle')} description={t('emptyDesc')} compact />
        </Card>
      ) : visible.length === 0 ? (
        <Card elevation="sm" padding="lg">
          <EmptyState emoji="🔎" title={t('emptyFilteredTitle')} description={t('emptyFilteredDesc')} compact />
        </Card>
      ) : (
        <div className="space-y-2">
          {visible.map(o => {
            const isPickup = o.fulfillmentType === 'pickup'
            const isNew    = o.status === 'received'
            return (
              <Card
                key={o.id}
                elevation="sm"
                padding="md"
                interactive
                onClick={() => setDetailId(o.id)}
                className={isNew ? 'border border-grubano-primary/40 bg-grubano-tint/15 ring-1 ring-grubano-primary/20' : ''}
              >
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-grubano-lg bg-grubano-surface-muted text-grubano-ink-muted">
                    {isPickup ? <ShoppingBasket size={16} /> : <Truck size={16} />}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {isNew && (
                        <span className="relative flex h-2 w-2" aria-hidden>
                          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-grubano-primary opacity-75" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-grubano-primary" />
                        </span>
                      )}
                      <span className="text-xs font-bold text-grubano-ink">
                        #{o.id.slice(-6).toUpperCase()}
                      </span>
                      <Badge tone={statusTone(o.status)} size="sm">{statusLabel(o.status)}</Badge>
                      <Badge tone="neutral" size="sm" icon={isPickup ? <ShoppingBasket size={10} /> : <Truck size={10} />}>
                        {isPickup ? ts('typePickup') : ts('typeDelivery')}
                      </Badge>
                    </div>
                    {o.brandNames.length > 0 && (
                      <p className="mt-1 truncate text-xs font-semibold text-grubano-ink">
                        {o.brandNames.join(' · ')}
                      </p>
                    )}
                    <p className="mt-0.5 truncate text-[11px] text-grubano-ink-muted">{o.itemsPreview}</p>
                  </div>

                  <div className="text-right">
                    <p className="text-sm font-bold text-grubano-ink">€{o.total.toFixed(2)}</p>
                    <p className="mt-0.5 flex items-center justify-end gap-0.5 text-[10px] text-grubano-ink-faint">
                      <Clock size={10} />
                      {o.timeLabel}
                    </p>
                  </div>
                </div>

                {/* Actions — stop propagation so they don't open the detail. */}
                <div onClick={e => e.stopPropagation()}>
                  <OrderStatusActions
                    order={o}
                    pendingId={pendingId}
                    advance={advance}
                    className="mt-3 flex flex-wrap items-center gap-2 border-t border-grubano-border pt-3"
                  />
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* Detail modal */}
      <Modal
        open={!!detailOrder}
        onClose={() => setDetailId(null)}
        size="lg"
        title={detailOrder ? t('detail.title', { ref: `#${detailOrder.id.slice(-6).toUpperCase()}` }) : ''}
        description={detailOrder ? `${detailOrder.dateLabel} · ${detailOrder.timeLabel}` : undefined}
        footer={
          detailOrder ? (
            <div className="flex w-full flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                leftIcon={<PackageX size={14} />}
                onClick={() => { setDetailId(null); setStockOpen(true) }}
              >
                {t('detail.markOutOfStock')}
              </Button>
              <div className="ml-auto" onClick={e => e.stopPropagation()}>
                <OrderStatusActions order={detailOrder} pendingId={pendingId} advance={advance} />
              </div>
            </div>
          ) : undefined
        }
      >
        {detailOrder && (
          <div className="space-y-4">
            {/* Status + type */}
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={statusTone(detailOrder.status)} size="md">{statusLabel(detailOrder.status)}</Badge>
              <Badge
                tone="neutral"
                size="md"
                icon={detailOrder.fulfillmentType === 'pickup' ? <ShoppingBasket size={11} /> : <Truck size={11} />}
              >
                {detailOrder.fulfillmentType === 'pickup' ? ts('typePickup') : ts('typeDelivery')}
              </Badge>
            </div>

            {/* Timeline */}
            <StatusTimeline status={detailOrder.status} statusLabel={statusLabel} cancelledLabel={t('detail.cancelled')} label={t('detail.timeline')} />

            {/* Customer */}
            <section>
              <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-grubano-ink-faint">
                {t('detail.customer')}
              </h3>
              {detailOrder.customer ? (
                <div className="space-y-1 rounded-grubano-lg bg-grubano-surface-muted p-3">
                  <p className="flex items-center gap-2 text-sm font-semibold text-grubano-ink">
                    <User size={13} className="text-grubano-ink-muted" />{detailOrder.customer.name}
                  </p>
                  <p className="flex items-center gap-2 text-xs text-grubano-ink-muted">
                    <Mail size={12} />{detailOrder.customer.email}
                  </p>
                  {detailOrder.customer.phone && (
                    <p className="flex items-center gap-2 text-xs text-grubano-ink-muted">
                      <Phone size={12} />{detailOrder.customer.phone}
                    </p>
                  )}
                </div>
              ) : (
                <p className="rounded-grubano-lg bg-grubano-surface-muted p-3 text-xs text-grubano-ink-muted">
                  {t('detail.noCustomer')}
                </p>
              )}
              {detailOrder.referralCode && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-grubano-ink-muted">
                  <Tag size={12} className="text-grubano-primary" />
                  {t('detail.referral')}: <span className="font-mono font-bold uppercase text-grubano-ink">{detailOrder.referralCode}</span>
                </p>
              )}
            </section>

            {/* Items */}
            <section>
              <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-grubano-ink-faint">
                {t('detail.items')}
              </h3>
              <ul className="space-y-2">
                {detailOrder.items.map((it, idx) => (
                  <li key={idx} className="rounded-grubano-lg border border-grubano-border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-grubano-ink">
                          <span className="text-grubano-ink-muted">{it.qty}× </span>
                          {it.emoji ? `${it.emoji} ` : ''}{it.name}
                        </p>
                        {it.brandName && (
                          <p className="mt-0.5 text-[10px] uppercase tracking-wide text-grubano-ink-faint">{it.brandName}</p>
                        )}
                        {it.options?.size && (
                          <p className="mt-1 text-xs text-grubano-ink-muted">
                            {t('detail.size')}: {it.options.size}
                          </p>
                        )}
                        {it.options?.supplements && it.options.supplements.length > 0 && (
                          <p className="mt-0.5 text-xs text-grubano-ink-muted">
                            {t('detail.supplements')}: {it.options.supplements.map(s => s.name).join(', ')}
                          </p>
                        )}
                        {it.options?.exclusions && it.options.exclusions.length > 0 && (
                          <p className="mt-0.5 text-xs text-grubano-danger">
                            {t('detail.exclusions')}: {it.options.exclusions.join(', ')}
                          </p>
                        )}
                        {it.options?.note && (
                          <p className="mt-0.5 text-xs italic text-grubano-ink-muted">
                            {t('detail.note')}: “{it.options.note}”
                          </p>
                        )}
                      </div>
                      <p className="shrink-0 text-sm font-bold text-grubano-ink">
                        €{(it.price * it.qty).toFixed(2)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {/* Totals */}
            <section className="space-y-1.5 rounded-grubano-lg bg-grubano-surface-muted p-3 text-sm">
              <div className="flex justify-between text-grubano-ink-muted">
                <span>{t('detail.subtotal')}</span><span>€{detailOrder.subtotal.toFixed(2)}</span>
              </div>
              {detailOrder.discount > 0 && (
                <div className="flex justify-between text-grubano-success">
                  <span>{t('detail.discount')}</span><span>−€{detailOrder.discount.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-grubano-ink-muted">
                <span>{t('detail.deliveryFee')}</span><span>€{detailOrder.deliveryFee.toFixed(2)}</span>
              </div>
              <div className="flex justify-between border-t border-grubano-border pt-1.5 text-base font-bold text-grubano-ink">
                <span>{t('detail.total')}</span><span>€{detailOrder.total.toFixed(2)}</span>
              </div>
            </section>
          </div>
        )}
      </Modal>

      {/* Stock-out modal */}
      <Modal
        open={stockOpen}
        onClose={() => setStockOpen(false)}
        size="lg"
        title={t('stock.title')}
        description={t('stock.desc')}
      >
        {menuItems.length === 0 ? (
          <EmptyState emoji="🍽️" title={t('stock.empty')} compact />
        ) : (
          <div className="space-y-2">
            {menuItems.map(m => {
              const isAvail = availability[m.id]
              const busy = availPending === m.id
              return (
                <div
                  key={m.id}
                  className="flex items-center gap-3 rounded-grubano-lg border border-grubano-border p-3"
                >
                  <span className="text-lg" aria-hidden>{m.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-grubano-ink">{m.name}</p>
                    <p className="text-[10px] uppercase tracking-wide text-grubano-ink-faint">{m.brandName}</p>
                  </div>
                  <Badge tone={isAvail ? 'success' : 'danger'} size="sm">
                    {isAvail ? t('stock.available') : t('stock.outOfStock')}
                  </Badge>
                  <Button
                    variant={isAvail ? 'ghost' : 'secondary'}
                    size="sm"
                    loading={busy}
                    leftIcon={isAvail ? <Ban size={13} /> : <Check size={13} />}
                    onClick={() => toggleAvailability(m)}
                  >
                    {isAvail ? t('stock.markOut') : t('stock.markBack')}
                  </Button>
                </div>
              )
            })}
            <p className="flex items-center gap-1.5 px-1 pt-1 text-[10px] text-grubano-ink-faint">
              <AlertTriangle size={11} /> {t('stock.todoNote')}
            </p>
          </div>
        )}
      </Modal>
    </div>
  )
}

// ── Small presentational helpers ──────────────────────────────────────────────

function FilterChip({
  active, dark, onClick, children,
}: {
  active: boolean
  dark?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  const base = 'shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors'
  const on   = dark ? 'bg-grubano-dark text-white' : 'bg-grubano-primary text-white'
  const off  = 'border border-grubano-border bg-grubano-surface text-grubano-ink-muted hover:text-grubano-ink'
  return (
    <button onClick={onClick} className={`${base} ${active ? on : off}`}>
      {children}
    </button>
  )
}

function StatusTimeline({
  status, statusLabel, cancelledLabel, label,
}: {
  status: string
  statusLabel: (s: string) => string
  cancelledLabel: string
  label: string
}) {
  if (status === 'cancelled') {
    return (
      <section>
        <h3 className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-grubano-ink-faint">{label}</h3>
        <div className="flex items-center gap-2 rounded-grubano-lg bg-grubano-danger-tint p-3 text-sm font-semibold text-grubano-danger">
          <Ban size={14} /> {cancelledLabel}
        </div>
      </section>
    )
  }
  const currentIdx = STATUS_FLOW.indexOf(status as (typeof STATUS_FLOW)[number])
  return (
    <section>
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-wider text-grubano-ink-faint">{label}</h3>
      <ol className="flex items-center">
        {STATUS_FLOW.map((step, i) => {
          const done    = currentIdx >= 0 && i <= currentIdx
          const current = i === currentIdx
          return (
            <li key={step} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center">
                <span
                  className={
                    'grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold ' +
                    (done ? 'bg-grubano-primary text-white' : 'bg-grubano-surface-muted text-grubano-ink-faint') +
                    (current ? ' ring-2 ring-grubano-primary/30' : '')
                  }
                >
                  {done ? <Check size={12} /> : i + 1}
                </span>
                <span className={'mt-1 max-w-[56px] text-center text-[9px] leading-tight ' + (done ? 'font-semibold text-grubano-ink' : 'text-grubano-ink-faint')}>
                  {statusLabel(step)}
                </span>
              </div>
              {i < STATUS_FLOW.length - 1 && (
                <span className={'mx-1 h-0.5 flex-1 rounded ' + (i < currentIdx ? 'bg-grubano-primary' : 'bg-grubano-border')} />
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
