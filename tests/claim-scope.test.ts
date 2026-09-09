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
