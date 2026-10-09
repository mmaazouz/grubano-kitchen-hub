// tests/growth-merchant-next-action.test.ts — the one place where "do we send?" is decided.
// Default must be NO SEND. Unknown jurisdiction → review. Policy block → review. Policy
// defer → wait. Only when every gate agrees does the decision land on `propose_outreach`
// (which is still a RECOMMENDATION, not a send).

import { describe, it, expect } from 'vitest'
import { decideNextAction, type NextActionInput } from '@/lib/growth/merchant/next-action'
import type { Consent, GrowthContact, MerchantProspect, Suppression } from '@/lib/growth/types'

const T = Date.parse('2026-10-09T12:00:00+00:00')

const prospect = (over: Partial<MerchantProspect> = {}): MerchantProspect => ({
  id: 'p1', role: 'restaurant',
  siren: '732829320', legalName: 'Acme Fake SARL', tradeName: 'Acme',
  domain: 'acme.example.fr', city: 'paris', countryIso2: 'FR',
  cuisineTags: ['italian'], sizeSignals: { declaredCovers: 60 }, enrichment: {},
  source: 'test', provenance: null,
  createdAt: '2026-10-01T00:00:00+00:00', updatedAt: '2026-10-01T00:00:00+00:00',
  ...over,
})

const contact = (over: Partial<GrowthContact> = {}): GrowthContact => ({
  id: 'c1', audienceType: 'b2b',
  tenantOperatorId: null, tenantRestaurantId: null,
  email: 'ops@acme.example.fr', phoneE164: null,
  firstName: null, lastName: null,
  locale: 'fr', timezone: 'Europe/Paris', countryIso2: 'FR',
  source: 'test', provenance: null,
  createdAt: '2026-10-01T00:00:00+00:00', updatedAt: '2026-10-01T00:00:00+00:00',
  ...over,
})

/**
 * Documented legitimate-interest balance test for c1. The foundation policy models the
 * balance test as a Consent row with `legalBasis: 'legitimate_interest'`; without it,
 * hasPermission returns no_consent for cold_b2b. See lib/growth/policy.ts §Consent.
 */
const legitimateInterestForC1: Consent = {
  contactId: 'c1', channel: 'email', purpose: 'cold_b2b',
  legalBasis: 'legitimate_interest',
  grantedAt: '2026-10-01T00:00:00+00:00', revokedAt: null,
  source: 'b2b_interest_balance_test#2026-10-01',
}

const baseInput = (over: Partial<NextActionInput> = {}): NextActionInput => ({
  nowMs: T,
  prospect: prospect(),
  state: 'verified',
  contacts: [contact()],
  consents: [legitimateInterestForC1],
  suppressions: [],
  recentSendTimestampsMs: {},
  frequencyCaps: [],
  quietHours: { startHour: 0, endHour: 0 },   // disable quiet hours in test (start === end)
  score: {
    fit: {
      prospect: prospect(),
      targetCities: ['paris'], targetCuisines: ['italian'],
    },
    intent: {
      nowMs: T,
      signals: {
        visitsMs: [T - 86_400_000],
        opensMs: [T - 86_400_000, T - 2 * 86_400_000],
        clicksMs: [T - 86_400_000],
        repliesMs: [], formAbandonsMs: [],
      },
    },
    professionalRelevance: { prospect: prospect(), contactEmail: 'ops@acme.example.fr' },
  },
  minutesSinceLastTouchpoint: null,
  minFollowupGapMinutes: 2880,  // 2 days
  ...over,
})

describe('terminal states', () => {
  it('returns `none` for `active`', () => {
    const d = decideNextAction(baseInput({ state: 'active' }))
    expect(d.kind).toBe('none')
  })
  it('returns `none` for `lost`', () => {
    const d = decideNextAction(baseInput({ state: 'lost' }))
    expect(d.kind).toBe('none')
  })
})

describe('jurisdiction gating', () => {
  it('routes unknown country to legal review (never a send)', () => {
    const d = decideNextAction(baseInput({ prospect: prospect({ countryIso2: null }) }))
    expect(d.kind).toBe('request_review')
    if (d.kind === 'request_review') {
      expect(d.reasonCode).toBe('jurisdiction_unknown')
      expect(d.routeTo).toBe('legal')
    }
  })

  it('routes unsupported country to legal review', () => {
    const d = decideNextAction(baseInput({ prospect: prospect({ countryIso2: 'BE' }) }))
    expect(d.kind).toBe('request_review')
    if (d.kind === 'request_review') expect(d.reasonCode).toBe('jurisdiction_unsupported')
  })
})

describe('enrichment', () => {
  it('requests enrichment when the prospect lacks a SIREN at the discovered state', () => {
    const d = decideNextAction(baseInput({
      state: 'discovered',
      prospect: prospect({ siren: null }),
    }))
    expect(d.kind).toBe('enrich')
    if (d.kind === 'enrich') expect(d.missing).toContain('siren')
  })
})

describe('suppression', () => {
  it('skips a contact suppressed with scope=all; routes to review when no other contact remains', () => {
    const sup: Suppression = { contactId: 'c1', channel: 'email', reason: 'bounce_hard', scope: 'all', since: '2026-10-01T00:00:00+00:00' }
    const d = decideNextAction(baseInput({ suppressions: [sup] }))
    expect(d.kind).toBe('request_review')
    if (d.kind === 'request_review') expect(d.reasonCode).toBe('no_professional_contact')
  })
})

describe('personal-mailbox contacts are never selected', () => {
  it('rejects the gmail contact and asks for ops review', () => {
    const d = decideNextAction(baseInput({
      contacts: [contact({ email: 'owner@gmail.com' })],
    }))
    expect(d.kind).toBe('request_review')
    if (d.kind === 'request_review') expect(d.routeTo).toBe('ops')
  })
})

describe('policy gate consumption', () => {
  it('defers when a frequency cap would be breached', () => {
    const prev = T - 60_000  // 1 min ago
    const d = decideNextAction(baseInput({
      recentSendTimestampsMs: { c1: [prev] },
      frequencyCaps: [{ channel: 'email', windowMs: 3_600_000, max: 1 }],
    }))
    expect(d.kind).toBe('wait')
    if (d.kind === 'wait') expect(d.reasonCode).toMatch(/^policy_defer:frequency_cap/)
  })

  it('proposes outreach when every gate agrees', () => {
    const d = decideNextAction(baseInput())
    expect(d.kind).toBe('propose_outreach')
    if (d.kind === 'propose_outreach') {
      expect(d.proposal.purpose).toBe('cold_b2b')
      expect(d.proposal.legalBasis).toBe('legitimate_interest')
      expect(d.proposal.requirements.includeOptOut).toBe(true)
      expect(d.proposal.requirements.identifyGrubano).toBe(true)
      expect(d.proposal.requirements.respectQuietHours).toBe(true)
      expect(d.proposal.requirements.professionalRelevanceOnly).toBe(true)
      expect(d.proposal.idempotencyKey.includes('prospect=p1')).toBe(true)
    }
  })
})

describe('contacted state', () => {
  it('waits when within the min followup gap', () => {
    const d = decideNextAction(baseInput({ state: 'contacted', minutesSinceLastTouchpoint: 10 }))
    expect(d.kind).toBe('wait')
    if (d.kind === 'wait') expect(d.reasonCode).toBe('followup_gap')
  })

  it('proposes a followup once the gap has elapsed', () => {
    const d = decideNextAction(baseInput({ state: 'contacted', minutesSinceLastTouchpoint: 3000 }))
    expect(d.kind).toBe('followup')
  })
})

describe('replied state', () => {
  it('asks for a meeting', () => {
    const d = decideNextAction(baseInput({ state: 'replied' }))
    expect(d.kind).toBe('request_meeting')
  })
})

describe('default-safe behaviour', () => {
  it('never returns a `propose_outreach` when the composite score is low', () => {
    const d = decideNextAction(baseInput({
      prospect: prospect({ countryIso2: 'FR', siren: null, legalName: 'Acme', domain: 'gmail.com' }),
      state: 'qualified',
      score: {
        fit: { prospect: prospect({ domain: 'gmail.com' }) },
        intent: { nowMs: T, signals: { visitsMs: [], opensMs: [], clicksMs: [], repliesMs: [], formAbandonsMs: [] } },
        professionalRelevance: { prospect: prospect({ domain: 'gmail.com' }), contactEmail: 'owner@gmail.com' },
      },
    }))
    expect(['wait', 'enrich', 'request_review']).toContain(d.kind)
  })
})
