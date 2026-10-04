'use client'

import { useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useTranslations, useLocale } from 'next-intl'
import { Link, useRouter } from '@/navigation'
import { writeCart, sessionCartStamp, currentCartStamp, type EatCartLineItem } from '@/lib/eat-cart'
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
  // D′ L9 (T-45) — kinds 'delivery' | 'pickup' only (additive; the API never sets
  // these on a dine-in or a reservation card). This is the MINIMAL list shape: the
  // money PROVEN returned, plus the server's verdict on whether that confirmed
  // figure covers the whole charge. No pending figure and no history, ON PURPOSE —
  // a card is not the place to explain a refund, so a refund still in flight gets
  // NO badge here rather than a badge the list has no figure to justify. Only a
  // TERMINAL order can carry them, and the API files every terminal order under
  // `past` → the badge lives in PastCard alone; CurrentCard stays untouched.
  refundedCents?: number
  /** Confirmed refunded money we cannot attribute to a row of ours. See refundBadge below. */
  unattributedCents?: number
  isTotal?: boolean
  isPartial?: boolean
}

/** Stable identity for the fail-closed empty lists: a fresh [] per render would churn the
 *  search memos below. Frozen, because it is shared by every gated render. */
const NO_CARDS: Card[] = Object.freeze([]) as unknown as Card[]

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
  const { data: session, status } = useSession()
  const t = useTranslations('eat.orders')
  const locale = useLocale()
  const router = useRouter()

  // The order list carries the identity it was FETCHED under: « Recommander » writes a
  // basket, and a card left on screen from the previous account must not be able to.
  const [data, setData] = useState<{ stamp: string | null; current: Card[]; past: Card[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'current' | 'past'>('current')
  const [query, setQuery] = useState('')
  // V5-1 — bumped after a successful reservation cancel so the list refetches.
  const [reloadTick, setReloadTick] = useState(0)

  // ── THE LIVE IDENTITY ──────────────────────────────────────────────────────────
  // Read once, used for the fetch, for the gate and for the dependency array, so the three
  // cannot disagree with one another.
  const liveUserId = (session?.user as { id?: string } | undefined)?.id
  const liveStamp = sessionCartStamp(status, liveUserId)

  useEffect(() => {
    if (status !== 'authenticated') return
    let alive = true
    // Captured BEFORE the request, so the list is labelled with the identity it was asked
    // for — not with whatever the session has become by the time it resolves.
    const ownStamp = sessionCartStamp(status, liveUserId)
    setLoading(true)
    fetch('/api/eat/orders')
      .then((r) => (r.ok ? r.json() : { current: [], past: [] }))
      .then((d) => { if (alive) setData({ stamp: ownStamp, current: d.current ?? [], past: d.past ?? [] }) })
      .catch(() => { if (alive) setData({ stamp: ownStamp, current: [], past: [] }) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
    // liveUserId IS A DEPENDENCY, and that is the fix for the refetch half of this defect.
    // `status` alone cannot see A -> logout -> B login: it ends where it started, at
    // 'authenticated', so no new request was guaranteed and `data` kept holding A's cards.
    // Keying on the identity also makes `alive` load-bearing rather than decorative: React
    // runs this cleanup when the id changes, so a request issued for A is disowned before
    // it can resolve, whichever order the two responses arrive in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, liveUserId, reloadTick])

  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(locale === 'ar' ? 'ar-MA' : locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso))

  // ── OWNERSHIP, EVALUATED DURING RENDER ─────────────────────────────────────────
  // The stamp the list was LOADED under against the stamp the LIVE session implies. It has
  // to be a render-time derivation: an effect runs after the frame that has already painted
  // the previous account's cards, so nothing an effect does can un-show them.
  // Fail closed on every uncertainty — `liveStamp` is null while the session resolves and
  // null for an authenticated session with no usable id — and there is no orders list for a
  // guest, so 'guest' can never match either.
  const ordersOwned = liveStamp !== null && liveStamp !== 'guest' && data?.stamp === liveStamp
  /** The ONLY shape the rest of this component may read. */
  const visibleData = ordersOwned ? data : null
  /** …and the only two lists. Every card, counter, filter and empty/list decision below is
   *  derived from these, never from `data`, which may belong to someone else. */
  const safeCurrent = visibleData?.current ?? NO_CARDS
  const safePast = visibleData?.past ?? NO_CARDS

  const current = useMemo(() => {
    const q = query.trim().toLowerCase()
    return safeCurrent.filter((c) => c.restaurantName.toLowerCase().includes(q))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeCurrent, query])
  const past = useMemo(() => {
    const q = query.trim().toLowerCase()
    return safePast.filter((c) => c.restaurantName.toLowerCase().includes(q))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safePast, query])

  async function reorder(c: Card) {
    // FAIL CLOSED: a past order loaded under another identity may not seed this basket.
    // A stale card no longer renders at all, so no handler for one should exist — but a
    // handler captured in the frame before the change would still be callable, and the
    // write must refuse then too.
    if (!ordersOwned || !visibleData) return
    const loadedFor = visibleData.stamp // the identity this history belongs to
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
      // RE-CHECK AFTER THE AWAIT. The guard above ran before the network round trip; if the
      // identity changed during it, writeCart() would put this history into the NEW owner's
      // bucket. Compare what the history belongs to with the owner the cache now serves.
      if (currentCartStamp() !== loadedFor) return
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
  // FIRST FRAME, FAIL CLOSED. « Aucune commande » is a statement about THIS account, so it
  // may only be made once a response stamped for this account has actually arrived. Until
  // then — session resolving, request in flight, nothing loaded yet, or a list belonging to
  // another identity — the existing skeleton stands: we do not know whether B has orders.
  const showLoading = status === 'loading' || loading || !ordersOwned
  const isEmpty = !showLoading && activeCards.length === 0
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

  // ── D′ L9 (T-45) — le badge de remboursement ────────────────────────────────
  // « Remboursée » states money that CAME BACK, so the sentence is spoken from
  // `refundedCents` ALONE (settled Refund rows carrying a Stripe re_ id) and only
  // above zero: never from a refund in flight — the list deliberately carries no
  // pending figure, so there is nothing here to announce — and never on a zero.
  // `isTotal` / `isPartial` are the SERVER's verdict on that same confirmed figure;
  // we never re-derive them from `c.total`, which is the charge, not the refund.
  // Food cards only, matching the API. Both flags false above zero is unreachable
  // by the server's own derivation (isPartial = confirmed > 0 && !isTotal), and if
  // it ever happened silence is the right default: a missing badge is silence,
  // a badge we cannot qualify would be a claim about money.
  const refundBadge = (c: Card): string | null => {
    if (c.kind !== 'delivery' && c.kind !== 'pickup') return null
    const cents = c.refundedCents ?? 0
    const other = c.unattributedCents ?? 0
    if (cents <= 0 && other <= 0) return null
    // WHEN PART OF THE CONFIRMED REFUND CANNOT BE ATTRIBUTED, THIS CARD STATES NO FIGURE.
    // `refundedCents` is deliberately rows-only (the frozen §4 contract), so on an order refunded by two
    // rails — say 10,00 € through the claim engine and the remaining 4,10 € from the Stripe Dashboard, which
    // writes a ledger line and no row — it holds 10,00 € of a 14,10 € refund. Printing it would understate
    // the refund by 4,10 € on a card too small to explain why, so the card says « un remboursement a été
    // enregistré » and the tracking page, which has room, states the parts. The neutral wording is also
    // what §6 requires of that money: never a cause, never a totality.
    if (other > 0) return t('refundedRecordedBadge')
    const amount = formatEuros(cents / 100, locale)
    return c.isTotal ? t('refundedBadge', { amount }) : c.isPartial ? t('refundedPartialBadge', { amount }) : null
  }

  // Same pill family as the terminal badge (`.final`), with the foundation's
  // --gb-warning pair: `final--done` / `final--res` are both the basil green and
  // would read as a SECOND success next to « Livrée », while `final--warn`'s red
  // would read as a failure. Money coming back is neither — it is a fact to notice.
  const RefundBadge = ({ c }: { c: Card }) => {
    const label = refundBadge(c)
    if (!label) return null
    return (
      <span className="final" style={{ color: 'var(--gb-warning)', background: 'var(--gb-warning-bg)' }}>
        <span className="ms" style={{ fontSize: 13 }} aria-hidden="true">undo</span>{label}
      </span>
    )
  }

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
        {/* D′ L9 (T-45) — composition of the two facts: the fulfilment word STAYS
            (« Livrée » remains true about the food, and a money event does not undo
            it) and the refund pill qualifies it immediately beside it, stacked, so a
            refunded order is never read as a bare « Livrée · 14,50 € ». We do not
            overwrite the fulfilment badge with the money badge — that would trade one
            silence for another. The wrapper is unconditional: with no refund it
            renders the single pill exactly as before (a content-width column,
            vertically centred like the flex item it replaces) and it is left
            shrinkable so a narrow card shares the row instead of squeezing the name. */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center', gap: 5 }}>
          <span className="final final--done"><span className="ms" style={{ fontSize: 13 }} aria-hidden="true">check_circle</span>{finalLabel(c)}</span>
          <RefundBadge c={c} />
        </div>
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
        {/* The counters are the account's totals, so they stay unfiltered by the search —
            but they come from the GATED lists: a count is data too, and « 7 » tells B how
            many orders A has. */}
        <button role="tab" aria-selected={tab === 'current'} onClick={() => setTab('current')}>{t('tabCurrent')} <span className="count">{safeCurrent.length}</span></button>
        <button role="tab" aria-selected={tab === 'past'} onClick={() => setTab('past')}>{t('tabPast')} <span className="count">{safePast.length}</span></button>
      </div>

      {/* Revue V5 — the food cards keep their OWN thumb index (fIdx counts food
          cards only): inserting reservation cards must not reshuffle the
          existing food thumbnails. */}
      <div className="list tab-current">
        {showLoading ? [0, 1, 2].map((i) => <div key={i} className="o-skel" />) : (() => {
          let fIdx = 0
          return current.map((c, i) =>
            c.kind === 'reservation'
              ? <ReservationCard key={c.id} c={c} i={i} onCancelled={() => setReloadTick((n) => n + 1)} />
              : <CurrentCard key={c.id} c={c} i={fIdx++} />)
        })()}
      </div>
      <div className="list tab-past">
        {showLoading ? [0, 1].map((i) => <div key={i} className="o-skel" />) : (() => {
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
