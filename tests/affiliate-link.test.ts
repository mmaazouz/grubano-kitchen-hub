// tests/affiliate-link.test.ts — Dashboard Affiliés Slice 2a (Agent 14).
// Pure link builder over the EXISTING /ref attribution. Env-robust assertions
// (origin is window-dependent; we assert the path/shape, not the host).

import { describe, it, expect } from 'vitest'
import { buildAffiliateLink, buildAffiliateRestaurantLink, isSafeToPath } from '@/lib/affiliate-link'

describe('isSafeToPath — mirror of the /ref server whitelist', () => {
  it('accepts a same-origin app path', () => {
    expect(isSafeToPath('/fr/eat/r/rest1')).toBe(true)
    expect(isSafeToPath('/eat')).toBe(true)
  })
  it('rejects protocol-relative, absolute, api and junk', () => {
    expect(isSafeToPath('//evil.com')).toBe(false)
    expect(isSafeToPath('https://evil.com')).toBe(false)
    expect(isSafeToPath('/api/orders')).toBe(false)
    expect(isSafeToPath('eat')).toBe(false)
    expect(isSafeToPath('')).toBe(false)
    expect(isSafeToPath(42 as unknown)).toBe(false)
  })
})

describe('buildAffiliateLink', () => {
  it('null/empty slug → null', () => {
    expect(buildAffiliateLink(null)).toBeNull()
    expect(buildAffiliateLink(undefined)).toBeNull()
    expect(buildAffiliateLink('')).toBeNull()
  })
  it('home target → the base /ref/<slug> link (slug encoded)', () => {
    const link = buildAffiliateLink('marco20')
    expect(link).toContain('/ref/marco20')
    expect(link).not.toContain('?to=')
  })
  it('path target → /ref/<slug>?to=<encoded path>', () => {
    const link = buildAffiliateLink('marco20', { kind: 'path', path: '/fr/eat/r/rest1' })
    expect(link).toContain('/ref/marco20')
    expect(link).toContain('?to=' + encodeURIComponent('/fr/eat/r/rest1'))
  })
  it('UNSAFE target → degrades to the base link (never an unusable URL)', () => {
    const link = buildAffiliateLink('marco20', { kind: 'path', path: 'https://evil.com' })
    expect(link).toContain('/ref/marco20')
    expect(link).not.toContain('?to=')
  })
})

describe('buildAffiliateRestaurantLink', () => {
  it('builds a deep link to the resto consumer page with the locale', () => {
    const link = buildAffiliateRestaurantLink('marco20', 'rest1', 'en')
    expect(link).toContain('/ref/marco20')
    expect(link).toContain('?to=' + encodeURIComponent('/en/eat/r/rest1'))
  })
  it('no restaurant → falls back to the base link', () => {
    const link = buildAffiliateRestaurantLink('marco20', null)
    expect(link).toContain('/ref/marco20')
    expect(link).not.toContain('?to=')
  })
  it('no slug → null', () => {
    expect(buildAffiliateRestaurantLink(null, 'rest1')).toBeNull()
  })
})
