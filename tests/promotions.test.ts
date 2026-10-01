import { describe, it, expect } from 'vitest'
import {
  evaluatePromotion, pickBestPromotion, commissionBaseCents, round2,
  type PromotionRow, type PromoContext,
} from '@/lib/promotions'

// ── Chantier P1 — the PURE promotion engine (doctrine D1-D6) ──────────────────
const now  = new Date('2026-06-12T12:00:00Z')
const past = new Date('2026-06-01T00:00:00Z')
const future = new Date('2026-06-30T00:00:00Z')

const promo = (over: Partial<PromotionRow> = {}): PromotionRow => ({
  id: 'p1', type: 'percent', discount: 10, conditions: {},
  startDate: past, endDate: future, active: true, ...over,
})
const ctx = (over: Partial<PromoContext> = {}): PromoContext => ({
  items: [{ rawId: 'dishA', price: 10, qty: 1 }],
  channel: 'delivery', now, ...over,
})

describe('evaluatePromotion — types & bounds', () => {
  it('percent: whole percentage of the basket, rounded at the cent', () => {
    // 10 € × 10 % = 1.00 €
    expect(evaluatePromotion(promo(), ctx())).toBe(1)
    // 23.75 × 2 × 15 % = 7.125 → 7.13 (round2)
    expect(evaluatePromotion(
      promo({ discount: 15 }),
      ctx({ items: [{ rawId: 'dishA', price: 23.75, qty: 2 }] }),
    )).toBe(7.13)
  })

  it('fixed: EUR amount, NEVER above the basket (total never negative)', () => {
    expect(evaluatePromotion(promo({ type: 'fixed', discount: 3 }), ctx())).toBe(3)
    // 15 € fixed on a 10 € basket → capped at 10 €.
    expect(evaluatePromotion(promo({ type: 'fixed', discount: 15 }), ctx())).toBe(10)
  })

  it('never negative; V1 ignores bundle/flash entirely', () => {
    expect(evaluatePromotion(promo({ type: 'fixed', discount: -5 }), ctx())).toBe(0)
    expect(evaluatePromotion(promo({ type: 'bundle' }), ctx())).toBe(0)
    expect(evaluatePromotion(promo({ type: 'flash' }), ctx())).toBe(0)
  })

  it('inactive / outside the date window → not applicable', () => {
    expect(evaluatePromotion(promo({ active: false }), ctx())).toBe(0)
    expect(evaluatePromotion(promo({ startDate: new Date('2026-06-13') }), ctx())).toBe(0)
    expect(evaluatePromotion(promo({ endDate: new Date('2026-06-11') }), ctx())).toBe(0)
  })
})

describe('evaluatePromotion — V1 conditions', () => {
  it('minOrderEur is evaluated on the PRE-discount subtotal', () => {
    const p = promo({ conditions: { minOrderEur: 20 } })
    expect(evaluatePromotion(p, ctx())).toBe(0) // subtotal 10 < 20
    expect(evaluatePromotion(p, ctx({ items: [{ rawId: 'dishA', price: 10, qty: 2 }] }))).toBe(2) // 20 ≥ 20 → 10 %
  })

  it('itemIds: the discount applies to the TARGETED items only (partial basket)', () => {
    const p = promo({ discount: 50, conditions: { itemIds: ['dishA'] } })
    const c = ctx({ items: [
      { rawId: 'dishA', price: 10, qty: 1 },
      { rawId: 'dishB', price: 30, qty: 1 },
    ] })
    expect(evaluatePromotion(p, c)).toBe(5) // 50 % of dishA's 10 €, not of 40 €
    // No targeted item in the cart → not applicable.
    expect(evaluatePromotion(p, ctx({ items: [{ rawId: 'dishB', price: 30, qty: 1 }] }))).toBe(0)
  })

  it('channels: applies only on the listed channels', () => {
    const p = promo({ conditions: { channels: ['pickup'] } })
    expect(evaluatePromotion(p, ctx())).toBe(0)                       // delivery
    expect(evaluatePromotion(p, ctx({ channel: 'pickup' }))).toBe(1) // pickup ✓
  })

  it('unknown condition keys are tolerated and ignored (V2 room)', () => {
    const p = promo({ conditions: { minOrderEur: 5, futureKey: 'whatever', other: 42 } })
    expect(evaluatePromotion(p, ctx())).toBe(1)
  })
})

describe('pickBestPromotion — D5 (one promo, the best, no stacking)', () => {
  it('picks the highest discount on overlap', () => {
    const best = pickBestPromotion([
      promo({ id: 'small', discount: 5 }),                 // 0.50 €
      promo({ id: 'big', type: 'fixed', discount: 2.5 }),  // 2.50 €
      promo({ id: 'mid', discount: 15 }),                  // 1.50 €
    ], ctx())
    expect(best).toEqual({ promotionId: 'big', discountEur: 2.5 })
  })

  it('returns null when nothing applies', () => {
    expect(pickBestPromotion([promo({ active: false })], ctx())).toBeNull()
    expect(pickBestPromotion([], ctx())).toBeNull()
  })
})

describe('commissionBaseCents — D2 (COMMISSION_BASE both modes)', () => {
  it("'discounted' (default): the base is what was PAID (subtotal − discount)", () => {
    expect(commissionBaseCents(10000, 1000, 'discounted')).toBe(9000)
  })
  it("'list': the base stays the list subtotal", () => {
    expect(commissionBaseCents(10000, 1000, 'list')).toBe(10000)
  })
  it('floors at zero, ignores negative discounts', () => {
    expect(commissionBaseCents(1000, 5000, 'discounted')).toBe(0)
    expect(commissionBaseCents(1000, -50, 'discounted')).toBe(1000)
  })
})

describe('round2 — the cent discipline', () => {
  it('rounds at 2 decimals (IEEE-float honest: representable halves go up)', () => {
    expect(round2(7.125)).toBe(7.13)  // 712.5 exactly representable → up
    expect(round2(2.675)).toBe(2.68)  // 267.50000…4 → up
    expect(round2(1.004)).toBe(1)
    expect(round2(1.006)).toBe(1.01)
    // 1.005 is NOT representable (1.005×100 = 100.4999…) → 1.00 — the same
    // arithmetic every money path of the codebase uses; pinned, not hidden.
    expect(round2(1.005)).toBe(1)
  })
})

// ── Promo V2 Slice 1 — second_item + threshold_reward ─────────────────────────
describe('evaluatePromotion — V2 « 2e article à −X% »', () => {
  it('discounts the CHEAPEST unit at X% when ≥ 2 units are present', () => {
    const p = promo({ type: 'second_item', discount: 50 })
    // two units: 12 € and 8 € → cheapest 8 € at −50% = 4 €
    const c = ctx({ items: [{ rawId: 'a', price: 12, qty: 1 }, { rawId: 'b', price: 8, qty: 1 }] })
    expect(evaluatePromotion(p, c)).toBe(4)
  })
  it('same item qty 2 → the 2nd (identical) unit at −50%', () => {
    const p = promo({ type: 'second_item', discount: 50 })
    expect(evaluatePromotion(p, ctx({ items: [{ rawId: 'a', price: 10, qty: 2 }] }))).toBe(5)
  })
  it('a SINGLE unit → no discount (needs a 2nd article)', () => {
    const p = promo({ type: 'second_item', discount: 50 })
    expect(evaluatePromotion(p, ctx({ items: [{ rawId: 'a', price: 10, qty: 1 }] }))).toBe(0)
  })
  it('itemIds scopes which units count', () => {
    const p = promo({ type: 'second_item', discount: 50, conditions: { itemIds: ['a'] } })
    // only one 'a' unit → not enough → 0 (the 'b' unit is out of scope)
    expect(evaluatePromotion(p, ctx({ items: [{ rawId: 'a', price: 10, qty: 1 }, { rawId: 'b', price: 6, qty: 1 }] }))).toBe(0)
  })
})

describe('evaluatePromotion — V2 « Palier-récompense »', () => {
  const reach = (over = {}) => ctx({ items: [{ rawId: 'a', price: 12, qty: 1 }, { rawId: 'b', price: 8, qty: 1 }], ...over }) // subtotal 20
  it('threshold NOT reached → 0', () => {
    const p = promo({ type: 'threshold_reward', discount: 0, conditions: { thresholdEur: 25, rewardKind: 'percent', rewardPct: 20 } })
    expect(evaluatePromotion(p, reach())).toBe(0)            // 20 < 25
  })
  it('threshold reached → percent reward on the subtotal', () => {
    const p = promo({ type: 'threshold_reward', discount: 0, conditions: { thresholdEur: 18, rewardKind: 'percent', rewardPct: 20 } })
    expect(evaluatePromotion(p, reach())).toBe(4)            // 20 ≥ 18 → 20 % of 20 = 4
  })
  it('threshold reached → free_item = cheapest unit of the eligible pool', () => {
    const p = promo({ type: 'threshold_reward', discount: 0, conditions: { thresholdEur: 18, rewardKind: 'free_item', freeItemIds: ['b'] } })
    expect(evaluatePromotion(p, reach())).toBe(8)            // 'b' (8 €) becomes free
  })
  it('free_item with a pool NOT in the cart → 0 (no item to offer)', () => {
    const p = promo({ type: 'threshold_reward', discount: 0, conditions: { thresholdEur: 18, rewardKind: 'free_item', freeItemIds: ['zzz'] } })
    expect(evaluatePromotion(p, reach())).toBe(0)
  })
  it('free_item with NO pool → 0 (an explicit offered-item pool is required — no whole-order giveaway)', () => {
    const p = promo({ type: 'threshold_reward', discount: 0, conditions: { thresholdEur: 18, rewardKind: 'free_item' } })
    expect(evaluatePromotion(p, reach())).toBe(0)            // defense in depth with the create API
  })
})

describe('non-régression — flat percent/fixed inchangé + pickBest sur V2', () => {
  it('le flat percent reste identique (10 % de 10 € = 1 €)', () => {
    expect(evaluatePromotion(promo(), ctx())).toBe(1)
  })
  it('pickBestPromotion choisit le meilleur entre un flat et un V2', () => {
    const flat = promo({ id: 'flat', type: 'percent', discount: 10 })             // 10 % of 20 = 2
    const second = promo({ id: 'sec', type: 'second_item', discount: 50 })        // 50 % of cheapest 8 = 4
    const c = ctx({ items: [{ rawId: 'a', price: 12, qty: 1 }, { rawId: 'b', price: 8, qty: 1 }] })
    expect(pickBestPromotion([flat, second], c)).toEqual({ promotionId: 'sec', discountEur: 4 })
  })
})
