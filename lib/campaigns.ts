// Chef demand-driver campaigns (Promo V2 Slice 2) — PURE helpers (testable).
//
// DOCTRINE: the chef PROPOSES (a suggested %, a message, a window) and never
// finances. Adopter restaurants OPT IN and finance the discount via a STANDARD
// resto-financed Promotion (the existing engine + guards). This module holds
// only the pure status/window logic — no money math, no DB, no commission.

export type CampaignStatus = 'draft' | 'active' | 'ended'

/** A campaign is LIVE when status='active' AND now is inside its window. */
export function isCampaignLive(
  c: { status: string; startDate: Date; endDate: Date },
  now: Date = new Date(),
): boolean {
  return c.status === 'active'
    && c.startDate.getTime() <= now.getTime()
    && c.endDate.getTime()   >= now.getTime()
}

/** The opt-in Promotion's window: it can never start before now nor end after
 *  the campaign — the resto's promo is BOUNDED BY the campaign window. */
export function optInWindow(
  campaign: { startDate: Date; endDate: Date },
  now: Date = new Date(),
): { start: Date; end: Date } {
  const start = now.getTime() > campaign.startDate.getTime() ? now : campaign.startDate
  return { start, end: campaign.endDate }
}

/** Validate a chef-suggested / resto-chosen percent (whole 1..90). */
export function isValidDiscountPct(pct: number): boolean {
  return Number.isFinite(pct) && Number.isInteger(pct) && pct >= 1 && pct <= 90
}
