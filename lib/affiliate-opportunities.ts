// lib/affiliate-opportunities.ts — Affiliate « Opportunités / Brief du jour »
// (Slice 2d, Agent 14). PURE + READ-ONLY. HEURISTIC (no LLM).
//
// Ranks what an influencer should promote today and shows a DISPLAY-ONLY gain
// estimate. It imports the EXISTING pure finance helpers to MIRROR the real calc
// (computeApplicationFee / estimateStripeFeeCents / netBeforeAffiliateCents) but
// NEVER modifies them — the number shown is an estimate, not a recomputation of
// any real payout.

import { computeApplicationFee, type RestaurantCommissionFields, type CommissionChannel } from '@/lib/commission'
import { estimateStripeFeeCents } from '@/lib/loyalty'
import { netBeforeAffiliateCents } from '@/lib/pricing'

// ── Display estimate of the influencer gain on a TYPICAL order ────────────────
// ≈ commissionPct × (commission − Stripe − royalty). Royalty is omitted for the
// estimate (it only applies to chef-adopted dishes; omitting it is the honest,
// conservative-for-the-platform choice — CHOICE NOTED). Platform default rate
// (no per-resto override) + a typical order size constant. CLEARLY an estimate.
export const TYPICAL_ORDER_SUBTOTAL_CENTS = 3000 // 30 € of food
export const TYPICAL_ORDER_DELIVERY_CENTS = 199  // 1,99 € delivery
const PLATFORM_DEFAULT: RestaurantCommissionFields = {
  commissionRateDineIn: null, commissionRatePickup: null, commissionRateDelivery: null, commissionFreeUntil: null,
}

export function estimateTypicalGainCents(
  commissionPct: number,
  channel: CommissionChannel = 'delivery',
  subtotalCents: number = TYPICAL_ORDER_SUBTOTAL_CENTS,
  deliveryCents: number = TYPICAL_ORDER_DELIVERY_CENTS,
): number {
  const pct = Number.isFinite(commissionPct) && commissionPct > 0 ? commissionPct : 0.30
  const grossCommissionCents = computeApplicationFee(PLATFORM_DEFAULT, channel, Math.max(0, Math.floor(subtotalCents)))
  const stripeFeeCents = estimateStripeFeeCents(Math.max(0, Math.floor(subtotalCents) + Math.floor(deliveryCents)))
  const netCents = netBeforeAffiliateCents(grossCommissionCents, stripeFeeCents, 0)
  return Math.max(0, Math.round(netCents * pct))
}

// ── Ranking (heuristic) ───────────────────────────────────────────────────────
// campaign (chef demand engine) > promo (resto-financed discount) > converted
// (the influencer's own performers) > popular (cold fallback). Dedup by
// restaurant (one card per resto, highest-priority reason wins). Top N.
export type OpportunityKind = 'campaign' | 'promo' | 'converted' | 'popular'

export const OPPORTUNITY_PRIORITY: Record<OpportunityKind, number> = {
  campaign: 0, promo: 1, converted: 2, popular: 3,
}

export interface OpportunityCandidate {
  kind:           OpportunityKind
  restaurantId:   string
  restaurantName: string
  dishId?:        string | null
  dishName?:      string | null
  /** i18n key + params the client renders as the « pourquoi » (templated, no LLM). */
  reasonKey:      string
  reasonParams?:  Record<string, string | number>
}

export function rankOpportunities(cands: OpportunityCandidate[], max = 3): OpportunityCandidate[] {
  const byPriority = [...cands].sort(
    (a, b) => OPPORTUNITY_PRIORITY[a.kind] - OPPORTUNITY_PRIORITY[b.kind],
  )
  const seen = new Set<string>()
  const out: OpportunityCandidate[] = []
  for (const c of byPriority) {
    if (!c.restaurantId || seen.has(c.restaurantId)) continue
    seen.add(c.restaurantId)
    out.push(c)
    if (out.length >= max) break
  }
  return out
}
