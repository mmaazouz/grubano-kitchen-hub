import { describe, it, expect } from 'vitest'
import { addableActivities, activityHref, activityMode, ADDABLE_ACTIVITIES } from '@/lib/add-activity'

// ── B1.3-C — add-an-activity hub logic (Agent 32) ────────────────────────────
// Pure logic: which activities a connected account can add, and the journey href
// that carries the SESSION email (+ prudent prefill). No role is granted here.

describe('addableActivities', () => {
  it('a restaurateur sees supplier/creator/logistics/franchise (not restaurant)', () => {
    expect(addableActivities(['restaurant'])).toEqual(['supplier', 'creator', 'logistics', 'franchise'])
  })

  it('excludes activities already held', () => {
    expect(addableActivities(['restaurant', 'supplier'])).toEqual(['creator', 'logistics', 'franchise'])
    expect(addableActivities(['creator'])).toEqual(['supplier', 'logistics', 'franchise'])
  })

  it('all four held → empty (hub shows the empty state)', () => {
    expect(addableActivities([...ADDABLE_ACTIVITIES])).toEqual([])
  })

  it('empty / null role set → all four addable', () => {
    expect(addableActivities([])).toEqual(['supplier', 'creator', 'logistics', 'franchise'])
    expect(addableActivities(null)).toEqual(['supplier', 'creator', 'logistics', 'franchise'])
    expect(addableActivities(undefined)).toEqual(['supplier', 'creator', 'logistics', 'franchise'])
  })

  it('consumer/admin are never offered as addable activities', () => {
    const a = addableActivities(['consumer'])
    expect(a).not.toContain('consumer')
    expect(a).not.toContain('admin')
  })

  // ── Phase 6 Brique A — affiliate is gated behind AFFILIATE_ENABLED (Agent 58) ──
  it('affiliate is NOT offered by default (flag OFF → byte-identical)', () => {
    expect(addableActivities(['restaurant'])).not.toContain('affiliate')
    expect(addableActivities(['restaurant'], {})).not.toContain('affiliate')
    expect(addableActivities(['restaurant'], { includeAffiliate: false })).not.toContain('affiliate')
  })

  it('affiliate is appended only when includeAffiliate is true (flag ON)', () => {
    expect(addableActivities(['restaurant'], { includeAffiliate: true }))
      .toEqual(['supplier', 'creator', 'logistics', 'franchise', 'affiliate'])
  })

  it('an existing affiliate is not re-offered even when the flag is ON', () => {
    expect(addableActivities(['restaurant', 'affiliate'], { includeAffiliate: true })).not.toContain('affiliate')
  })
})

describe('activityMode', () => {
  it('franchise is an application (admin-approved); the rest are self-serve register', () => {
    expect(activityMode('franchise')).toBe('apply')
    for (const a of ['supplier', 'creator', 'logistics'] as const) {
      expect(activityMode(a)).toBe('register')
    }
  })
})

describe('activityHref', () => {
  it('always carries the SESSION email (never a free value)', () => {
    expect(activityHref('creator', 's@x.com')).toBe('/creators/apply?email=s%40x.com')
    expect(activityHref('supplier', 's@x.com')).toBe('/supplier/register?email=s%40x.com')
    expect(activityHref('logistics', 's@x.com')).toBe('/business/logistics/register?email=s%40x.com')
    expect(activityHref('franchise', 's@x.com')).toBe('/franchise/apply?email=s%40x.com')
  })

  it('prefills verified siren/company for company-backed journeys (supplier)', () => {
    expect(activityHref('supplier', 's@x.com', { siren: '123456789', officialName: 'ACME SARL' }))
      .toBe('/supplier/register?email=s%40x.com&siren=123456789&company=ACME+SARL')
  })

  it('logistics prefills siren only (no company-name field)', () => {
    expect(activityHref('logistics', 's@x.com', { siren: '123456789', officialName: 'ACME SARL' }))
      .toBe('/business/logistics/register?email=s%40x.com&siren=123456789')
  })

  it('creator never prefills a siren (creators have no company identity)', () => {
    expect(activityHref('creator', 's@x.com', { siren: '123456789', officialName: 'ACME' }))
      .toBe('/creators/apply?email=s%40x.com')
  })

  it('empty anchor → email only', () => {
    expect(activityHref('supplier', 's@x.com', null)).toBe('/supplier/register?email=s%40x.com')
    expect(activityHref('supplier', 's@x.com', {})).toBe('/supplier/register?email=s%40x.com')
  })
})
