// tests/growth-scoring.test.ts — business-engine Phase 0/1 scoring.
// Exercises the pure deterministic scoring in lib/growth/scoring.ts: merchant fit, merchant
// intent (time-decayed), consumer RFM, lifecycle state, reorder window, churn risk.
// No I/O, no mocks — all inputs explicit.

import { describe, it, expect } from 'vitest'
import {
  merchantFitScore, merchantIntentScore,
  consumerRFM, consumerLifecycleState, reorderWindowDays, churnRisk,
} from '@/lib/growth/scoring'
import type { MerchantProspect } from '@/lib/growth/types'

const baseProspect: Pick<MerchantProspect, 'role' | 'siren' | 'legalName' | 'domain' | 'city' | 'cuisineTags' | 'sizeSignals' | 'countryIso2'> = {
  role: 'restaurant',
  siren: '123456789',
  legalName: 'Trattoria Example',
  domain: 'example.fr',
  city: 'Paris',
  countryIso2: 'FR',
  cuisineTags: ['italian', 'pizza'],
  sizeSignals: { branches: 2 },
}

describe('merchantFitScore', () => {
  it('bounded 0..100', () => {
    const r = merchantFitScore({ prospect: baseProspect })
    expect(r.score).toBeGreaterThanOrEqual(0)
    expect(r.score).toBeLessThanOrEqual(100)
  })

  it('verified identity contributes 20, missing SIREN contributes 0', () => {
    const withSiren    = merchantFitScore({ prospect: baseProspect }).components.verified_identity
    const withoutSiren = merchantFitScore({ prospect: { ...baseProspect, siren: null } }).components.verified_identity
    expect(withSiren).toBe(20)
    expect(withoutSiren).toBe(0)
  })

  it('non-FR country gets a heavy penalty', () => {
    const r = merchantFitScore({ prospect: { ...baseProspect, countryIso2: 'US' } })
    expect(r.components.country_match).toBeLessThan(0)
  })

  it('null countryIso2 FAILS CLOSED — penalised the same as non-FR, not given a free FR bonus', () => {
    // The naive `(countryIso2 ?? 'FR')` default makes an unknown prospect score as FR, which
    // would bubble them above a verified FR competitor in the pipeline queue and could feed
    // them into FR-only cold B2B sequences. Doctrine: unknown country ⇒ cannot prove
    // in-territory ⇒ score as if out-of-territory. Fix in scoring, not at the sequence gate.
    const r = merchantFitScore({ prospect: { ...baseProspect, countryIso2: null } })
    expect(r.components.country_match).toBeLessThan(0)
  })

  it('city match only scored when targetCities provided; score reflects the match', () => {
    const unscored = merchantFitScore({ prospect: baseProspect })
    expect('city_match' in unscored.components).toBe(false)
    const matched = merchantFitScore({ prospect: baseProspect, targetCities: ['paris', 'lyon'] })
    expect(matched.components.city_match).toBe(15)
    const missed  = merchantFitScore({ prospect: { ...baseProspect, city: 'Marseille' }, targetCities: ['paris', 'lyon'] })
    expect(missed.components.city_match).toBe(0)
  })

  it('cuisine match only applies to restaurant role', () => {
    const rest = merchantFitScore({ prospect: baseProspect, targetCuisines: ['italian'] })
    expect(rest.components.cuisine_match).toBe(15)
    const sup  = merchantFitScore({ prospect: { ...baseProspect, role: 'supplier' }, targetCuisines: ['italian'] })
    expect('cuisine_match' in sup.components).toBe(false)
  })

  it('role prior is deterministic', () => {
    const r1 = merchantFitScore({ prospect: baseProspect }).components.role
    const r2 = merchantFitScore({ prospect: { ...baseProspect, role: 'affiliate' } }).components.role
    expect(r1).toBe(20)   // restaurant
    expect(r2).toBe(10)   // affiliate
  })
})

describe('merchantIntentScore', () => {
  const now = Date.UTC(2026, 9, 8, 12, 0)
  const d  = (days: number) => now - days * 86_400_000

  it('is 0 with no signals', () => {
    const r = merchantIntentScore({ nowMs: now, signals: { visitsMs: [], opensMs: [], clicksMs: [], repliesMs: [], formAbandonsMs: [] } })
    expect(r.score).toBe(0)
  })

  it('decays with age — a signal today weighs more than one 14 days old', () => {
    const today = merchantIntentScore({ nowMs: now, signals: { visitsMs: [d(0)], opensMs: [], clicksMs: [], repliesMs: [], formAbandonsMs: [] } }).components.visits
    const old   = merchantIntentScore({ nowMs: now, signals: { visitsMs: [d(14)], opensMs: [], clicksMs: [], repliesMs: [], formAbandonsMs: [] } }).components.visits
    expect(today).toBeGreaterThan(old)
  })

  it('replies dominate opens', () => {
    const openOnly  = merchantIntentScore({ nowMs: now, signals: { visitsMs: [], opensMs: [d(0)], clicksMs: [], repliesMs: [], formAbandonsMs: [] } }).score
    const replyOnly = merchantIntentScore({ nowMs: now, signals: { visitsMs: [], opensMs: [],       clicksMs: [], repliesMs: [d(0)], formAbandonsMs: [] } }).score
    expect(replyOnly).toBeGreaterThan(openOnly)
  })

  it('ignores signals older than 30 days', () => {
    const r = merchantIntentScore({ nowMs: now, signals: { visitsMs: [d(45)], opensMs: [], clicksMs: [], repliesMs: [], formAbandonsMs: [] } })
    expect(r.score).toBe(0)
  })

  it('score is clamped to 100', () => {
    const spam = { visitsMs: Array(1000).fill(now), opensMs: [], clicksMs: [], repliesMs: Array(1000).fill(now), formAbandonsMs: [] }
    const r = merchantIntentScore({ nowMs: now, signals: spam })
    expect(r.score).toBeLessThanOrEqual(100)
  })
})

describe('consumerRFM', () => {
  const now = Date.UTC(2026, 9, 8, 12, 0)
  const d  = (days: number) => now - days * 86_400_000

  it('yields recency=Infinity, 0 frequency, 0 monetary for a contact with no orders', () => {
    const r = consumerRFM({ nowMs: now, orders: [] })
    expect(r.recencyDays).toBe(Number.POSITIVE_INFINITY)
    expect(r.frequency).toBe(0)
    expect(r.monetaryCents).toBe(0)
    expect(r.score).toBe(0)
  })

  it('counts orders inside the window only', () => {
    const r = consumerRFM({
      nowMs: now,
      orders: [{ atMs: d(1), valueCents: 1000 }, { atMs: d(400), valueCents: 2000 }],
    })
    expect(r.frequency).toBe(1)
    expect(r.monetaryCents).toBe(1000)
  })

  it('score ranks a recent frequent spender above a lapsed one', () => {
    const recent  = consumerRFM({ nowMs: now, orders: [{ atMs: d(5), valueCents: 1500 }, { atMs: d(20), valueCents: 1500 }, { atMs: d(60), valueCents: 1500 }] })
    const lapsed  = consumerRFM({ nowMs: now, orders: [{ atMs: d(55), valueCents: 1500 }] })
    expect(recent.score).toBeGreaterThan(lapsed.score)
  })
})

describe('reorderWindowDays', () => {
  const now = Date.UTC(2026, 9, 8, 12, 0)
  const d  = (days: number) => now - days * 86_400_000

  it('returns fallback when fewer than 2 orders', () => {
    expect(reorderWindowDays([], 21)).toBe(21)
    expect(reorderWindowDays([{ atMs: d(1), valueCents: 1000 }], 30)).toBe(30)
  })

  it('median of inter-order gaps', () => {
    // gaps = [10, 20, 30] → median 20
    const orders = [
      { atMs: d(60), valueCents: 1000 },
      { atMs: d(50), valueCents: 1000 },
      { atMs: d(30), valueCents: 1000 },
      { atMs: d(0),  valueCents: 1000 },
    ]
    expect(reorderWindowDays(orders)).toBe(20)
  })

  it('clamps at a 1-day minimum', () => {
    // same-day gaps collapse → fallback kicks in; still ≥1
    expect(reorderWindowDays([{ atMs: d(0), valueCents: 1 }, { atMs: d(0), valueCents: 1 }])).toBeGreaterThanOrEqual(1)
  })
})

describe('consumerLifecycleState', () => {
  const now = Date.UTC(2026, 9, 8, 12, 0)
  const d  = (days: number) => now - days * 86_400_000

  it("frequency ≤ 1 ⇒ 'new' regardless of recency", () => {
    const rfm = consumerRFM({ nowMs: now, orders: [{ atMs: d(2), valueCents: 1000 }] })
    expect(consumerLifecycleState(rfm, 21)).toBe('new')
  })

  it('recency ≤ 1× baseline ⇒ active', () => {
    const rfm = consumerRFM({ nowMs: now, orders: [{ atMs: d(10), valueCents: 1000 }, { atMs: d(5), valueCents: 1000 }] })
    expect(consumerLifecycleState(rfm, 10)).toBe('active')
  })

  it('1×..2× baseline ⇒ at_risk', () => {
    const rfm = consumerRFM({ nowMs: now, orders: [{ atMs: d(30), valueCents: 1000 }, { atMs: d(15), valueCents: 1000 }] })
    expect(consumerLifecycleState(rfm, 10)).toBe('at_risk')
  })

  it('2×..4× baseline ⇒ dormant', () => {
    const rfm = consumerRFM({ nowMs: now, orders: [{ atMs: d(60), valueCents: 1000 }, { atMs: d(30), valueCents: 1000 }] })
    expect(consumerLifecycleState(rfm, 10)).toBe('dormant')
  })

  it('> 4× baseline ⇒ lost', () => {
    const rfm = consumerRFM({ nowMs: now, orders: [{ atMs: d(90), valueCents: 1000 }, { atMs: d(80), valueCents: 1000 }], windowDays: 365 })
    expect(consumerLifecycleState(rfm, 10)).toBe('lost')
  })
})

describe('churnRisk', () => {
  const now = Date.UTC(2026, 9, 8, 12, 0)
  const d  = (days: number) => now - days * 86_400_000

  it('monotone in recency/baseline ratio', () => {
    const rfmActive = consumerRFM({ nowMs: now, orders: [{ atMs: d(5),  valueCents: 1000 }, { atMs: d(1), valueCents: 1000 }] })
    const rfmLapse  = consumerRFM({ nowMs: now, orders: [{ atMs: d(5),  valueCents: 1000 }, { atMs: d(30), valueCents: 1000 }] })
    const rfmLost   = consumerRFM({ nowMs: now, orders: [{ atMs: d(90), valueCents: 1000 }, { atMs: d(80), valueCents: 1000 }], windowDays: 365 })
    const a = churnRisk(rfmActive, 10)
    const b = churnRisk(rfmLapse,  10)
    const c = churnRisk(rfmLost,   10)
    expect(a).toBeLessThan(b)
    expect(b).toBeLessThan(c)
    expect(c).toBe(1)
  })

  it('returns 1 if there are no orders', () => {
    const rfm = consumerRFM({ nowMs: now, orders: [] })
    expect(churnRisk(rfm, 10)).toBe(1)
  })
})
