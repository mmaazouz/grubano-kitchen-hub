'use client'
import { orderRef } from '@/lib/order-ref'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from '@/navigation'
import { formatEuros, formatAmount } from '@/lib/format-money'
import { emptyScoped, loadOwnedOrder, orderScopeStamp, scopePending, scopedValue, type Scoped } from '@/lib/eat-order-scope'
// D′ L10 (§2): the code→key map moved to a shared LEAF so this page and components/claims/ClaimSection
// cannot drift, and so an unmapped code degrades to a LOCALIZED generic instead of the server's French.
import { claimRefusalKey } from '@/lib/claim-refusal-labels'
import './help.css'
// gb-* design FOUNDATION (Agent 168) — tokens + Material `.ms` font. The page wraps in
// `.gb` so the foundation tokens/font resolve; all component CSS lives in help.css.
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'

// ── /eat/order/[orderId]/help — « Aide & problème de commande » ────────────────
//
// VERBATIM reproduction of the FROZEN CD ref (Notion 38efd2c9-…-81f5). Three views,
// client-toggled on ONE screen (the CD file ships A active + B/C in its project):
//   A « Aide »          : search + REAL order banner + 3 problem options + topics + contact
//   B « Remboursement » : REAL per-item list (checkboxes) + reason + photo + estimate
//   C « Support »       : chat bubbles + « IA bientôt » pill + composer
//
// REAL DATA (read-only): the order banner + the refund item list come from the REAL
// order via GET /api/orders/[orderId] (restaurant name, ref, items, prices, total,
// status). NO amount is fabricated — the refund estimate is the SUM of the selected
// REAL item prices.
//
// REFUND SUBMIT (B) — now wired to the REAL /api/claims (P2-CLAIMS), but ONLY when the
// feature is live. On entering the refund view (when authenticated) we GET
// /api/claims?orderId= which returns { enabled, eligibility }:
//  • enabled === false  → the claims SURFACE is closed (D′ L1: CLAIMS_SURFACE_ENABLED, or the legacy lease
//    when no product flag is set; the original « CLAIMS_ENABLED is OFF » of founder D4).
//    LOT D (P-2): the inert refund form is MASKED entirely — the view renders ONLY the
//    human-support panel (mailto:contact@grubano.com with the order number in the
//    subject). No inert items/textarea/photo/« bientôt » banner/dead submit is shown.
//  • enabled === true   → real flow. Eligibility (owner + paid + within window + no active
//    claim) drives the submit. If not eligible we surface the reason and disable submit;
//    if an existing claim exists we show its status. On submit we POST a real claim.
//    D′ L1: with the intake paused (CLAIMS_INTAKE_ENABLED off) the route overlays
//    { canClaim:false, reason:'intake_closed' } — the reason is shown, submit stays disabled.
//
// LOT 4 (closed beta — support honnête, plus de mise en scène) :
//  • The scripted chat (fake agent bubbles, « ● En ligne » badge, disabled composer)
//    and the fabricated « ~2 min » / « < 24 h » contact ETAs were REMOVED — no
//    support-chat backend exists. The « Support » view is now an honest e-mail
//    contact: mailto:contact@grubano.com (the product's ONLY real support channel,
//    same address as the dine-in receipt + PartnerShell).
//  • « Annuler la commande » was REMOVED — no cancel API exists.
//  • The refund estimate line only renders when claimsEnabled === true.
// STILL INERT (no live backend — see report):
//  • « Retard » routes to the EXISTING /eat/track.
//  • Help topics are inert placeholders (no help-article backend).
//  • The refund PHOTO button stays INERT — the photo is OPTIONAL per /api/claims; we do
//    NOT wire the moderated upload here (future nicety, noted in report).
//  • `reason` is fixed to 'missing_item' (this entry = « article manquant / erroné »); a
//    reason picker is a future nicety (the API accepts the full CLAIM_REASONS enum).
//
// P1 SAME-TAB ACCOUNT SCOPE (hotfix/order-aux-account-scope, after PR #21 on /eat/track).
// The order and the claim eligibility lived in plain state under effects keyed on
// `[authStatus, orderId]`. NextAuth broadcasts an A → B switch WITHOUT flipping `status`
// through 'unauthenticated', so neither effect re-fired and B inherited A's banner (restaurant,
// ref, items, total, refund figures) and A's claim scope (per-line unitCents, the existing
// claim id and its refusal code) — plus A's half-typed refund draft. Now:
//  • the order AND the claim gate/eligibility are kept WITH the stamp of the (identity,
//    orderId) PAIR they were read under (lib/eat-order-scope) and are surfaced ONLY through a
//    render-time match against the stamp the live session + route imply;
//  • the scope effect is keyed on `[authStatus, userId, orderId]`, FAIL-CLOSES before any
//    request, RESETS every order-bound draft (view, picked lines, description, submit
//    lifecycle) with it, and adopts the order only when the server echoed `ownerId === userId`;
//  • GET /api/claims carries no owner echo, so it is requested ONLY AFTER the order was adopted
//    under the same scope, stamped with that scope, and disowned with it;
//  • the claim POST captures the scope it was filed under: a response landing after the
//    identity or route moved on touches nothing (the server enforces ownership on the write).

interface OrderItem { name: string; qty: number; price: number }
/**
 * D′ L9 (T-45) — the slice of the server's `refundSummary` read-model this page consumes. Declared
 * LOCALLY, not imported from lib/order-refund-summary: this is a `'use client'` page and that module
 * pulls the refund/claim server chain, which a client bundle must never resolve. Optional because this
 * page types the RAW API object; every read below defaults to 0/false, i.e. « nothing to say ».
 */
interface RefundLite {
  /** Money PROVEN returned — settled Refund rows carrying a Stripe `re_`. The ONLY basis for « remboursé ». */
  refundedCents: number
  /** A refund in flight. NEVER worded « remboursé » — « en cours », and nothing else. */
  pendingCents: number
  /** Real Stripe money on this order with no certain internal origin → NEUTRAL copy only. */
  unattributedCents: number
  isTotal: boolean
  isPartial: boolean
}
interface Order {
  id: string
  status: string
  total: number
  items: OrderItem[]
  restaurant?: { name?: string } | null
  // P0-19 — served by GET /api/orders/[id]; drives pickup-aware status labels.
  fulfillmentType?: string
  // D′ L9 (T-45) — the refund truth that `status` and `total` above cannot express.
  refundSummary?: RefundLite
}

type View = 'help' | 'refund' | 'chat'

// Mirror of lib/claims.getClaimEligibility's return shape (the only fields the UI reads).
interface ClaimEligibility {
  canClaim: boolean
  // D' L6 (spec v2 §7.1): 'not_delivered' (E3) and 'no_refundable_amount' (E6) joined the server's union.
  // L7 (T-50): this union is the ELIGIBILITY codes — the ones GET /api/claims can answer about the order.
  // The POST answers those too, plus a second family about WHAT was claimed (items_required,
  // qty_over_purchased, …). Those never appear here because they are not properties of the order; they
  // arrive on the POST response and are rendered through the shared lib/claim-refusal-labels map.
  reason?: 'not_owner' | 'not_paid' | 'not_delivered' | 'window_expired' | 'active_claim' | 'no_refundable_amount' | 'intake_closed'
  /**
   * D′ L6: with `reason: 'active_claim'`, the id of the claim that HOLDS the key — which is not always
   * `existingClaim`, the NEWEST one. When they differ, the claim shown below is not the one that blocks.
   */
  blockingClaimId?: string
  maxRefundableCents: number
  /** T-59: true only when the ceiling was proven against live Stripe cash truth. */
  ceilingVerified?: boolean
  /**
   * T-86 — THE SERVER'S PRICE BASIS, per line, exactly as `publicClaimScope` publishes it.
   *
   * `Order.items[].price` is the MenuItem LIST price. When the order total is BELOW the sum of its
   * lines — a promotion, a bundle, points redeemed — lib/claim-scope scales every unit down to the
   * basis actually paid (`scale = paidBasis / grossLines`), and `resolveClaimAmount` prices the claim
   * from THOSE units. So the list price is not what the claim is worth, and this page must not add it
   * up. `components/claims/ClaimSection.tsx` already reads `unitCents`; this page did not, which is
   * how two consumer surfaces on the same order came to state two different requested amounts.
   *
   * Optional because the page types the RAW API object; absent ⇒ no figure is stated at all.
   */
  scope?: {
    lines?: Array<{ index: number; name: string; maxQty: number; unitCents: number; lineCents: number }>
  }
  windowHours: number
  existingClaim:
    | { id: string; status: string; canContest: boolean; restaurantResponseReason: string | null; arbitrationReason: string | null }
    | null
}

// Submit lifecycle for the REAL claim POST (flag ON). 'idle' before submit; 'sending'
// disables the button (no double-submit); 'done' shows the « réclamation envoyée » state;
// 'error' surfaces the API error string.
type SubmitState = 'idle' | 'sending' | 'done' | 'error'

// Short, human-friendly reference derived from the real id (matches /api/eat/orders).
const refOf = orderRef

export default function OrderHelpScreen() {
  const t = useTranslations('eat.help')
  // D′ L9 (T-45, §15) — the refund sentences live in ONE shared namespace read by every consumer
  // surface that recaps an order (this page, the post-delivery screen, the pickup pass, the tracking
  // page). A per-screen copy of the same sentence is how two surfaces describe one order differently.
  const tRefund = useTranslations('eat.refund')
  const locale = useLocale()
  const router = useRouter()
  const { orderId } = useParams<{ orderId: string }>()
  const { data: session, status: authStatus } = useSession()
  // The raw next-auth id the request is issued UNDER — compared with the SERVER-echoed `ownerId`.
  const userId = (session?.user as { id?: string } | undefined)?.id
  // FIRST-FRAME GUARD — the PAIR stamp (identity, orderId) the live session + route imply,
  // derived during render so it moves in the same frame as the session (effects run after).
  const liveStamp = orderScopeStamp(authStatus, userId, orderId)

  // The order, kept WITH the stamp it was read under. Read ONLY through `scopedValue` below.
  const [orderState, setOrderState] = useState<Scoped<Order>>(emptyScoped)
  // The claims gate + eligibility, kept WITH the same stamp. `enabled` defaults to false →
  // the inert path is taken until proven otherwise, so a slow/failed GET can NEVER turn an
  // OFF page into a live one, and a value read for another pair is never shown.
  const [claimState, setClaimState] = useState<Scoped<{ enabled: boolean; eligibility: ClaimEligibility | null }>>(emptyScoped)
  // The scope the CURRENT effect run issued its requests under — what the claim POST and the
  // eligibility refetch stamp with, and what their late responses are checked against.
  const scopeRef = useRef<{ stamp: string; userId: string; isAlive: () => boolean } | null>(null)
  const [view, setView] = useState<View>('help')
  // refund view local state — which REAL items are flagged + the description.
  /**
   * L7 (T-50) — index → the QUANTITY the customer disputes on that line. 0 (or absent) = not selected.
   *
   * It was a boolean, and the claim then sent the FULL purchased quantity for every ticked line: a
   * customer who received three gnocchi and had a problem with one could only say « the gnocchi », and
   * the claim recorded three. The snapshot must hold the quantity actually contested, so the customer
   * has to be able to say it.
   */
  const [picked, setPicked] = useState<Record<number, number>>({})
  const [desc, setDesc] = useState('')
  // INERT (flag OFF) fallback flag — exactly the prior behaviour, kept byte-identical.
  const [submitted, setSubmitted] = useState(false)
  // REAL-claim submit lifecycle (only used when claimsEnabled === true).
  const [submitState, setSubmitState] = useState<SubmitState>('idle')
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Fetch the claim feature-gate + eligibility UNDER A GIVEN SCOPE. On ANY failure (network /
  // non-OK / parse) the scope reads enabled=false → the page stays on the inert path, never
  // exposing a half-wired live submit. { enabled:false } (flag OFF) does the same. A response
  // landing after the scope was disowned (identity or route moved on) writes NOTHING.
  async function loadEligibility(scope: { stamp: string; isAlive: () => boolean }, forOrderId: string): Promise<void> {
    let next: { enabled: boolean; eligibility: ClaimEligibility | null } = { enabled: false, eligibility: null }
    try {
      const r = await fetch(`/api/claims?orderId=${encodeURIComponent(forOrderId)}`, { cache: 'no-store' })
      if (!scope.isAlive()) return
      if (r.ok) {
        const d = await r.json()
        if (d?.enabled === true) next = { enabled: true, eligibility: (d.eligibility as ClaimEligibility) ?? null }
      }
    } catch {
      /* enabled stays false */
    }
    if (!scope.isAlive()) return
    setClaimState({ stamp: scope.stamp, value: next })
  }

  useEffect(() => {
    // FAIL CLOSED FIRST — the previous pair's order, claim scope AND every order-bound draft
    // leave the state BEFORE any request. (On the very first run these are the initial values.)
    setOrderState(emptyScoped())
    setClaimState(emptyScoped())
    setView('help')
    setPicked({})
    setDesc('')
    setSubmitted(false)
    setSubmitState('idle')
    setSubmitError(null)
    scopeRef.current = null
    if (authStatus !== 'authenticated') return
    // Same pure derivation as `liveStamp`, from the effect's own deps (no closure over render).
    const requestStamp = orderScopeStamp(authStatus, userId, orderId)
    const requestUserId = userId
    if (requestStamp === null || !requestUserId) return
    let alive = true
    const scope = { stamp: requestStamp, userId: requestUserId, isAlive: () => alive }
    scopeRef.current = scope
    loadOwnedOrder<Order>({ orderId, requestStamp, requestUserId, isAlive: () => alive })
      .then((r) => {
        if (!alive || !r) return
        setOrderState(r)
        // The claims GET has NO owner echo of its own: it is issued ONLY once the order was
        // adopted under this scope (server-echoed ownerId), and it inherits that scope.
        if (r.value !== null) void loadEligibility(scope, orderId)
      })
    // `userId` AND `orderId` ARE DEPENDENCIES: `authStatus` alone cannot see A → B when the
    // broadcast moves the id without touching the status, and the same mount serving another
    // order's URL must re-fire too. Keying on them makes `alive` load-bearing: the cleanup
    // disowns every in-flight request (order, eligibility, claim POST) issued for the previous
    // pair before it can resolve.
    return () => { alive = false; if (scopeRef.current === scope) scopeRef.current = null }
    // `loadEligibility` is a stable function of this render with no captured state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, /* help-deps */ [authStatus, userId, orderId])

  // RENDER-TIME GATE — the order and the claim scope are visible only while their stamp matches
  // the live pair. `loading` is DERIVED from the same stamps: the frame right after an account
  // switch reads as loading, never as « not found », never as A's banner or A's claim.
  const order = scopedValue(orderState, liveStamp)
  const loading = authStatus === 'loading' || scopePending(orderState, liveStamp)
  const claims = scopedValue(claimState, liveStamp)
  const claimsEnabled = order !== null && claims?.enabled === true
  const eligibility = claimsEnabled ? claims?.eligibility ?? null : null

  const items = useMemo<OrderItem[]>(() => (Array.isArray(order?.items) ? order!.items : []), [order])
  const itemsCount = useMemo(() => items.reduce((s, it) => s + (it.qty ?? 1), 0), [items])
  // RE-AUDIT FIX (batch 2). This figure is what the CUSTOMER is told they are asking for. It was
  // summed from `Order.items[].price`, the MenuItem LIST price, and shown raw — so on a discounted
  // order, or one already partly refunded (including from the Stripe Dashboard, which the rail's
  // own Refund table never sees), it exceeded what the server actually records. The customer read
  // one number and the acknowledgement e-mail then stated a smaller one. The server's ceiling is
  // already fetched here; the displayed figure is now clamped to it, so the page cannot promise
  // money the server will not grant. It can only ever shrink — never inflate.
  // T-86 (PRE-L11 adversarial review). The clamp above is on the ORDER ceiling, and an order ceiling
  // does not bind a ONE-LINE selection: on 40 € of lines paid 20 €, ticking an 8 € dish stayed 8 €
  // (well under the 20 € cap) while the server recorded 4 €. The customer read 8 € here, then 4 € in
  // the acknowledgement e-mail, 4 € on /eat/account/claims and 4 € on the tracking widget — three
  // surfaces plus the e-mail contradicting the form they had just filled in. The fix is not another
  // clamp: it is to stop summing list prices and read the SERVER's per-line unit, which is the number
  // `resolveClaimAmount` will use. `scope.lines[].index` is the position in `Order.items` ITSELF, so it
  // indexes this list directly (claim-scope keeps the raw position for exactly this reason).
  const unitCentsByIndex = useMemo(() => {
    const m = new Map<number, number>()
    for (const l of eligibility?.scope?.lines ?? []) {
      if (Number.isInteger(l?.index) && Number.isFinite(l?.unitCents)) m.set(l.index, Math.max(0, Math.round(l.unitCents)))
    }
    return m
  }, [eligibility])
  const rawEstimate = useMemo(
    () => items.reduce((s, it, i) => {
      const unit = unitCentsByIndex.get(i)
      if (unit === undefined) return s
      return s + (unit / 100) * Math.min(picked[i] ?? 0, it.qty ?? 1)
    }, 0),
    [items, picked, unitCentsByIndex],
  )
  /**
   * A line the SERVER did not price — claim-scope DROPS a malformed line rather than guess it — cannot
   * be added up here either. Such a selection states NO figure instead of a quietly understated one: the
   * figure is a promise, and a promise nobody can honour is worse than no promise.
   */
  const estimatePriceable = useMemo(
    () => unitCentsByIndex.size > 0 && !items.some((_, i) => (picked[i] ?? 0) > 0 && !unitCentsByIndex.has(i)),
    [items, picked, unitCentsByIndex],
  )
  const ceilingEuros = (eligibility?.maxRefundableCents ?? 0) / 100
  const estimate = eligibility ? Math.min(rawEstimate, ceilingEuros) : rawEstimate
  /** True when the server ceiling, not the selection, is what caps the figure shown. */
  const estimateCapped = !!eligibility && rawEstimate > ceilingEuros
  /**
   * L7 — only a selection that still POINTS AT SOMETHING counts.
   *
   * It was `Object.values(selected).some(Boolean)`, true for any truthy key — including an index past
   * the end of the list after the order reloaded shorter. The button was then enabled while the body
   * built an EMPTY items array, so the customer pressed « envoyer » and got a 400 they could not act
   * on. A stale index is not a selection.
   */
  const anySelected = items.some((it, i) => (picked[i] ?? 0) > 0 && (picked[i] ?? 0) <= Math.max(1, Math.floor(it.qty ?? 1)))

  // P0-19 — on a pickup order, 'picked_up'/'delivered' mean "collected by the
  // client": never « En route »/« Livrée » (delivery vocabulary). Display only.
  const isPickupOrder = order?.fulfillmentType === 'pickup'
  const statusLabel = (s?: string) =>
    isPickupOrder && (s === 'picked_up' || s === 'delivered') ? t('statusCollected')
      : s === 'received' ? t('statusReceived')
        : s === 'preparing' ? t('statusPreparing')
          : s === 'ready' ? t('statusReady')
            : s === 'picked_up' ? t('statusEnRoute')
              : s === 'delivered' ? t('statusDelivered')
                : s === 'cancelled' ? t('statusCancelled')
                  : t('statusReceived')

  const restaurantName = order?.restaurant?.name ?? '—'

  // ── D′ L9 (T-45, §15) — WHAT THE SYSTEM ALREADY KNOWS ABOUT THE MONEY ───────────────────────────
  //
  // A customer opens this page to ask « where is my money ». Until this lot the page could not answer:
  // no consumer surface read the `Refund` table, so it offered a claim form (or a mailto) for a refund
  // that had ALREADY landed — and a second claim on money already returned is exactly the confusion
  // T-45 was filed for. The three facts below are stated BEFORE any form or any address.
  //
  // THE WORDING IS THE WHOLE POINT, and each line has one basis and one only:
  //   • `refundedCents > 0`      → « remboursée » / « remboursement partiel ». Settled rows carrying a
  //                                Stripe `re_`, i.e. money PROVEN returned. The word is never used on
  //                                anything else, and never on 0.
  //   • `pendingCents > 0`       → « remboursement de X € en cours ». In flight, so never « remboursé »
  //                                and never « effectué ». Never added to the confirmed figure.
  //   • `unattributedCents > 0`  → NEUTRAL only: real Stripe money on this order whose internal origin
  //                                is not certain (a Dashboard refund, typically). It names no author,
  //                                no réclamation, no commission, and is called NEITHER total NOR
  //                                partial — none of that is known. The three sums are disjoint by
  //                                construction server-side, so showing all three double-counts nothing.
  // NO bank delay and NO estimated date is stated anywhere: the only delay sentence on this page is
  // `refundEstimate`, which belongs to the CLAIM being filed and is not a promise about this money.
  //
  // NOT CLAIMS-GATED. `claimsEnabled` gates the claim FORM; a refund is an ORDER truth and is stated
  // whether the claims surface is open, paused or closed — which is why this block is built ABOVE the
  // branch below and rendered inside BOTH of its outcomes.
  const rs = order?.refundSummary
  const refundedCents = rs?.refundedCents ?? 0
  const pendingCents = rs?.pendingCents ?? 0
  const unattributedCents = rs?.unattributedCents ?? 0
  // Cents ÷ 100 through the shared helper — never a hand-formatted euro string. The amount is isolated
  // with <bdi> (the idiom this page already uses for figures) so an Arabic RTL sentence cannot reorder it.
  const refundEuros = (cents: number) => formatEuros(cents / 100, locale)
  const refundState = (refundedCents > 0 || pendingCents > 0 || unattributedCents > 0) ? (
    <>
      <p className="lbl">{tRefund('stateLabel')}</p>
      <div className="rcard" style={{ display: 'grid', gap: 6, fontSize: 12.5, lineHeight: 1.55 }}>
        {refundedCents > 0 && (
          <span>
            {tRefund.rich(rs?.isTotal ? 'refundedTotal' : 'refundedPartial', {
              amount: refundEuros(refundedCents),
              amt: (c) => <bdi>{c}</bdi>,
            })}
          </span>
        )}
        {pendingCents > 0 && (
          <span>
            {tRefund.rich('refundPending', { amount: refundEuros(pendingCents), amt: (c) => <bdi>{c}</bdi> })}
          </span>
        )}
        {unattributedCents > 0 && (
          <span>
            {tRefund.rich('refundRecorded', { amount: refundEuros(unattributedCents), amt: (c) => <bdi>{c}</bdi> })}
          </span>
        )}
      </div>
    </>
  ) : null

  function goBack() {
    if (view !== 'help') {
      setView('help'); setSubmitted(false); setSubmitState('idle'); setSubmitError(null)
      return
    }
    // L7 — leaving the form CLEARS it. `selected` and `desc` used to survive both a goBack and a
    // successful submit, so the next visit opened with the previous visit's ticks and description
    // already in place, ready to be filed again without the customer having chosen anything.
    setPicked({})
    setDesc('')
    router.back()
  }

  // ── REAL claim submit (flag ON + eligible) ─────────────────────────────────
  // POST a claim for the selected items: reason fixed to 'missing_item' (this entry),
  // requestedAmountCents = the SELECTED real-item estimate (server re-caps at order total).
  // 201 → success + refetch eligibility (so it reflects the now-active/auto-resolved claim);
  // 4xx → surface the API error; 403 {gated} → fall back to the inert « bientôt » state.
  async function submitClaim() {
    if (!claimsEnabled || !eligibility?.canClaim || !anySelected || submitState === 'sending') return
    // The scope this claim is filed UNDER. If the identity or route moves on while the POST is
    // in flight, the cleanup disowns it and the response below touches nothing.
    const scope = scopeRef.current
    if (!scope || scope.stamp !== liveStamp) return
    setSubmitState('sending'); setSubmitError(null)
    try {
      const res = await fetch('/api/claims', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId,
          reason: 'missing_item',
          description: desc.trim() || undefined,
          // CLAIMS BATCH 2 — 'missing_item' is ITEM_REQUIRED server-side: a whole-order ceiling
          // is refused for it, so sending only an amount would now be rejected. This page
          // ALREADY tracks which lines the customer ticked, so it sends that SELECTION
          // (index + purchased quantity). The server prices it from the stored order; no price
          // or total from this client is ever read.
          // L7 — the scope is STATED, not inferred. 'missing_item' is items-only, so there is nothing for
          // the customer to choose here; saying it anyway means the server never has to guess, and a future
          // change of reason on this page cannot silently become a whole-order claim.
          scope: 'items',
          items: items
            .map((it, i) => ({ index: i, qty: Math.min(picked[i] ?? 0, it.qty ?? 1) }))
            .filter((x) => x.qty > 0),
        }),
      })
      if (!scope.isAlive()) return
      if (res.status === 201) {
        setSubmitState('done')
        // The claim is filed: the form's content is spent. Leaving it in place invited a second,
        // identical claim built from state the customer had already used.
        setPicked({})
        setDesc('')
        await loadEligibility(scope, orderId) // reflect the filed claim (active / auto-resolved)
        return
      }
      const data = await res.json().catch(() => ({} as { error?: string; gated?: boolean }))
      if (!scope.isAlive()) return
      // Gate flipped off between the GET and the POST → honest inert fallback.
      if (res.status === 403 && data?.gated) {
        setClaimState({ stamp: scope.stamp, value: { enabled: false, eligibility: null } })
        setSubmitState('idle'); setSubmitError(null)
        return
      }
      setSubmitState('error')
      // D' L6: an eligibility refusal carries its CODE, so the customer reads it in their own language.
      //
      // D′ L10 (§2) — THE FALLBACK NO LONGER SHOWS THE SERVER'S SENTENCE. It used to read
      // `localized ? t(localized) : data.error`, so any code without an entry — and four of them provably had
      // none in ANY locale — printed French prose to a reader in English, Spanish, Italian or Arabic. An
      // unmapped code now degrades to a LOCALIZED generic, and the map moved to lib/claim-refusal-labels so
      // this page and components/claims/ClaimSection cannot answer the same code differently.
      const localized = claimRefusalKey(data?.reason)
      setSubmitError(localized ? t(localized) : t('claimError'))
    } catch {
      if (!scope.isAlive()) return
      setSubmitState('error')
      setSubmitError(t('claimError'))
    }
  }


  // Eligibility → a human label for the disabled-submit reason (flag ON, not eligible).
  // Mirrors getClaimEligibility's reason union + the active-claim status.
  const eligibilityLabel = (): string => {
    const ex = eligibility?.existingClaim
    // D′ L6: an OLDER claim can hold the @unique activeOrderKey while the newest claim of the order is
    // closed. Showing that closed claim's status (« refusée ») next to a refusal that means « one is still
    // in progress » read as a contradiction, and told the customer to do the wrong thing. When the blocking
    // claim is not the one we are about to describe, say what actually blocks.
    if (eligibility?.reason === 'active_claim' && eligibility.blockingClaimId && eligibility.blockingClaimId !== ex?.id) {
      return t('claimAlreadyFiled')
    }
    if (ex && (eligibility?.reason === 'active_claim' || !eligibility?.canClaim)) {
      // an existing claim takes precedence — show its review/decision status
      if (ex.status === 'restaurant_review') return t('claimAlreadyFiled')
      // ROUND-8 AUDIT FIX (P2): an APPROVED claim was told « remboursement en cours » — nothing pays an
      // approved claim until a refund is actually driven. Only 'refunding' is in progress.
      // ROUND-9: the server now derives the status a customer sees; a recovery state reads as a review.
      if (ex.status === 'financial_verification') return t('claimInReview')
      if (ex.status === 'refunding') return t('claimRefunding')
      if (ex.status === 'approved') return t('claimApproved')
      if (ex.status === 'refunded') return t('claimRefunded')
      // ROUND 13 (F07): « Remboursée » needs a proven row (F03); otherwise the customer reads it unconfirmed.
      if (ex.status === 'refund_unconfirmed') return t('claimRefundUnconfirmed')
      // ROUND-11 AUDIT FIX (P1): a declaration close is not a refusal (lib/claim-action-rules customerClaimStatus).
      if (ex.status === 'closed_by_support') return t('claimClosedBySupport')
      if (ex.status === 'refused' || ex.status === 'refused_final' || ex.status === 'refused_by_grubano') return t('claimRefused')
      if (ex.status === 'arbitration') return t('claimInReview')
    }
    // D′ L10 (§2) — THE SECOND HAND-WRITTEN MAP IS GONE TOO. A `switch` over the same codes lived here, so
    // this lot un-duplicated one table and left another one standing: a code added to the shared map would have
    // appeared on the POST refusal and NOT on this disabled-submit label. The existing-claim precedence above
    // is unchanged — it is richer than a lookup and stays — but the tail now asks the ONE map, with
    // « pas éligible » as the last word. Behaviour-identical today for every code `getClaimEligibility`
    // returns (they are all in the map, with the same keys), and correct for any code added later.
    // Found by this lot's own adversarial review.
    return t(claimRefusalKey(eligibility?.reason) ?? 'claimNotEligible')
  }

  // ── Not signed in → invite to sign in (the order needs a session) ──────────
  if (authStatus === 'unauthenticated') {
    return (
      <div className="gb gb-help">
        <div className="bar">
          <button type="button" className="back" onClick={() => router.back()} aria-label={t('back')}>
            <span className="ms ms-flip" aria-hidden="true">arrow_back</span>
          </button>
          <h1>{t('title')}</h1>
        </div>
        <div className="body">
          <div className="ord" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 8 }}>
            <b style={{ fontFamily: 'var(--gb-font-display)', fontSize: 15 }}>{t('signInTitle')}</b>
            <button className="submit" type="button" style={{ width: 'auto', padding: '12px 20px' }} onClick={() => router.push('/eat/auth')}>
              <span className="ms" aria-hidden="true">login</span><b>{t('signInCta')}</b>
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ════════════════════════════ VIEW HEADER (shared) ════════════════════════
  const Header = ({ titleKey }: { titleKey: string }) => (
    <div className="bar">
      <button type="button" className="back" onClick={goBack} aria-label={t('back')}>
        <span className="ms ms-flip" aria-hidden="true">arrow_back</span>
      </button>
      <h1>{t(titleKey)}</h1>
    </div>
  )

  // ════════════════════════════ B) REFUND VIEW ══════════════════════════════
  if (view === 'refund') {
    // LOT D (P-2, décision fondateur D4) — CLAIMS_ENABLED=false est FINAL pour la
    // bêta : la vue « Remboursement » inerte (items/textarea/photo/bannière
    // « bientôt »/submit mort) est MASQUÉE au profit du seul canal réel, le
    // support humain (même adresse que toutes les autres surfaces support).
    // `claimsEnabled` défaute à false → un GET lent/échoué atterrit TOUJOURS ici,
    // jamais sur un formulaire à moitié câblé. Le flux flag-ON ci-dessous reste
    // STRICTEMENT intouché (ses branches !claimsEnabled sont désormais
    // inatteignables — conservées telles quelles pour ne pas toucher au flux ON).
    if (!claimsEnabled) {
      const refundMailto = `mailto:contact@grubano.com?subject=${encodeURIComponent(`Remboursement — commande ${refOf(orderId)}`)}`
      return (
        <div className="gb gb-help">
          <Header titleKey="refundTitle" />
          <div className="body">
            {/* D′ L9 (T-45) — the refund FACT first, then the only channel the beta has. A customer
                whose money is already back must read that before being told to write an e-mail. */}
            {refundState}
            <p className="lbl">{t('refundOffTitle')}</p>
            <div className="rcard" style={{ fontSize: 12.5, color: 'var(--gb-muted)', lineHeight: 1.55 }}>
              {t('refundOffBody')}
            </div>
            <div className="contact">
              <a className="cbtn" href={refundMailto}>
                <span className="ms" aria-hidden="true">mail</span>
                <b>{t('contactEmail')}</b><span>contact@grubano.com</span>
              </a>
            </div>
          </div>
        </div>
      )
    }
    return (
      <div className="gb gb-help">
        <Header titleKey="refundTitle" />
        <div className="body">
          {/* D′ L9 (T-45) — the SAME refund fact as the closed-surface branch above: a live claim form
              does not change what already happened to the money, so the customer reads it first. */}
          {refundState}
          <p className="lbl">{t('refundWhich')}</p>
          <div className="rcard">
            <div className="items">
              {loading ? (
                [0, 1].map((i) => <div key={i} className="sk" style={{ height: 22 }} />)
              ) : items.length ? (
                items.map((it, i) => {
                  const maxQty = Math.max(1, Math.floor(it.qty ?? 1))
                  const qty = Math.min(picked[i] ?? 0, maxQty)
                  const on = qty > 0
                  return (
                    <div key={i} className="it" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {/* Tapping the line selects it (qty 1) or clears it — the same gesture as before. */}
                      <button
                        type="button"
                        aria-pressed={on}
                        onClick={() => setPicked((p) => ({ ...p, [i]: on ? 0 : 1 }))}
                        style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, background: 'none', border: 0, padding: 0, textAlign: 'start' }}
                      >
                        <span className={`cb${on ? ' on' : ''}`}>
                          {on && <span className="ms" aria-hidden="true">check</span>}
                        </span>
                        <span className="nm">{maxQty > 1 ? `${maxQty}× ${it.name}` : it.name}</span>
                      </button>
                      {/* L7 — HOW MANY of them. Shown only when more than one was bought: a stepper on a
                          single item would be a control with one position. Min 1 on a selected line; the
                          maximum is what was purchased, and the server re-checks both. */}
                      {on && maxQty > 1 && (
                        <select
                          aria-label={t('claimQtyLabel', { name: it.name })}
                          value={qty}
                          onChange={(e) => setPicked((p) => ({ ...p, [i]: Number(e.target.value) }))}
                          style={{ borderRadius: 8, border: '1px solid var(--gb-border)', padding: '2px 6px', background: 'var(--gb-surface)', color: 'inherit' }}
                        >
                          {Array.from({ length: maxQty }, (_, k) => k + 1).map((q) => (
                            <option key={q} value={q}>{q}</option>
                          ))}
                        </select>
                      )}
                      {/* T-86 — the same basis as the total below: the server's scaled unit, never the
                          list price. A line the server did not price shows no price rather than a
                          wrong one. */}
                      {unitCentsByIndex.has(i) && (
                        <span className="pr">{formatEuros((unitCentsByIndex.get(i)! / 100) * (on ? qty : maxQty), locale)}</span>
                      )}
                    </div>
                  )
                })
              ) : (
                <span className="nm" style={{ color: 'var(--gb-muted)' }}>{t('refundNoItems')}</span>
              )}
            </div>
          </div>

          <p className="lbl">{t('refundWhat')}</p>
          <div className="field">
            {/* Bound. value='' keeps the rendered textarea identical to the prior
                uncontrolled one; the API enforces the 1000-char cap (a 4xx is surfaced). */}
            <textarea
              placeholder={t('refundPlaceholder')}
              aria-label={t('refundWhat')}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
            />
          </div>

          {/* INERT — the photo is OPTIONAL per /api/claims; the moderated upload is not
              wired here (future nicety). The button has no handler. */}
          <button type="button" className="photo">
            <span className="ms" aria-hidden="true">add_a_photo</span>{t('refundAddPhoto')}
          </button>

          {/* FLAG OFF (claimsEnabled === false, the default) → the original inert
              « bientôt » banner, byte-identical to before. */}
          {!claimsEnabled && (
            <div className="soon">
              <span className="ms" aria-hidden="true">schedule</span>{t('refundSoon')}
              <span className="pill">{t('soonBadge')}</span>
            </div>
          )}

          {/* FLAG ON, claim FILED → confirmation. */}
          {claimsEnabled && submitState === 'done' && (
            <div className="soon" role="status">
              <span className="ms" aria-hidden="true">check_circle</span>{t('claimFiledSub')}
            </div>
          )}

          {/* FLAG ON, NOT eligible (and no claim just filed) → the reason. */}
          {claimsEnabled && submitState !== 'done' && eligibility && !eligibility.canClaim && (
            <div className="soon" role="status">
              <span className="ms" aria-hidden="true">info</span>{eligibilityLabel()}
            </div>
          )}

          {/* FLAG ON, submit ERROR → the API error, verbatim. */}
          {claimsEnabled && submitState === 'error' && submitError && (
            <div className="soon" role="alert">
              {/* P0-30bis — no `.ms` ligature glued to the refusal message. */}
              {submitError}
            </div>
          )}

          {/* LOT 4 — the « Remboursement estimé … sous 3–5 jours » promise only renders
              when the claims feature is LIVE (claimsEnabled). Flag OFF → no promise. */}
          {claimsEnabled && (
            <div className="refund-note">
              <span className="ms" aria-hidden="true">verified_user</span>
              <p>
                {anySelected && estimatePriceable
                  ? t.rich('refundEstimate', { amount: formatAmount(estimate, locale), b: (c) => <b><bdi>{c} €</bdi></b> })
                  : t('refundPickToEstimate')}
              </p>
              {/* T-59 — the cap sentence says « ce qui reste remboursable », a cash claim. It may only
                  be shown when the ceiling was proven against live Stripe truth; otherwise the cap is
                  DB-derived and is described as the maximum of the REQUEST, still to be verified. */}
              {estimateCapped && (
                <p className="refund-note-cap">{t(eligibility?.ceilingVerified === true ? 'refundEstimateCapped' : 'refundEstimateCappedUnverified')}</p>
              )}
            </div>
          )}
        </div>

        <div className="foot">
          <div className="inner">
            {!claimsEnabled ? (
              /* FLAG OFF → the ORIGINAL inert submit (sets `submitted`, no POST). Byte-identical. */
              <button type="button" className="submit" disabled={!anySelected || submitted} onClick={() => setSubmitted(true)}>
                <span className="ms" aria-hidden="true">{submitted ? 'schedule' : 'send'}</span>
                <b>{submitted ? t('refundSubmittedSoon') : t('refundSubmit')}</b>
              </button>
            ) : submitState === 'done' ? (
              /* FLAG ON, claim FILED → success, button locked. */
              <button type="button" className="submit" disabled>
                <span className="ms" aria-hidden="true">check_circle</span>
                <b>{t('claimFiledTitle')}</b>
              </button>
            ) : (
              /* FLAG ON → REAL submit; disabled if not eligible / nothing selected / sending. */
              <button
                type="button"
                className="submit"
                disabled={!eligibility?.canClaim || !anySelected || submitState === 'sending'}
                onClick={submitClaim}
              >
                <span className="ms" aria-hidden="true">{submitState === 'sending' ? 'schedule' : 'send'}</span>
                <b>{submitState === 'sending' ? t('claimSending') : t('refundSubmit')}</b>
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ═══════════════ C) SUPPORT VIEW — honest e-mail contact (LOT 4) ══════════
  // The scripted chat was REMOVED (no support-chat backend). This view is a
  // minimal honest state: the ONLY real support channel, a real mailto.
  if (view === 'chat') {
    return (
      <div className="gb gb-help">
        <Header titleKey="supportTitle" />
        <div className="body">
          <p className="lbl">{t('contactLabel')}</p>
          <div className="contact">
            <a className="cbtn" href="mailto:contact@grubano.com">
              <span className="ms" aria-hidden="true">mail</span>
              <b>{t('contactEmail')}</b><span>contact@grubano.com</span>
            </a>
          </div>
        </div>
      </div>
    )
  }

  // ════════════════════════════ A) HELP CENTRE VIEW ═════════════════════════
  return (
    <div className="gb gb-help">
      <Header titleKey="title" />
      <div className="body">
        <div className="hp-search">
          <span className="ms" aria-hidden="true">search</span>
          <input placeholder={t('searchPlaceholder')} aria-label={t('searchPlaceholder')} />
        </div>

        <p className="lbl">{t('problemLabel')}</p>
        {loading ? (
          <div className="sk" style={{ height: 72, marginBottom: 16 }} />
        ) : (
          <div className="ord">
            <span className="th" />
            <div className="m">
              <b>{restaurantName}</b>
              <span>
                <bdi>{refOf(orderId)}</bdi> · {t('items', { count: itemsCount })} · <bdi>{formatEuros(order?.total ?? 0, locale)}</bdi>
              </span>
            </div>
            <span className="st">{statusLabel(order?.status)}</span>
          </div>
        )}

        {/* D′ L9 (T-45, §15) — the banner above states « Livrée · 14,50 € », the charge and the
            delivery, which is all it can say. On a refunded order that reads as money still paid, so
            the same sentence the other surfaces use is stated here too — before the options offer a
            claim on money that may already be back. */}
        {refundState}

        <div className="opts">
          <button type="button" className="opt warn" onClick={() => setView('refund')}>
            <span className="ic"><span className="ms" aria-hidden="true">remove_shopping_cart</span></span>
            <div className="t"><b>{t('optMissingTitle')}</b><span>{t('optMissingSub')}</span></div>
            <span className="ms ms-flip" aria-hidden="true">chevron_right</span>
          </button>
          {/* Lot véracité : « Voir où en est le livreur » est du vocabulaire de
              LIVRAISON — sur un retrait il promettait un livreur qui n'existe pas
              (constat humain de la répétition). Le motif n'apparaît que pour une
              commande livrée ; le retrait garde son propre chemin (pass + statut). */}
          {!isPickupOrder && (
            <button type="button" className="opt info" onClick={() => router.push(`/eat/track/${orderId}`)}>
              <span className="ic"><span className="ms" aria-hidden="true">schedule</span></span>
              <div className="t"><b>{t('optLateTitle')}</b><span>{t('optLateSub')}</span></div>
              <span className="ms ms-flip" aria-hidden="true">chevron_right</span>
            </button>
          )}
          {/* LOT 4 : l'option « Annuler la commande — Possible avant la préparation »
              est RETIRÉE — aucune API d'annulation n'existe ; elle routait vers un
              faux chat. */}
        </div>

        <p className="lbl">{t('topicsLabel')}</p>
        <div className="topics">
          <button type="button" className="topic">
            <span className="ms" aria-hidden="true">payments</span>
            <span>{t('topicPayments')}</span>
            <span className="ms chev ms-flip" aria-hidden="true">chevron_right</span>
          </button>
          <button type="button" className="topic">
            <span className="ms" aria-hidden="true">account_circle</span>
            <span>{t('topicAccount')}</span>
            <span className="ms chev ms-flip" aria-hidden="true">chevron_right</span>
          </button>
          <button type="button" className="topic">
            <span className="ms" aria-hidden="true">redeem</span>
            <span>{t('topicRewards')}</span>
            <span className="ms chev ms-flip" aria-hidden="true">chevron_right</span>
          </button>
        </div>

        <p className="lbl">{t('contactLabel')}</p>
        {/* LOT 4 : ETA fabriquées (« ~2 min », « < 24 h ») RETIRÉES ; l'e-mail est un
            vrai mailto (le seul canal support réel du produit). */}
        <div className="contact">
          <button type="button" className="cbtn" onClick={() => setView('chat')}>
            <span className="ms" aria-hidden="true">support_agent</span>
            <b>{t('supportTitle')}</b>
          </button>
          <a className="cbtn" href="mailto:contact@grubano.com">
            <span className="ms" aria-hidden="true">mail</span>
            <b>{t('contactEmail')}</b><span>contact@grubano.com</span>
          </a>
        </div>
      </div>
    </div>
  )
}
