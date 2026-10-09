'use client'
import { orderRef } from '@/lib/order-ref'

import { useState, useEffect } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useSession } from 'next-auth/react'
import { formatEuros, formatMoney } from '@/lib/format-money'
import { useParams } from 'next/navigation'
import { useRouter } from '@/navigation'
import ClaimSection from '@/components/claims/ClaimSection'
import CourierMap from '@/components/CourierMap'
import { sessionCartStamp } from '@/lib/eat-cart'
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

// D′ L9 (T-45) — the shape of the ADDITIVE refund read-model served inside `order` by
// GET /api/orders/[id] (assembled by lib/order-refund-summary, derived, never persisted). Each
// figure carries a different level of proof, and the copy below is locked to it:
//   refundedCents      money PROVEN back — settled `Refund` rows carrying a Stripe `re_`;
//   pendingCents       a refund in flight — named at Stripe, NOT yet arrived;
//   unattributedCents  real Stripe money on this order whose internal origin is NOT certain;
//   chargeCents        the reference amount charged (the ledger payment line, else the order total);
//   pointsReversed /   what the loyalty LEDGER did — `Order.pointsEarned` is never decremented.
//   pointsRestored
// `source` is part of the payload and is deliberately NOT rendered: a consumer is never told who
// triggered a refund (§ the neutral-copy rule), so the page reads the amount and the date only.
interface ConsumerRefundLine {
  amountCents: number
  at: string
  source: 'claim' | 'support' | 'system' | 'external'
}
interface RefundSummary {
  refundedCents: number
  pendingCents: number
  unattributedCents: number
  chargeCents: number
  isTotal: boolean
  isPartial: boolean
  refunds: ConsumerRefundLine[]
  pointsReversed: number
  pointsRestored: number
}

interface Order {
  id: string
  status: string
  // Served by GET /api/orders/[id] — LOT 4 : drives the honest « expirée mais
  // payée » message (a payment can land AFTER expiry: 'paid'/'reconcile_manual').
  paymentStatus?: string | null
  fulfillmentType?: 'delivery' | 'pickup' | string
  subtotal?: number
  deliveryFee?: number
  total: number
  estimatedTime: number
  items: OrderItem[]
  restaurant: { name: string; address: string; city?: string; logo?: string; pickupPrepTime?: number | null; deliveryPrepTime?: number | null }
  // PRE-REFUND COLUMN — never decremented when money goes back (schema fact, T-44 / L6.1 own the
  // loyalty numbers). Nothing on this page may state it without reading `refundSummary` beside it.
  pointsEarned: number
  // ADDITIVE (D′ L9 / T-45). The route ALWAYS sends it, all-zero when there is nothing to say
  // (§10: one stable shape, never undefined per path) — so it is declared OPTIONAL only to survive
  // the deploy window in which a browser still holds the previous bundle and an older payload: a
  // missing field must degrade to « rien à dire », never white-screen a customer's order.
  refundSummary?: RefundSummary
  createdAt: string
  deliveryAddress: string
}

// Géoloc ÉTAPE 4 — the courier's (coarsened, for the client) live position for this order. Fed by
// GET /api/orders/[id]/courier-position (owner-scoped, flag-gated). available:false / a 404 (flag
// OFF) → the inert placeholder map stays (byte-identical). The point is ALREADY coarsened server-
// side — the client never receives the exact courier coordinates.
interface CourierPos {
  available: boolean
  approx?: boolean
  courier?: { lat: number; lng: number }
  pickup?: { lat: number; lng: number } | null
  dropoff?: { lat: number; lng: number } | null
  etaMinutes?: number | null
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
  const { data: session, status } = useSession()
  // The identity, reused — same shape as EatShell / rewards / account
  // (lib/eat-cart.sessionCartStamp). `userId` is the raw next-auth id used to compare
  // the SERVER-echoed `ownerId` against the one the request was issued UNDER.
  const userId = (session?.user as { id?: string } | undefined)?.id

  // Order + courier are stored WITH the stamp of the identity they were read under. The
  // page used to keep them in plain state and poll on an effect keyed on `[orderId]`, so
  // an A → B cross-tab switch — NextAuth broadcasts `setSession` without flipping through
  // `unauthenticated` — left A's order (refund block included) and A's courier map painted
  // on B's screen until the poll came round, and even then only until the next poll could
  // fail silently. The stamp lets a render-time match drop a stale body in the frame it
  // reappeared under.
  const [orderState, setOrderState] = useState<{ stamp: string | null; order: Order | null }>(
    { stamp: null, order: null },
  )
  const [courierState, setCourierState] = useState<{ stamp: string | null; pos: CourierPos | null }>(
    { stamp: null, pos: null },
  )
  const [loading, setLoading] = useState(true)

  // FIRST-FRAME GUARD — the stamp the SESSION implies, available in the SAME render as
  // the new session. The effect below declares the identity, and effects run AFTER the
  // render that introduced a new session: a switch inside the SPA re-renders with B's
  // session while `orderState` still holds A's values. Comparing the stamp the value was
  // read under with the stamp the SESSION implies right now closes that one frame.
  const sessionStamp = sessionCartStamp(status, userId)
  // Route-specific render guard: the same person navigating from order X to Y must
  // never see X's address, refund or courier position in Y's first committed frame.
  // JSON.stringify is unambiguous even when an order id contains delimiters.
  const trackStamp = sessionStamp !== null && typeof orderId === 'string' && orderId.length > 0
    ? JSON.stringify([sessionStamp, orderId]) : null

  // Order + courier polling, keyed on IDENTITY and `orderId` (not merely `[orderId]`):
  // `status` stays 'authenticated' across A → B so a dep of `[orderId]` would never re-fire
  // on identity change. FAIL-CLOSED FIRST: the previous owner's values leave the screen
  // BEFORE any request. `requestOwner` + `requestUserId` are captured together so the
  // response is refused unless the server echoed the SAME RAW ID (closes the window where
  // React still believes A but the browser cookie is already B). `alive` closes the opposite
  // window — React moved on, but a late response from the previous identity is still inbound.
  // 401/403/404 FAIL CLOSED without a redirect: a redirect fired from a stale identity would
  // trampoline a signed-in B user through /eat/auth on A's defunct poll.
  useEffect(() => {
    setOrderState({ stamp: null, order: null })
    setCourierState({ stamp: null, pos: null })
    if (status === 'loading') return
    // UNAUTHENTICATED → go to /eat/auth, but ONLY off the live session (never off a polled
    // 401 from a stale A-identity whose cookie now authenticates as B — a redirect there
    // would trampoline a signed-in B through the login page on A's defunct in-flight call).
    // Tracking deep-links from post-payment land here too: an actually-signed-out visitor
    // reaches /eat/auth, authenticates, and bounces back to the track URL.
    if (status === 'unauthenticated') { setLoading(false); router.push('/eat/auth'); return }
    if (!userId) { setLoading(false); return }
    const requestOwner = trackStamp
    const requestUserId = userId
    if (requestOwner === null) { setLoading(false); return }
    setLoading(true)
    let alive = true

    const fetchOrder = async () => {
      try {
        const res = await fetch(`/api/orders/${orderId}`)
        if (!alive) return
        // 401/403/404 — fail closed without a redirect: a stale A-identity poll must NOT
        // trampoline a now-signed-in B through /eat/auth. The « not found » state renders
        // from `orderState.order === null`, which is already the resting shape.
        if (!res.ok) return
        const data = (await res.json()) as { ownerId?: unknown; order?: Order }
        if (!alive) return
        // NEVER STAMP A BODY THE SERVER DID NOT ATTRIBUTE TO THE SAME RAW ID. The `typeof`
        // half matters: a response that OMITS the field (older server, cache, proxy) must
        // not slip through on `undefined === undefined`. A mismatch is a FAILED load — the
        // state stays unstamped, so the chrome renders the neutral "not found" view.
        if (typeof data?.ownerId !== 'string' || data.ownerId !== requestUserId) return
        if (!data.order) return
        setOrderState({ stamp: requestOwner, order: data.order })
      } catch {
        /* keep neutral — stamp stays null */
      } finally {
        if (alive) setLoading(false)
      }
    }

    // Géoloc ÉTAPE 4 — poll the owner-scoped courier position (coarsened). A 404 (flag OFF),
    // 403, or {available:false} → no live map → the inert placeholder stays (byte-identical
    // when OFF). Same identity contract as the order fetch above: the body is adopted only
    // under the stamp of the identity the request was issued FOR, and only when the server
    // echoed the SAME raw id. The feature-OFF `{ available:false, gated:true }` response
    // carries no owner-specific data, so a missing `ownerId` on it is NOT grounds to retain
    // a previous owner's position — this handler clears `courierState` on any non-adoptable
    // body, which keeps the OFF-path visibly identical to a fresh guest tab.
    const fetchCourierPos = async () => {
      try {
        const res = await fetch(`/api/orders/${orderId}/courier-position`, { cache: 'no-store' })
        if (!alive) return
        if (!res.ok) { setCourierState({ stamp: requestOwner, pos: null }); return }
        const data = (await res.json()) as (CourierPos & { ownerId?: unknown }) | null
        if (!alive) return
        if (!data || data.available !== true) {
          setCourierState({ stamp: requestOwner, pos: null }); return
        }
        if (typeof data.ownerId !== 'string' || data.ownerId !== requestUserId) {
          setCourierState({ stamp: requestOwner, pos: null }); return
        }
        setCourierState({ stamp: requestOwner, pos: data })
      } catch {
        if (alive) setCourierState({ stamp: requestOwner, pos: null })
      }
    }

    fetchOrder(); fetchCourierPos()
    const poll = setInterval(() => { fetchOrder(); fetchCourierPos() }, 15_000)
    return () => { alive = false; clearInterval(poll) }
    // `userId` AND `orderId` ARE DEPENDENCIES: `status` alone cannot see A → logout → B when
    // the broadcast moves the id without touching `status`, and switching to another order's
    // URL on the same mount must also re-fire. Keying on them also makes `alive` load-bearing
    // — React runs the cleanup on identity or route change, so an in-flight request issued
    // for A is disowned before it can resolve. `sessionStamp` is derived from `status` +
    // `userId` already in deps, so pinning the two primitives keeps it current without an
    // extra dep that would re-fire on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, /* track-deps */ [status, userId, orderId])

  // RENDER-TIME GATE — a value is shown only when its stamp matches the identity the
  // SESSION implies right now, which changes in the same render as the session. On an
  // A → B switch inside this component, this is what prevents one committed frame of A's
  // order (and refund block, and address) painting under B — and the same for the courier
  // map, which is a RGPD-sensitive datum.
  const orderStampOk = orderState.stamp !== null && orderState.stamp === trackStamp
  const order = orderStampOk ? orderState.order : null
  const courierStampOk = courierState.stamp !== null && courierState.stamp === trackStamp
  const courierPos = courierStampOk ? courierState.pos : null

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

  // ── D′ L9 (T-45) — WHAT A REFUND DID TO THIS ORDER ───────────────────────────
  // This page asserted the opposite of the truth in two places, and both are now stated from
  // `refundSummary` and from nothing else:
  //   (1) the recap presented « Total payé » as money the customer still paid. It is the amount
  //       CHARGED — which stays true — so the line is KEPT and qualified, never rewritten;
  //   (2) « +{points} points fidélité crédités » was rendered from `order.pointsEarned`, the
  //       pre-refund column. Measured with the repository's canonical figures (a 14,10 € order
  //       earning 14 points, refunded in full) the loyalty ledger writes an `earn_reversal` of −14
  //       and the customer's balance drops by 14 — while this line still read « +14 crédités ».
  //       Only the NET the customer still HAS may be celebrated.
  // The words are locked to the level of proof behind each figure:
  //   • « remboursé » is spoken for `refundedCents` ONLY — a settled row carrying a Stripe `re_`.
  //     Never for a pending row, never on zero;
  //   • `pendingCents` is « en cours »: in flight, not arrived, and no wording may imply otherwise;
  //   • `unattributedCents` is real Stripe money whose internal origin is NOT certain (the
  //     read-model reads no metadata by design), so its sentence is NEUTRAL — no origin, no
  //     réclamation, no total/partial, no commission;
  //   • no bank delay and no estimated date anywhere: this page can know neither, and a promise it
  //     cannot keep is the very defect this lot exists to remove.
  // Read defensively (see the interface): a missing field degrades to « nothing to say ».
  const rs = order.refundSummary
  const refundedCents      = Math.max(0, Math.floor(rs?.refundedCents ?? 0))
  const refundPendingCents = Math.max(0, Math.floor(rs?.pendingCents ?? 0))
  const refundOtherCents   = Math.max(0, Math.floor(rs?.unattributedCents ?? 0))
  const pointsReversed     = Math.max(0, Math.floor(rs?.pointsReversed ?? 0))
  const pointsRestored     = Math.max(0, Math.floor(rs?.pointsRestored ?? 0))
  // Confirmed lines, priced ones only — a 0-cent line has nothing to state. The server sorts them
  // newest-first; that order is kept verbatim so the 15 s poll re-renders an IDENTICAL block.
  const refundLines = (rs?.refunds ?? []).filter((r) => r.amountCents > 0)
  const refundLinesSum = refundLines.reduce((s, r) => s + r.amountCents, 0)
  // Per-line list rather than one summary sentence: a customer refunded twice is owed both dates,
  // and the list is short by construction. The « Total remboursé » line is added ONLY when the
  // per-line figures do not already state the whole confirmed sum on their own (two lines, or a
  // line the server could not price) — so the block can never show less than what came back.
  const showRefundedTotal = refundedCents > 0
    && (refundLines.length !== 1 || refundLinesSum !== refundedCents)
  // « en totalité » is the CONFIRMED cumulative reaching the charge — `isTotal` is computed from
  // settled rows alone, so a pending refund that would complete the total never says it did.
  const refundedInFull = rs?.isTotal === true && refundedCents > 0
  // The points the customer KEPT: the pre-refund earning minus what the ledger took back.
  const pointsKept = Math.max(0, order.pointsEarned - pointsReversed)
  const pointsAllReversed = pointsReversed > 0 && pointsKept === 0
  const showRefundBlock = refundedCents > 0 || refundPendingCents > 0 || refundOtherCents > 0
  // IS THE REFUND ESTABLISHED, or merely in flight? The loyalty ledger is driven by Stripe's succeeded set
  // and our own Refund row is not, so the two can legitimately disagree for a window — and when the row is
  // still pending while the points are already clawed back, a sentence ending « après le remboursement »
  // asserts an accomplished past event the proof does not support. Found by the adversarial review of L9:
  // it slipped through because §5's banned words (« remboursé », « effectué ») do not appear in it.
  //
  // D′ L10 — THE GATE WAS A TAUTOLOGY AT TWO OF ITS THREE USE SITES, which is why the fix it shipped never
  // fired. It counted the LOYALTY facts as evidence (`|| pointsAllReversed || pointsRestored > 0`), and two of
  // the three sites are inside `pointsAllReversed && (…)` and `pointsRestored > 0 && (…)` — so the disjunct
  // was always already true there and the false branch was unreachable.
  //
  // THE THIRD SITE (the « points conservés » box) was NOT a tautology and its behaviour DOES change, so it is
  // stated rather than glossed: that box requires `pointsKept > 0`, which makes `pointsAllReversed` false, so
  // the old formula reduced there to `money || pointsRestored > 0`. A restoration alone could therefore make
  // it say « … après le remboursement » with no refund proven — the SAME category error, one step smaller.
  // It now needs the money too, and a test pins all three sites. Found by this lot's adversarial review, which
  // also caught that the first version of this comment claimed two sites.
  // Measured consequence in the exact state the gate exists for
  // (points fully clawed back while our row is still `pending` with a `re_`): the screen rendered
  // « … repris APRÈS LE REMBOURSEMENT » three rows below « Remboursement en cours », and the two
  // `*PendingNote` strings were dead in all five locales. A clawback is a CONSEQUENCE of a refund, never its
  // proof; the proof is the money. So the gate now asks the money and nothing else.
  const refundEstablished = refundedCents > 0 || refundOtherCents > 0

  // No date helper exists on this page (the recap has never carried one). A refund line needs a day
  // and it is the locale-aware built-in, never a hand-built string. `ar` resolves to `ar-MA` — the
  // same tag lib/format-money uses — so a refund's date and its amount agree on one locale.
  const refundDay = (iso: string): string | null => {
    try {
      const d = new Date(iso)
      if (Number.isNaN(d.getTime())) return null
      return d.toLocaleDateString(locale === 'ar' ? 'ar-MA' : locale, {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    } catch {
      return null
    }
  }

  // ── Awaiting-payment / expired — dedicated states (kept, re-skinned) ─────────
  if (order.status === 'awaiting_payment' || order.status === 'expired') {
    const awaiting = order.status === 'awaiting_payment'
    // LOT 4 — a payment can land AFTER expiry (webhook race / manual reconcile).
    // « Rien n'a été débité » would then be FALSE → honest dedicated message.
    //
    // D′ L9 (T-45) — THE MONEY IS THE TEST, NOT A `paymentStatus` SENTINEL, and this cost a measured false
    // statement before it was fixed. The ghost-order auto-refund writes `paymentStatus: 'refunded'` (the one
    // place in the repository that writes it), which matched NEITHER value below — so the screen rendered
    // « Rien n'a été débité » directly above « 14,50 € vous ont été remboursés », in all five locales, on
    // the single order Grubano refunds by itself. Enumerating sentinels is how that happens twice, so the
    // condition now asks the refund read-model whether money moved: if any refund figure is non-zero then a
    // payment was taken, whatever the column says.
    const refundKnownCents = refundedCents + refundPendingCents + refundOtherCents
    const expiredButPaid = !awaiting
      && (order.paymentStatus === 'paid' || order.paymentStatus === 'reconcile_manual'
        || order.paymentStatus === 'refunded' || refundKnownCents > 0)
    // …and once the refund has SETTLED, « notre équipe vous recontacte pour le régulariser » is stale rather
    // than false: there is nothing left to regularise. A third state says what actually happened.
    const expiredAndRefunded = !awaiting && refundedCents > 0
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
            <p>{awaiting ? t('awaitingDesc') : expiredAndRefunded ? t('expiredRefundedDesc') : expiredButPaid ? t('expiredPaidDesc') : t('expiredDesc')}</p>
            {/* D′ L9 (T-45) — an EXPIRED order is the one Grubano refunds by itself (the abandoned
                checkout « ghost order »), and this screen returns BEFORE the recap: without these
                lines the single most likely refunded order is also the one that says nothing about
                the money coming back. Same proof levels and same words as the recap block below —
                « remboursé » for settled money only, « en cours » for a refund in flight, and the
                neutral sentence when a real Stripe refund's internal origin cannot be proven. No
                delay and no arrival date here either. */}
            {refundedCents > 0 && (
              <p>{t.rich('refundedNote', {
                amount: formatMoney(refundedCents, locale), m: (chunks) => <bdi>{chunks}</bdi>,
              })}</p>
            )}
            {refundPendingCents > 0 && (
              <p>{t.rich('refundPendingNote', {
                amount: formatMoney(refundPendingCents, locale), m: (chunks) => <bdi>{chunks}</bdi>,
              })}</p>
            )}
            {refundOtherCents > 0 && (
              <p>{t.rich('refundRecorded', {
                amount: formatMoney(refundOtherCents, locale), m: (chunks) => <bdi>{chunks}</bdi>,
              })}</p>
            )}
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

  // Short order ref. LOT VÉRACITÉ (2026-09-01) : l'« heure d'arrivée estimée »
  // (createdAt + estimatedTime, où estimatedTime = Restaurant.deliveryTime qu'aucune
  // UI ne saisit — défaut 30) est RETIRÉE : aucun moteur ne calcule d'heure, et le
  // libellé « arrivée » sortait tel quel sur des RETRAITS (prouvé en répétition).
  // Seule durée exposée : la préparation saisie par le restaurateur, pendant la
  // préparation uniquement.
  const shortRef = orderRef(order.id)
  const prepMins = (() => {
    const v = Number(isPickup ? order.restaurant?.pickupPrepTime : order.restaurant?.deliveryPrepTime)
    return Number.isFinite(v) && v > 0 ? Math.round(v) : null
  })()
  const preparing = order.status === 'received' || order.status === 'preparing'

  // CD's 5 steps, label + sub-line keys + dot icon. `picked_up` for a pickup order
  // means "récupérée par le client" (terminal) — but the CD 5-step delivery journey is
  // the frozen design; we render it for both and only swap a couple of labels.
  const stepLabelKey = isPickup
    ? ['stepConfirmed', 'stepPreparing', 'stepReadyPickup', 'stepEnRoutePickup', 'stepCollected']
    : ['stepConfirmed', 'stepPreparing', 'stepPickedUp', 'stepEnRoute', 'stepDelivered']

  const statusBadgeKey: Record<string, string> = {
    received: 'statusReceived', preparing: 'statusPreparing', ready: 'statusReady',
    // P0-19 — a pickup order that reaches 'delivered' was COLLECTED, never « Livrée ».
    picked_up: isPickup ? 'statusCollected' : 'statusPickedUp',
    delivered: isPickup ? 'statusCollected' : 'statusDelivered',
    cancelled: 'statusCancelled',
  }

  const restoLine = [order.restaurant.name].filter(Boolean).join('')
  const itemsCount = order.items.reduce((n, it) => n + it.qty, 0)
  const modeLabel = isPickup ? t('pickupMode') : t('modeDelivery')

  // Recap fee lines — VÉRACITÉ : seul le frais réellement stocké (Order.deliveryFee)
  // porte le libellé « frais » ; l'écart résiduel du total (frais petite commande,
  // pourboire — non détaillés sur la ligne Order) est nommé pour ce qu'il est,
  // jamais déguisé en « Frais de service ».
  const itemsSubtotal = order.items.reduce((s, it) => s + it.price * it.qty, 0)
  const feeAmount = typeof order.deliveryFee === 'number' ? order.deliveryFee : 0
  const otherAmount = Math.max(0, Math.round((order.total - itemsSubtotal - feeAmount) * 100) / 100)

  // ── The CD vertical stepper (5 steps), real status drives done/cur/todo ──────
  const Stepper = (
    <div className="steps">
      {stepLabelKey.map((labelKey, i) => {
        const done = !isCancelled && i < currentStep
        const cur = !isCancelled && i === currentStep && !isDelivered
        const allDone = !isCancelled && isDelivered
        const klass = allDone || done ? 'done' : cur ? 'cur' : 'todo'
        // sub-line: real time on the active step; em-dash otherwise
        const sub = klass === 'cur' ? t('inProgress') : ''
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

      {/* Points earned (real loyalty data) on completion. D′ L9 (T-45) — this celebratory box may
          only state what the customer still HAS: `order.pointsEarned` is the pre-refund column and
          the loyalty ledger can have clawed all of it back. So the net comes FIRST, and when the
          take-back swallows the whole earning the box does not render at all — no « +N crédités »
          line, and the claw-back is stated in the refund block below, where the styling does not
          congratulate a customer for points they no longer have. */}
      {isDelivered && order.pointsEarned > 0 && pointsKept > 0 && (
        <div className="earned">
          <span className="ms">redeem</span>
          <div>
            <b>{t('enjoy')}</b>
            <span>
              {pointsReversed === 0
                ? t('pointsCredited', { points: order.pointsEarned })
                : refundEstablished
                  ? t('pointsKeptAfterRefund', { kept: pointsKept, reversed: pointsReversed })
                  : t('pointsKeptPending', { kept: pointsKept, reversed: pointsReversed })}
            </span>
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
        {otherAmount > 0.009 && (
          <div className="row">
            <span>{t('otherCharges')}</span>
            <b>{formatEuros(otherAmount, locale)}</b>
          </div>
        )}
        <div className="row tot">
          <span>{t('totalPaid')}</span>
          <b>{formatEuros(order.total, locale)}</b>
        </div>
        {/* D′ L9 (T-45) — the refund truth, appended to the recap and never replacing it: the total
            above is what was CHARGED, which remains true whatever came back afterwards. Every line
            here is gated on « > 0 », so an order with nothing to say renders byte-identically to
            before. Amounts come from the summary in CENTS → formatMoney; <bdi> isolates them so an
            RTL locale cannot swap a symbol onto the wrong side of the figure. */}
        {showRefundBlock && (
          <>
            <div className="lab" style={{ marginTop: 16 }}>{t('refundLabel')}</div>
            {/* CONFIRMED — money whose Stripe refund is settled. The only lines allowed the word
                « remboursé », and each one carries the day the money actually left. */}
            {refundLines.map((line, i) => {
              const day = refundDay(line.at)
              return (
                <div className="row" key={`${line.at}-${i}`}>
                  <span>{day ? t('refundedOn', { date: day }) : t('refundedLabel')}</span>
                  <b><bdi>{formatMoney(line.amountCents, locale)}</bdi></b>
                </div>
              )
            })}
            {showRefundedTotal && (
              <div className="row">
                <span>{t('refundedTotal')}</span>
                <b><bdi>{formatMoney(refundedCents, locale)}</bdi></b>
              </div>
            )}
            {/* IN FLIGHT — named at Stripe, not arrived. « en cours », and the key it reads cannot
                contain « remboursé » (see the copy contract): nothing here may imply it landed. */}
            {refundPendingCents > 0 && (
              <div className="row">
                <span>{t('refundInProgress')}</span>
                <b><bdi>{formatMoney(refundPendingCents, locale)}</bdi></b>
              </div>
            )}
            {/* ORIGIN NOT CERTAIN — real Stripe money on this order that no internal row claims.
                Neutral sentence only: it names no origin, no réclamation, no total/partial and no
                commission, because the read-model genuinely cannot prove any of them. */}
            {refundOtherCents > 0 && (
              <div className="row">
                <span>
                  {t.rich('refundRecorded', {
                    amount: formatMoney(refundOtherCents, locale),
                    m: (chunks) => <bdi>{chunks}</bdi>,
                  })}
                </span>
              </div>
            )}
            {/* The qualifier the « Total payé » line needs once everything came back — the charge is
                still shown, and this says what happened to it. No delay, no date of arrival. */}
            {refundedInFull && (
              <div className="row"><span>{t('refundedInFullNote')}</span></div>
            )}
            {/* The loyalty take-back, stated where it is a consequence of the refund rather than in
                the celebratory box. Net first: « aucun point conservé », then what was taken. */}
            {pointsAllReversed && (
              <div className="row"><span>{refundEstablished
                ? t('pointsAllReversedNote', { reversed: pointsReversed })
                : t('pointsAllReversedPendingNote', { reversed: pointsReversed })}</span></div>
            )}
            {pointsRestored > 0 && (
              <div className="row"><span>{refundEstablished
                ? t('pointsRestoredNote', { points: pointsRestored })
                : t('pointsRestoredPendingNote', { points: pointsRestored })}</span></div>
            )}
          </>
        )}
        {/* WAVE 1 — pass de retrait réel (QR scannable + adresse + itinéraire), câblé au
            parcours pickup : jusqu'ici l'écran existait mais aucun lien n'y menait. */}
        {isPickup && !isCancelled && order.status !== 'awaiting_payment' && (
          <button className="help" onClick={() => router.push(`/eat/order/${order.id}/pickup`)}>
            <span className="ms">qr_code_2</span>{t('viewPickupPass')}
          </button>
        )}
        {/* LOT 4 — routes to the REAL per-order help screen (was a dead push to /eat). */}
        <button className="help" onClick={() => router.push(`/eat/order/${order.id}/help`)}>
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
        {isDelivered ? (
          <>
            <small>{t('arrived')}</small>
            <b>{'✓'}</b>
          </>
        ) : preparing && prepMins != null ? (
          <>
            <small>{t('prepLabel')}</small>
            <b><bdi>{t('prepMinsValue', { mins: prepMins })}</bdi></b>
          </>
        ) : null}
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

  // ── Live map (Géoloc ÉTAPE 4) — REAL self-hosted map of the courier's COARSENED position, fed
  // by the owner-scoped endpoint. Shown only while the courier is in course (the endpoint returns
  // available:true then). When the flag is OFF / no position → LiveMap is null → the inert Map
  // placeholder above renders (byte-identical). Never the exact courier point — coarsened server-side.
  const LiveMap = courierPos?.available && courierPos.courier ? (
    <div className="map map--live">
      <CourierMap
        courier={courierPos.courier}
        pickup={courierPos.pickup ?? null}
        dropoff={courierPos.dropoff ?? null}
        etaText={courierPos.etaMinutes ? t('etaMinutes', { min: courierPos.etaMinutes }) : null}
        approxText={courierPos.approx ? t('approxPosition') : null}
      />
    </div>
  ) : null

  return (
    <div className="gb gb-track" data-theme="light">
      {LiveMap ?? Map}
      {Panel}
    </div>
  )
}
