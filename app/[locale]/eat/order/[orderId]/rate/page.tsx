'use client'
import { orderRef } from '@/lib/order-ref'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useRouter } from '@/navigation'
import { emptyScoped, loadOwnedOrder, orderScopeStamp, scopePending, scopedValue, type Scoped } from '@/lib/eat-order-scope'
import { useTranslations, useLocale } from 'next-intl'
import { formatEuros } from '@/lib/format-money'
import './post-delivery.css'
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'

/* ─────────────────────────────────────────────────────────────────────────────
 * /eat/order/[orderId]/rate — « Après livraison » (note + pourboire + écran Merci)
 * VERBATIM re-skin of the FROZEN CD ref (Notion 38efd2c9-…-81e5, eat/post-delivery.html).
 * Material Symbols (NOT lucide), gb-foundation tokens, page CSS scoped `.gb-postdelivery`.
 * Shown AFTER an order is delivered (linked from /eat/track or /eat/orders). The flow has
 * its OWN .pd-bar (close / skip) → IMMERSIVE in EatShell (see report: /eat/order must be
 * added to the EatShell IMMERSIVE list so the shell drops its top bar / mobile chrome).
 *
 * REAL DATA vs INERT (no fabrication — task rule):
 *  • HERO line = REAL order: restaurant name · ref (GR-XXXX) · total (GET /api/orders/[id]).
 *  • ⭐ ORDER RATING + quick tags → INERT. There is NO consumer review backend (confirmed:
 *    /eat/r/[id]/reviews has no write endpoint — the only `Review` is the B2B ServiceReview,
 *    operator-gated). Local state only; submit shows the « Merci » view WITHOUT a network
 *    write. Reported as a gap (a real review-creation mutation is a later brick).
 *  • 💶 POURBOIRE → READ-ONLY RECAP (P2-TIP). The courier tip is now CHARGED AT CHECKOUT
 *    (cart), so this page NO LONGER offers a tip selector (which would imply a 2nd charge).
 *    It reads order.tipCents and, when > 0, shows « pourboire ajouté · X € » — informational
 *    only, no money moves here. When 0 (or TIPS_ENABLED off), nothing tip-related shows.
 *  • COURIER card → NEUTRAL placeholder. The order API exposes NO real driver model (name/
 *    rating/vehicle); we do NOT fabricate a named courier (same stance as /eat/track). Generic
 *    « Votre livreur » + icon avatar; the courier-rating stars are inert too.
 *  • « Merci » / +points = REAL loyalty, NET OF THE REFUND (D′ L9 / T-45 — see below).
 *  • « Signaler un souci » → Aide flow (routes to /eat for now; no dedicated help route yet).
 *
 * D′ L9 (T-45) — WHY THIS SCREEN LIED ABOUT POINTS, and what now holds it to the truth.
 * `order.pointsEarned` is the PRE-REFUND column: it is written when the order is delivered and is
 * NEVER decremented (a schema fact — T-44 / L6.1 own the loyalty numbers, not this page). The
 * claw-back lives in `LoyaltyTransaction` rows instead, which this page never read. So a fully
 * refunded order congratulated the customer — « +14 points gagnés » — on points that had gone
 * straight back out, while the confirmation e-mail said the opposite. This screen now reads
 * `order.refundSummary` (additive, ALWAYS present on GET /api/orders/[id]) beside that column:
 *   • points are stated NET of `pointsReversed`, and at or below zero the line is not rendered
 *     at all — there is no truthful « gagnés » to show;
 *   • when the WHOLE charge came back (`isTotal`) ONE sober line states it. « Remboursée » is
 *     used only for money PROVEN returned (`refundedCents > 0`), never for a refund in flight,
 *     and NO bank delay and NO date is ever promised;
 *   • the rating flow itself is untouched — a customer may rate a refunded order, and taking the
 *     screen away would be a product decision nobody has taken.
 *
 * P1 SAME-TAB ACCOUNT SCOPE (hotfix/order-aux-account-scope, after PR #21 on /eat/track).
 * This screen had NO notion of identity: `fetchOrder` was keyed on `[orderId, router]`, the
 * order sat in plain state, and a 401 inside the handler pushed /eat/auth. On an A → B switch
 * inside the same mount (NextAuth broadcasts `setSession` without flipping `status`), B read
 * A's restaurant, ref, total, tip and refund figures; and a stale A-request answering 401 could
 * trampoline a signed-in B through the login page. Now:
 *   • the order is kept WITH the stamp of the (identity, orderId) PAIR it was read under
 *     (lib/eat-order-scope) and surfaced ONLY through a render-time match against the stamp the
 *     live session + route imply;
 *   • the effect is keyed on `[authStatus, userId, orderId]`, FAIL-CLOSES before any request,
 *     RESETS the rating draft (stars, tags, « Merci » view) with it, and adopts a body only when
 *     the server echoed `ownerId === userId`;
 *   • the ONLY /eat/auth redirect is taken off the LIVE session ('unauthenticated'), never off a
 *     response; 401/403/404 are a stamped EMPTY (« not found »).
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * D′ L9 (T-45) — the slice of the server's `refundSummary` read-model this screen consumes. Declared
 * LOCALLY rather than imported from lib/order-refund-summary: this is a `'use client'` page and that
 * module pulls the claim/refund server chain, which a client bundle must never resolve (the fix-server
 * precedent: a dead branch is still resolved by the bundler). The shape is additive and always present
 * on GET /api/orders/[id], but it is normalised defensively below anyway — a screen that decides whether
 * to congratulate someone must not depend on an optional chain reading `undefined` as « nothing to say ».
 */
interface RefundLite {
  /** Money PROVEN returned (settled Refund rows carrying a Stripe `re_`). 0 = nothing came back. */
  refundedCents: number
  /** The confirmed cumulative reaches the charge. */
  isTotal: boolean
  /** Loyalty points TAKEN BACK because of the refund (read from LoyaltyTransaction rows). */
  pointsReversed: number
}

/** The RAW API object GET /api/orders/[id] serves — only the fields this screen normalises. */
interface RawOrder {
  id: string
  status: string
  total?: unknown
  pointsEarned?: unknown
  tipCents?: unknown
  refundSummary?: { refundedCents?: unknown; isTotal?: unknown; pointsReversed?: unknown } | null
  restaurant?: { name?: string | null } | null
}

interface OrderLite {
  id: string
  status: string
  total: number
  pointsEarned: number
  // P2-TIP — the courier tip CHARGED AT CHECKOUT (cents). The tip is no longer
  // collected here; this page shows it as a READ-ONLY recap. 0 = no tip.
  tipCents: number
  // D′ L9 (T-45) — the refund truth that `pointsEarned` and `total` above cannot express.
  refundSummary: RefundLite
  restaurant: { name: string }
}

// CD quick-tags (order rating) — keys, rendered via t(`qtag_${k}`).
const QTAG_KEYS = ['delicious', 'wellPacked', 'hot', 'generous'] as const

export default function PostDeliveryScreen() {
  const t = useTranslations('eat.postDelivery')
  // D′ L9 (T-45, §15) — the refund sentences live in ONE shared namespace read by every consumer
  // surface that recaps an order (this screen, the pickup pass, the help page, the tracking page). A
  // per-screen copy of the same sentence is how two surfaces end up describing one order differently.
  const tRefund = useTranslations('eat.refund')
  const locale = useLocale()
  const { orderId } = useParams<{ orderId: string }>()
  const router = useRouter()
  const { data: session, status: authStatus } = useSession()
  // The raw next-auth id the request is issued UNDER — compared with the SERVER-echoed `ownerId`.
  const userId = (session?.user as { id?: string } | undefined)?.id
  // FIRST-FRAME GUARD — the PAIR stamp (identity, orderId) the live session + route imply,
  // derived during render so it moves in the same frame as the session (effects run after).
  const liveStamp = orderScopeStamp(authStatus, userId, orderId)

  // The order, kept WITH the stamp it was read under. Read ONLY through `scopedValue` below.
  const [orderState, setOrderState] = useState<Scoped<OrderLite>>(emptyScoped)

  // Local UI state (rating INERT — no review backend; see header). The tip is no
  // longer collected here (it is charged at checkout — P2-TIP), so there is no tip
  // input state: tipCents comes from the order as a read-only recap.
  // ORDER-BOUND: a draft rating belongs to the (identity, order) pair it was typed for, so
  // the scope effect below resets all three with the order.
  const [stars, setStars] = useState(4)
  const [tags, setTags] = useState<string[]>(['delicious', 'hot'])
  const [done, setDone] = useState(false)

  useEffect(() => {
    // FAIL CLOSED FIRST — the previous pair's order AND its rating draft leave the state
    // BEFORE any request. (On the very first run these are the initial values already.)
    setOrderState(emptyScoped())
    setStars(4)
    setTags(['delicious', 'hot'])
    setDone(false)
    if (authStatus === 'loading') return
    // UNAUTHENTICATED → /eat/auth, but ONLY off the LIVE session (the previous handler
    // redirected on a polled 401, which a stale A-request could fire under a signed-in B).
    if (authStatus === 'unauthenticated') { router.push('/eat/auth'); return }
    // Same pure derivation as `liveStamp`, from the effect's own deps (no closure over render).
    const requestStamp = orderScopeStamp(authStatus, userId, orderId)
    const requestUserId = userId
    if (requestStamp === null || !requestUserId) return
    let alive = true
    loadOwnedOrder<RawOrder>({ orderId, requestStamp, requestUserId, isAlive: () => alive })
      .then((r) => {
        if (!alive || !r) return
        const o = r.value
        // D′ L9 — normalised the same way as every other figure on this page: an absent or
        // non-numeric field becomes 0/false, i.e. « nothing to say », never a rendered guess.
        setOrderState({
          stamp: r.stamp,
          value: o === null ? null : {
            id: o.id,
            status: o.status,
            total: typeof o.total === 'number' ? o.total : 0,
            pointsEarned: typeof o.pointsEarned === 'number' ? o.pointsEarned : 0,
            tipCents: typeof o.tipCents === 'number' ? o.tipCents : 0,
            refundSummary: {
              refundedCents: typeof o.refundSummary?.refundedCents === 'number' ? o.refundSummary.refundedCents : 0,
              isTotal: o.refundSummary?.isTotal === true,
              pointsReversed: typeof o.refundSummary?.pointsReversed === 'number' ? o.refundSummary.pointsReversed : 0,
            },
            restaurant: { name: o.restaurant?.name ?? '' },
          },
        })
      })
    // `userId` AND `orderId` ARE DEPENDENCIES: `authStatus` alone cannot see A → B when the
    // broadcast moves the id without touching the status, and the same mount serving another
    // order's URL must re-fire too. Keying on them makes `alive` load-bearing: the cleanup
    // disowns an in-flight request issued for the previous pair before it can resolve.
    return () => { alive = false }
  }, /* rate-deps */ [authStatus, userId, orderId, router])

  // RENDER-TIME GATE — the order is visible only while its stamp matches the live pair.
  // `loading` / `notFound` are DERIVED from the same stamps: the frame right after an account
  // switch reads as loading, never as « not found », never as A's recap.
  const order = scopedValue(orderState, liveStamp)
  const loading = authStatus !== 'authenticated' || scopePending(orderState, liveStamp)
  const notFound = !loading && order === null

  function toggleTag(k: string) {
    setTags((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]))
  }

  // P2-TIP — the tip ALREADY charged at checkout (read-only recap, euros). > 0 → a
  // confirmation line shows; never editable here, no money moves on this page.
  const tipEur = (order?.tipCents ?? 0) / 100

  // D′ L9 (T-45) — THE POINTS THE CUSTOMER ACTUALLY KEPT, and the refund fact.
  // `pointsEarned` is the pre-refund column; `pointsReversed` is what the refund took back. The net is
  // the only figure this screen may show, and only while it is positive: at 0 (a full claw-back) there
  // is nothing gained, so nothing is rendered — that silence IS the fix for T-45, not a missing line.
  const pointsEarned = order?.pointsEarned ?? 0
  const pointsReversed = order?.refundSummary.pointsReversed ?? 0
  const netPoints = pointsEarned - pointsReversed
  // « Remboursée » is gated on money PROVEN returned (`refundedCents > 0`) AND on the confirmed
  // cumulative reaching the charge (`isTotal`). A refund in flight (`pendingCents`) is deliberately
  // NOT read here: this screen has one sober line to give and it must state a fact, not an expectation.
  const refundedCents = order?.refundSummary.refundedCents ?? 0
  const refundedTotal = refundedCents > 0 && order?.refundSummary.isTotal === true
  // The amount is isolated with <bdi> (the idiom this page already uses for numbers) so an Arabic RTL
  // paragraph cannot reorder « 14,50 € ». Cents ÷ 100 through the shared helper — never hand-formatted.
  const refundedLine = refundedTotal
    ? tRefund.rich('refundedTotal', {
        amount: formatEuros(refundedCents / 100, locale),
        amt: (c) => <bdi>{c}</bdi>,
      })
    : null

  // Submit = INERT. No review write, no tip charge — just reveal the « Merci » view.
  function submit() { setDone(true) }

  const shortRef = order ? orderRef(order.id) : ''

  // ── not found ────────────────────────────────────────────────────────────────
  if (notFound) {
    return (
      <div className="gb gb-postdelivery">
        <div className="pd-bar">
          <span className="ms ms-flip" role="button" tabIndex={0} onClick={() => router.push('/eat')} aria-label={t('close')}>arrow_back</span>
        </div>
        <div className="pd-body">
          <div className="dhero">
            <h1>{t('notFoundTitle')}</h1>
            <p>{t('notFoundBody')}</p>
          </div>
        </div>
      </div>
    )
  }

  // ── « Merci » view (after submit) ────────────────────────────────────────────
  if (done) {
    return (
      <div className="gb gb-postdelivery">
        <div className="pd-done">
          <div className="ic"><span className="ms" aria-hidden="true">favorite</span></div>
          <h2>{t('thanksTitle')}</h2>
          {/* tip confirmation only if the order carried a (checkout-charged) tip */}
          <p>{tipEur > 0 ? t('thanksTipBody', { amount: formatEuros(tipEur, locale) }) : t('thanksBody')}</p>
          {/* D′ L9 (T-45) — the WHOLE charge came back: one sober line, stated before any
              congratulation. No delay, no date, no author — just the fact. */}
          {refundedLine && <p style={{ marginTop: 0, color: 'var(--gb-text)', fontWeight: 600 }}>{refundedLine}</p>}
          {/* REAL loyalty points, NET of what the refund reversed (D′ L9). With no refund the net IS
              `pointsEarned` and the rendering is unchanged; with a partial one the net is stated as
              what was KEPT; with a full claw-back (net ≤ 0) no points line exists at all. */}
          {netPoints > 0 && (
            <span className="pts"><span className="ms" aria-hidden="true">redeem</span>
              {pointsReversed > 0
                ? t('pointsEarnedAfterRefund', { points: netPoints })
                : t('pointsEarned', { points: netPoints })}
            </span>
          )}
          <div className="acts">
            <button type="button" className="w" onClick={() => router.push(`/eat/track/${orderId}`)}>{t('viewReceipt')}</button>
            <button type="button" className="o" onClick={() => router.push('/eat')}>{t('reorder')}</button>
          </div>
        </div>
      </div>
    )
  }

  // ── rate + tip view ──────────────────────────────────────────────────────────
  // Hero meta = REAL resto · ref · total (skeletons while loading).
  const heroMeta = loading
    ? null
    : `${order?.restaurant.name ?? ''} · ${shortRef} · ${formatEuros(order?.total ?? 0, locale)}`

  // Submit label — the tip is charged at checkout, so the label is the plain submit
  // (no « +tip » charge implication). The recap line below shows the charged tip.
  const submitLabel = t('submit')

  return (
    <div className="gb gb-postdelivery">
      <div className="pd-bar">
        <span className="ms ms-flip" role="button" tabIndex={0} onClick={() => router.push('/eat')} aria-label={t('close')}>close</span>
        <button type="button" className="skip" onClick={() => router.push('/eat')}>{t('skip')}</button>
      </div>

      <div className="pd-body">
        {/* delivered hero — real order context */}
        <div className="dhero">
          <div className="ic"><span className="ms" aria-hidden="true">check</span></div>
          <h1>{t('heroTitle')}</h1>
          {loading
            ? <p><span className="sk sk-line" style={{ width: 200, height: 12, margin: '6px auto 0' }} /></p>
            : <p><bdi>{heroMeta}</bdi></p>}
          {/* D′ L9 (T-45) — the hero meta above states the total CHARGED. On a fully refunded order
              that figure alone reads as money the customer still paid, so the fact is stated right
              under it: same sentence as every other surface, no delay and no date. */}
          {refundedLine && <p style={{ color: 'var(--gb-text)', fontWeight: 600 }}>{refundedLine}</p>}
        </div>

        {/* ⭐ order rating + quick tags — INERT (no review backend) */}
        <div className="pd-card">
          <div className="ttl">{t('rateOrderTitle')}</div>
          <div className="hint">{t('rateOrderHint')}</div>
          <div className="pd-stars" role="radiogroup" aria-label={t('rateOrderTitle')}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={`ms${n > stars ? ' off' : ''}`}
                onClick={() => setStars(n)}
                aria-label={t('starLabel', { n })}
                aria-pressed={n <= stars}
              >
                star
              </button>
            ))}
          </div>
          <div className="qtags">
            {QTAG_KEYS.map((k) => {
              const on = tags.includes(k)
              return (
                <button
                  key={k}
                  type="button"
                  className={`qtag${on ? ' on' : ''}`}
                  aria-pressed={on}
                  onClick={() => toggleTag(k)}
                >
                  {t(`qtag_${k}` as 'qtag_delicious')}
                </button>
              )
            })}
          </div>
        </div>

        {/* 💶 courier rating (NEUTRAL placeholder, inert) + tip RECAP (P2-TIP).
            The tip is charged at CHECKOUT now — no selector here. When the order
            carried a tip (tipEur > 0) we show a read-only « pourboire ajouté · X € »
            line; no money moves. When there is no tip, nothing tip-related shows. */}
        <div className="pd-card">
          <div className="courier">
            <span className="av" aria-hidden="true"><span className="ms" style={{ fontSize: 22, color: '#1E3E60' }}>sports_motorsports</span></span>
            <div className="m">
              <b>{t('courierName')}</b>
              <span>{t('courierRole')}</span>
            </div>
            <div className="pd-stars" role="radiogroup" aria-label={t('rateCourier')}>
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" className="ms" aria-label={t('courierStarLabel', { n })}>star</button>
              ))}
            </div>
          </div>
          {tipEur > 0 && (
            <div className="tip-recap">
              <span className="ms" aria-hidden="true">volunteer_activism</span>
              <span className="tip-recap__txt">{t('tipRecap', { amount: formatEuros(tipEur, locale) })}</span>
            </div>
          )}
        </div>

        {/* signaler un souci → Aide */}
        <button type="button" className="report" onClick={() => router.push('/eat')}>
          <span className="ms" aria-hidden="true">flag</span>{t('reportIssue')}
        </button>
      </div>

      {/* sticky footer — submit (INERT: no review write, no tip charge) */}
      <div className="pd-foot">
        <div className="inner">
          <button type="button" className="pd-submit" onClick={submit}>
            <span className="ms" aria-hidden="true">send</span>
            <b>{submitLabel}</b>
          </button>
        </div>
      </div>
    </div>
  )
}
