/**
 * PROD-14 — THE RULE HAS EXACTLY ONE SOURCE, AND THIS TEST IS WHY IT WILL STAY THAT WAY.
 *
 * The delivery mechanism of `docs/ops/P1-PRODUCTION-RUNBOOK.md` is a HUMAN COPY-PASTE into a live
 * host's `.htaccess`. Within one hour the document accumulated THREE versions of the deny rule:
 *
 *   §14.1  a `<FilesMatch "\.(prisma|json|js|ts|map|lock)$">` + `Require all denied` — `.js` is in
 *          that pattern and every client bundle under /_next/static/ IS a .js, so pasting it makes
 *          the site inert (the 2026-09-06 P0);
 *   §15.2  the first RedirectMatch draft, naming `tests|docs|components|app` (absent from the server)
 *          and MISSING `public`, `node_modules` and `tmp` (present), so pasting it fails the probe;
 *   §16.3  a third copy that had already drifted from the artefact — `tmp` was missing.
 *
 * Each was individually defensible; together they guaranteed that some operator would paste the
 * wrong one. That is the T-108 shape: a control in several places is a control that gets
 * half-updated. So the rule now lives in ONE file, the document points at it, and this test refuses
 * any future pasteable copy — including the two shapes that were actually dangerous.
 *
 * It is a LEXICAL ban, so it aims at the EXECUTABLE construction and not at the word: the prose may
 * name `RedirectMatch` and `FilesMatch` freely (it must, to explain the choice), and only a line that
 * an operator could paste as a directive is refused.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'

const ARTEFACT = 'docs/ops/htaccess/PROD-14-deny-sources.htaccess'
const RUNBOOK = 'docs/ops/P1-PRODUCTION-RUNBOOK.md'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

/** A line an operator could paste as an Apache directive, at the start of a line (± indentation). */
const PASTEABLE_DIRECTIVE = /^[ \t]*(RedirectMatch|Redirect|RewriteRule|RewriteCond|Require|<FilesMatch|<Files|<Directory|<Location)\b/

describe('PROD-14 — one source for the deny rule, and the document holds none of it', () => {
  it('the artefact exists and carries the three directives, with every measured-exposed directory named', () => {
    expect(existsSync(ARTEFACT)).toBe(true)
    const src = read(ARTEFACT)
    const directives = src.split('\n').filter((l) => PASTEABLE_DIRECTIVE.test(l))
    expect(directives).toHaveLength(3)

    /* Every docroot directory MEASURED at 200 on app.grubano.com on 2026-09-29 must be named. `tmp`
       is in this list because the repository's own WEB-ROOT-HARDENING-HANDOFF.md:27 had it before I
       did, and the third runbook copy had already lost it. */
    for (const seg of ['prisma', 'scripts', 'lib', 'messages', 'public', 'node_modules', 'tmp']) {
      expect(directives[0], seg).toContain(seg)
    }
    expect(directives[1]).toMatch(/\\\.next/)
    expect(directives[2]).toMatch(/package/)
    expect(directives[2]).toMatch(/server\\\.js/)
  })

  /**
   * THIS TEST EXECUTES THE RULE INSTEAD OF SPELL-CHECKING IT.
   *
   * My first version of this assertion banned the substring `\.js` and immediately failed on
   * `^/(package(-lock)?\.json|server\.js)$` — a pattern anchored to two exact filenames, which is
   * precisely what we want. Banning the WORD was wrong for the same reason it is always wrong: the
   * defect is not that `.js` appears, it is that a pattern MATCHES A CLIENT BUNDLE. So the regexes
   * are compiled and run against the two URL sets that matter. Apache's PCRE and JS agree on the
   * constructs used here (`\.`, `(a|b)?`, `^`, `$`, character alternation).
   *
   * As a side effect this is also what would have caught the missing `public` and `tmp` on its own,
   * without a review: an exposure that must be denied and is not simply fails to match.
   */
  it('EXECUTED: the compiled rule matches everything that must be denied and NOTHING that must be served', () => {
    const regexes = read(ARTEFACT)
      .split('\n')
      .filter((l) => /^[ \t]*RedirectMatch\s+404\s+/.test(l))
      .map((l) => new RegExp(l.replace(/^[ \t]*RedirectMatch\s+404\s+/, '').trim()))
    expect(regexes).toHaveLength(3)
    const denied = (url: string) => regexes.some((re) => re.test(url))

    /* MUST BE DENIED — every path measured at 200 on app.grubano.com on 2026-09-29, plus the
       directory forms that verify the `(/|$)` half of the first pattern. */
    for (const url of [
      '/prisma/schema.prisma', '/prisma/',
      '/scripts/server/phase2-refund-gate.js', '/scripts/cron/cron-target-guard.js', '/scripts/',
      '/lib/ledger-check-core.js', '/lib/claims-payable-core.js', '/lib/',
      '/messages/fr.json', '/messages/',
      '/public/version.json', '/public/manifest.webmanifest', '/public/',
      '/node_modules/next/package.json', '/node_modules/.prisma/client/schema.prisma', '/node_modules/',
      '/tmp/restart.txt', '/tmp/',
      '/.next/prerender-manifest.json', '/.next/routes-manifest.json', '/.next/app-build-manifest.json',
      '/.next/required-server-files.json', '/.next/server/middleware-manifest.json', '/.next/BUILD_ID', '/.next/',
      '/package.json', '/package-lock.json', '/server.js',
    ]) expect(denied(url), `must be DENIED: ${url}`).toBe(true)

    /* MUST STILL BE SERVED — the client bundles (the 2026-09-06 P0), the deploy's own health check,
       the application routes, and every public asset. A rule scoped by file extension fails here. */
    for (const url of [
      '/_next/static/chunks/main-app-1a2b3c.js',
      '/_next/static/chunks/app/global-error-d199d96.js',
      '/_next/static/css/3b56bcf148aaf239.css',
      '/_next/static/media/cairo-arabic.woff2',
      '/_next/data/build/fr.json',
      '/version.json', '/VERSION',
      '/fr/eat', '/fr/auth/magic', '/fr/eat/auth', '/en/dashboard', '/ar/eat',
      '/api/restaurants', '/api/webhooks/stripe', '/api/admin/refunds/run',
      '/favicon.ico', '/favicon.svg', '/apple-touch-icon.png', '/manifest.webmanifest',
      '/sw.js', '/offline.html', '/icons/icon-192.png', '/fonts/OFL-cairo.txt', '/images/x.png', '/brand/y.svg',
      '/',
    ]) expect(denied(url), `must still be SERVED: ${url}`).toBe(false)
  })

  it('and no directive is scoped by file extension or by <FilesMatch> — the shape that caused the 2026-09-06 P0', () => {
    const directives = read(ARTEFACT).split('\n').filter((l) => PASTEABLE_DIRECTIVE.test(l))
    for (const d of directives) expect(d, d).not.toMatch(/FilesMatch|<Files\b/)
    // The dotted `.next` is the on-disk directory; `_next` is the URL Next serves and must never appear.
    expect(read(ARTEFACT)).not.toMatch(/RedirectMatch[^\n]*_next/)
  })

  it('the RUNBOOK contains no pasteable directive at all — it points at the file instead', () => {
    const offenders = read(RUNBOOK)
      .split('\n')
      .map((l, i) => [i + 1, l] as const)
      .filter(([, l]) => PASTEABLE_DIRECTIVE.test(l))
      .map(([n, l]) => `${RUNBOOK}:${n}: ${l.trim().slice(0, 60)}`)
    expect(offenders).toEqual([])
    expect(read(RUNBOOK)).toContain(ARTEFACT.replace('docs/ops/', ''))
  })

  it('NEGATIVE CONTROL — the scan catches each of the three shapes that were actually in the document', () => {
    const shapes = [
      '<FilesMatch "\\.(prisma|json|js|ts|map|lock)$">',
      '  Require all denied',
      'RedirectMatch 404 ^/(prisma|scripts|lib|tests|messages|docs|components|app)(/|$)',
      'RewriteRule ^/x$ /y [L]',
    ]
    for (const s of shapes) expect(PASTEABLE_DIRECTIVE.test(s), s).toBe(true)
    // …and that prose naming the same words is NOT caught, or the ban would refuse its own explanation.
    for (const s of [
      '`<FilesMatch "\\.js$">` tuerait les bundles. `RedirectMatch 404` agit sur le **chemin**.',
      'un `RedirectMatch` peut voir l’URI avant ou après une réécriture',
      '> Elle proposait un `<FilesMatch …>` + `Require all denied`.',
    ]) expect(PASTEABLE_DIRECTIVE.test(s), s).toBe(false)
  })

  it('the artefact names the two warnings that decide whether the paste is survivable', () => {
    const src = read(ARTEFACT)
    // AllowOverride FileInfo: if the host does not grant it, Apache answers 500 for the WHOLE vhost.
    expect(src).toMatch(/AllowOverride/)
    expect(src).toMatch(/500/)
    // .htaccess also carries Passenger config and injected env on this host — a money-adjacent edit.
    expect(src).toMatch(/Passenger\*/)
    expect(src).toMatch(/fr\/eat/)
  })
})
