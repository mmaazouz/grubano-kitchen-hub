/**
 * « Devenir partenaire Grubano » on the consumer profile must reach the PARTNER LANDING, never a
 * single role's funnel, and must not carry the consumer's e-mail.
 *
 * WHAT WAS WRONG (app/[locale]/eat/account/page.tsx, before this lot):
 *     const becomePartnerRoute = session?.user?.email
 *       ? `/creators/apply?email=${encodeURIComponent(session.user.email)}`
 *       : '/creators/apply'
 *
 * Three defects in one expression. A generic entry sent restaurateurs, suppliers and couriers into
 * the CREATOR application. That route answers 404 BY DESIGN — app/[locale]/creators/layout.tsx does
 * `if (!isCreatorEnabled()) notFound()`, masking the whole subtree while CREATOR_ENABLED is off, and
 * it was measured 404 on grubano.com AND on app.grubano.com, so it was never a production-only
 * typo. And the e-mail travelled in a query string, which means browser history, Referer headers and
 * every access log.
 *
 * WHY THE ASSERTION IS ON THE SOURCE AND NOT ON A RENDER. The destination is decided by one
 * expression in a client component wired to `router.push`; rendering the page would need a session,
 * a loyalty wallet, an order list and five locale bundles to assert one string. The regression this
 * test exists to stop is textual — someone reinstating `/creators/apply` — so the source is the
 * right surface. The locale is NOT asserted here because it is not this file's job: `router` comes
 * from @/navigation with localePrefix 'always', and that contract is pinned separately below.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'

const PAGE = 'app/[locale]/eat/account/page.tsx'
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

/** Blank block comments (newlines preserved), then drop whole-line // comments. The explanation
 *  beside the fix necessarily names `/creators/apply`; a ban that read comments would refuse its
 *  own documentation — the mistake this repository has paid for repeatedly. */
function executable(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((l) => (/^\s*\/\//.test(l) ? '' : l))
    .join('\n')
}

describe('consumer profile — « Devenir partenaire » goes to the partner landing', () => {
  const src = read(PAGE)
  const code = executable(src)

  it('the destination is exactly /business', () => {
    expect(code).toMatch(/const\s+becomePartnerRoute\s*=\s*'\/business'/)
    // and it is what the row actually pushes
    expect(code).toMatch(/router\.push\(becomePartnerRoute\)/)
  })

  it('/creators/apply is no longer used from the consumer profile', () => {
    expect(code).not.toContain('/creators/apply')
    expect(code).not.toContain('/creators')
  })

  it('the consumer e-mail is no longer injected into this navigation', () => {
    // No query string at all on the partner route, and no e-mail interpolation anywhere near it.
    expect(code).not.toMatch(/becomePartnerRoute\s*=\s*[^;\n]*email/i)
    expect(code).not.toMatch(/\?email=/)
    expect(code).not.toMatch(/encodeURIComponent\(\s*session[^)]*email/)
  })

  it('no absolute partner URL is hard-coded — business.grubano.com currently serves the STAGING build', () => {
    expect(code).not.toMatch(/https?:\/\/business\.grubano\.com/)
    // Nor any other absolute host on this route: a cross-environment jump is the worse bug.
    expect(code).not.toMatch(/becomePartnerRoute\s*=\s*[`'"]https?:/)
  })

  it('the locale is NOT hard-coded — @/navigation prefixes it (localePrefix "always")', () => {
    expect(code).not.toMatch(/becomePartnerRoute\s*=\s*'\/(fr|en|es|it|ar)\//)
    // The contract this relies on, pinned where it lives.
    const nav = read('navigation.ts')
    expect(nav).toMatch(/localePrefix\s*=\s*'always'/)
    expect(nav).toMatch(/useRouter/)
    // …and the page must take its router from there, not from next/navigation.
    expect(code).toMatch(/useRouter\s*}?\s*from\s*'@\/navigation'|from\s*'@\/navigation'/)
    expect(code).not.toMatch(/from\s*'next\/navigation'/)
  })

  it('the target exists and, unlike /creators, is behind no feature flag', () => {
    expect(existsSync('app/[locale]/business/page.tsx')).toBe(true)
    for (const f of ['app/[locale]/business/page.tsx', 'app/[locale]/business/layout.tsx']) {
      if (!existsSync(f)) continue
      const t = executable(read(f))
      expect(t, f).not.toMatch(/notFound\(\)/)
      expect(t, f).not.toMatch(/_ENABLED/)
    }
    // Control: the route we moved AWAY from really is flag-masked, which is why it 404s.
    const creatorsLayout = executable(read('app/[locale]/creators/layout.tsx'))
    expect(creatorsLayout).toMatch(/isCreatorEnabled/)
    expect(creatorsLayout).toMatch(/notFound\(\)/)
  })

  it('NEGATIVE CONTROL — reinstating either half of the old expression is caught', () => {
    const restored = code + "\nconst x = session?.user?.email ? `/creators/apply?email=${encodeURIComponent(session.user.email)}` : '/creators/apply'\n"
    expect(restored).toContain('/creators/apply')
    expect(restored).toMatch(/\?email=/)
    expect(restored).toMatch(/encodeURIComponent\(\s*session[^)]*email/)
    // And an absolute staging-serving host would be caught too.
    expect(code + "\nconst y = 'https://business.grubano.com/fr/business'\n").toMatch(/https?:\/\/business\.grubano\.com/)
  })

  it('the change is CONFINED to the consumer profile — the other partner entries keep their creator path', () => {
    // lib/add-activity.ts offers a creator entry on purpose (the « add activity » chooser)…
    expect(read('lib/add-activity.ts')).toContain("'/creators/apply'")
    // …and so does the trade chooser at /business/start, which is where picking "creator" belongs.
    expect(read('app/[locale]/business/start/page.tsx')).toContain("'/creators/apply'")
  })
})
