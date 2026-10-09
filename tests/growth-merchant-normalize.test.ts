// tests/growth-merchant-normalize.test.ts — merchant field normalisation.
// Covers: SIREN Luhn mod-10 validation, domain canonicalisation (scheme/path/port/userinfo
// strip, www stripping, trailing dot, IP-literal rejection), personal-mailbox detection,
// email split, jurisdiction gating. No mocks — every function under test is pure.

import { describe, it, expect } from 'vitest'
import {
  normalizeSiren, normalizeDomain, normalizeDisplayName, normalizePhoneE164Lite,
  isPersonalMailboxDomain, splitEmail, isSupportedColdB2BJurisdiction,
  SUPPORTED_COLD_B2B_JURISDICTIONS, PERSONAL_MAILBOX_DOMAINS,
} from '@/lib/growth/merchant/normalize'

describe('normalizeSiren', () => {
  it('accepts a valid 9-digit SIREN whose Luhn mod-10 checksum is 0', () => {
    expect(normalizeSiren('732829320')).toBe('732829320')
    expect(normalizeSiren('552100554')).toBe('552100554')
    expect(normalizeSiren('404833048')).toBe('404833048')
    expect(normalizeSiren('440337558')).toBe('440337558')
  })

  it('rejects wrong length', () => {
    expect(normalizeSiren('12345678')).toBeNull()
    expect(normalizeSiren('1234567890')).toBeNull()
    expect(normalizeSiren('')).toBeNull()
  })

  it('rejects non-digit characters', () => {
    expect(normalizeSiren('73282932A')).toBeNull()
    expect(normalizeSiren('abcdefghi')).toBeNull()
  })

  it('rejects the "000000000" placeholder', () => {
    expect(normalizeSiren('000000000')).toBeNull()
  })

  it('rejects a 9-digit string whose Luhn checksum is not 0', () => {
    expect(normalizeSiren('732829321')).toBeNull()  // checksum off
    expect(normalizeSiren('123456789')).toBeNull()
  })

  it('strips whitespace, NBSP, hyphens and dots before validating', () => {
    expect(normalizeSiren('732 829 320')).toBe('732829320')
    expect(normalizeSiren('732-829-320')).toBe('732829320')
    expect(normalizeSiren('732.829.320')).toBe('732829320')
    expect(normalizeSiren(' 732 829 320 ')).toBe('732829320')
  })

  it('rejects non-string inputs', () => {
    expect(normalizeSiren(732829320 as unknown)).toBeNull()
    expect(normalizeSiren(null)).toBeNull()
    expect(normalizeSiren(undefined)).toBeNull()
  })
})

describe('normalizeDomain', () => {
  it('returns the canonical bare host for a well-formed URL', () => {
    const r = normalizeDomain('https://WWW.example.FR/path?q=1#x')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.canonical).toBe('example.fr')
  })

  it('strips scheme, userinfo, port, path, query, fragment and leading www', () => {
    const r = normalizeDomain('https://user:pass@WWW.foo.bar.example.com:8443/a/b?x=1#y')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.canonical).toBe('foo.bar.example.com')
  })

  it('strips trailing dots', () => {
    const r = normalizeDomain('example.fr.')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.canonical).toBe('example.fr')
  })

  it('rejects empty and whitespace-only inputs', () => {
    expect(normalizeDomain('').ok).toBe(false)
    expect(normalizeDomain('   ').ok).toBe(false)
    expect(normalizeDomain(null).ok).toBe(false)
  })

  it('rejects IPv4 literals', () => {
    const r = normalizeDomain('http://127.0.0.1:3000/x')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('ip_literal')
  })

  it('rejects syntactically invalid hosts', () => {
    expect(normalizeDomain('not_a_host').ok).toBe(false)
    expect(normalizeDomain('--leadingdash.example.com').ok).toBe(false)
    expect(normalizeDomain('example').ok).toBe(false)        // no TLD
    expect(normalizeDomain('example.1').ok).toBe(false)      // numeric TLD
  })

  it('is case-insensitive', () => {
    const a = normalizeDomain('Example.FR')
    const b = normalizeDomain('example.fr')
    expect(a.ok && b.ok && a.canonical === b.canonical).toBe(true)
  })
})

describe('isPersonalMailboxDomain', () => {
  it('recognises known providers', () => {
    expect(isPersonalMailboxDomain('gmail.com')).toBe(true)
    expect(isPersonalMailboxDomain('yahoo.fr')).toBe(true)
    expect(isPersonalMailboxDomain('outlook.com')).toBe(true)
    expect(isPersonalMailboxDomain('proton.me')).toBe(true)
  })

  it('rejects company domains', () => {
    expect(isPersonalMailboxDomain('acme.example.fr')).toBe(false)
    expect(isPersonalMailboxDomain('grubano.com')).toBe(false)
  })

  it('does not reach into subdomains of personal providers', () => {
    // A subdomain is a different host; treat it as non-personal — the public domain is distinct.
    expect(isPersonalMailboxDomain('foo.gmail.com')).toBe(false)
  })

  it('exports a non-empty read-only set', () => {
    expect(PERSONAL_MAILBOX_DOMAINS.size).toBeGreaterThan(10)
  })
})

describe('splitEmail', () => {
  it('splits on the last @ and normalises the domain', () => {
    const r = splitEmail('Jean.Dupont+promo@WWW.example.FR')
    expect(r).toEqual({ local: 'Jean.Dupont+promo', domain: 'example.fr' })
  })

  it('rejects missing or trailing @', () => {
    expect(splitEmail('nope')).toBeNull()
    expect(splitEmail('a@')).toBeNull()
    expect(splitEmail('@a.com')).toBeNull()
  })

  it('rejects email with invalid domain part', () => {
    expect(splitEmail('a@127.0.0.1')).toBeNull()
    expect(splitEmail('a@notatld')).toBeNull()
  })

  it('does not lowercase the local part', () => {
    const r = splitEmail('MixedCase@example.fr')
    expect(r?.local).toBe('MixedCase')
  })
})

describe('normalizeDisplayName', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeDisplayName('  Acme  SARL   ')).toBe('Acme SARL')
  })

  it('rejects empty', () => {
    expect(normalizeDisplayName('')).toBeNull()
    expect(normalizeDisplayName('   ')).toBeNull()
    expect(normalizeDisplayName(null)).toBeNull()
  })

  it('caps at 200 chars', () => {
    const s = 'A'.repeat(500)
    expect(normalizeDisplayName(s)?.length).toBe(200)
  })
})

describe('normalizePhoneE164Lite', () => {
  it('accepts +<digits>', () => {
    expect(normalizePhoneE164Lite('+33612345678')).toBe('+33612345678')
    expect(normalizePhoneE164Lite('+33 6 12 34 56 78')).toBe('+33612345678')
  })

  it('rejects anything without a leading +', () => {
    expect(normalizePhoneE164Lite('33612345678')).toBeNull()
    expect(normalizePhoneE164Lite('0612345678')).toBeNull()
  })

  it('rejects wrong digit count', () => {
    expect(normalizePhoneE164Lite('+123')).toBeNull()
    expect(normalizePhoneE164Lite('+' + '9'.repeat(20))).toBeNull()
  })
})

describe('isSupportedColdB2BJurisdiction', () => {
  it('accepts FR today', () => {
    expect(isSupportedColdB2BJurisdiction('FR')).toBe(true)
    expect(isSupportedColdB2BJurisdiction('fr')).toBe(true)
  })

  it('rejects any country NOT on the explicit list', () => {
    for (const c of ['BE', 'DE', 'IT', 'ES', 'US', 'GB', 'MA', 'XX']) {
      expect(isSupportedColdB2BJurisdiction(c)).toBe(false)
    }
  })

  it('rejects null / undefined', () => {
    expect(isSupportedColdB2BJurisdiction(null)).toBe(false)
    expect(isSupportedColdB2BJurisdiction(undefined)).toBe(false)
  })

  it('is minimal on purpose: adding a country is a legal decision', () => {
    expect(SUPPORTED_COLD_B2B_JURISDICTIONS.size).toBe(1)
  })
})
