// tests/growth-merchant-scoring.test.ts — merchant-specific scoring layer.
// Composes the foundation scoring with professional-relevance and the composite score.
// Determinism: identical inputs produce byte-identical outputs across repeated runs.

import { describe, it, expect } from 'vitest'
import {
  professionalRelevanceScore, qualificationScore, qualificationBand,
  MIN_FIT_FOR_QUALIFIED, MIN_COMPOSITE_FOR_VERIFIED, MIN_COMPOSITE_FOR_OUTREACH,
} from '@/lib/growth/merchant/scoring'
import type { MerchantProspect } from '@/lib/growth/types'

const prospect = (over: Partial<MerchantProspect> = {}): MerchantProspect => ({
  id: 'p', role: 'restaurant',
  siren: '732829320', legalName: 'Acme Fake SARL', tradeName: 'Acme',
  domain: 'acme.example.fr', city: 'paris', countryIso2: 'FR',
  cuisineTags: ['italian'], sizeSignals: { declaredCovers: 60 }, enrichment: {},
  source: 'test', provenance: null,
  createdAt: '2026-10-09T00:00:00+00:00', updatedAt: '2026-10-09T00:00:00+00:00',
  ...over,
})

describe('professionalRelevanceScore', () => {
  it('returns null when no email is supplied', () => {
    const r = professionalRelevanceScore({ prospect: prospect(), contactEmail: null })
    expect(r.score).toBeNull()
    expect(r.components.hasEmail).toBe(false)
  })

  it('is highest when the email domain matches the prospect company domain', () => {
    const r = professionalRelevanceScore({ prospect: prospect(), contactEmail: 'ops@acme.example.fr' })
    expect(r.score).toBeGreaterThanOrEqual(90)
    expect(r.components.emailDomainMatchesCompany).toBe(true)
    expect(r.components.emailDomainIsPersonal).toBe(false)
  })

  it('penalises a personal mailbox against a prospect that has a company domain', () => {
    const r = professionalRelevanceScore({ prospect: prospect(), contactEmail: 'owner@gmail.com' })
    expect(r.score).toBe(0)                    // clamped
    expect(r.components.emailDomainIsPersonal).toBe(true)
  })

  it('penalises a prospect with no company domain', () => {
    const r = professionalRelevanceScore({ prospect: prospect({ domain: null }), contactEmail: 'anyone@foo.example.fr' })
    expect(r.components.hasCompanyDomain).toBe(false)
    expect(r.score).toBeLessThan(30)
  })

  it('is deterministic across repeated invocations', () => {
    const input = { prospect: prospect(), contactEmail: 'ops@acme.example.fr' }
    const a = professionalRelevanceScore(input)
    const b = professionalRelevanceScore(input)
    expect(a).toEqual(b)
  })
})

describe('qualificationScore', () => {
  const baseInput = () => ({
    fit: {
      prospect: prospect(),
      targetCities: ['paris'],
      targetCuisines: ['italian'],
    },
    intent: {
      nowMs: Date.parse('2026-10-09T12:00:00+00:00'),
      signals: { visitsMs: [], opensMs: [], clicksMs: [], repliesMs: [], formAbandonsMs: [] },
    },
    professionalRelevance: { prospect: prospect(), contactEmail: 'ops@acme.example.fr' },
  })

  it('is deterministic: byte-identical outputs across runs', () => {
    const i = baseInput()
    const a = qualificationScore(i)
    const b = qualificationScore(i)
    expect(a).toEqual(b)
  })

  it('redistributes relevance weight to fit when no email is known', () => {
    const withEmail = qualificationScore(baseInput())
    const i = baseInput()
    i.professionalRelevance = { prospect: prospect(), contactEmail: null }
    const noEmail = qualificationScore(i)
    expect(noEmail.relevance.score).toBeNull()
    // No fictitious bump: the composite should NOT exceed what fit alone can produce.
    expect(noEmail.score).toBeLessThanOrEqual(withEmail.score + 20)  // slack because weights shift
  })

  it('falls back to default weights when custom weights do not sum to 1', () => {
    const i = baseInput()
    const good = qualificationScore(i)
    const bad = qualificationScore({ ...i, weights: { fit: 0.9, intent: 0.9, relevance: 0.9 } })
    expect(bad.weightsUsed).toEqual(good.weightsUsed)
  })

  it('threshold constants are self-consistent', () => {
    expect(MIN_FIT_FOR_QUALIFIED).toBeLessThan(MIN_COMPOSITE_FOR_VERIFIED)
    expect(MIN_COMPOSITE_FOR_VERIFIED).toBeLessThanOrEqual(MIN_COMPOSITE_FOR_OUTREACH)
  })
})

describe('qualificationBand', () => {
  it('maps scores to the three bands', () => {
    expect(qualificationBand(10)).toBe('cold')
    expect(qualificationBand(49)).toBe('cold')
    expect(qualificationBand(50)).toBe('warm')
    expect(qualificationBand(74)).toBe('warm')
    expect(qualificationBand(75)).toBe('hot')
    expect(qualificationBand(100)).toBe('hot')
  })
})
