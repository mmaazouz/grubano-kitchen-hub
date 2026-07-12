// tests/affiliate-opportunities.test.ts — « Brief du jour » 2d (Agent 14). PURE.
import { describe, it, expect } from 'vitest'
import {
  rankOpportunities, estimateTypicalGainCents, OPPORTUNITY_PRIORITY,
  type OpportunityCandidate,
} from '@/lib/affiliate-opportunities'

const c = (kind: OpportunityCandidate['kind'], restaurantId: string): OpportunityCandidate =>
  ({ kind, restaurantId, restaurantName: restaurantId.toUpperCase(), reasonKey: `oppReason${kind}` })

describe('rankOpportunities — priority + dedup + cap', () => {
  it('orders campaign > promo > converted > popular', () => {
    const out = rankOpportunities([c('popular', 'r4'), c('converted', 'r3'), c('promo', 'r2'), c('campaign', 'r1')], 4)
    expect(out.map(o => o.kind)).toEqual(['campaign', 'promo', 'converted', 'popular'])
    expect(OPPORTUNITY_PRIORITY.campaign).toBeLessThan(OPPORTUNITY_PRIORITY.popular)
  })
  it('dedups by restaurant — the highest-priority reason wins', () => {
    const out = rankOpportunities([c('popular', 'rA'), c('campaign', 'rA'), c('promo', 'rB')], 3)
    expect(out).toHaveLength(2)
    expect(out.find(o => o.restaurantId === 'rA')!.kind).toBe('campaign')
  })
  it('caps at max', () => {
    expect(rankOpportunities([c('campaign', 'a'), c('promo', 'b'), c('converted', 'c'), c('popular', 'd')], 3)).toHaveLength(3)
  })
  it('skips candidates without a restaurantId', () => {
    expect(rankOpportunities([{ kind: 'popular', restaurantId: '', restaurantName: '', reasonKey: 'x' }], 3)).toHaveLength(0)
  })
})

describe('estimateTypicalGainCents — display estimate (read-only helpers)', () => {
  it('≈ 30 % × (commission − Stripe) on a typical delivery order', () => {
    // gross = round(3000×0.12)=360 ; stripe = round(3199×0.029)+25=118 ;
    // net = 242 ; gain = round(242×0.30)=73.
    expect(estimateTypicalGainCents(0.30)).toBe(73)
  })
  it('is positive and never exceeds the commission', () => {
    const g = estimateTypicalGainCents(0.30)
    expect(g).toBeGreaterThan(0)
    expect(g).toBeLessThan(360) // < the gross commission on a 30 € order
  })
  it('falls back to 30 % on a garbage rate', () => {
    expect(estimateTypicalGainCents(0)).toBe(estimateTypicalGainCents(0.30))
    expect(estimateTypicalGainCents(Number.NaN)).toBe(estimateTypicalGainCents(0.30))
  })
})
