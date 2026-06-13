// tests/affiliate-status.test.ts — Gamification 2c (Agent 14). PURE, status-only.
import { describe, it, expect } from 'vitest'
import {
  computeTier, computeStreakWeeks, computeBadges, rankLeaderboard, weekBucket, AFFILIATE_TIERS,
} from '@/lib/affiliate-status'

describe('computeTier — from cumulative matured cents', () => {
  it('0 € → bronze, progressing toward silver', () => {
    const t = computeTier(0)
    expect(t.key).toBe('bronze')
    expect(t.nextKey).toBe('silver')
    expect(t.progressPct).toBe(0)
  })
  it('exactly a floor lands on that tier', () => {
    expect(computeTier(5000).key).toBe('silver')   // 50 €
    expect(computeTier(20000).key).toBe('gold')     // 200 €
  })
  it('half-way to the next tier → ~50 %', () => {
    // bronze(0)→silver(5000): 2500 → 50 %.
    expect(computeTier(2500).progressPct).toBe(50)
  })
  it('top tier → no next, 100 %', () => {
    const t = computeTier(999999)
    expect(t.key).toBe('platinum')
    expect(t.nextKey).toBeNull()
    expect(t.progressPct).toBe(100)
  })
  it('thresholds are strictly increasing (frozen ladder)', () => {
    for (let i = 1; i < AFFILIATE_TIERS.length; i++) {
      expect(AFFILIATE_TIERS[i].floorCents).toBeGreaterThan(AFFILIATE_TIERS[i - 1].floorCents)
    }
  })
})

describe('computeStreakWeeks — consecutive weeks with ≥1 order', () => {
  const W = 7 * 24 * 60 * 60 * 1000
  const base = weekBucket(Date.UTC(2026, 0, 15)) * W // some anchored week start
  it('no orders → 0', () => { expect(computeStreakWeeks([])).toBe(0) })
  it('one week → 1', () => { expect(computeStreakWeeks([base])).toBe(1) })
  it('three consecutive weeks → 3 (dedup within a week)', () => {
    expect(computeStreakWeeks([base, base + 100, base + W, base + 2 * W])).toBe(3)
  })
  it('a gap breaks the run (counts from the most-recent week)', () => {
    // weeks: latest, latest-1, then a gap, then older → run = 2.
    expect(computeStreakWeeks([base + 4 * W, base + 3 * W, base + W])).toBe(2)
  })
})

describe('computeBadges — milestone booleans', () => {
  it('locks/unlocks at the thresholds', () => {
    const none = computeBadges({ ordersCount: 0, newCustomers: 0, maturedCents: 0 })
    expect(none.every(b => !b.achieved)).toBe(true)
    const all = computeBadges({ ordersCount: 5, newCustomers: 12, maturedCents: 60000 })
    expect(all.every(b => b.achieved)).toBe(true)
    const mid = computeBadges({ ordersCount: 1, newCustomers: 3, maturedCents: 10000 })
    expect(mid.find(b => b.key === 'firstSale')!.achieved).toBe(true)
    expect(mid.find(b => b.key === 'tenCustomers')!.achieved).toBe(false)
    expect(mid.find(b => b.key === 'hundredEuros')!.achieved).toBe(true)
  })
})

describe('rankLeaderboard — rank + name + tier, NEVER the € of others', () => {
  const rows = [
    { creatorId: 'a', name: 'Alice', gainCents: 30000 },
    { creatorId: 'b', name: 'Bob',   gainCents: 8000 },
    { creatorId: 'me',name: 'Me',    gainCents: 1000 },
  ]
  it('sorts by gain desc, assigns ranks + isMe + myRank', () => {
    const r = rankLeaderboard(rows, 'me', 10)
    expect(r.top.map(e => e.name)).toEqual(['Alice', 'Bob', 'Me'])
    expect(r.top[0].rank).toBe(1)
    expect(r.top[2].isMe).toBe(true)
    expect(r.top[0].tierKey).toBe('gold')   // 300 € → gold
    expect(r.myRank).toBe(3)
    expect(r.total).toBe(3)
  })
  it('PRIVACY: no entry exposes a € amount (gainCents stays internal)', () => {
    const r = rankLeaderboard(rows, 'me', 10)
    for (const e of r.top) {
      expect(Object.keys(e).sort()).toEqual(['isMe', 'name', 'rank', 'tierKey'])
      expect(e).not.toHaveProperty('gainCents')
    }
  })
  it('honours topN + still reports my real rank outside it', () => {
    const r = rankLeaderboard(rows, 'me', 1)
    expect(r.top).toHaveLength(1)
    expect(r.myRank).toBe(3)
  })
})
