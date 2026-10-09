// tests/growth-merchant-pipeline.test.ts — end-to-end dry-run report.
// Multi-venue per contact is supported; tenant boundaries are enforced; a suppressed
// contact never gets a send proposal; the report is marked dryRun:true and never claims
// a dispatch. Measured metrics only.

import { describe, it, expect } from 'vitest'
import { runMerchantDryRun, type PipelineInput } from '@/lib/growth/merchant/pipeline'
import type { Consent, GrowthContact, MerchantProspect, Suppression } from '@/lib/growth/types'

const T = Date.parse('2026-10-09T12:00:00+00:00')

const prospect = (over: Partial<MerchantProspect> = {}): MerchantProspect => ({
  id: 'p1', role: 'restaurant',
  siren: '732829320', legalName: 'Acme Fake SARL', tradeName: 'Acme',
  domain: 'acme.example.fr', city: 'paris', countryIso2: 'FR',
  cuisineTags: ['italian'], sizeSignals: {}, enrichment: {},
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

const baseInput = (over: Partial<PipelineInput> = {}): PipelineInput => ({
  nowMs: T,
  tenantOperatorId: null,
  prospects: [
    {
      prospect: prospect(),
      state: 'verified',
      contactIds: ['c1'],
      targeting: { targetCities: ['paris'], targetCuisines: ['italian'] },
      intent: {
        visitsMs: [T - 86_400_000],
        opensMs: [T - 86_400_000],
        clicksMs: [T - 86_400_000],
        repliesMs: [], formAbandonsMs: [],
      },
      halfLifeDays: 7,
      minutesSinceLastTouchpoint: null,
    },
  ],
  contacts: [contact()],
  consents: [{
    contactId: 'c1', channel: 'email', purpose: 'cold_b2b',
    legalBasis: 'legitimate_interest',
    grantedAt: '2026-10-01T00:00:00+00:00', revokedAt: null,
    source: 'b2b_interest_balance_test#2026-10-01',
  }],
  suppressions: [],
  recentSendTimestampsMs: {},
  frequencyCaps: [],
  quietHours: { startHour: 0, endHour: 0 },
  minFollowupGapMinutes: 2880,
  ...over,
})

describe('runMerchantDryRun — hard invariants', () => {
  it('marks the report dryRun:true and measuredOnly:true', () => {
    const r = runMerchantDryRun(baseInput())
    expect(r.dryRun).toBe(true)
    expect(r.measuredOnly).toBe(true)
  })

  it('never records a dispatched row (dispatched is literal false)', () => {
    const r = runMerchantDryRun(baseInput())
    for (const row of r.rows) expect(row.dispatched).toBe(false)
  })

  it('reports a propose_outreach for a verified FR prospect with professional contact and no suppressions', () => {
    const r = runMerchantDryRun(baseInput())
    expect(r.decisionCounts.propose_outreach).toBe(1)
    expect(r.outreachProposals).toBe(1)
  })
})

describe('tenant isolation', () => {
  it('ignores contacts that belong to another tenant', () => {
    const input = baseInput({
      tenantOperatorId: null,
      contacts: [contact({ id: 'c1', tenantOperatorId: 'other' })],
    })
    const r = runMerchantDryRun(input)
    expect(r.rows[0].decisionKind).toBe('request_review')
  })
})

describe('duplicate detection', () => {
  it('counts a franchise sharing a trade name but with a different SIREN as a SEPARATE group', () => {
    const input = baseInput({
      prospects: [
        baseInput().prospects[0],
        { ...baseInput().prospects[0], prospect: prospect({ id: 'p2', siren: '440337558', domain: 'lyon.example.fr' }) },
      ],
      contacts: [contact(), contact({ id: 'c2', email: 'ops@lyon.example.fr' })],
    })
    input.prospects[1].contactIds = ['c2']
    const r = runMerchantDryRun(input)
    expect(r.uniqueCompanies).toBe(2)
    expect(r.duplicateGroups).toBe(0)
  })

  it('reports a duplicate when two rows share a SIREN', () => {
    const input = baseInput({
      prospects: [
        baseInput().prospects[0],
        { ...baseInput().prospects[0], prospect: prospect({ id: 'p1_dup' }) },  // same SIREN
      ],
    })
    const r = runMerchantDryRun(input)
    expect(r.uniqueCompanies).toBe(1)
    expect(r.duplicateGroups).toBe(1)
  })
})

describe('suppression blocks sends at pipeline entry', () => {
  it('suppressed-scope-all contact prevents any outreach proposal', () => {
    const sup: Suppression = { contactId: 'c1', channel: 'email', reason: 'bounce_hard', scope: 'all', since: '2026-10-01T00:00:00+00:00' }
    const r = runMerchantDryRun(baseInput({ suppressions: [sup] }))
    expect(r.outreachProposals).toBe(0)
    expect(r.rows[0].decisionKind).toBe('request_review')
  })
})

describe('jurisdiction gating end-to-end', () => {
  it('routes unknown country to review and never emits a send proposal', () => {
    const r = runMerchantDryRun(baseInput({
      prospects: [{ ...baseInput().prospects[0], prospect: prospect({ countryIso2: null }) }],
    }))
    expect(r.outreachProposals).toBe(0)
    expect(r.rows[0].decisionKind).toBe('request_review')
    expect(r.rows[0].decisionReasonCode).toBe('jurisdiction_unknown')
  })
})

describe('determinism', () => {
  it('two runs with the same input produce byte-identical reports', () => {
    const i = baseInput()
    expect(runMerchantDryRun(i)).toEqual(runMerchantDryRun(i))
  })
})
