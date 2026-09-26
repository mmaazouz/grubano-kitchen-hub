// tests/claim-scope.test.ts — SERVER-AUTHORITATIVE CLAIM FINANCIAL SCOPE (Claims batch 1 → D′ L7)
//
// Baseline defect (BETA-CLAIMS-REFUND-FACTUAL-INVENTORY §3, reconfirmed 2026-09-07):
// the consumer CHOSE `requestedAmountCents` and the server merely capped it at the order
// total. These tests pin the contract: the client may send a line SELECTION, never
// money, and no client-supplied value can widen server authority.
//
// ── L7 (T-50): WHY EVERY CALL IN THIS FILE NOW NAMES A MODE ───────────────────────────────────────
// `resolveClaimAmount` used to infer the scope from ABSENCE: no selection meant « the whole remaining
// authority », and a `scopeKind` derived from the reason decided whether that fallback was allowed. The
// mode is now an explicit parameter, so the implicit path is not expressible — which is exactly why the
// old call shapes no longer compile. The translation used here, stated once so it can be checked:
//     resolveClaimAmount(s)                            → { mode: 'whole' }
//     resolveClaimAmount(s, sel)                       → { mode: 'items',  selection: sel }
//     resolveClaimAmount(s, null, cents)               → { mode: 'amount', requestedCents: cents }
//     …, 'ITEM_REQUIRED'  with no selection            → { mode: 'items' }  (refused: items_required)
//     …, 'ORDER_LEVEL' / 'ITEM_OPTIONAL' with no sel   → { mode: 'whole' }
// Two behaviours CHANGED with the spec, and the tests below assert the new one rather than hiding the
// difference:
//   • an amount ABOVE the ceiling is now REFUSED (`amount_over_ceiling`) instead of silently capped —
//     capping told the customer their figure was accepted when a different one was used ;
//   • a selection AND an amount together is now REFUSED (`amount_not_allowed`) instead of resolving to
//     the lower of the two — two fields claiming to set the amount is a contradiction only the customer
//     can resolve.
// Neither change can widen authority: both replace a silent value with a refusal.
import { describe, it, expect } from 'vitest'
import { buildClaimScope, resolveClaimAmount, publicClaimScope } from '@/lib/claim-scope'

// Server-re-priced lines as persisted by app/api/orders/route.ts (unit price in EUR).
const ITEMS = [
  { itemId: 'm1', name: 'Gnocchi', qty: 2, price: 12.5 },  // 1250 c each → 2500 c
  { itemId: 'm2', name: 'Tiramisu', qty: 1, price: 6 },    //  600 c
]
const scope = (over: Partial<{ items: unknown; orderTotalEur: number; alreadyRefundedCents: number }> = {}) =>
  buildClaimScope({ items: ITEMS, orderTotalEur: 32.5, alreadyRefundedCents: 0, ...over })

describe('buildClaimScope — authority comes from the ORDER, never from the request', () => {
  it('derives line values and the ceiling from the order total minus what is already refunded', () => {
    const s = scope()
    expect(s.orderTotalCents).toBe(3250)
    expect(s.maxAuthorityCents).toBe(3250)
    expect(s.lines).toEqual([
      { index: 0, itemId: 'm1', name: 'Gnocchi', maxQty: 2, unitCents: 1250, lineCents: 2500 },
      { index: 1, itemId: 'm2', name: 'Tiramisu', maxQty: 1, unitCents: 600, lineCents: 600 },
    ])
  })

  it('an already-refunded amount SHRINKS the ceiling (a second claim cannot re-ask the whole order)', () => {
    const s = scope({ alreadyRefundedCents: 1000 })
    expect(s.maxAuthorityCents).toBe(2250)
    expect(resolveClaimAmount(s, { mode: 'whole' })).toMatchObject({ ok: true, amountCents: 2250, mode: 'whole' })
  })

  it('a fully refunded order has ZERO authority left', () => {
    const s = scope({ alreadyRefundedCents: 3250 })
    expect(s.maxAuthorityCents).toBe(0)
    expect(resolveClaimAmount(s, { mode: 'whole' })).toMatchObject({ ok: false, code: 'no_refundable_amount' })
    expect(resolveClaimAmount(s, { mode: 'items', selection: [{ index: 0, qty: 1 }] }))
      .toMatchObject({ ok: false, code: 'no_refundable_amount' })
    // …and the empty ceiling is checked BEFORE the mode, so no mode can buy its way past it.
    expect(resolveClaimAmount(s, { mode: 'amount', requestedCents: 1 })).toMatchObject({ ok: false, code: 'no_refundable_amount' })
  })

  it('malformed or legacy items are DROPPED, never guessed (they can only shrink the surface)', () => {
    const s = buildClaimScope({
      items: [{ name: 'ok', qty: 1, price: 10 }, { name: 'bad qty', qty: 0, price: 5 }, { name: 'neg', qty: 1, price: -5 }, null, 'nope'],
      orderTotalEur: 10, alreadyRefundedCents: 0,
    })
    expect(s.lines).toHaveLength(1)
    expect(s.maxAuthorityCents).toBe(1000)
  })

  it('non-array items (legacy rows) → no lines, whole-order authority still works', () => {
    const s = buildClaimScope({ items: null, orderTotalEur: 20, alreadyRefundedCents: 0 })
    expect(s.linesUnavailable).toBe(true)
    expect(resolveClaimAmount(s, { mode: 'whole' })).toMatchObject({ ok: true, amountCents: 2000, mode: 'whole' })
  })
})

describe('resolveClaimAmount — the client selection can only ever REDUCE', () => {
  it('mode whole → the whole remaining authority, derived by the server', () => {
    expect(resolveClaimAmount(scope(), { mode: 'whole' })).toMatchObject({ ok: true, amountCents: 3250, mode: 'whole' })
  })

  it('a partial selection is priced from SERVER line values', () => {
    const r = resolveClaimAmount(scope(), { mode: 'items', selection: [{ index: 0, qty: 1 }] })
    expect(r).toMatchObject({ ok: true, amountCents: 1250, mode: 'items' })
  })

  it('selecting everything still cannot exceed the ceiling', () => {
    // lines sum to 3100 < total 3250 (fees) → selection is the lower number, never the higher
    const r = resolveClaimAmount(scope(), { mode: 'items', selection: [{ index: 0, qty: 2 }, { index: 1, qty: 1 }] })
    expect(r).toMatchObject({ ok: true, amountCents: 3100 })
  })

  it('a selection is capped by the ceiling when the order is partly refunded', () => {
    const r = resolveClaimAmount(scope({ alreadyRefundedCents: 3000 }), { mode: 'items', selection: [{ index: 0, qty: 2 }] })
    expect(r).toMatchObject({ ok: true, amountCents: 250 }) // 2500 requested, 250 left
  })

  it('the resolved MODE is reported, so the snapshot records what was actually priced', () => {
    expect(resolveClaimAmount(scope(), { mode: 'items', selection: [{ index: 1, qty: 1 }] })).toMatchObject({ mode: 'items' })
    expect(resolveClaimAmount(scope(), { mode: 'amount', requestedCents: 600 })).toMatchObject({ mode: 'amount' })
    expect(resolveClaimAmount(scope(), { mode: 'whole' })).toMatchObject({ mode: 'whole' })
  })
})

describe('FORGERY — every hostile input class is rejected, none expands authority', () => {
  const items = (selection: Array<{ index: number; qty: number }>) =>
    resolveClaimAmount(scope(), { mode: 'items', selection })

  it('forged item INDEX (not a line of this order) → rejected', () => {
    expect(items([{ index: 99, qty: 1 }])).toMatchObject({ ok: false, code: 'invalid_selection' })
    expect(items([{ index: -1, qty: 1 }])).toMatchObject({ ok: false, code: 'invalid_selection' })
  })

  it('forged QUANTITY above what was purchased → rejected, never clamped upward', () => {
    const r = items([{ index: 1, qty: 99 }]) // only 1 tiramisu bought
    expect(r).toMatchObject({ ok: false, code: 'qty_over_purchased' })
    if (!r.ok) expect(r.error).toMatch(/Quantité supérieure/)
  })

  it('DUPLICATED line → rejected (no stacking the same item twice)', () => {
    expect(items([{ index: 0, qty: 1 }, { index: 0, qty: 1 }])).toMatchObject({ ok: false, code: 'duplicate_selection' })
  })

  it('non-integer / zero / negative quantity → rejected', () => {
    for (const qty of [0, -3, 1.5, NaN]) {
      expect(items([{ index: 0, qty }])).toMatchObject({ ok: false, code: 'invalid_qty' })
    }
  })

  it('a forged unit PRICE or line TOTAL in the payload is structurally unreadable', () => {
    // The resolver's only inputs are index+qty. Extra fields cannot be consumed.
    const hostile = [{ index: 0, qty: 1, price: 9999, unitCents: 9999, lineCents: 9999, amountCents: 9999, itemId: 'forged' }]
    const r = resolveClaimAmount(scope(), { mode: 'items', selection: hostile as unknown as Array<{ index: number; qty: number }> })
    expect(r).toMatchObject({ ok: true, amountCents: 1250 }) // the SERVER price, not 9999
  })

  it('more selection entries than the order has lines → rejected before pricing', () => {
    expect(items([{ index: 0, qty: 1 }, { index: 1, qty: 1 }, { index: 0, qty: 1 }]))
      .toMatchObject({ ok: false, code: 'invalid_selection' })
  })
})

describe('publicClaimScope — what the client UI may see', () => {
  it('exposes line values and the ceiling, and nothing the client could echo back as authority', () => {
    const p = publicClaimScope(scope({ alreadyRefundedCents: 250 }))
    expect(p.maxAuthorityCents).toBe(3000)
    expect(p.alreadyRefundedCents).toBe(250)
    expect(p.itemSelectionAvailable).toBe(true)
    expect(p.lines[0]).toEqual({ index: 0, name: 'Gnocchi', maxQty: 2, unitCents: 1250, lineCents: 2500 })
  })
})

// ── NEGATIVE CONTROL ────────────────────────────────────────────────────────────
// Prove these tests would actually CATCH the class of defect they claim to cover, by
// re-implementing the OLD permissive rule (client amount, capped at the total) and
// showing the forgery cases pass through it. The vulnerable variant lives ONLY here.
describe('negative control — the OLD client-amount rule would have been caught', () => {
  const vulnerableResolve = (totalCents: number, clientAmount: number) =>
    (Number.isInteger(clientAmount) && clientAmount > 0 && clientAmount <= totalCents)
      ? { ok: true as const, amountCents: clientAmount }
      : { ok: false as const }

  it('the old rule lets a client claim 32.50 € on an order where only one 12.50 € item was wrong', () => {
    expect(vulnerableResolve(3250, 3250)).toMatchObject({ ok: true, amountCents: 3250 })
    // the new derivation, given the same honest selection, yields the item value only
    expect(resolveClaimAmount(scope(), { mode: 'items', selection: [{ index: 0, qty: 1 }] }))
      .toMatchObject({ ok: true, amountCents: 1250 })
  })

  it('the old rule ignores what was ALREADY refunded — the new one cannot', () => {
    // order already refunded 3000 c; the old rule still accepts a 3250 c claim
    expect(vulnerableResolve(3250, 3250)).toMatchObject({ ok: true, amountCents: 3250 })
    expect(resolveClaimAmount(scope({ alreadyRefundedCents: 3000 }), { mode: 'whole' }))
      .toMatchObject({ ok: true, amountCents: 250 })
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT FIX (P0) — found by the independent adversarial audit of batch 1.
// Dropping `requestedAmountCents` outright meant the SHIPPED client (which sends an
// amount and no `items`) had every claim silently re-written to the WHOLE order: the
// change made authority WIDER, not narrower, and the inflated figure was then shown to
// the restaurant, the admin and the customer as "the amount you requested".
// L7 keeps the invariant and hardens its edges: the figure is honoured in mode 'amount',
// and every case where it CANNOT be honoured is now a refusal with a code.
// ═══════════════════════════════════════════════════════════════════════════════
describe('AUDIT FIX P0 — a requested amount REDUCES, never expands, and is never silently ignored', () => {
  it('a client asking for a precise amount gets that amount — NOT the whole order', () => {
    expect(resolveClaimAmount(scope(), { mode: 'amount', requestedCents: 500 }))
      .toMatchObject({ ok: true, amountCents: 500, mode: 'amount' })
  })

  it('an amount ABOVE the ceiling is REFUSED, never granted and no longer silently capped', () => {
    const r = resolveClaimAmount(scope(), { mode: 'amount', requestedCents: 999999 })
    expect(r).toMatchObject({ ok: false, code: 'amount_over_ceiling' })
    // the ceiling itself is unchanged and still reachable — deliberately, via its own mode
    expect(resolveClaimAmount(scope(), { mode: 'whole' })).toMatchObject({ ok: true, amountCents: 3250 })
  })

  it('an amount above the ceiling of a PARTLY refunded order is refused against what REMAINS', () => {
    const partly = scope({ alreadyRefundedCents: 3000 })
    expect(resolveClaimAmount(partly, { mode: 'amount', requestedCents: 999999 }))
      .toMatchObject({ ok: false, code: 'amount_over_ceiling' })
    expect(resolveClaimAmount(partly, { mode: 'amount', requestedCents: 250 }))
      .toMatchObject({ ok: true, amountCents: 250 })
    expect(resolveClaimAmount(partly, { mode: 'amount', requestedCents: 251 }))
      .toMatchObject({ ok: false, code: 'amount_over_ceiling' })
  })

  it('a selection AND an amount → REFUSED, so the customer is never told a figure they did not get', () => {
    // Before L7 this resolved to the lower of the two, silently. 1250 (the selection) vs 400 (the typed
    // figure): whichever the server picked, the other was discarded without a word.
    expect(resolveClaimAmount(scope(), { mode: 'items', selection: [{ index: 0, qty: 1 }], requestedCents: 400 }))
      .toMatchObject({ ok: false, code: 'amount_not_allowed' })
    expect(resolveClaimAmount(scope(), { mode: 'amount', requestedCents: 400, selection: [{ index: 0, qty: 1 }] }))
      .toMatchObject({ ok: false, code: 'items_not_allowed' })
  })

  it('a junk amount (0, negative, float, NaN) is REFUSED, never turned into the whole order', () => {
    for (const bad of [0, -100, 12.5, NaN]) {
      expect(resolveClaimAmount(scope(), { mode: 'amount', requestedCents: bad }))
        .toMatchObject({ ok: false, code: 'amount_required' })
    }
    // …and the old fallback value is no longer reachable by accident: 3250 requires mode 'whole'.
    expect(resolveClaimAmount(scope(), { mode: 'amount', requestedCents: null }))
      .toMatchObject({ ok: false, code: 'amount_required' })
  })

  it('mode whole takes no amount at all — a figure beside it is a contradiction, not a cap', () => {
    expect(resolveClaimAmount(scope(), { mode: 'whole', requestedCents: 500 }))
      .toMatchObject({ ok: false, code: 'amount_not_allowed' })
    expect(resolveClaimAmount(scope(), { mode: 'whole', selection: [{ index: 0, qty: 1 }] }))
      .toMatchObject({ ok: false, code: 'items_not_allowed' })
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH 2 — ITEM-LEVEL AUTHORITY. Batch 1 derived the ceiling from the order alone with
// no branching on the reason, so "article manquant" obtained authority over the WHOLE
// order simply because the shipped client sent no selection. Batch 2 made the reason
// decide; L7 made the resulting MODE explicit (lib/claim-selection.resolveScopeMode),
// so this file pins what each mode PRICES and its companion pins which reason may use it.
// ═══════════════════════════════════════════════════════════════════════════════
describe('BATCH 2 — an item-specific reason cannot reach a whole-order ceiling', () => {
  it('mode items with no selection → REJECTED, with an actionable message and a code', () => {
    const r = resolveClaimAmount(scope(), { mode: 'items' })
    expect(r).toMatchObject({ ok: false, code: 'items_required' })
    if (!r.ok) expect(r.error).toMatch(/articles concernés/)
  })

  it('mode items with a selection → priced from the SERVER lines only', () => {
    expect(resolveClaimAmount(scope(), { mode: 'items', selection: [{ index: 0, qty: 1 }] }))
      .toMatchObject({ ok: true, amountCents: 1250, mode: 'items' })
  })

  it('a requested amount CANNOT substitute for the missing selection', () => {
    // Neither a large figure nor a small one buys its way out of naming the articles.
    expect(resolveClaimAmount(scope(), { mode: 'items', requestedCents: 3250 })).toMatchObject({ ok: false })
    expect(resolveClaimAmount(scope(), { mode: 'items', requestedCents: 100 })).toMatchObject({ ok: false })
  })

  it('mode items on an order whose lines are unreadable fails CLOSED (no whole-order fallback)', () => {
    const legacy = buildClaimScope({ items: null, orderTotalEur: 32.5, alreadyRefundedCents: 0 })
    const r = resolveClaimAmount(legacy, { mode: 'items' })
    expect(r).toMatchObject({ ok: false, code: 'item_lines_unavailable' })
    if (!r.ok) expect(r.error).toMatch(/indisponible/)
  })

  it('order-level reasons keep a legitimate whole-order ceiling', () => {
    expect(resolveClaimAmount(scope(), { mode: 'whole' }))
      .toMatchObject({ ok: true, amountCents: 3250, mode: 'whole' })
  })

  it('an optional-item reason narrows with a selection and reaches the whole order only by saying so', () => {
    expect(resolveClaimAmount(scope(), { mode: 'whole' })).toMatchObject({ ok: true, amountCents: 3250 })
    expect(resolveClaimAmount(scope(), { mode: 'items', selection: [{ index: 1, qty: 1 }] })).toMatchObject({ ok: true, amountCents: 600 })
  })

  it('forgery is still rejected under every mode, priced or not', () => {
    expect(resolveClaimAmount(scope(), { mode: 'items', selection: [{ index: 0, qty: 99 }] })).toMatchObject({ ok: false })
    expect(resolveClaimAmount(scope(), { mode: 'items', selection: [{ index: 42, qty: 1 }] })).toMatchObject({ ok: false })
    expect(resolveClaimAmount(scope(), { mode: 'items', selection: [{ index: 0, qty: 1 }, { index: 0, qty: 1 }] })).toMatchObject({ ok: false })
    // …and the modes that accept NO selection reject a forged one on sight, before pricing it.
    expect(resolveClaimAmount(scope(), { mode: 'amount', requestedCents: 100, selection: [{ index: 42, qty: 1 }] }))
      .toMatchObject({ ok: false, code: 'items_not_allowed' })
    expect(resolveClaimAmount(scope(), { mode: 'whole', selection: [{ index: 42, qty: 1 }] }))
      .toMatchObject({ ok: false, code: 'items_not_allowed' })
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH 2 — CUMULATIVE CEILING vs STRIPE TRUTH. The DB only knows refunds the rail
// created, so a Stripe-Dashboard refund was invisible and the ceiling overstated reality.
// ═══════════════════════════════════════════════════════════════════════════════
describe('BATCH 2 — the ceiling never exceeds real Stripe cash', () => {
  // The founder's exact scenario: captured 1000, no internal Refund row, Dashboard refund 400.
  const dashboardCase = () => buildClaimScope({
    items: [{ itemId: 'm1', name: 'Plat', qty: 1, price: 10 }],
    orderTotalEur: 10,
    alreadyRefundedCents: 0, // the DB knows NOTHING about the Dashboard refund
    stripe: { capturedCents: 1000, refundedCents: 400, pendingCents: 0 },
  })

  it('a Dashboard refund of 400 keeps a 1000 claim out of reach — the ceiling is 600', () => {
    const s = dashboardCase()
    expect(s.maxAuthorityCents).toBe(600)
    expect(s.ceilingSource).toBe('stripe')
    expect(resolveClaimAmount(s, { mode: 'amount', requestedCents: 1000 })).toMatchObject({ ok: false, code: 'amount_over_ceiling' })
    expect(resolveClaimAmount(s, { mode: 'whole' })).toMatchObject({ ok: true, amountCents: 600 })
  })

  it('the DB-only view would have allowed the full 1000 — the divergence is the whole point', () => {
    const dbOnly = buildClaimScope({ items: [], orderTotalEur: 10, alreadyRefundedCents: 0 })
    expect(dbOnly.maxAuthorityCents).toBe(1000)
    expect(dbOnly.ceilingSource).toBe('db_only')
    expect(dashboardCase().maxAuthorityCents).toBe(600)
  })

  it('a pending refund reported OUTSIDE amount_refunded is still subtracted (fail-closed floor)', () => {
    const s = buildClaimScope({
      items: [], orderTotalEur: 10, alreadyRefundedCents: 0,
      stripe: { capturedCents: 1000, refundedCents: 0, pendingCents: 400 },
    })
    expect(s.maxAuthorityCents).toBe(600)
    expect(s.stripeRemainingCents).toBe(600)
  })

  // AUDIT FIX (batch 2). This test previously asserted 300 — it encoded a DOUBLE SUBTRACTION.
  // REFUND-FINANCIAL-CONTRACT §66/§145/A9: `charge.amount_refunded` ALREADY includes a still-
  // pending refund. Subtracting `pendingCents` again removed the same 300 c twice and refused
  // legitimate claims on money that was never committed.
  it('pending is INSIDE amount_refunded — 1000 captured, 400 refunded (300 of it pending) → 600 left', () => {
    const s = buildClaimScope({
      items: [], orderTotalEur: 10, alreadyRefundedCents: 0,
      stripe: { capturedCents: 1000, refundedCents: 400, pendingCents: 300 },
    })
    expect(s.maxAuthorityCents).toBe(600)
    expect(s.stripeRemainingCents).toBe(600)
  })

  it('NEGATIVE CONTROL — the double-subtracting rule would be caught here', () => {
    const doubleSubtracting = (cap: number, ref: number, pend: number) => Math.max(0, cap - ref - pend)
    expect(doubleSubtracting(1000, 400, 300)).toBe(300) // ← the defect the audit found
    const real = buildClaimScope({
      items: [], orderTotalEur: 10, alreadyRefundedCents: 0,
      stripe: { capturedCents: 1000, refundedCents: 400, pendingCents: 300 },
    })
    expect(real.maxAuthorityCents).toBe(600) // ← fixed
  })

  it('fully refunded at Stripe → zero authority even when the DB believes otherwise', () => {
    const s = buildClaimScope({
      items: [], orderTotalEur: 10, alreadyRefundedCents: 0,
      stripe: { capturedCents: 1000, refundedCents: 1000, pendingCents: 0 },
    })
    expect(s.maxAuthorityCents).toBe(0)
    expect(resolveClaimAmount(s, { mode: 'amount', requestedCents: 500 })).toMatchObject({ ok: false, code: 'no_refundable_amount' })
    expect(resolveClaimAmount(s, { mode: 'whole' })).toMatchObject({ ok: false, code: 'no_refundable_amount' })
  })

  it('the SMALLER of DB and Stripe always wins (a DB row Stripe has not seen still counts)', () => {
    const s = buildClaimScope({
      items: [], orderTotalEur: 10, alreadyRefundedCents: 700, // rail refund not yet in Stripe truth
      stripe: { capturedCents: 1000, refundedCents: 0, pendingCents: 0 },
    })
    expect(s.maxAuthorityCents).toBe(300)
  })

  it('Stripe unreachable → the DB ceiling is used but the source is FLAGGED, never silently trusted', () => {
    const s = buildClaimScope({ items: [], orderTotalEur: 10, alreadyRefundedCents: 0, stripe: null })
    expect(s.ceilingSource).toBe('db_only')
    expect(s.stripeRemainingCents).toBeNull()
  })
})

// ── NEGATIVE CONTROLS (batch 2) ──────────────────────────────────────────────────
describe('negative controls — batch 2 defect classes are detectable', () => {
  it('a whole-order fallback reintroduced for a missing-item claim would be caught', () => {
    const vulnerable = (sc: ReturnType<typeof scope>) => ({ ok: true as const, amountCents: sc.maxAuthorityCents })
    expect(vulnerable(scope()).amountCents).toBe(3250)                                  // the defect
    expect(resolveClaimAmount(scope(), { mode: 'items' })).toMatchObject({ ok: false })  // fixed
  })

  it('ignoring the Dashboard refund would be caught', () => {
    const vulnerable = buildClaimScope({ items: [], orderTotalEur: 10, alreadyRefundedCents: 0 }) // DB only
    expect(vulnerable.maxAuthorityCents).toBe(1000)                                     // the defect
    const real = buildClaimScope({ items: [], orderTotalEur: 10, alreadyRefundedCents: 0, stripe: { capturedCents: 1000, refundedCents: 400, pendingCents: 0 } })
    expect(real.maxAuthorityCents).toBe(600)                                            // fixed
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT FIX (batch 2, P1) — PRICE BASIS. Order.items carries the MenuItem LIST price;
// Order.total is what the customer actually paid (promotions, referral discounts and
// loyalty credit are subtracted from the total, never from the lines). On a discounted
// order Σ lines exceeded the total, so a ONE-LINE selection clamped onto the whole-order
// ceiling — defeating the very invariant this batch introduced.
// ═══════════════════════════════════════════════════════════════════════════════
describe('AUDIT FIX P1 — a discounted order cannot turn one item into the whole order', () => {
  // The auditor's exact scenario: 2 × 15,00 € listed, −50 % promotion, 15,00 € actually paid.
  const promo = () => buildClaimScope({
    items: [{ itemId: 'm1', name: 'Gnocchi Truffe', qty: 2, price: 15 }],
    orderTotalEur: 15, alreadyRefundedCents: 0,
    stripe: { capturedCents: 1500, refundedCents: 0, pendingCents: 0 },
  })

  it('lines are scaled to what was really paid (7,50 € a portion, not 15,00 €)', () => {
    const s = promo()
    expect(s.lines[0].unitCents).toBe(750)
    expect(s.lines[0].lineCents).toBe(1500)
  })

  it('ONE of the two portions claims HALF the order, not all of it', () => {
    const r = resolveClaimAmount(promo(), { mode: 'items', selection: [{ index: 0, qty: 1 }] })
    expect(r).toMatchObject({ ok: true, amountCents: 750 })
  })

  it('both portions claim the whole order — the ceiling is still respected', () => {
    expect(resolveClaimAmount(promo(), { mode: 'items', selection: [{ index: 0, qty: 2 }] }))
      .toMatchObject({ ok: true, amountCents: 1500 })
  })

  it('a −5 € code on a 30 € two-line order prices each line below its list value', () => {
    const s = buildClaimScope({
      items: [{ name: 'A', qty: 1, price: 12.5 }, { name: 'B', qty: 1, price: 17.5 }],
      orderTotalEur: 25, alreadyRefundedCents: 0,
    })
    expect(s.lines[0].unitCents).toBeLessThan(1250)
    expect(s.lines[0].unitCents + s.lines[1].unitCents).toBeLessThanOrEqual(2500)
  })

  it('an UNDISCOUNTED order is untouched — fees sit on top, so no scaling happens', () => {
    const s = buildClaimScope({
      items: [{ name: 'A', qty: 2, price: 12.5 }, { name: 'B', qty: 1, price: 6 }],
      orderTotalEur: 32.5, alreadyRefundedCents: 0, // 3100 in lines, 3250 total (delivery fee)
    })
    expect(s.lines[0].unitCents).toBe(1250)
    expect(s.lines[1].unitCents).toBe(600)
  })

  it('the line index still points into Order.items even when a malformed line is dropped', () => {
    const s = buildClaimScope({
      items: [{ name: 'bad', qty: 0, price: 5 }, { name: 'good', qty: 1, price: 10 }],
      orderTotalEur: 10, alreadyRefundedCents: 0,
    })
    expect(s.lines).toHaveLength(1)
    expect(s.lines[0].index).toBe(1) // position in Order.items, NOT 0
    expect(resolveClaimAmount(s, { mode: 'items', selection: [{ index: 1, qty: 1 }] })).toMatchObject({ ok: true, amountCents: 1000 })
    expect(resolveClaimAmount(s, { mode: 'items', selection: [{ index: 0, qty: 1 }] })).toMatchObject({ ok: false, code: 'invalid_selection' })
  })
})

// ── NEGATIVE CONTROL ────────────────────────────────────────────────────────────
describe('negative control — list-price pricing on a discounted order would be caught', () => {
  it('the unscaled rule turns one of two portions into 100% of the order', () => {
    const unscaledUnitCents = 1500                    // the LIST price, as before the fix
    const orderTotalCents = 1500                      // what was actually paid
    expect(Math.min(unscaledUnitCents * 1, orderTotalCents)).toBe(1500) // ← the defect
    const fixed = buildClaimScope({ items: [{ name: 'x', qty: 2, price: 15 }], orderTotalEur: 15, alreadyRefundedCents: 0 })
    expect(resolveClaimAmount(fixed, { mode: 'items', selection: [{ index: 0, qty: 1 }] })).toMatchObject({ amountCents: 750 })
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// L7 (T-50) — THE IMPLICIT WHOLE-ORDER PATH IS GONE, STRUCTURALLY
// The batch-2 defect was not that the fallback was wrong in every case; it was that it
// happened WITHOUT ANYONE ASKING. These tests pin that no call shape reaches the ceiling
// by accident, and that every refusal names a code the client can localise.
// ═══════════════════════════════════════════════════════════════════════════════
describe('L7 — no amount is ever resolved without a mode, and every refusal carries a code', () => {
  it('a call with no input object at all cannot fall through to the whole-order ceiling', () => {
    // The mode is required at compile time. This asserts the RUNTIME behaviour too, so that making it
    // optional later « for convenience » fails a test and not only a review.
    const fn = resolveClaimAmount as unknown as (s: unknown, i?: unknown) => { ok?: boolean; amountCents?: number }
    let reachedCeiling = false
    try {
      const r = fn(scope())
      reachedCeiling = r?.ok === true && r?.amountCents === 3250
    } catch { reachedCeiling = false } // a throw is acceptable; a silent whole-order grant is not
    expect(reachedCeiling).toBe(false)
  })

  it('every refusal this module can produce carries a machine code AND a sentence', () => {
    const refusals = [
      resolveClaimAmount(scope({ alreadyRefundedCents: 3250 }), { mode: 'whole' }),
      resolveClaimAmount(scope(), { mode: 'items' }),
      resolveClaimAmount(buildClaimScope({ items: null, orderTotalEur: 10, alreadyRefundedCents: 0 }), { mode: 'items' }),
      resolveClaimAmount(scope(), { mode: 'items', selection: [{ index: 99, qty: 1 }] }),
      resolveClaimAmount(scope(), { mode: 'items', selection: [{ index: 0, qty: 1 }, { index: 0, qty: 1 }] }),
      resolveClaimAmount(scope(), { mode: 'items', selection: [{ index: 0, qty: 0 }] }),
      resolveClaimAmount(scope(), { mode: 'items', selection: [{ index: 1, qty: 9 }] }),
      resolveClaimAmount(scope(), { mode: 'amount' }),
      resolveClaimAmount(scope(), { mode: 'amount', requestedCents: 999999 }),
      resolveClaimAmount(scope(), { mode: 'whole', selection: [{ index: 0, qty: 1 }] }),
      resolveClaimAmount(scope(), { mode: 'whole', requestedCents: 10 }),
    ]
    const codes = new Set<string>()
    for (const r of refusals) {
      expect(r.ok).toBe(false)
      if (!r.ok) {
        expect(typeof r.code).toBe('string')
        expect(r.error.length).toBeGreaterThan(10)
        codes.add(r.code)
      }
    }
    // All eleven distinct refusal codes are reachable — none is dead text in the table.
    expect(codes).toEqual(new Set([
      'no_refundable_amount', 'items_required', 'item_lines_unavailable', 'invalid_selection',
      'duplicate_selection', 'invalid_qty', 'qty_over_purchased', 'amount_required',
      'amount_over_ceiling', 'items_not_allowed', 'amount_not_allowed',
    ]))
  })

  it('NEGATIVE CONTROL — a resolver that defaulted an unknown mode to whole would be caught', () => {
    const vulnerable = (mode: string, ceiling: number) =>
      mode === 'items' ? { ok: false as const } : { ok: true as const, amountCents: ceiling }
    expect(vulnerable('', 3250)).toMatchObject({ ok: true, amountCents: 3250 }) // ← the defect: silence = whole
    // The real resolver has no such branch: an empty mode matches none of the three and falls through
    // to the items path, which refuses for want of a selection rather than granting the ceiling.
    const r = resolveClaimAmount(scope(), { mode: '' as unknown as 'items' })
    expect(r).toMatchObject({ ok: false })
    expect(r.ok === false && r.code !== 'no_refundable_amount').toBe(true)
  })
})
