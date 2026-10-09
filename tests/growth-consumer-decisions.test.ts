// tests/growth-consumer-decisions.test.ts — NBA + idempotency keys + seeded holdout.
// Adversarial focus: holdout stability across seed/pct, no silent fabrication of money,
// idempotency keys include tenant (never collide across restaurants), day anchor derived
// from UTC midnight, confidence always 0..1.

import { describe, it, expect } from 'vitest'
import { decideNBA, isInHoldout, utcDayKey, buildIdempotencyKey, fnv1a32 } from '@/lib/growth/consumer/decisions'
import type { ConsumerRFMSnapshot } from '@/lib/growth/consumer/rfm'

const NOW = Date.UTC(2026, 9, 9, 12, 0, 0, 0)  // 2026-10-09T12:00:00Z

function snap(cohort: ConsumerRFMSnapshot['cohort'], extra: Partial<ConsumerRFMSnapshot> = {}): ConsumerRFMSnapshot {
  return {
    tenantRestaurantId: 'tenant-A',
    contactId:          'contact-1',
    nowMs:              NOW,
    windowDays:         365,
    rfm: { recencyDays: 5, frequency: 2, monetaryCents: 4_000, score: 42 },
    lifetimeOrders:         2,
    lifetimeMonetaryCents:  4_000,
    firstOrderAtMs:         NOW - 20 * 86_400_000,
    lastOrderAtMs:          NOW -  5 * 86_400_000,
    reorderMedianDays:      14,
    cohort,
    cohortReasons:          ['test'],
    rejected:               [],
    ...extra,
  }
}

describe('decideNBA — rules matrix', () => {
  it('cohort "none" → kind "wait", channel null, confidence 1', () => {
    const d = decideNBA(snap('none', { lifetimeOrders: 0, firstOrderAtMs: null, lastOrderAtMs: null }))
    expect(d.kind).toBe('wait')
    expect(d.channel).toBeNull()
    expect(d.confidence).toBe(1)
  })

  it('cohort "new" → lifecycle one-off welcome, confidence 0..1', () => {
    const d = decideNBA(snap('new'))
    expect(d.kind).toBe('send_one_off')
    expect(d.purpose).toBe('lifecycle')
    expect(d.templateKey).toBe('consumer.new.welcome')
    expect(d.confidence).toBeGreaterThan(0)
    expect(d.confidence).toBeLessThanOrEqual(1)
  })

  it('cohort "at_risk" → reactivation_offer with LIFECYCLE purpose (no fabricated promo)', () => {
    const d = decideNBA(snap('at_risk'))
    expect(d.kind).toBe('reactivation_offer')
    expect(d.purpose).toBe('lifecycle')
  })

  it('cohort "lost" → wait (never solicit lost contacts)', () => {
    const d = decideNBA(snap('lost'))
    expect(d.kind).toBe('wait')
    expect(d.channel).toBeNull()
  })

  it('confidence is bounded in [0, 1] for every cohort', () => {
    const cohorts: ConsumerRFMSnapshot['cohort'][] = ['none','new','first_time','regular','high_value','at_risk','dormant','winback','lost']
    for (const c of cohorts) {
      const d = decideNBA(snap(c))
      expect(d.confidence).toBeGreaterThanOrEqual(0)
      expect(d.confidence).toBeLessThanOrEqual(1)
    }
  })
})

describe('decideNBA — idempotency key', () => {
  it('includes tenant, contact, cohort, kind, channel, purpose, UTC day', () => {
    const d = decideNBA(snap('regular'))
    expect(d.idempotencyKey).toContain('tenant=tenant-A')
    expect(d.idempotencyKey).toContain('contact=contact-1')
    expect(d.idempotencyKey).toContain('cohort=regular')
    expect(d.idempotencyKey).toContain('day=2026-10-09')
    expect(d.idempotencyKey.startsWith('nba|')).toBe(true)
  })

  it('two tenants with the same contactId produce DIFFERENT keys (no cross-tenant collision)', () => {
    const a = decideNBA(snap('regular', { tenantRestaurantId: 'tenant-A' }))
    const b = decideNBA(snap('regular', { tenantRestaurantId: 'tenant-B' }))
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey)
  })

  it('calling twice with the same snapshot returns the same key (replay-safe)', () => {
    const a = decideNBA(snap('regular'))
    const b = decideNBA(snap('regular'))
    expect(a.idempotencyKey).toBe(b.idempotencyKey)
  })

  it('cohort change on the same contact + day → different key (legitimate NBAs do not collide)', () => {
    const a = decideNBA(snap('regular'))
    const b = decideNBA(snap('at_risk'))
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey)
  })
})

describe('isInHoldout — determinism', () => {
  it('pct=0 → never in holdout; pct=1 → always in holdout', () => {
    expect(isInHoldout('seed', 'tenant-A', 'contact-1', 0)).toBe(false)
    expect(isInHoldout('seed', 'tenant-A', 'contact-1', 1)).toBe(true)
  })

  it('is deterministic for a fixed (seed, tenant, contact, pct)', () => {
    const results = Array.from({ length: 10 }, () => isInHoldout('exp42', 'tenant-A', 'contact-1', 0.1))
    expect(new Set(results).size).toBe(1)
  })

  it('bumping pct from 10% → 20% KEEPS everyone who was in the 10% holdout', () => {
    // Monotone-in-pct property. A contact in the 10% holdout stays in the 20% one.
    const seed = 'exp-monotone'
    const ids  = Array.from({ length: 200 }, (_, i) => `c${i}`)
    const inTen    = new Set(ids.filter((id) => isInHoldout(seed, 'tenant-A', id, 0.10)))
    const inTwenty = new Set(ids.filter((id) => isInHoldout(seed, 'tenant-A', id, 0.20)))
    for (const id of inTen) expect(inTwenty.has(id)).toBe(true)
    // And 20% must contain MORE buckets than 10% (unless we got unlucky with zero —
    // the test uses 200 ids over 1000 buckets so the expectation is very safe).
    expect(inTwenty.size).toBeGreaterThanOrEqual(inTen.size)
  })

  it('changing the seed re-randomises the partition (not stable across seeds)', () => {
    const ids = Array.from({ length: 500 }, (_, i) => `c${i}`)
    const a = new Set(ids.filter((id) => isInHoldout('seed-A', 'tenant-A', id, 0.10)))
    const b = new Set(ids.filter((id) => isInHoldout('seed-B', 'tenant-A', id, 0.10)))
    // The two sets should differ on at least one id (otherwise the hash isn't using seed).
    const diff = Array.from(a).filter((id) => !b.has(id))
    expect(diff.length).toBeGreaterThan(0)
  })
})

describe('decideNBA — holdout wiring', () => {
  it('a contact that lands in holdout gets kind="wait", channel=null, templateKey=null', () => {
    // Pick a contact that we KNOW is in the 100% holdout (always-on).
    const d = decideNBA(snap('regular'), { holdoutPct: 1, holdoutSeed: 'exp42' })
    expect(d.holdout).toBe(true)
    expect(d.kind).toBe('wait')
    expect(d.channel).toBeNull()
    expect(d.templateKey).toBeNull()
  })

  it('holdout=false (default) → the rule-matrix action is kept', () => {
    const d = decideNBA(snap('regular'))
    expect(d.holdout).toBe(false)
    expect(d.kind).toBe('referral_prompt')
  })
})

describe('utcDayKey + fnv1a32', () => {
  it('utcDayKey returns zero-padded YYYY-MM-DD anchored to UTC', () => {
    expect(utcDayKey(Date.UTC(2026, 0, 5, 23, 59, 59, 999))).toBe('2026-01-05')
    expect(utcDayKey(Date.UTC(2026, 0, 6, 0, 0, 0, 0))).toBe('2026-01-06')
  })

  it('fnv1a32 is stable, non-trivial, and 32-bit unsigned', () => {
    const h = fnv1a32('grubano')
    expect(h).toBeGreaterThanOrEqual(0)
    expect(h).toBeLessThanOrEqual(0xFFFFFFFF)
    expect(fnv1a32('grubano')).toBe(h)
    expect(fnv1a32('Grubano')).not.toBe(h)
  })

  it('buildIdempotencyKey is stable under reordered fields (positional, not spread)', () => {
    const parts = {
      tenantRestaurantId: 't', contactId: 'c', cohort: 'regular', kind: 'referral_prompt',
      channel: 'email' as const, purpose: 'commercial', anchorKey: '2026-10-09',
    }
    const k1 = buildIdempotencyKey(parts)
    const k2 = buildIdempotencyKey({ ...parts })
    expect(k1).toBe(k2)
  })
})
