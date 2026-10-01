import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { BARE_PREFIXES, isBarePathname, normalizeChromePathname } from '@/lib/app-chrome-rules'

// ── AppChrome chrome decision (lib/app-chrome-rules.ts) ───────────────────────
// The decision that puts a route under OperatorShell (or leaves it bare) is a PURE
// function of the pathname: no hostname, no session, no post-mount effect. This is
// what guarantees that the FIRST (server) render already picks the right chrome.
// Founder decision ⑩ (smoke staging 2026-08-23): /auth/magic — a public, anonymous
// passwordless sign-in — must never receive the operator furniture, on any host.

describe('app-chrome rules — /auth/magic is bare on every host, from the first render', () => {
  it('/auth/magic is bare (no locale)', () => {
    expect(isBarePathname('/auth/magic')).toBe(true)
  })

  it('/fr/auth/magic and /ar/auth/magic are bare (locale stripped before matching)', () => {
    expect(normalizeChromePathname('/fr/auth/magic')).toBe('/auth/magic')
    expect(normalizeChromePathname('/ar/auth/magic')).toBe('/auth/magic')
    for (const p of ['/fr/auth/magic', '/en/auth/magic', '/es/auth/magic', '/ar/auth/magic', '/it/auth/magic']) {
      expect(isBarePathname(p)).toBe(true)
    }
  })

  it('/auth/magic with a trailing slash stays bare; a future /auth/<other> does NOT (exact path, like middleware)', () => {
    expect(isBarePathname('/auth/magic/')).toBe(true)
    // exact path only (mirrors middleware.ts: `restPath === '/auth/magic'`, not /auth/*)
    expect(isBarePathname('/auth/other')).toBe(false)
    expect(isBarePathname('/fr/auth')).toBe(false)
    expect(isBarePathname('/auth')).toBe(false)
  })

  it('the decision takes no hostname and no session — the signature is (pathname) only', () => {
    expect(isBarePathname.length).toBe(1)
    expect(normalizeChromePathname.length).toBe(1)
  })
})

describe('app-chrome rules — operator routes still get OperatorShell', () => {
  it.each(['/dashboard', '/fr/dashboard', '/fr/menu', '/fr/orders', '/fr/stocks', '/fr/customers', '/fr/finance', '/fr/deliveries', '/fr/more', '/fr/design', '/fr/chef/demo20'])(
    '%s is NOT bare',
    (p) => { expect(isBarePathname(p)).toBe(false) },
  )
})

describe('app-chrome rules — existing bare prefixes are unchanged', () => {
  it('/ (with or without locale) is bare', () => {
    expect(isBarePathname('/')).toBe(true)
    expect(isBarePathname('/fr')).toBe(true)
    expect(isBarePathname(null)).toBe(true)
    expect(isBarePathname(undefined)).toBe(true)
  })

  it('the 14 historical prefixes are still present, /auth/magic is the 15th', () => {
    const historical = ['/eat', '/eat-next', '/franchise', '/creators', '/supplier', '/admin', '/logistics', '/business', '/t', '/legal', '/login', '/add-activity', '/affiliate', '/onboarding']
    for (const p of historical) expect(BARE_PREFIXES).toContain(p)
    expect(BARE_PREFIXES).toContain('/auth/magic')
    expect(BARE_PREFIXES).toHaveLength(15)
  })

  it.each([
    '/fr/business', '/fr/business/start', '/fr/business/register', '/fr/business/verified', '/fr/business/onboarding', '/ar/business',
    '/fr/eat', '/fr/eat/auth', '/fr/franchise', '/fr/creators/apply', '/fr/supplier', '/fr/admin', '/fr/logistics/dashboard',
    '/fr/t/abc', '/fr/legal/cookies', '/fr/login', '/fr/add-activity', '/fr/affiliate/apply', '/fr/onboarding',
  ])('%s is bare', (p) => { expect(isBarePathname(p)).toBe(true) })

  it('prefix matching is segment-safe (no accidental widening: /tables, /loginx, /eating stay operator)', () => {
    expect(isBarePathname('/fr/tables')).toBe(false) // '/t' must not match '/tables'
    expect(isBarePathname('/fr/loginx')).toBe(false)
    expect(isBarePathname('/fr/eating')).toBe(false)
  })
})

describe('AppChrome.tsx consumes the pure rule and carries no host/effect logic anymore', () => {
  const SRC = readFileSync(path.join(process.cwd(), 'components/AppChrome.tsx'), 'utf8')
  it('imports isBarePathname and contains no hostname / useEffect / useState / partnerHost', () => {
    expect(SRC).toContain("from '@/lib/app-chrome-rules'")
    expect(SRC).toContain('isBarePathname(')
    expect(SRC).not.toMatch(/window\.location\.hostname/)
    expect(SRC).not.toMatch(/\buseEffect\b|\buseState\b|\bpartnerHost\b/)
  })
  it('still wraps non-bare routes in SessionProvider + OperatorShell', () => {
    expect(SRC).toContain('<SessionProvider>')
    expect(SRC).toContain('<OperatorShell>{children}</OperatorShell>')
  })
})
