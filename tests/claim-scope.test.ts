// tests/claim-scope.test.ts — SERVER-AUTHORITATIVE CLAIM FINANCIAL SCOPE (Claims batch 1)
//
// Baseline defect (BETA-CLAIMS-REFUND-FACTUAL-INVENTORY §3, reconfirmed 2026-09-07):
// the consumer CHOSE `requestedAmountCents` and the server merely capped it at the order
// total. These tests pin the new contract: the client may send a line SELECTION, never
// money, and no client-supplied value can widen server authority.
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
    expect(resolveClaimAmount(s)).toMatchObject({ ok: true, amountCents: 2250, wholeOrder: true })
  })

  it('a fully refunded order has ZERO authority left', () => {
    const s = scope({ alreadyRefundedCents: 3250 })
    expect(s.maxAuthorityCents).toBe(0)
    expect(resolveClaimAmount(s)).toMatchObject({ ok: false })
    expect(resolveClaimAmount(s, [{ index: 0, qty: 1 }])).toMatchObject({ ok: false })
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
    expect(resolveClaimAmount(s)).toMatchObject({ ok: true, amountCents: 2000, wholeOrder: true })
  })
})

describe('resolveClaimAmount — the client selection can only ever REDUCE', () => {
  it('no selection → the whole remaining authority', () => {
    expect(resolveClaimAmount(scope())).toMatchObject({ ok: true, amountCents: 3250, wholeOrder: true })
  })

  it('a partial selection is priced from SERVER line values', () => {
    const r = resolveClaimAmount(scope(), [{ index: 0, qty: 1 }])
    expect(r).toMatchObject({ ok: true, amountCents: 1250, wholeOrder: false })
  })

  it('selecting everything still cannot exceed the ceiling', () => {
    // lines sum to 3100 < total 3250 (fees) → selection is the lower number, never the higher
    const r = resolveClaimAmount(scope(), [{ index: 0, qty: 2 }, { index: 1, qty: 1 }])
    expect(r).toMatchObject({ ok: true, amountCents: 3100 })
  })

  it('a selection is capped by the ceiling when the order is partly refunded', () => {
    const r = resolveClaimAmount(scope({ alreadyRefundedCents: 3000 }), [{ index: 0, qty: 2 }])
    expect(r).toMatchObject({ ok: true, amountCents: 250 }) // 2500 requested, 250 left
  })
})

describe('FORGERY — every hostile input class is rejected, none expands authority', () => {
  it('forged item INDEX (not a line of this order) → rejected', () => {
    expect(resolveClaimAmount(scope(), [{ index: 99, qty: 1 }])).toMatchObject({ ok: false })
    expect(resolveClaimAmount(scope(), [{ index: -1, qty: 1 }])).toMatchObject({ ok: false })
  })

  it('forged QUANTITY above what was purchased → rejected, never clamped upward', () => {
    const r = resolveClaimAmount(scope(), [{ index: 1, qty: 99 }]) // only 1 tiramisu bought
    expect(r).toMatchObject({ ok: false })
    if (!r.ok) expect(r.error).toMatch(/Quantité supérieure/)
  })

  it('DUPLICATED line → rejected (no stacking the same item twice)', () => {
    expect(resolveClaimAmount(scope(), [{ index: 0, qty: 1 }, { index: 0, qty: 1 }])).toMatchObject({ ok: false })
  })

  it('non-integer / zero / negative quantity → rejected', () => {
    for (const qty of [0, -3, 1.5, NaN]) {
      expect(resolveClaimAmount(scope(), [{ index: 0, qty }])).toMatchObject({ ok: false })
    }
  })

  it('a forged unit PRICE or line TOTAL in the payload is structurally unreadable', () => {
    // The resolver's only inputs are index+qty. Extra fields cannot be consumed.
    const hostile = [{ index: 0, qty: 1, price: 9999, unitCents: 9999, lineCents: 9999, amountCents: 9999, itemId: 'forged' }]
    const r = resolveClaimAmount(scope(), hostile as unknown as Array<{ index: number; qty: number }>)
    expect(r).toMatchObject({ ok: true, amountCents: 1250 }) // the SERVER price, not 9999
  })

  it('more selection entries than the order has lines → rejected before pricing', () => {
    expect(resolveClaimAmount(scope(), [{ index: 0, qty: 1 }, { index: 1, qty: 1 }, { index: 0, qty: 1 }])).toMatchObject({ ok: false })
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
    expect(resolveClaimAmount(scope(), [{ index: 0, qty: 1 }])).toMatchObject({ ok: true, amountCents: 1250 })
  })

  it('the old rule ignores what was ALREADY refunded — the new one cannot', () => {
    // order already refunded 3000 c; the old rule still accepts a 3250 c claim
    expect(vulnerableResolve(3250, 3250)).toMatchObject({ ok: true, amountCents: 3250 })
    expect(resolveClaimAmount(scope({ alreadyRefundedCents: 3000 }))).toMatchObject({ ok: true, amountCents: 250 })
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT FIX (P0) — found by the independent adversarial audit of THIS batch.
// Dropping `requestedAmountCents` outright meant the SHIPPED client (which sends an
// amount and no `items`) had every claim silently re-written to the WHOLE order: the
// change made authority WIDER, not narrower, and the inflated figure was then shown to
// the restaurant, the admin and the customer as "the amount you requested".
// ═══════════════════════════════════════════════════════════════════════════════
describe('AUDIT FIX P0 — a requested amount REDUCES, never expands, and is never ignored', () => {
  it('the shipped client (amount, no selection) gets the amount it asked for — NOT the whole order', () => {
    expect(resolveClaimAmount(scope(), null, 500)).toMatchObject({ ok: true, amountCents: 500, wholeOrder: false })
  })

  it('an amount ABOVE the ceiling is capped at the ceiling, never granted', () => {
    expect(resolveClaimAmount(scope(), null, 999999)).toMatchObject({ ok: true, amountCents: 3250 })
  })

  it('an amount above the ceiling of a PARTLY refunded order is capped at what remains', () => {
    expect(resolveClaimAmount(scope({ alreadyRefundedCents: 3000 }), null, 999999)).toMatchObject({ ok: true, amountCents: 250 })
  })

  it('a selection AND an amount → the lower of the two, never the higher', () => {
    // selection prices at 1250; asking for 400 reduces it; asking for 9999 cannot raise it
    expect(resolveClaimAmount(scope(), [{ index: 0, qty: 1 }], 400)).toMatchObject({ ok: true, amountCents: 400 })
    expect(resolveClaimAmount(scope(), [{ index: 0, qty: 1 }], 9999)).toMatchObject({ ok: true, amountCents: 1250 })
  })

  it('a junk amount (0, negative, float, NaN) falls back to the derived value, never to an error or an inflation', () => {
    for (const bad of [0, -100, 12.5, NaN]) {
      expect(resolveClaimAmount(scope(), null, bad)).toMatchObject({ ok: true, amountCents: 3250 })
    }
  })

  it('no amount and no selection still means the whole remaining authority (an explicit whole-order claim)', () => {
    expect(resolveClaimAmount(scope(), null, null)).toMatchObject({ ok: true, amountCents: 3250, wholeOrder: true })
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH 2 — ITEM-LEVEL AUTHORITY. Batch 1 derived the ceiling from the order alone with
// no branching on the reason, so "article manquant" obtained authority over the WHOLE
// order simply because the shipped client sent no selection. The reason now decides
// whether a whole-order ceiling is available at all.
// ═══════════════════════════════════════════════════════════════════════════════
describe('BATCH 2 — an item-specific reason cannot reach a whole-order ceiling', () => {
  it('ITEM_REQUIRED with no selection → REJECTED, with an actionable message', () => {
    const r = resolveClaimAmount(scope(), null, null, 'ITEM_REQUIRED')
    expect(r).toMatchObject({ ok: false })
    if (!r.ok) expect(r.error).toMatch(/articles concernés/)
  })

  it('ITEM_REQUIRED with a selection → priced from the SERVER lines only', () => {
    expect(resolveClaimAmount(scope(), [{ index: 0, qty: 1 }], null, 'ITEM_REQUIRED'))
      .toMatchObject({ ok: true, amountCents: 1250, wholeOrder: false })
  })

  it('a requested amount CANNOT substitute for the missing selection', () => {
    expect(resolveClaimAmount(scope(), null, 3250, 'ITEM_REQUIRED')).toMatchObject({ ok: false })
    expect(resolveClaimAmount(scope(), null, 100, 'ITEM_REQUIRED')).toMatchObject({ ok: false })
  })

  it('ITEM_REQUIRED on an order whose lines are unreadable fails CLOSED (no whole-order fallback)', () => {
    const legacy = buildClaimScope({ items: null, orderTotalEur: 32.5, alreadyRefundedCents: 0 })
    const r = resolveClaimAmount(legacy, null, null, 'ITEM_REQUIRED')
    expect(r).toMatchObject({ ok: false })
    if (!r.ok) expect(r.error).toMatch(/indisponible/)
  })

  it('ORDER_LEVEL reasons keep a legitimate whole-order ceiling', () => {
    expect(resolveClaimAmount(scope(), null, null, 'ORDER_LEVEL'))
      .toMatchObject({ ok: true, amountCents: 3250, wholeOrder: true })
  })

  it('ITEM_OPTIONAL narrows with a selection and allows the whole order without one', () => {
    expect(resolveClaimAmount(scope(), null, null, 'ITEM_OPTIONAL')).toMatchObject({ ok: true, amountCents: 3250 })
    expect(resolveClaimAmount(scope(), [{ index: 1, qty: 1 }], null, 'ITEM_OPTIONAL')).toMatchObject({ ok: true, amountCents: 600 })
  })

  it('forgery is still rejected under every scope kind', () => {
    for (const kind of ['ITEM_REQUIRED', 'ITEM_OPTIONAL', 'ORDER_LEVEL'] as const) {
      expect(resolveClaimAmount(scope(), [{ index: 0, qty: 99 }], null, kind)).toMatchObject({ ok: false })
      expect(resolveClaimAmount(scope(), [{ index: 42, qty: 1 }], null, kind)).toMatchObject({ ok: false })
      expect(resolveClaimAmount(scope(), [{ index: 0, qty: 1 }, { index: 0, qty: 1 }], null, kind)).toMatchObject({ ok: false })
    }
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

  it('a Dashboard refund of 400 caps a 1000 claim at 600, not 1000', () => {
    const s = dashboardCase()
    expect(s.maxAuthorityCents).toBe(600)
    expect(s.ceilingSource).toBe('stripe')
    expect(resolveClaimAmount(s, null, 1000, 'ORDER_LEVEL')).toMatchObject({ ok: true, amountCents: 600 })
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
    expect(resolveClaimAmount(s, null, 500, 'ORDER_LEVEL')).toMatchObject({ ok: false })
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
    expect(resolveClaimAmount(scope(), null, null, 'ITEM_REQUIRED')).toMatchObject({ ok: false }) // fixed
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
    const r = resolveClaimAmount(promo(), [{ index: 0, qty: 1 }], null, 'ITEM_REQUIRED')
    expect(r).toMatchObject({ ok: true, amountCents: 750 })
  })

  it('both portions claim the whole order — the ceiling is still respected', () => {
    expect(resolveClaimAmount(promo(), [{ index: 0, qty: 2 }], null, 'ITEM_REQUIRED'))
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
    expect(resolveClaimAmount(s, [{ index: 1, qty: 1 }], null, 'ITEM_REQUIRED')).toMatchObject({ ok: true, amountCents: 1000 })
    expect(resolveClaimAmount(s, [{ index: 0, qty: 1 }], null, 'ITEM_REQUIRED')).toMatchObject({ ok: false })
  })
})

// ── NEGATIVE CONTROL ────────────────────────────────────────────────────────────
describe('negative control — list-price pricing on a discounted order would be caught', () => {
  it('the unscaled rule turns one of two portions into 100% of the order', () => {
    const unscaledUnitCents = 1500                    // the LIST price, as before the fix
    const orderTotalCents = 1500                      // what was actually paid
    expect(Math.min(unscaledUnitCents * 1, orderTotalCents)).toBe(1500) // ← the defect
    const fixed = buildClaimScope({ items: [{ name: 'x', qty: 2, price: 15 }], orderTotalEur: 15, alreadyRefundedCents: 0 })
    expect(resolveClaimAmount(fixed, [{ index: 0, qty: 1 }], null, 'ITEM_REQUIRED')).toMatchObject({ amountCents: 750 })
  })
})
