// Promotions restaurateur (chantier P1) — the PURE engine + thin fetch helper.
//
// DOCTRINE (frozen):
//   D1 the RESTO finances its promo — the customer pays the discounted price;
//   D2 Grubano's commission base follows COMMISSION_BASE env:
//      'discounted' (default) = what was PAID (subtotal − discount) | 'list';
//   D4 the client NEVER sends a discount — the server resolves the brand's
//      active promotions and applies the rule;
//   D5 ONE promo per order (the BEST for the customer on overlap), no stacking;
//      V1 types: percent + fixed ONLY (bundle/flash stay in the schema, ignored).
// All money maths round2 at the cent. percent is a WHOLE number (10 = 10 %).
import { prisma } from '@/lib/prisma'

export const round2 = (n: number) => Math.round(n * 100) / 100

export type PromotionRow = {
  id:         string
  type:       string   // percent | fixed (bundle/flash ignored by the V1 engine)
  discount:   number   // percent: whole 1..90 ; fixed: EUR amount
  conditions: unknown  // V1: { minOrderEur?, itemIds?: string[], channels?: string[] } — unknown keys ignored
  startDate:  Date
  endDate:    Date
  active:     boolean
}

export type OrderLine = {
  /** The RAW MenuItem id (composite cart ids are reduced by the caller). */
  rawId: string
  price: number // EUR unit price
  qty:   number
}

export type PromoContext = {
  items:   OrderLine[]
  channel: 'delivery' | 'pickup'
  now?:    Date
}

type V1Conditions = { minOrderEur?: number; itemIds?: string[]; channels?: string[] }

function parseConditions(raw: unknown): V1Conditions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const c = raw as Record<string, unknown>
  const out: V1Conditions = {}
  if (typeof c.minOrderEur === 'number' && c.minOrderEur > 0) out.minOrderEur = c.minOrderEur
  if (Array.isArray(c.itemIds) && c.itemIds.every(x => typeof x === 'string') && c.itemIds.length > 0) {
    out.itemIds = c.itemIds as string[]
  }
  if (Array.isArray(c.channels) && c.channels.every(x => typeof x === 'string') && c.channels.length > 0) {
    out.channels = c.channels as string[]
  }
  return out // any other key: tolerated and ignored (V2 room)
}

/** Evaluate ONE promotion against the order. Returns the discount in EUR
 *  (0 = not applicable). Bounds: never negative, never above the concerned
 *  basket (a fixed 15 € promo on a 10 € basket gives 10 €, total never < 0). */
export function evaluatePromotion(promo: PromotionRow, ctx: PromoContext): number {
  const now = ctx.now ?? new Date()
  if (!promo.active) return 0
  if (promo.type !== 'percent' && promo.type !== 'fixed') return 0 // V1 scope (D5)
  if (now.getTime() < promo.startDate.getTime() || now.getTime() > promo.endDate.getTime()) return 0

  const cond = parseConditions(promo.conditions)
  if (cond.channels && !cond.channels.includes(ctx.channel)) return 0

  // The full pre-discount subtotal (minOrder is evaluated on it — existing pattern).
  const subtotal = round2(ctx.items.reduce((s, l) => s + l.price * l.qty, 0))
  if (cond.minOrderEur && subtotal < cond.minOrderEur) return 0

  // The concerned basket: the targeted items only, else the whole order.
  const basket = cond.itemIds
    ? round2(ctx.items.filter(l => cond.itemIds!.includes(l.rawId)).reduce((s, l) => s + l.price * l.qty, 0))
    : subtotal
  if (basket <= 0) return 0

  const raw = promo.type === 'percent'
    ? basket * (Math.min(Math.max(promo.discount, 0), 100) / 100)
    : promo.discount
  return round2(Math.min(Math.max(raw, 0), basket))
}

/** D5: pick the BEST applicable promotion (highest discount; older first on a
 *  tie for determinism). Returns null when nothing applies. */
export function pickBestPromotion(
  promos: PromotionRow[],
  ctx: PromoContext,
): { promotionId: string; discountEur: number } | null {
  let best: { promotionId: string; discountEur: number } | null = null
  for (const p of promos) {
    const d = evaluatePromotion(p, ctx)
    if (d > 0 && (!best || d > best.discountEur)) {
      best = { promotionId: p.id, discountEur: d }
    }
  }
  return best
}

/** D2 — the commission base in CENTS per COMMISSION_BASE mode. */
export function commissionBaseCents(
  subtotalCents: number,
  discountCents: number,
  mode: 'discounted' | 'list',
): number {
  if (mode === 'list') return Math.max(0, subtotalCents)
  return Math.max(0, subtotalCents - Math.max(0, discountCents))
}

/** The runtime COMMISSION_BASE flag ('discounted' default — D2). */
export function commissionBaseMode(): 'discounted' | 'list' {
  return process.env.COMMISSION_BASE === 'list' ? 'list' : 'discounted'
}

/** Active promotions of an establishment (all its brands), window-filtered at
 *  the DB level. Thin fetch — the decision stays in the pure picker above. */
export async function fetchActivePromotions(restaurantId: string, now: Date = new Date()) {
  return prisma.promotion.findMany({
    where: {
      active:    true,
      startDate: { lte: now },
      endDate:   { gte: now },
      type:      { in: ['percent', 'fixed'] },
      brand:     { restaurantId },
    },
    select: {
      id: true, type: true, discount: true, conditions: true,
      startDate: true, endDate: true, active: true,
    },
  })
}
