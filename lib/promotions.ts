// Promotions restaurateur (chantier P1 → Promo V2 Slice 1) — PURE engine + fetch.
//
// DOCTRINE (frozen):
//   D1 the RESTO finances its promo — the customer pays the discounted price;
//   D2 Grubano's commission base follows COMMISSION_BASE env:
//      'discounted' (default) = what was PAID (subtotal − discount) | 'list';
//   D4 the client NEVER sends a discount — the server resolves the brand's
//      active promotions and applies the rule;
//   D5 ONE promo per order (the BEST for the customer on overlap), no stacking.
//   Types: percent + fixed (V1, INTACT) + second_item + threshold_reward (V2).
//   ALL types write the SAME Order.discount/promotionId via pickBestPromotion —
//   commission/royalty/loyalty are computed OUTSIDE this module and untouched.
// All money maths round2 at the cent. percent is a WHOLE number (10 = 10 %).
import { prisma } from '@/lib/prisma'

export const round2 = (n: number) => Math.round(n * 100) / 100

export type PromotionRow = {
  id:         string
  // percent | fixed (V1) · second_item | threshold_reward (V2). Unknown → ignored.
  type:       string
  discount:   number   // percent/second_item: whole 1..90 ; fixed: EUR amount
  conditions: unknown  // see Conditions below — unknown keys tolerated
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

type Conditions = {
  minOrderEur?: number
  itemIds?:     string[]
  channels?:    string[]
  // ── V2 (threshold_reward) ─────────────────────────────────────────────────
  thresholdEur?: number               // subtotal gate for the reward
  rewardKind?:   'percent' | 'free_item'
  rewardPct?:    number               // 'percent' reward: 1..90 (else falls back to promo.discount)
  freeItemIds?:  string[]             // 'free_item' reward: the eligible « offered » item pool
}

function parseConditions(raw: unknown): Conditions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const c = raw as Record<string, unknown>
  const out: Conditions = {}
  if (typeof c.minOrderEur === 'number' && c.minOrderEur > 0) out.minOrderEur = c.minOrderEur
  if (Array.isArray(c.itemIds) && c.itemIds.every(x => typeof x === 'string') && c.itemIds.length > 0) {
    out.itemIds = c.itemIds as string[]
  }
  if (Array.isArray(c.channels) && c.channels.every(x => typeof x === 'string') && c.channels.length > 0) {
    out.channels = c.channels as string[]
  }
  if (typeof c.thresholdEur === 'number' && c.thresholdEur > 0) out.thresholdEur = c.thresholdEur
  if (c.rewardKind === 'percent' || c.rewardKind === 'free_item') out.rewardKind = c.rewardKind
  if (typeof c.rewardPct === 'number' && c.rewardPct > 0) out.rewardPct = c.rewardPct
  if (Array.isArray(c.freeItemIds) && c.freeItemIds.every(x => typeof x === 'string') && c.freeItemIds.length > 0) {
    out.freeItemIds = c.freeItemIds as string[]
  }
  return out // any other key: tolerated and ignored
}

const clampPct = (x: number) => Math.min(Math.max(x, 0), 100) / 100

/** Expand the (optionally id-filtered) lines into per-UNIT prices. */
function units(items: OrderLine[], ids?: string[]): number[] {
  const lines = ids ? items.filter(l => ids.includes(l.rawId)) : items
  const out: number[] = []
  for (const l of lines) {
    const q = Math.max(0, Math.floor(l.qty))
    for (let i = 0; i < q; i++) out.push(l.price)
  }
  return out
}

/** Evaluate ONE promotion against the order. Returns the discount in EUR
 *  (0 = not applicable). Bounds: never negative, never above the order subtotal
 *  (the total can never go < 0). */
export function evaluatePromotion(promo: PromotionRow, ctx: PromoContext): number {
  const now = ctx.now ?? new Date()
  if (!promo.active) return 0
  if (now.getTime() < promo.startDate.getTime() || now.getTime() > promo.endDate.getTime()) return 0

  const cond = parseConditions(promo.conditions)
  if (cond.channels && !cond.channels.includes(ctx.channel)) return 0

  // The full pre-discount subtotal (minOrder/threshold are evaluated on it).
  const subtotal = round2(ctx.items.reduce((s, l) => s + l.price * l.qty, 0))
  if (subtotal <= 0) return 0
  if (cond.minOrderEur && subtotal < cond.minOrderEur) return 0

  // ── V1 — percent / fixed (INTACT) ──────────────────────────────────────────
  if (promo.type === 'percent' || promo.type === 'fixed') {
    const basket = cond.itemIds
      ? round2(ctx.items.filter(l => cond.itemIds!.includes(l.rawId)).reduce((s, l) => s + l.price * l.qty, 0))
      : subtotal
    if (basket <= 0) return 0
    const raw = promo.type === 'percent' ? basket * clampPct(promo.discount) : promo.discount
    return round2(Math.min(Math.max(raw, 0), basket))
  }

  // ── V2 — « 2e article à −X% » ──────────────────────────────────────────────
  // CHOIX NOTÉ : on remise la SEULE unité la moins chère du panier concerné
  // (id-filtré si itemIds), et seulement à partir de 2 unités concernées.
  if (promo.type === 'second_item') {
    const u = units(ctx.items, cond.itemIds)
    if (u.length < 2) return 0
    const cheapest = Math.min(...u)
    return round2(Math.min(Math.max(cheapest * clampPct(promo.discount), 0), subtotal))
  }

  // ── V2 — « Palier-récompense » ─────────────────────────────────────────────
  // subtotal ≥ thresholdEur → récompense : 'percent' (rewardPct% du sous-total)
  // ou 'free_item' (l'unité la moins chère du pool freeItemIds, offerte).
  // CHOIX NOTÉ : « points bonus » reporté (écrirait au ledger fidélité dans
  // orders/route — hors moteur pur ; non livré en Slice 1).
  if (promo.type === 'threshold_reward') {
    if (!cond.thresholdEur || subtotal < cond.thresholdEur) return 0
    if (cond.rewardKind === 'free_item') {
      // The « offered item » pool MUST be explicit (defense in depth with the
      // create API): no freeItemIds → no reward (never « cheapest of the whole
      // order », which would silently give away an item on every order).
      if (!cond.freeItemIds) return 0
      const pool = units(ctx.items, cond.freeItemIds)
      if (pool.length === 0) return 0
      return round2(Math.min(Math.min(...pool), subtotal))
    }
    // default reward kind: percent
    const pctVal = cond.rewardPct ?? promo.discount
    return round2(Math.min(Math.max(subtotal * clampPct(pctVal), 0), subtotal))
  }

  return 0 // unknown type
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
 *  the DB level. Thin fetch — the decision stays in the pure picker above.
 *
 *  P1-PROMO: a CODE-promo (Promotion.code != null) must NEVER auto-apply — it
 *  is opt-in only (the customer types the code in the cart, resolveCodePromo
 *  validates it). The `code: null` filter removes them here. Byte-identical
 *  today: no Promotion has a `code` yet, so the filter removes nothing. */
export async function fetchActivePromotions(restaurantId: string, now: Date = new Date()) {
  return prisma.promotion.findMany({
    where: {
      active:    true,
      startDate: { lte: now },
      endDate:   { gte: now },
      type:      { in: ['percent', 'fixed', 'second_item', 'threshold_reward'] },
      code:      null,                  // P1-PROMO — exclude code-promos from the auto-best
      brand:     { restaurantId },
    },
    // Oldest first → pickBestPromotion's « older wins on a discount tie » is now
    // deterministic (the DB no longer returns an arbitrary order).
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, type: true, discount: true, conditions: true,
      startDate: true, endDate: true, active: true,
    },
  })
}

// ── P1-PROMO — consumer promo CODES ──────────────────────────────────────────
// A code-promo is a STANDARD resto-financed Promotion (same types, same per-type
// discount math via evaluatePromotion) that carries a `code` and NEVER
// auto-applies (excluded from fetchActivePromotions). The customer types the code
// in the cart; the SERVER resolves + applies it. One redemption per user per code
// (PromoRedemption unique on (promotionId, userId)). The client never sends a
// discount amount — this returns the server-computed EUR figure only.

export type ResolvedCodePromo = {
  promotionId: string
  discountEur: number
  type:        string
  label:       string
}

/** Resolve a typed promo CODE for a restaurant's cart.
 *
 *  Returns the server-computed discount (reusing evaluatePromotion's per-type
 *  math) for an ACTIVE code-promo whose `code` matches (case-insensitive) a brand
 *  SERVED BY this restaurant. Returns null when: no such code, expired/inactive,
 *  wrong brand, no discount applies to this basket, or — when `userId` is given —
 *  the user has already redeemed it (PromoRedemption). Without a `userId` (guest
 *  preview) the redeemed-check is skipped. Best-effort safe: a thrown query
 *  bubbles to the caller's try/catch (the order proceeds at full price). */
export async function resolveCodePromo(
  restaurantId: string,
  code: string,
  userId?: string,
  ctx?: { items: OrderLine[]; channel: 'delivery' | 'pickup'; now?: Date },
): Promise<ResolvedCodePromo | null> {
  const normalized = code.trim().toUpperCase()
  if (!normalized) return null
  const now = ctx?.now ?? new Date()

  // ACTIVE code-promo for a brand served by this restaurant. Compare the stored
  // code case-insensitively by uppercasing the input AND requiring the stored
  // code to equal it — promo codes are created/stored uppercased by convention;
  // we additionally tolerate a lowercase stored value via the OR below.
  const promo = await prisma.promotion.findFirst({
    where: {
      active:    true,
      startDate: { lte: now },
      endDate:   { gte: now },
      type:      { in: ['percent', 'fixed', 'second_item', 'threshold_reward'] },
      brand:     { restaurantId },
      OR: [{ code: normalized }, { code: normalized.toLowerCase() }],
    },
    select: {
      id: true, type: true, discount: true, conditions: true, name: true,
      startDate: true, endDate: true, active: true,
    },
    orderBy: { createdAt: 'asc' },
  })
  if (!promo) return null

  // One redemption per user per code — refuse a code this user already burned.
  if (userId) {
    const already = await prisma.promoRedemption.findUnique({
      where: { promotionId_userId: { promotionId: promo.id, userId } },
      select: { id: true },
    })
    if (already) return null
  }

  // Reuse the SAME per-type discount math as the auto-best engine. When no cart
  // context is provided (defensive), there is nothing to discount → null.
  const discountEur = ctx
    ? evaluatePromotion(
        {
          id: promo.id, type: promo.type, discount: promo.discount,
          conditions: promo.conditions, startDate: promo.startDate,
          endDate: promo.endDate, active: promo.active,
        },
        { items: ctx.items, channel: ctx.channel, now },
      )
    : 0
  if (discountEur <= 0) return null

  return { promotionId: promo.id, discountEur, type: promo.type, label: promo.name }
}
