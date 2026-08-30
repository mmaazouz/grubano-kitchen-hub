import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'

// ── BETA TRUTH — Premium / billing (B1) ──────────────────────────────────────
// Founder doctrine: a restaurateur must NEVER read that they have a
// « Formule actuelle : Premium », saved « Moyens de paiement » or an
// « Historique de facturation » when NO subscription model, NO billing backend
// and NO payment-method storage exist (verified: zero subscription/plan model in
// prisma/schema.prisma, zero billing API route). These are SOURCE LOCKS: they
// pin the removal of the fictitious surfaces and the non-regression of the REAL
// neighbouring surfaces (/finance P&L, commission invoices, KYB/TVA/DAC7 forms).

const read = (p: string) => readFileSync(path.join(process.cwd(), p), 'utf8')

const MORE_CLIENT = read('app/[locale]/more/MoreClient.tsx')
const MORE_CSS = read('app/[locale]/more/more.css')
// the redirect files carry an explanatory header COMMENT naming the removed mock
// (29 €, /pricing…) — the locks target CODE, so line comments are stripped first.
const stripLineComments = (src: string) => src.replace(/^\s*\/\/.*$/gm, '')
const PRICING_PAGE = stripLineComments(read('app/[locale]/pricing/page.tsx'))
const PREMIUM_PAGE = stripLineComments(read('app/[locale]/premium/page.tsx'))

describe('beta truth — /more no longer asserts a fictitious subscription', () => {
  it('references NONE of the fictitious billing i18n keys (plan/premium/methods/history)', () => {
    // the whole more.billing.* namespace was UI-hardcoded fiction — orphaned in
    // messages/*.json (left in place by design), but no component may cite it.
    expect(MORE_CLIENT).not.toMatch(/billing\.(title|plan|premium|methods|methodsSub|history|historySub)/)
    expect(MORE_CLIENT).not.toMatch(/t\('billing/)
  })

  it('holds no « Formule actuelle : Premium » badge (premium tone + star icon gone)', () => {
    expect(MORE_CLIENT).not.toMatch(/'premium'/)
    expect(MORE_CLIENT).not.toMatch(/workspace_premium/)
    expect(MORE_CSS).not.toMatch(/set-badge\.premium/)
  })

  it('links to neither /pricing (mock) nor /finance under a billing pretext', () => {
    expect(MORE_CLIENT).not.toMatch(/href="\/pricing"/)
    // /finance was only linked from the removed billing rows (« Moyens de
    // paiement » / « Historique de facturation ») — both mislabelled its content.
    expect(MORE_CLIENT).not.toMatch(/href="\/finance"/)
  })

  it('keeps every REAL surface of the screen (KYB display, TVA + DAC7 forms, true logout)', () => {
    expect(MORE_CLIENT).toContain('VatNumberForm')
    expect(MORE_CLIENT).toContain('Dac7FiscalForm')
    expect(MORE_CLIENT).toContain('signOut({ callbackUrl:')
    expect(MORE_CLIENT).toContain('href="/notifications"')
    expect(MORE_CLIENT).toContain('href="/legal/mentions-legales"')
    expect(MORE_CLIENT).toContain('href="/legal/confidentialite"')
    expect(MORE_CLIENT).toMatch(/kyb\.kybStatus/)
  })
})

describe('beta truth — /pricing mock is really neutralised (redirect, not rendered)', () => {
  it('is a server redirect to /more — no client code, no fetch, no env gate (SSG-safe)', () => {
    expect(PRICING_PAGE).toContain("import { redirect } from 'next/navigation'")
    expect(PRICING_PAGE).toContain('redirect(`/${params.locale}/more`)')
    expect(PRICING_PAGE).not.toContain("'use client'")
    expect(PRICING_PAGE).not.toMatch(/fetch\(/)
    expect(PRICING_PAGE).not.toMatch(/process\.env/)
  })

  it('carries none of the mock content (hardcoded fees, 29 € plan, inert modal, pricing keys)', () => {
    expect(PRICING_PAGE).not.toMatch(/defaultValue/)
    expect(PRICING_PAGE).not.toMatch(/t\('pricing\./)
    expect(PRICING_PAGE).not.toMatch(/premiumOpen|openPremiumModal/)
    expect(PRICING_PAGE).not.toMatch(/29\s?€|29&nbsp;€/)
  })

  it('its dead stylesheet is deleted and no longer imported', () => {
    expect(existsSync(path.join(process.cwd(), 'app/[locale]/pricing/pricing.css'))).toBe(false)
    expect(PRICING_PAGE).not.toContain('pricing.css')
  })

  it('the ROUTE still exists (middleware sweep /fr/pricing keeps resolving)', () => {
    expect(existsSync(path.join(process.cwd(), 'app/[locale]/pricing/page.tsx'))).toBe(true)
  })
})

describe('beta truth — /premium redirect no longer chains through the mock', () => {
  it('redirects straight to /more (single hop), route kept for the middleware sweep', () => {
    expect(PREMIUM_PAGE).toContain('redirect(`/${params.locale}/more`)')
    expect(PREMIUM_PAGE).not.toContain('/pricing`)')
    expect(existsSync(path.join(process.cwd(), 'app/[locale]/premium/page.tsx'))).toBe(true)
  })
})

describe('beta truth — REAL money surfaces are untouched', () => {
  it('/finance still reads the real P&L from /api/finance/summary (not edited by this train)', () => {
    const finance = read('app/[locale]/finance/page.tsx')
    expect(finance).toContain("fetch('/api/finance/summary'")
  })

  it('the real commission-invoice backend routes still exist', () => {
    expect(existsSync(path.join(process.cwd(), 'app/api/restaurants/[id]/invoices/route.ts'))).toBe(true)
    expect(existsSync(path.join(process.cwd(), 'app/api/admin/invoices/generate/route.ts'))).toBe(true)
  })
})
