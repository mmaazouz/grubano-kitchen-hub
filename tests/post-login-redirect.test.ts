import { describe, it, expect } from 'vitest'
import { POST_LOGIN_REDIRECTS, postLoginPath } from '@/lib/post-login-redirect'

// ── Post-login routing guard (P1, Agent 17) ──────────────────────────────────
// Anti-regression for the bug fix + the new logistics wiring: every partner role
// must land on its OWN private dashboard after sign-in, never a public landing,
// and an unknown role must fall back to the always-renders consumer app (/eat).

describe('postLoginPath / POST_LOGIN_REDIRECTS', () => {
  it('logistics lands on its dashboard (was ABSENT → /eat fallback before P1)', () => {
    expect(postLoginPath('logistics')).toBe('/logistics/dashboard')
  })

  it('creator lands on its dashboard, not the public /creators landing (bug fix)', () => {
    expect(postLoginPath('creator')).toBe('/creators/dashboard')
  })

  it('franchise lands on its dashboard, not the public /franchise landing (bug fix)', () => {
    expect(postLoginPath('franchise')).toBe('/franchise/dashboard')
  })

  it('untouched roles keep their landing (non-regression)', () => {
    expect(postLoginPath('restaurant')).toBe('/dashboard')
    expect(postLoginPath('admin')).toBe('/dashboard')
    expect(postLoginPath('supplier')).toBe('/supplier/dashboard')
    expect(postLoginPath('consumer')).toBe('/eat')
  })

  it('unknown / missing role falls back to the public consumer app', () => {
    expect(postLoginPath('mystery')).toBe('/eat')
    expect(postLoginPath(undefined)).toBe('/eat')
    expect(postLoginPath(null)).toBe('/eat')
    expect(postLoginPath('')).toBe('/eat')
  })

  it('no partner role points at a bare public landing (every partner → /…/dashboard)', () => {
    for (const role of ['restaurant', 'franchise', 'creator', 'supplier', 'logistics'] as const) {
      expect(POST_LOGIN_REDIRECTS[role]).toMatch(/\/dashboard$/)
    }
  })
})
