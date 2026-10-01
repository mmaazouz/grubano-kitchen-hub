import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { diagnoseShot } from '../scripts/qa/operator-qa-diagnose.mjs'

// ── Mission CD (⑥c) — the operator QA robot's auth guard, un-inverted ─────────
//
// The old in-line guard read an arrival on /eat/auth as « session valid, role
// missing », while the product sends UNAUTHENTICATED visitors there; and for the
// operator screens the robot shoots, the middleware bounces no-session requests
// to /{locale}/login and insufficient roles to /{locale}/eat (or the role home)
// — URLs the old guard did not watch at all, so both failures were silent.
//
// These tests cover the four ⑥c situations DISTINCTLY. They would fail against
// the inverted guard twice over: (a) the classifier module did not exist — the
// import alone would be red; (b) the wiring test asserts the inverted diagnosis
// string is GONE from the robot — red as long as the old guard is in place.

const BASE = 'https://app.grubano.com'

describe('① requête NON AUTHENTIFIÉE — arrival on an auth page', () => {
  it('final URL /{locale}/login (middleware bounce for operator routes) → unauthenticated', () => {
    const v = diagnoseShot({
      requestedUrl: `${BASE}/fr/dashboard`, finalUrl: `${BASE}/fr/login`, status: 200,
    })
    expect(v.kind).toBe('unauthenticated')
    // The message must state the truth — and never the inverted diagnosis.
    expect(v.message).toContain('UNAUTHENTICATED')
    expect(v.message).not.toContain('session is valid')
  })

  it('final URL /eat/auth (consumer per-page guard) → unauthenticated, NOT role-mismatch', () => {
    // This is the exact case the old guard diagnosed backwards.
    const v = diagnoseShot({
      requestedUrl: `${BASE}/fr/dashboard`,
      finalUrl: `${BASE}/fr/eat/auth?callbackUrl=%2Ffr%2Fdashboard`,
      status: 200,
    })
    expect(v.kind).toBe('unauthenticated')
    expect(v.kind).not.toBe('role-mismatch')
  })

  it('the auth-page verdict wins over an error status — the bounce is the primary fact', () => {
    const v = diagnoseShot({
      requestedUrl: `${BASE}/fr/menu`, finalUrl: `${BASE}/fr/login`, status: 500,
    })
    expect(v.kind).toBe('unauthenticated')
  })

  it('final URL /auth/magic (page-level guard on tables/add-activity/establishments) → unauthenticated', () => {
    // These operator pages bounce a REJECTED session (or a session whose operator
    // row no longer exists) to /auth/magic — an auth failure, not a role one.
    const v = diagnoseShot({
      requestedUrl: `${BASE}/fr/tables`, finalUrl: `${BASE}/fr/auth/magic`, status: 200,
    })
    expect(v.kind).toBe('unauthenticated')
  })

  it('matches the auth pages with any locale prefix, and without one', () => {
    for (const u of [
      `${BASE}/en/login`, `${BASE}/login`,
      `${BASE}/ar/eat/auth`, `${BASE}/eat/auth`,
      `${BASE}/it/auth/magic`, `${BASE}/auth/magic`,
    ]) {
      expect(diagnoseShot({ requestedUrl: `${BASE}/fr/orders`, finalUrl: u, status: 200 }).kind)
        .toBe('unauthenticated')
    }
  })

  it('does NOT read a page merely containing "login" in its path as an auth page', () => {
    const v = diagnoseShot({
      requestedUrl: `${BASE}/fr/dashboard/login-history`,
      finalUrl: `${BASE}/fr/dashboard/login-history`, status: 200,
    })
    expect(v.kind).toBe('ok')
  })
})

describe('② authentifié SANS rôle suffisant — bounced off the target, no auth page', () => {
  it('/fr/dashboard bounced to /fr/eat (middleware safeFallback) → role-mismatch', () => {
    const v = diagnoseShot({
      requestedUrl: `${BASE}/fr/dashboard`, finalUrl: `${BASE}/fr/eat`, status: 200,
    })
    expect(v.kind).toBe('role-mismatch')
    expect(v.message).toContain('session ACCEPTED')
  })

  it('an operator flat route bounced to the primary-role home → role-mismatch', () => {
    // e.g. an affiliate-role account shooting /fr/menu lands on its own space.
    const v = diagnoseShot({
      requestedUrl: `${BASE}/fr/menu`, finalUrl: `${BASE}/fr/affiliate/dashboard`, status: 200,
    })
    expect(v.kind).toBe('role-mismatch')
  })

  it('a bounce to /business/onboarding is NOT a role problem — the role was right', () => {
    // app/[locale]/dashboard/layout.tsx gates a restaurant-role account with no
    // brand/establishment to /business/onboarding. Calling this a role mismatch
    // would reproduce the exact inversion this mission removes.
    const v = diagnoseShot({
      requestedUrl: `${BASE}/fr/dashboard`, finalUrl: `${BASE}/fr/business/onboarding`, status: 200,
    })
    expect(v.kind).toBe('onboarding-gate')
    expect(v.kind).not.toBe('role-mismatch')
    expect(v.message).toContain('role ACCEPTED')
  })
})

describe('③ authentifié AVEC rôle suffisant — the screen renders where asked', () => {
  it('same path → ok, no message', () => {
    const v = diagnoseShot({
      requestedUrl: `${BASE}/fr/dashboard`, finalUrl: `${BASE}/fr/dashboard`, status: 200,
    })
    expect(v).toEqual({ kind: 'ok', message: null })
  })

  it('a query string or trailing slash added by the app is still ok', () => {
    expect(diagnoseShot({
      requestedUrl: `${BASE}/fr/orders`, finalUrl: `${BASE}/fr/orders?tab=new`, status: 200,
    }).kind).toBe('ok')
    expect(diagnoseShot({
      requestedUrl: `${BASE}/fr/orders`, finalUrl: `${BASE}/fr/orders/`, status: 200,
    }).kind).toBe('ok')
  })
})

describe('④ erreur applicative — distinct from every auth situation', () => {
  it('HTTP 500 on the target itself → app-error, explicitly not an auth problem', () => {
    const v = diagnoseShot({
      requestedUrl: `${BASE}/fr/finance`, finalUrl: `${BASE}/fr/finance`, status: 500,
    })
    expect(v.kind).toBe('app-error')
    expect(v.message).toContain('500')
    expect(v.message).toContain('not an auth problem')
  })

  it('HTTP 404 (screen absent or flag-gated layout) → app-error', () => {
    expect(diagnoseShot({
      requestedUrl: `${BASE}/fr/prep`, finalUrl: `${BASE}/fr/prep`, status: 404,
    }).kind).toBe('app-error')
  })

  it('navigation that produced no page (timeout/crash) → app-error', () => {
    expect(diagnoseShot({
      requestedUrl: `${BASE}/fr/stocks`, finalUrl: 'about:blank', status: null,
    }).kind).toBe('app-error')
  })

  it('a null status with the page correctly in place stays ok (capture-only semantics)', () => {
    // goto timed out during late loading but the target painted — old behaviour kept.
    expect(diagnoseShot({
      requestedUrl: `${BASE}/fr/stocks`, finalUrl: `${BASE}/fr/stocks`, status: null,
    }).kind).toBe('ok')
  })
})

describe('the robot is wired to the classifier — the inverted guard is gone', () => {
  const robotSrc = fs.readFileSync(
    path.resolve(__dirname, '..', 'scripts', 'qa', 'operator-visual-qa.mjs'), 'utf8',
  )

  it('imports the classifier module', () => {
    expect(robotSrc).toContain("from './operator-qa-diagnose.mjs'")
    expect(robotSrc).toContain('diagnoseShot(')
  })

  it('no longer carries the inverted diagnosis', () => {
    // The exact backwards message the old guard printed on /eat/auth arrivals.
    expect(robotSrc).not.toContain('the session is valid but the account may')
    // Nor the bare regex-only check that could never fire on operator bounces.
    expect(robotSrc).not.toMatch(/\/eat\\\/auth\/\.test\(finalUrl\)/)
  })

  it('records the verdict and the HTTP status for every case (resume.json rows)', () => {
    expect(robotSrc).toContain('authDiagnosis: verdict.kind')
    expect(robotSrc).toContain('httpStatus: status')
  })
})
