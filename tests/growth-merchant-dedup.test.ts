// tests/growth-merchant-dedup.test.ts — company dedupe keys and franchise safety.
// SIREN beats domain, personal-mailbox domains never produce a key, two franchises that
// share a trade name must NOT merge, two rows with the same SIREN must merge regardless
// of display differences.

import { describe, it, expect } from 'vitest'
import {
  dedupKeyForProspect, isSameCompany, groupByCompany, explainDedup,
} from '@/lib/growth/merchant/dedup'
import type { MerchantProspect } from '@/lib/growth/types'

const prospect = (over: Partial<MerchantProspect> = {}): MerchantProspect => ({
  id: 'p', role: 'restaurant',
  siren: null, legalName: null, tradeName: null, domain: null, city: null, countryIso2: 'FR',
  cuisineTags: [], sizeSignals: {}, enrichment: {},
  source: 'test', provenance: null,
  createdAt: '2026-10-09T00:00:00+00:00', updatedAt: '2026-10-09T00:00:00+00:00',
  ...over,
})

describe('dedupKeyForProspect', () => {
  it('prefers a validated SIREN over any domain', () => {
    const k = dedupKeyForProspect(prospect({ siren: '732829320', domain: 'other.example.fr' }))
    expect(k).toBe('siren:732829320')
  })

  it('falls back to the canonical domain when SIREN is missing or invalid', () => {
    expect(dedupKeyForProspect(prospect({ siren: null,          domain: 'WWW.Acme.example.FR' }))).toBe('domain:acme.example.fr')
    expect(dedupKeyForProspect(prospect({ siren: '000000000',   domain: 'acme.example.fr' }))).toBe('domain:acme.example.fr')
    expect(dedupKeyForProspect(prospect({ siren: '12345678',    domain: 'acme.example.fr' }))).toBe('domain:acme.example.fr')
  })

  it('never produces a key from a personal mailbox domain', () => {
    expect(dedupKeyForProspect(prospect({ siren: null, domain: 'gmail.com' }))).toBeNull()
    expect(dedupKeyForProspect(prospect({ siren: null, domain: 'yahoo.fr' }))).toBeNull()
  })

  it('returns null when both SIREN and domain are missing/invalid', () => {
    expect(dedupKeyForProspect(prospect({}))).toBeNull()
    expect(dedupKeyForProspect(prospect({ siren: 'nope', domain: 'invalid' }))).toBeNull()
  })

  it('namespaces siren vs domain to prevent cross-namespace collisions', () => {
    const a = dedupKeyForProspect(prospect({ siren: '732829320' }))
    const b = dedupKeyForProspect(prospect({ domain: '732829320.example.fr' }))
    expect(a).not.toBe(b)
  })
})

describe('isSameCompany', () => {
  it('merges two prospects with the same SIREN regardless of display', () => {
    const a = prospect({ id: 'a', siren: '732829320', tradeName: 'Store A' })
    const b = prospect({ id: 'b', siren: '732829320', tradeName: 'Store A Montmartre' })
    expect(isSameCompany(a, b)).toBe(true)
  })

  it('does NOT merge two franchises that share only a trade name', () => {
    const paris = prospect({ id: 'paris', siren: '732829320', tradeName: 'Gnocchi Fake',
                             domain: 'paris.example.fr' })
    const lyon  = prospect({ id: 'lyon',  siren: '440337558', tradeName: 'Gnocchi Fake',
                             domain: 'lyon.example.fr' })
    expect(isSameCompany(paris, lyon)).toBe(false)
  })

  it('merges two prospects with the same company domain and no SIREN', () => {
    const a = prospect({ id: 'a', domain: 'acme.example.fr' })
    const b = prospect({ id: 'b', domain: 'WWW.acme.example.FR' })
    expect(isSameCompany(a, b)).toBe(true)
  })

  it('does NOT merge two prospects that only share a personal mailbox domain', () => {
    const a = prospect({ id: 'a', domain: 'gmail.com' })
    const b = prospect({ id: 'b', domain: 'gmail.com' })
    expect(isSameCompany(a, b)).toBe(false)
  })

  it('does NOT merge when one side has SIREN and the other only domain (unprovable match)', () => {
    const a = prospect({ id: 'a', siren: '732829320', domain: null })
    const b = prospect({ id: 'b', siren: null,       domain: 'acme.example.fr' })
    expect(isSameCompany(a, b)).toBe(false)
  })

  it('null dedupe keys never equal null dedupe keys', () => {
    const a = prospect({ id: 'a' })
    const b = prospect({ id: 'b' })
    expect(isSameCompany(a, b)).toBe(false)
  })
})

describe('groupByCompany', () => {
  it('bundles duplicate SIRENs and keeps franchises separate', () => {
    const inputs = [
      prospect({ id: 'a1', siren: '732829320', domain: 'paris.example.fr' }),
      prospect({ id: 'a2', siren: '732829320', domain: 'paris-ii.example.fr' }),
      prospect({ id: 'b',  siren: '440337558', domain: 'lyon.example.fr' }),
      prospect({ id: 'c',  siren: null, domain: 'gmail.com' }),  // review bucket
      prospect({ id: 'd',  siren: null, domain: 'gmail.com' }),  // DISTINCT review bucket
    ]
    const groups = groupByCompany(inputs)
    const bucketSizes = [...groups.values()].map((g) => g.length).sort()
    expect(bucketSizes).toEqual([1, 1, 1, 2])
    // The two gmail rows must land in DIFFERENT buckets, not a shared one.
    const reviewKeys = [...groups.keys()].filter((k) => k.startsWith('review:'))
    expect(reviewKeys.length).toBe(2)
  })

  it('preserves input order within each bucket', () => {
    const groups = groupByCompany([
      prospect({ id: 'first',  siren: '732829320' }),
      prospect({ id: 'second', siren: '732829320' }),
    ])
    const bucket = [...groups.values()][0]
    expect(bucket.map((p) => p.id)).toEqual(['first', 'second'])
  })
})

describe('explainDedup', () => {
  it('reports a merge_siren with matching SIRENs', () => {
    const r = explainDedup(prospect({ siren: '732829320' }), prospect({ siren: '732829320' }))
    expect(r).toEqual({ same: true, reason: 'merge_siren' })
  })

  it('reports no_merge_different_siren', () => {
    const r = explainDedup(prospect({ siren: '732829320' }), prospect({ siren: '440337558' }))
    expect(r).toEqual({ same: false, reason: 'no_merge_different_siren' })
  })

  it('reports no_merge_personal_mailbox when the only shared identifier is a personal domain', () => {
    const r = explainDedup(prospect({ domain: 'gmail.com' }), prospect({ domain: 'gmail.com' }))
    expect(r).toEqual({ same: false, reason: 'no_merge_personal_mailbox' })
  })

  it('reports no_merge_mixed_siren_vs_domain', () => {
    const r = explainDedup(prospect({ siren: '732829320' }), prospect({ domain: 'acme.example.fr' }))
    expect(r.same).toBe(false)
    expect(r.reason).toBe('no_merge_mixed_siren_vs_domain')
  })

  it('reports no_merge_missing_identifier', () => {
    const r = explainDedup(prospect({}), prospect({}))
    expect(r).toEqual({ same: false, reason: 'no_merge_missing_identifier' })
  })
})
