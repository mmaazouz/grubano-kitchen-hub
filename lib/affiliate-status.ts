// lib/affiliate-status.ts — Affiliate gamification (Slice 2c, Agent 14). PURE,
// READ-ONLY computation over the existing ReferralOrder/Referral data.
//
// STATUS / RECOGNITION ONLY: tiers, streaks, badges and the leaderboard NEVER
// change the commission rate (30 % for everyone) — they touch no money. All
// amounts in INTEGER CENTS.

// ── Tiers ─────────────────────────────────────────────────────────────────────
// Computed from CUMULATIVE matured earnings. Thresholds are a frozen constant
// (CHOICE NOTED — env override is a trivial future tweak); modest for a launching
// programme. Status only — zero effect on the rate or the payout.
export interface TierDef { key: string; floorCents: number }
export const AFFILIATE_TIERS: TierDef[] = [
  { key: 'bronze',   floorCents: 0 },      // 0 €
  { key: 'silver',   floorCents: 5000 },   // 50 €
  { key: 'gold',     floorCents: 20000 },  // 200 €
  { key: 'platinum', floorCents: 50000 },  // 500 €
]

export interface TierStatus {
  key: string; floorCents: number
  nextKey: string | null; nextFloorCents: number | null
  progressPct: number
}

export function computeTier(maturedCents: number): TierStatus {
  const c = Math.max(0, Math.floor(maturedCents || 0))
  let idx = 0
  for (let i = 0; i < AFFILIATE_TIERS.length; i++) if (c >= AFFILIATE_TIERS[i].floorCents) idx = i
  const cur  = AFFILIATE_TIERS[idx]
  const next = AFFILIATE_TIERS[idx + 1] ?? null
  let progressPct = 100
  if (next) {
    const span = next.floorCents - cur.floorCents
    progressPct = span > 0 ? Math.max(0, Math.min(100, Math.round(((c - cur.floorCents) / span) * 100))) : 0
  }
  return { key: cur.key, floorCents: cur.floorCents, nextKey: next?.key ?? null, nextFloorCents: next?.floorCents ?? null, progressPct }
}

// ── Gain streak ───────────────────────────────────────────────────────────────
// Consecutive WEEKS with ≥1 referred order (the run ending at the most-recent
// active week). NOT a posting streak — the app cannot know when the influencer
// posts; it only knows when a referred ORDER landed.
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
export function weekBucket(ms: number): number { return Math.floor(ms / WEEK_MS) }

export function computeStreakWeeks(datesMs: number[]): number {
  const buckets = Array.from(new Set(datesMs.filter(Number.isFinite).map(weekBucket))).sort((a, b) => b - a)
  if (buckets.length === 0) return 0
  let streak = 1
  for (let i = 1; i < buckets.length; i++) {
    if (buckets[i] === buckets[i - 1] - 1) streak++
    else break
  }
  return streak
}

// ── Badges / milestones (computed booleans) ───────────────────────────────────
export interface BadgeInput { ordersCount: number; newCustomers: number; maturedCents: number }
export type BadgeKey = 'firstSale' | 'tenCustomers' | 'hundredEuros' | 'fiveHundredEuros'
export interface Badge { key: BadgeKey; achieved: boolean }

export function computeBadges(i: BadgeInput): Badge[] {
  return [
    { key: 'firstSale',        achieved: (i.ordersCount  ?? 0) >= 1 },
    { key: 'tenCustomers',     achieved: (i.newCustomers ?? 0) >= 10 },
    { key: 'hundredEuros',     achieved: (i.maturedCents ?? 0) >= 10000 },
    { key: 'fiveHundredEuros', achieved: (i.maturedCents ?? 0) >= 50000 },
  ]
}

// ── Leaderboard ranking (PURE) ────────────────────────────────────────────────
// Ranks influencers by gains, then exposes ONLY rank + name + tier — the € amount
// NEVER leaves this function (privacy: others' exact earnings are not disclosed).
export interface LeaderRow { creatorId: string; name: string; gainCents: number }
export interface LeaderEntry { rank: number; name: string; tierKey: string; isMe: boolean }

export function rankLeaderboard(
  rows: LeaderRow[], meId: string, topN = 10,
): { top: LeaderEntry[]; myRank: number | null; total: number } {
  const sorted = [...rows].sort((a, b) => b.gainCents - a.gainCents || a.name.localeCompare(b.name))
  const top = sorted.slice(0, topN).map((r, i) => ({
    rank: i + 1,
    name: r.name,
    tierKey: computeTier(r.gainCents).key, // derived label, NOT the amount
    isMe: r.creatorId === meId,
  }))
  const myIdx = sorted.findIndex(r => r.creatorId === meId)
  return { top, myRank: myIdx >= 0 ? myIdx + 1 : null, total: sorted.length }
}
