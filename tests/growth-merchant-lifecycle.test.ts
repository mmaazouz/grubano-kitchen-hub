// tests/growth-merchant-lifecycle.test.ts — lifecycle state machine guards.
// Illegal transitions are rejected without mutation; guards cite the failing precondition
// by code so dashboards can display it.

import { describe, it, expect } from 'vitest'
import {
  checkGuard, legalNextStates, isTerminal, hasVerifiedIdentity,
  MERCHANT_LIFECYCLE_STATES, type MerchantLifecycleState,
} from '@/lib/growth/merchant/lifecycle'
import type { MerchantProspect } from '@/lib/growth/types'

const prospect = (over: Partial<MerchantProspect> = {}): MerchantProspect => ({
  id: 'p', role: 'restaurant',
  siren: '732829320', legalName: 'Acme Fake SARL', tradeName: 'Acme',
  domain: 'acme.example.fr', city: 'paris', countryIso2: 'FR',
  cuisineTags: ['italian'], sizeSignals: {}, enrichment: {},
  source: 'test', provenance: null,
  createdAt: '2026-10-09T00:00:00+00:00', updatedAt: '2026-10-09T00:00:00+00:00',
  ...over,
})

const okGuard = {
  fitScore: 70, compositeScore: 70,
  hasProfessionalContact: true, hasAnyReachableContact: true,
}

describe('legal transition map', () => {
  it('rejects reversed transitions explicitly', () => {
    const r = checkGuard('qualified', 'discovered', { prospect: prospect(), ...okGuard })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/^illegal_transition:qualified->discovered$/)
  })

  it('rejects skipping stages', () => {
    const r = checkGuard('discovered', 'outreach_eligible', { prospect: prospect(), ...okGuard })
    expect(r.ok).toBe(false)
  })

  it('allows any state → lost (disqualify)', () => {
    for (const s of MERCHANT_LIFECYCLE_STATES) {
      if (s === 'lost' || s === 'active') continue
      const r = checkGuard(s, 'lost', { prospect: prospect(), ...okGuard })
      expect(r.ok).toBe(true)
    }
  })

  it('does not allow transitions out of terminal states', () => {
    expect(checkGuard('lost',   'qualified', { prospect: prospect(), ...okGuard }).ok).toBe(false)
    expect(checkGuard('active', 'lost',      { prospect: prospect(), ...okGuard }).ok).toBe(false)
  })
})

describe('guard: discovered → qualified', () => {
  it('rejects when fit score below the minimum', () => {
    const r = checkGuard('discovered', 'qualified', { prospect: prospect(), ...okGuard, fitScore: 10 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/^guard_qualified:fit_below_/)
  })

  it('rejects when no identity at all', () => {
    const r = checkGuard('discovered', 'qualified',
      { prospect: prospect({ legalName: null, domain: null }), ...okGuard })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('guard_qualified:no_identity_at_all')
  })

  it('accepts a thin-but-identified prospect with enough fit', () => {
    const r = checkGuard('discovered', 'qualified', { prospect: prospect(), ...okGuard })
    expect(r.ok).toBe(true)
  })
})

describe('guard: qualified → verified', () => {
  it('rejects when identity is unverified (no SIREN+legalName and no company domain)', () => {
    const r = checkGuard('qualified', 'verified',
      { prospect: prospect({ siren: null, legalName: null, domain: 'gmail.com' }), ...okGuard })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('guard_verified:identity_unverified')
  })

  it('rejects when composite score is below threshold', () => {
    const r = checkGuard('qualified', 'verified',
      { prospect: prospect(), ...okGuard, compositeScore: 10 })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/^guard_verified:composite_below_/)
  })
})

describe('guard: verified → outreach_eligible', () => {
  it('rejects out-of-jurisdiction', () => {
    const r = checkGuard('verified', 'outreach_eligible',
      { prospect: prospect({ countryIso2: 'BE' }), ...okGuard })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('guard_outreach_eligible:jurisdiction_unsupported')
  })

  it('rejects when no professional contact is available', () => {
    const r = checkGuard('verified', 'outreach_eligible',
      { prospect: prospect(), ...okGuard, hasProfessionalContact: false })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('guard_outreach_eligible:no_professional_contact')
  })

  it('rejects when every contact is suppressed', () => {
    const r = checkGuard('verified', 'outreach_eligible',
      { prospect: prospect(), ...okGuard, hasAnyReachableContact: false })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('guard_outreach_eligible:all_contacts_suppressed')
  })

  it('accepts when all preconditions hold', () => {
    const r = checkGuard('verified', 'outreach_eligible', { prospect: prospect(), ...okGuard })
    expect(r.ok).toBe(true)
  })
})

describe('hasVerifiedIdentity', () => {
  it('accepts SIREN + legal name', () => {
    expect(hasVerifiedIdentity({ siren: '732829320', legalName: 'Acme', domain: null })).toBe(true)
  })

  it('accepts a company domain even without SIREN', () => {
    expect(hasVerifiedIdentity({ siren: null, legalName: null, domain: 'acme.example.fr' })).toBe(true)
  })

  it('rejects personal mailbox as identity', () => {
    expect(hasVerifiedIdentity({ siren: null, legalName: null, domain: 'gmail.com' })).toBe(false)
  })

  it('rejects SIREN without legal name', () => {
    expect(hasVerifiedIdentity({ siren: '732829320', legalName: null, domain: null })).toBe(false)
  })
})

describe('legalNextStates / isTerminal', () => {
  it('declares `active` and `lost` as terminal', () => {
    expect(isTerminal('active')).toBe(true)
    expect(isTerminal('lost')).toBe(true)
    expect(isTerminal('discovered')).toBe(false)
  })

  it('returns the forward transitions only', () => {
    expect(legalNextStates('discovered')).toContain('qualified')
    expect(legalNextStates('discovered')).not.toContain('discovered')
    expect(legalNextStates('active')).toEqual([])
  })
})
