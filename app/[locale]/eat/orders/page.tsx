'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useTranslations, useLocale } from 'next-intl'
import { Link, useRouter } from '@/navigation'
import { writeCart, type EatCartLineItem } from '@/lib/eat-cart'
import { formatEuros } from '@/lib/format-money'
import './orders.css'
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'

// /eat/orders — « Mes commandes ». Verbatim reproduction of the FROZEN CD ref
// (Notion 38efd2c9-…-8155), bound READ-ONLY to real data via GET /api/eat/orders
// (merges delivery/pickup Orders + dine-in TableTickets). Top-level nav tab → no
// back arrow. Dine-in « Voir l'addition & payer » routes to the EXISTING /t/[tableId]
// bill+pay page (money byte-identical — no new payment code here).

type Kind = 'delivery' | 'pickup' | 'dinein' | 'reservation'
interface Card {
  id: string
  kind: Kind
  phase: 'current' | 'past'
  restaurantName: string
  itemsCount: number
  total: number
  status: string
  createdAt: string
  ref: string
  restaurantId?: string
  eta?: number
  trackingId?: string
  tableLabel?: string
  tableId?: string
  // V5-1 — kind 'reservation' only (additive; food cards untouched). The hold
  // display is driven by depositStatus + depositAmount, NEVER noShowPenalty
  // (the API never selects it — founder decision).
  date?: string
  endTime?: string
  guests?: number
  depositAmount?: number
  depositStatus?: string
  cancellable?: boolean
}

const TYPE_ICON: Record<Kind, string> = { delivery: 'two_wheeler', pickup: 'storefront', dinein: 'table_restaurant', reservation: 'event' }
const THUMBS = ['t1', 't2', 't3', 't4']

// ── V5-1 — reservation card (both tabs). TOP-LEVEL component (revue V5: defined
// inside the parent, its identity changed at every parent render → React
// remounted it and the confirming/err state died on each keystroke in the
// search box). Reuses the o-card markup family; the food CurrentCard/PastCard
// render paths are untouched. The deposit line is the WHOLE point: amount +
// REAL hold state, driven by depositStatus/depositAmount (never noShowPenalty —
// the API doesn't send it). The 'authorized' wording is STATUS-AWARE (revue V5
// BLOQUANT: « libérée à votre arrivée » was false once arrived — doctrine: the
// hold stays active until the bill is settled — and false on a cancelled row
// whose release failed → « libération en cours »). Cancel = the EXISTING route
// POST /api/reservations/[id]/cancel, guards untouched: a 409 surfaces the
// server's French message as-is (project rule: UI-facing server errors are
// French; signalé pour le lot i18n).
function ReservationCard({ c, i, onCancelled }: { c: Card; i: number; onCancelled: () => void }) {
  const t = useTranslations('eat.orders')
  const locale = useLocale()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  // A reservation is a moment (with its year — revue V5: past cards from a
  // previous year were ambiguous next to year-stamped food cards).
  const fmtDateTime = (iso: string) =>
    new Intl.DateTimeFormat(locale === 'ar' ? 'ar-MA' : locale, {
      day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso))

  const hasDeposit = typeof c.depositAmount === 'number' && c.depositAmount > 0 && c.depositStatus !== 'none'
  const amount = formatEuros(c.depositAmount ?? 0, locale)
  const depositLine =
    !hasDeposit ? null
      : c.depositStatus === 'authorized'
        ? (c.status === 'arrived' || c.status === 'overrun') ? t('resDepositAuthorizedArrived', { amount })
          : c.status === 'confirmed' && c.phase === 'current' ? t('resDepositAuthorized', { amount })
            : t('resDepositAuthorizedPending', { amount })
        : c.depositStatus === 'released' ? (c.status === 'noshow' ? t('resNoShowReleased', { amount }) : t('resDepositReleased', { amount }))
          : c.depositStatus === 'captured' ? t('resDepositCaptured', { amount })
            : null
  const stateLabel =
    c.status === 'cancelled' ? t('resCancelled')
      : c.status === 'noshow' ? t('resNoShow')
        : c.phase === 'current' ? (c.status === 'confirmed' ? t('resUpcoming') : t('resUnderway'))
          : t('resPast')
  // Revue V5 — tone: never the green success pill for cancelled/noshow.
  const stateTone =
    c.status === 'cancelled' || c.status === 'noshow' ? 'final--warn'
      : c.phase === 'past' ? 'final--done' : 'final--res'

  async function cancel() {
    if (busy) return
    setBusy(true)
    setErr('')
    try {
      const r = await fetch(`/api/reservations/${c.id}/cancel`, { method: 'POST' })
      if (r.ok) { onCancelled(); return }
      const d = await r.json().catch(() => null)
      setErr(typeof d?.error === 'string' ? d.error : t('resCancelError'))
    } catch {
      setErr(t('resCancelError'))
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <article className="o-card">
      <div className="o-card__top">
        <div className={`thumb ${THUMBS[i % 4]}`} />
        <div className="o-card__id">
          <div className="o-card__name">{c.restaurantName}
            <span className="type type--reservation"><span className="ms" style={{ fontSize: 13 }} aria-hidden="true">{TYPE_ICON.reservation}</span>{t('type_reservation')}</span>
          </div>
          <div className="o-card__meta">{c.date ? fmtDateTime(c.date) : '—'} · {t('resGuests', { count: c.guests ?? 1 })}</div>
        </div>
        <span className={`final ${stateTone}`}>{stateLabel}</span>
      </div>
      {depositLine && (
        <div className={`res-deposit${c.depositStatus === 'captured' ? ' captured' : ''}`}>
          <span className="ms" aria-hidden="true">{c.depositStatus === 'authorized' ? 'credit_card' : 'check_circle'}</span>
          <span>{depositLine}</span>
        </div>
      )}
      {err && <div className="res-cancel-err" role="alert">{err}</div>}
      {c.cancellable && (
        <div className="past-foot">
          {!confirming ? (
            <button className="btn-sm btn-sm--line" type="button" onClick={() => setConfirming(true)}>
              <span className="ms" aria-hidden="true">event_busy</span>{t('resCancel')}
            </button>
          ) : (
            <>
              <button className="btn-sm btn-sm--solid" type="button" disabled={busy} onClick={cancel}>
                {busy ? t('resCancelBusy') : t('resCancelConfirm')}
              </button>
              <button className="btn-sm btn-sm--line" type="button" disabled={busy} onClick={() => setConfirming(false)}>
                {t('resCancelKeep')}
              </button>
            </>
          )}
        </div>
      )}
    </article>
  )
}

export default function OrdersPage() {
  const { status } = useSession()
  const t = useTranslations('eat.orders')
  const locale = useLocale()
  const router = useRouter()

  const [data, setData] = useState<{ current: Card[]; past: Card[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'current' | 'past'>('current')
  const [query, setQuery] = useState('')
  // V5-1 — bumped after a successful reservation cancel so the list refetches.
  const [reloadTick, setReloadTick] = useState(0)

  useEffect(() => {
    if (status !== 'authenticated') return
    let alive = true
    setLoading(true)
    fetch('/api/eat/orders')
      .then((r) => (r.ok ? r.json() : { current: [], past: [] }))
      .then((d) => { if (alive) setData({ current: d.current ?? [], past: d.past ?? [] }) })
      .catch(() => { if (alive) setData({ current: [], past: [] }) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [status, reloadTick])

  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(locale === 'ar' ? 'ar-MA' : locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso))

  const current = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data?.current ?? []).filter((c) => c.restaurantName.toLowerCase().includes(q))
  }, [data, query])
  const past = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data?.past ?? []).filter((c) => c.restaurantName.toLowerCase().includes(q))
  }, [data, query])

  async function reorder(c: Card) {
    if (c.kind === 'dinein' || !c.trackingId) { if (c.restaurantId) router.push(`/eat/r/${c.restaurantId}`); return }
    try {
      const r = await fetch(`/api/orders/${c.trackingId}`)
      if (!r.ok) { if (c.restaurantId) router.push(`/eat/r/${c.restaurantId}`); return }
      // GET /api/orders/[id] wraps its payload as { order: {...} } (same as /eat/track).
      const o = (await r.json())?.order
      const items: EatCartLineItem[] = (o?.items ?? []).map((it: { itemId: string; name: string; price: number; qty: number; options?: unknown }) => ({
        item: { id: it.itemId, name: it.name, price: it.price, photos: [] },
        qty: it.qty,
        options: it.options as EatCartLineItem['options'],
      }))
      if (!o || !items.length) { if (c.restaurantId) router.push(`/eat/r/${c.restaurantId}`); return }
      writeCart({
        restaurantId: o.restaurant?.id ?? c.restaurantId ?? '',
        items,
        restaurant: { name: o.restaurant?.name ?? c.restaurantName, deliveryFee: o.deliveryFee ?? o.restaurant?.deliveryFee ?? 0, minOrder: o.restaurant?.minOrder ?? 0 },
      })
      router.push('/eat/cart')
    } catch { if (c.restaurantId) router.push(`/eat/r/${c.restaurantId}`) }
  }

  // ── Not signed in → invite to sign in (orders need a session) ──────────────
  if (status === 'unauthenticated') {
    return (
      <div className="gb gb-orders">
        <div className="orders__head"><h1 className="orders__title">{t('title')}</h1></div>
        <div className="empty" style={{ display: 'flex' }}>
          <div className="empty__ico"><span className="ms" aria-hidden="true">receipt_long</span></div>
          <h2>{t('signInTitle')}</h2>
          <p>{t('signInBody')}</p>
          <button className="act" type="button" onClick={() => router.push('/eat/auth')}><span className="ms" aria-hidden="true">login</span>{t('signInCta')}</button>
        </div>
      </div>
    )
  }

  const activeCards = tab === 'current' ? current : past
  const isEmpty = !loading && activeCards.length === 0
  const state = isEmpty ? 'empty' : 'list'

  // ── stepper (4 steps) mapping — verbatim CD step states per type+status ─────
  const stepLabels = (kind: Kind): string[] =>
    kind === 'delivery' ? [t('stepConfirmed'), t('stepPreparing'), t('stepEnRoute'), t('stepDelivered')]
      : kind === 'pickup' ? [t('stepConfirmed'), t('stepPreparing'), t('stepReady'), t('stepPickedUp')]
        : [t('stepTabOpen'), t('stepSentKitchen'), t('stepServed'), t('stepPaid')]
  const curIdx = (status: string) => (status === 'received' ? 0 : status === 'preparing' ? 1 : 2)

  const Stepper = ({ c }: { c: Card }) => {
    const idx = c.kind === 'dinein' ? 2 : curIdx(c.status)
    const green = c.kind !== 'delivery'
    const labels = stepLabels(c.kind)
    return (
      <>
        <div className="stepwrap">
          <div className="steps">
            {[0, 1, 2, 3].map((i) => {
              const dotCls = i < idx ? 'done' : i === idx ? (green ? 'cur green' : 'cur') : ''
              const seg = i < 3
              const segCls = i < idx - 1 ? 'done' : i === idx - 1 ? (green ? 'done' : 'cur') : ''
              return (
                <span key={i} style={{ display: 'contents' }}>
                  <span className={`dot ${dotCls}`.trim()}>{i < idx && <span className="ms" aria-hidden="true">check</span>}</span>
                  {seg && <span className={`seg ${segCls}`.trim()} />}
                </span>
              )
            })}
          </div>
        </div>
        <div className="steplabels">
          {labels.map((l, i) => (
            <span key={i} className={i === idx ? (green ? 'on green' : 'on') : undefined}>{l}</span>
          ))}
        </div>
      </>
    )
  }

  const CurrentCard = ({ c, i }: { c: Card; i: number }) => (
    <article className="o-card">
      <div className="o-card__top">
        <div className={`thumb ${THUMBS[i % 4]}`} />
        <div className="o-card__id">
          <div className="o-card__name">{c.restaurantName}
            <span className={`type type--${c.kind}`}><span className="ms" style={{ fontSize: 13 }} aria-hidden="true">{TYPE_ICON[c.kind]}</span>{t(`type_${c.kind}`)}</span>
          </div>
          <div className="o-card__meta">{c.kind === 'dinein' && c.tableLabel ? `${c.tableLabel} · ${t('billOpen')}` : `${t('orderNo', { ref: c.ref })} · ${t('items', { count: c.itemsCount })}`}</div>
        </div>
      </div>
      <Stepper c={c} />
      {/* LOT VÉRACITÉ : la ligne « Arrivée estimée ~N min » (Order.estimatedTime =
          deliveryTime jamais saisi, repli 30 EN DUR) est retirée — aucun moteur ne
          calcule d'heure d'arrivée. Le stepper d'état au-dessus dit déjà le vrai. */}
      {c.kind === 'pickup' && (
        <div className="statusline"><span className="ms" style={{ color: 'var(--gb-pickup)' }} aria-hidden="true">qr_code_2</span>{t('pickupCode')} <span className="pickup-code" style={{ marginLeft: 4 }}>{c.ref}</span></div>
      )}
      {c.kind === 'dinein' && (
        <div className="dinein-note"><span className="ms" aria-hidden="true">info</span>{t('dineinNote')}</div>
      )}
      <div className="o-card__foot">
        <div className="total"><small>{c.kind === 'dinein' ? t('totalCurrent') : t('total')}</small><b>{formatEuros(c.total, locale)}</b></div>
        {c.kind === 'delivery' && <Link href={`/eat/track/${c.trackingId}`} className="act"><span className="ms" aria-hidden="true">location_on</span>{t('actTrack')}</Link>}
        {/* WAVE 1 — « voir le code » mène désormais au VRAI pass de retrait (QR + adresse
            + itinéraire), plus au simple suivi. */}
        {c.kind === 'pickup' && <Link href={`/eat/order/${c.trackingId}/pickup`} className="act act--line"><span className="ms" aria-hidden="true">qr_code_2</span>{t('actViewCode')}</Link>}
        {c.kind === 'dinein' && <Link href={`/t/${c.tableId}`} className="act act--green"><span className="ms" aria-hidden="true">receipt_long</span>{t('actPayBill')}</Link>}
      </div>
    </article>
  )

  const finalLabel = (c: Card) =>
    c.status === 'cancelled' ? t('finalCancelled') : c.kind === 'pickup' ? t('finalPickedUp') : c.kind === 'dinein' ? t('finalPaid') : t('finalDelivered')

  const PastCard = ({ c, i }: { c: Card; i: number }) => (
    <article className="o-card">
      <div className="o-card__top">
        <div className={`thumb ${THUMBS[i % 4]}`} />
        <div className="o-card__id">
          <div className="o-card__name">{c.restaurantName}
            <span className={`type type--${c.kind}`}><span className="ms" style={{ fontSize: 13 }} aria-hidden="true">{TYPE_ICON[c.kind]}</span>{t(`type_${c.kind}`)}</span>
          </div>
          <div className="o-card__meta">{fmtDate(c.createdAt)}{c.kind === 'dinein' && c.tableLabel ? ` · ${c.tableLabel}` : ` · ${t('items', { count: c.itemsCount })}`}</div>
        </div>
        <span className="final final--done"><span className="ms" style={{ fontSize: 13 }} aria-hidden="true">check_circle</span>{finalLabel(c)}</span>
      </div>
      <div className="statusline" style={{ justifyContent: 'space-between', paddingTop: 2 }}>
        <span className="total" style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}><small>{t('total')}</small><b style={{ fontSize: 16 }}>{formatEuros(c.total, locale)}</b></span>
      </div>
      <div className="past-foot">
        {/* Mission AU — le « Reçu » dine-in mène à la surface PRIVÉE de reçu
            (le serveur re-juge propriété AVANT statut ; jamais /t/[tableId],
            qui est publique et ne sert que les tickets ouverts). La branche
            delivery/pickup est STRICTEMENT inchangée. */}
        <Link href={c.kind === 'dinein' ? `/eat/receipt/${c.id}` : `/eat/track/${c.trackingId}`} className="btn-sm btn-sm--line"><span className="ms" aria-hidden="true">receipt_long</span>{t('receipt')}</Link>
        <button className="btn-sm btn-sm--solid" type="button" onClick={() => reorder(c)}><span className="ms" aria-hidden="true">refresh</span>{t('reorder')}</button>
      </div>
    </article>
  )

  return (
    <div className="gb gb-orders" data-tab={tab} data-state={state}>
      <div className="orders__head">
        <h1 className="orders__title">{t('title')}</h1>
        <div className="search"><span className="ms" aria-hidden="true">search</span>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('searchPlaceholder')} aria-label={t('searchPlaceholder')} />
        </div>
      </div>

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === 'current'} onClick={() => setTab('current')}>{t('tabCurrent')} <span className="count">{(data?.current ?? []).length}</span></button>
        <button role="tab" aria-selected={tab === 'past'} onClick={() => setTab('past')}>{t('tabPast')} <span className="count">{(data?.past ?? []).length}</span></button>
      </div>

      {/* Revue V5 — the food cards keep their OWN thumb index (fIdx counts food
          cards only): inserting reservation cards must not reshuffle the
          existing food thumbnails. */}
      <div className="list tab-current">
        {loading ? [0, 1, 2].map((i) => <div key={i} className="o-skel" />) : (() => {
          let fIdx = 0
          return current.map((c, i) =>
            c.kind === 'reservation'
              ? <ReservationCard key={c.id} c={c} i={i} onCancelled={() => setReloadTick((n) => n + 1)} />
              : <CurrentCard key={c.id} c={c} i={fIdx++} />)
        })()}
      </div>
      <div className="list tab-past">
        {loading ? [0, 1].map((i) => <div key={i} className="o-skel" />) : (() => {
          let fIdx = 0
          return past.map((c, i) =>
            c.kind === 'reservation'
              ? <ReservationCard key={c.id} c={c} i={i} onCancelled={() => setReloadTick((n) => n + 1)} />
              : <PastCard key={c.id} c={c} i={fIdx++} />)
        })()}
      </div>

      <div className="empty">
        <div className="empty__ico"><span className="ms" aria-hidden="true">receipt_long</span></div>
        <h2>{t('emptyTitle')}</h2>
        <p>{t('emptyBody')}</p>
        <Link href="/eat" className="act"><span className="ms" aria-hidden="true">restaurant</span>{t('emptyCta')}</Link>
      </div>
    </div>
  )
}
