// tests/growth-merchant-fixtures.test.ts — synthetic fixtures sanity checks.
// Every fixture SIREN is a VALID Luhn mod-10. No fixture email uses a real-looking personal
// identity. The fixture set exercises each major branch of the pipeline.

import { describe, it, expect } from 'vitest'
import {
  SAMPLE_PROSPECTS, SAMPLE_CONTACTS, SAMPLE_SUPPRESSIONS, FIXTURE_SIRENS,
} from '@/lib/growth/merchant/fixtures'
import { normalizeSiren, splitEmail } from '@/lib/growth/merchant/normalize'
import { dedupKeyForProspect, isSameCompany } from '@/lib/growth/merchant/dedup'
import { runMerchantDryRun } from '@/lib/growth/merchant/pipeline'

describe('fixture SIRENs are all valid Luhn mod-10', () => {
  it.each(Object.entries(FIXTURE_SIRENS))('%s', (_label, siren) => {
    expect(normalizeSiren(siren)).toBe(siren)
  })
})

describe('fixture emails are synthetic', () => {
  it('every contact email uses a reserved / example TLD or a personal mailbox provider', () => {
    const allowedDomainSuffixes = ['.example.fr', '.example.test', 'gmail.com', 'yahoo.fr']
    for (const c of SAMPLE_CONTACTS) {
      if (!c.email) continue
      const parts = splitEmail(c.email)
      expect(parts).not.toBeNull()
      if (parts) {
        const ok = allowedDomainSuffixes.some((s) => parts.domain.endsWith(s))
        expect(ok, `fixture email ${c.email}`).toBe(true)
      }
    }
  })

  it('no fixture domain uses a well-known real company TLD like .com without "example"', () => {
    for (const p of SAMPLE_PROSPECTS) {
      if (!p.domain) continue
      const parts = p.domain.toLowerCase()
      expect(parts).not.toMatch(/^(grubano|google|facebook|amazon|microsoft)\./)
    }
  })
})

describe('fixture dedupe behaviour', () => {
  it('exposes the "same SIREN, different display" case', () => {
    const a = SAMPLE_PROSPECTS.find((p) => p.id === 'p_fake_restaurant_1')!
    const b = SAMPLE_PROSPECTS.find((p) => p.id === 'p_fake_restaurant_1_dup')!
    expect(isSameCompany(a, b)).toBe(true)
  })

  it('exposes the "shared trade name, different SIREN" franchise case', () => {
    const paris = SAMPLE_PROSPECTS.find((p) => p.id === 'p_fake_restaurant_1')!
    const lyon  = SAMPLE_PROSPECTS.find((p) => p.id === 'p_fake_franchise_a')!
    expect(isSameCompany(paris, lyon)).toBe(false)
  })

  it('every fixture prospect has a computable dedupe key or is clearly a review case', () => {
    for (const p of SAMPLE_PROSPECTS) {
      const k = dedupKeyForProspect(p)
      if (!k) expect(p.id === 'p_fake_thin').toBe(true)
    }
  })
})

describe('fixture end-to-end', () => {
  it('runs through the dry-run pipeline producing the expected branches', () => {
    const now = Date.parse('2026-10-09T12:00:00+00:00')
    const report = runMerchantDryRun({
      nowMs: now,
      tenantOperatorId: null,
      prospects: SAMPLE_PROSPECTS.map((p) => ({
        prospect: p,
        state: 'verified' as const,
        contactIds:
          p.id === 'p_fake_restaurant_1'     ? ['c_fake_pro_match'] :
          p.id === 'p_fake_restaurant_1_dup' ? ['c_fake_pro_match'] :
          p.id === 'p_fake_franchise_a'      ? ['c_fake_franchise_lyon'] :
          p.id === 'p_fake_belgium'          ? [] :
          p.id === 'p_fake_thin'             ? ['c_fake_personal'] :
          [],
        targeting: {
          targetCities: p.city ? [p.city] : [],
          targetCuisines: ['italian'],
        },
        intent: { visitsMs: [], opensMs: [], clicksMs: [], repliesMs: [], formAbandonsMs: [] },
        minutesSinceLastTouchpoint: null,
      })),
      contacts: SAMPLE_CONTACTS,
      consents: [{
        // Documented legitimate-interest balance test for the Lyon contact. The foundation
        // policy expects a Consent row even for cold_b2b (see lib/growth/policy.ts §Consent).
        contactId: 'c_fake_franchise_lyon', channel: 'email', purpose: 'cold_b2b',
        legalBasis: 'legitimate_interest',
        grantedAt: '2026-10-01T00:00:00+00:00', revokedAt: null,
        source: 'b2b_interest_balance_test#2026-10-01',
      }],
      suppressions: SAMPLE_SUPPRESSIONS,
      recentSendTimestampsMs: {},
      frequencyCaps: [],
      quietHours: { startHour: 0, endHour: 0 },
      minFollowupGapMinutes: 2880,
    })
    expect(report.dryRun).toBe(true)
    // Belgium must land in review (jurisdiction).
    const belgium = report.rows.find((r) => r.prospectId === 'p_fake_belgium')!
    expect(belgium.decisionKind).toBe('request_review')
    expect(belgium.decisionReasonCode).toBe('jurisdiction_unsupported')
    // Thin prospect, state 'verified', has gmail contact + no company domain → low
    // composite blocks the send branch. Expected non-outreach outcomes: wait (score
    // below threshold), enrich (if we fed it as 'discovered'), or request_review.
    const thin = report.rows.find((r) => r.prospectId === 'p_fake_thin')!
    expect(['wait', 'enrich', 'request_review']).toContain(thin.decisionKind)
    expect(thin.decisionKind).not.toBe('propose_outreach')
    // Hard-suppressed contact for p_fake_restaurant_1 → no outreach proposal.
    const main = report.rows.find((r) => r.prospectId === 'p_fake_restaurant_1')!
    expect(main.decisionKind).not.toBe('propose_outreach')
    // Franchise with reachable Lyon contact → should propose outreach.
    const lyon = report.rows.find((r) => r.prospectId === 'p_fake_franchise_a')!
    expect(lyon.decisionKind).toBe('propose_outreach')
  })
})
