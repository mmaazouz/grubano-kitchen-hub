import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  classifyRenderHealth,
  domProbe,
  RENDER_INVALID_MESSAGE,
} from '../scripts/qa/operator-qa-render-health.mjs'

// ── Mission CK — the operator QA robot's render-health guard ──────────────────
//
// On /fr/orders mobile the robot produced a 738x844 capture on a 390x844
// viewport with diffPercent 15.69: the DOCUMENT was 200 but the stylesheets and
// fonts had been refused under HTTP 429 — raw unstyled HTML, Material Symbols
// ligature names visible. The robot watched only the document status;
// document.fonts.ready resolves even when fonts FAIL; networkidle0 is satisfied
// by requests COMPLETED in error. These tests prove the pure classifier's
// verdicts and the robot's wiring WITHOUT executing the robot (the CD pattern:
// replayed against the defective version, the wiring block below goes red).

const ORIGIN = 'https://app.grubano.com'
const ok = { unloadedStylesheets: [], erroredFonts: [] }

describe('cas A — page correctement rendue', () => {
  it('no failures + clean DOM probe → ok, no message', () => {
    const v = classifyRenderHealth({ pageOrigin: ORIGIN, failures: [], probe: ok })
    expect(v).toEqual({ health: 'ok', errors: [], message: null })
  })
})

describe('cas C — document 200 mais ressources critiques refusées (le cas observé)', () => {
  it('stylesheet 429 + font 429, corroborated by the DOM probe → invalid, named resources', () => {
    // The exact /fr/orders mobile failure: CSS and the icon font both 429'd,
    // the page rendered as raw HTML.
    const v = classifyRenderHealth({
      pageOrigin: ORIGIN,
      failures: [
        { type: 'stylesheet', url: `${ORIGIN}/_next/static/css/app.css`, status: 429 },
        { type: 'font', url: `${ORIGIN}/fonts/material-symbols-rounded.woff2`, status: 429 },
      ],
      probe: {
        unloadedStylesheets: [`${ORIGIN}/_next/static/css/app.css`],
        erroredFonts: ['Material Symbols Rounded'],
      },
    })
    expect(v.health).toBe('invalid')
    expect(v.message).toContain(RENDER_INVALID_MESSAGE)
    // Enough information to identify the failing resource.
    expect(JSON.stringify(v.errors)).toContain('/_next/static/css/app.css')
    expect(JSON.stringify(v.errors)).toContain('Material Symbols Rounded')
  })

  it('the DOM probe ALONE invalidates — a stylesheet that never materialised, no network entry', () => {
    // Failure seen only by ground truth (e.g. flapping observed by neither
    // listener, or a cache-served error): the probe is authoritative.
    const v = classifyRenderHealth({
      pageOrigin: ORIGIN,
      failures: [],
      probe: { unloadedStylesheets: [`${ORIGIN}/_next/static/css/app.css`], erroredFonts: [] },
    })
    expect(v.health).toBe('invalid')
  })

  it('an errored FontFace alone → invalid (icon ligatures would render as text)', () => {
    const v = classifyRenderHealth({
      pageOrigin: ORIGIN,
      failures: [],
      probe: { unloadedStylesheets: [], erroredFonts: ['Material Symbols Rounded'] },
    })
    expect(v.health).toBe('invalid')
  })
})

describe('le piège — la police AUTO-HÉBERGÉE : jamais de filtre d’origine', () => {
  it('a SAME-ORIGIN font failure counts fully (the observed self-hosted icon font)', () => {
    const v = classifyRenderHealth({
      pageOrigin: ORIGIN,
      failures: [{ type: 'font', url: `${ORIGIN}/fonts/material-symbols-rounded.woff2`, status: 429 }],
      probe: { unloadedStylesheets: [], erroredFonts: ['Material Symbols Rounded'] },
    })
    expect(v.health).toBe('invalid')
    expect(JSON.stringify(v.errors)).toContain(`${ORIGIN}/fonts/material-symbols-rounded.woff2`)
  })

  it('a REMOTE font failure classifies identically — same rule, no origin distinction', () => {
    const remote = classifyRenderHealth({
      pageOrigin: ORIGIN,
      failures: [{ type: 'font', url: 'https://fonts.gstatic.com/s/x.woff2', status: 429 }],
      probe: { unloadedStylesheets: [], erroredFonts: ['Gabarito'] },
    })
    expect(remote.health).toBe('invalid')
  })
})

describe('réconciliation réseau ↔ DOM — un échec réseau NON corroboré ne ment pas', () => {
  it('stylesheet 429 on the wire but the DOM shows every sheet loaded → degraded (retry/fallback survived)', () => {
    // A failed <link rel=preload as=style> whose real fetch then succeeded, or
    // rate-limit flapping: the FINAL render is fine — invalidating it would be
    // a false positive.
    const v = classifyRenderHealth({
      pageOrigin: ORIGIN,
      failures: [{ type: 'stylesheet', url: `${ORIGIN}/_next/static/css/app.css`, status: 429 }],
      probe: ok,
    })
    expect(v.health).toBe('degraded')
    expect(v.message).toContain('NOT a normal visual verdict')
  })

  it('multi-src @font-face: first source 404 but the FontFace ended loaded → degraded, not invalid', () => {
    const v = classifyRenderHealth({
      pageOrigin: ORIGIN,
      failures: [{ type: 'font', url: `${ORIGIN}/fonts/a.woff2`, status: 404 }],
      probe: ok,
    })
    expect(v.health).toBe('degraded')
  })
})

describe('scripts — /_next/ même-origine critique, tiers dégradé (décision ① validée)', () => {
  it('a same-origin /_next/ chunk failure → invalid (hydration is dead)', () => {
    const v = classifyRenderHealth({
      pageOrigin: ORIGIN,
      failures: [{ type: 'script', url: `${ORIGIN}/_next/static/chunks/main-app.js`, status: 429 }],
      probe: ok,
    })
    expect(v.health).toBe('invalid')
    expect(v.message).toContain(RENDER_INVALID_MESSAGE)
  })

  it('a third-party script failure → degraded only (no pixel necessarily depends on it)', () => {
    const v = classifyRenderHealth({
      pageOrigin: ORIGIN,
      failures: [{ type: 'script', url: 'https://js.stripe.com/v3/', status: 403 }],
      probe: ok,
    })
    expect(v.health).toBe('degraded')
  })

  it('a /_next/ path on a FOREIGN origin is not the page’s own chunk → degraded', () => {
    const v = classifyRenderHealth({
      pageOrigin: ORIGIN,
      failures: [{ type: 'script', url: 'https://evil.example/_next/static/chunks/x.js', status: 500 }],
      probe: ok,
    })
    expect(v.health).toBe('degraded')
  })

  it('a script chunk failure is decisive even when the probe itself failed', () => {
    // Precedence: proven critical > unknown.
    const v = classifyRenderHealth({
      pageOrigin: ORIGIN,
      failures: [{ type: 'script', url: `${ORIGIN}/_next/static/chunks/main-app.js`, status: 429 }],
      probe: null,
    })
    expect(v.health).toBe('invalid')
  })
})

describe('cas D — ressources non critiques : jamais bloquantes', () => {
  it('image 404 → degraded (diff computed, flagged)', () => {
    const v = classifyRenderHealth({
      pageOrigin: ORIGIN,
      failures: [{ type: 'image', url: `${ORIGIN}/img/logo.png`, status: 404 }],
      probe: ok,
    })
    expect(v.health).toBe('degraded')
  })

  it('a SUB-frame document error → degraded (the main document is diagnoseShot’s job)', () => {
    const v = classifyRenderHealth({
      pageOrigin: ORIGIN,
      failures: [{ type: 'document', url: `${ORIGIN}/embed/frame`, status: 500 }],
      probe: ok,
    })
    expect(v.health).toBe('degraded')
  })

  it('xhr/fetch/prefetch/preflight/ping/websocket errors are IGNORED — data, not rendering', () => {
    const v = classifyRenderHealth({
      pageOrigin: ORIGIN,
      failures: [
        { type: 'xhr', url: `${ORIGIN}/api/orders`, status: 429 },
        { type: 'fetch', url: `${ORIGIN}/api/notifications`, status: 500 },
        { type: 'prefetch', url: `${ORIGIN}/fr/menu`, status: 404 },
        { type: 'preflight', url: `${ORIGIN}/api/x`, status: 403 },
        { type: 'ping', url: `${ORIGIN}/beacon`, status: 400 },
        { type: 'websocket', url: `wss://app.grubano.com/ws`, status: 400 },
        { type: 'cspviolationreport', url: `${ORIGIN}/csp`, status: 400 },
      ],
      probe: ok,
    })
    expect(v.health).toBe('ok')
    expect(v.errors).toEqual([])
  })

  it('a net-level font failure (ERR_FAILED — CORS-blocked) is counted as a network suspicion', () => {
    const v = classifyRenderHealth({
      pageOrigin: ORIGIN,
      failures: [{ type: 'font', url: 'https://fonts.gstatic.com/s/x.woff2', status: null, errorText: 'net::ERR_FAILED' }],
      probe: ok,
    })
    expect(v.health).toBe('degraded')
    expect(JSON.stringify(v.errors)).toContain('net::ERR_FAILED')
  })
})

describe('sonde impossible — la capture ne peut pas être certifiée', () => {
  it('probe null (wedged page) → unknown, never ok', () => {
    const v = classifyRenderHealth({ pageOrigin: ORIGIN, failures: [], probe: null })
    expect(v.health).toBe('unknown')
    expect(v.message).toContain('cannot be certified')
  })
})

describe('navigation jamais établie — un timeout ne produit plus de diff non flaggé', () => {
  it('goto returned no response + otherwise clean shot → capped at degraded (revue adversariale)', () => {
    // A half-painted networkidle0 timeout used to yield an unflagged diff —
    // the exact « meaningless diffPercent » this mission forbids.
    const v = classifyRenderHealth({ pageOrigin: ORIGIN, failures: [], probe: ok, navSettled: false })
    expect(v.health).toBe('degraded')
    expect(v.message).toContain('never settled')
  })

  it('navSettled defaults to true — a settled clean shot stays ok', () => {
    expect(classifyRenderHealth({ pageOrigin: ORIGIN, failures: [], probe: ok }).health).toBe('ok')
  })

  it('a critical failure still outranks the unsettled cap → invalid', () => {
    const v = classifyRenderHealth({
      pageOrigin: ORIGIN,
      failures: [],
      probe: { unloadedStylesheets: [`${ORIGIN}/_next/static/css/app.css`], erroredFonts: [] },
      navSettled: false,
    })
    expect(v.health).toBe('invalid')
  })

  it('a DOM-origin critical is described as never loaded, not as a network failure', () => {
    const v = classifyRenderHealth({
      pageOrigin: ORIGIN,
      failures: [],
      probe: { unloadedStylesheets: [], erroredFonts: ['Material Symbols Rounded'] },
    })
    expect(v.message).toContain('never loaded (DOM)')
    expect(v.message).not.toContain('network failure')
  })
})

describe('la sonde DOM — testée sur un document simulé', () => {
  // domProbe is self-contained (serialised into the browser); here it runs
  // against faked globals so its filters are proven without a browser.
  const g = globalThis as Record<string, unknown>
  afterEach(() => { delete g.document; delete g.matchMedia })

  function fakeDom({ links = [] as Array<Record<string, unknown>>, fonts = [] as Array<Record<string, unknown>> }) {
    g.document = {
      querySelectorAll: () => links,
      fonts,
    }
    g.matchMedia = (q: string) => ({ matches: q !== 'print' && q !== '(min-width: 1024px)' })
  }

  it('a stylesheet link whose .sheet never materialised is reported', () => {
    fakeDom({ links: [{ disabled: false, media: '', sheet: null, href: 'https://x/app.css' }] })
    expect(domProbe()).toEqual({ unloadedStylesheets: ['https://x/app.css'], erroredFonts: [] })
  })

  it('a loaded stylesheet (sheet present) is NOT reported', () => {
    fakeDom({ links: [{ disabled: false, media: '', sheet: {}, href: 'https://x/app.css' }] })
    expect(domProbe().unloadedStylesheets).toEqual([])
  })

  it('a DISABLED link is intentionally unapplied — not a failure', () => {
    fakeDom({ links: [{ disabled: true, media: '', sheet: null, href: 'https://x/theme-dark.css' }] })
    expect(domProbe().unloadedStylesheets).toEqual([])
  })

  it('a media that does not match this shot (print, desktop-only in mobile) is filtered', () => {
    fakeDom({
      links: [
        { disabled: false, media: 'print', sheet: null, href: 'https://x/print.css' },
        { disabled: false, media: '(min-width: 1024px)', sheet: null, href: 'https://x/desktop.css' },
      ],
    })
    expect(domProbe().unloadedStylesheets).toEqual([])
  })

  it('an errored FontFace is reported by family; loaded/unloaded ones are not', () => {
    fakeDom({
      fonts: [
        { status: 'error', family: 'Material Symbols Rounded' },
        { status: 'loaded', family: 'Gabarito' },
        { status: 'unloaded', family: 'Unused Face' },
      ],
    })
    expect(domProbe().erroredFonts).toEqual(['Material Symbols Rounded'])
  })
})

describe('le robot est câblé à la garde — le comparateur est gaté', () => {
  const robotSrc = fs.readFileSync(
    path.resolve(__dirname, '..', 'scripts', 'qa', 'operator-visual-qa.mjs'), 'utf8',
  )

  it('imports the render-health classifier and the DOM probe', () => {
    expect(robotSrc).toContain("from './operator-qa-render-health.mjs'")
    expect(robotSrc).toContain('classifyRenderHealth(')
    expect(robotSrc).toContain('page.evaluate(domProbe)')
  })

  it('observes subresources: response + requestfailed listeners, ERR_ABORTED excluded', () => {
    expect(robotSrc).toContain("page.on('response'")
    expect(robotSrc).toContain("page.on('requestfailed'")
    expect(robotSrc).toContain("'net::ERR_ABORTED'")
    // failure() is nullable and errorText not guaranteed — the safe read.
    expect(robotSrc).toContain('request.failure()?.errorText ?? ')
  })

  it('collects pageerror without letting it drive health (decision ⑤)', () => {
    expect(robotSrc).toContain("page.on('pageerror'")
    expect(robotSrc).toContain('pageErrors')
  })

  it('the pixel diff is GATED — no skipReason, no diff', () => {
    expect(robotSrc).toContain('if (!rec.skipReason)')
    expect(robotSrc).toContain("rec.skipReason = 'render-invalid'")
    expect(robotSrc).toContain('`auth-${verdict.kind}`')
    expect(robotSrc).toContain("rec.skipReason = 'ref-render-invalid'")
    expect(robotSrc).toContain("rec.skipReason = 'ref-render-unknown'")
    // A skipped case purges any STALE diff.png from a previous run.
    expect(robotSrc).toContain("fs.rmSync(path.join(dir, 'diff.png')")
  })

  it('a nullable frame() cannot smuggle the MAIN document into failures', () => {
    // puppeteer: frame() is « null if navigating to error pages » — the
    // exclusion must treat a null frame as the main document.
    expect(robotSrc).toContain('req.frame() === page.mainFrame() || req.frame() === null')
  })

  it('the unsettled-navigation cap is wired: navSettled fed from the shot status, both sides', () => {
    expect(robotSrc).toContain('navSettled: status !== null')
    expect(robotSrc).toContain('navSettled: refShot.status !== null')
  })

  it('records the new resume.json fields, ref side included (decision ②)', () => {
    expect(robotSrc).toContain('renderHealth: appHealth.health')
    expect(robotSrc).toContain('rec.refRenderHealth = refHealth.health')
    expect(robotSrc).toContain('rec.renderErrors = ')
    expect(robotSrc).toContain('rec.refRenderErrors = ')
  })

  it('the invalid banner exists and the message is the classifier’s (single source)', () => {
    const guardSrc = fs.readFileSync(
      path.resolve(__dirname, '..', 'scripts', 'qa', 'operator-qa-render-health.mjs'), 'utf8',
    )
    expect(guardSrc).toContain("'RENDER INVALID — CRITICAL STATIC RESOURCE FAILED'")
    expect(robotSrc).toContain('appHealth.message')
  })

  it('detects the app target by URL scheme facts, never by cookie presence', () => {
    // The classifier receives the page origin computed from BASE, and the ref
    // side passes pageOrigin: null — cookie presence is an auth concern.
    expect(robotSrc).toContain('pageOrigin: new URL(BASE).origin')
    expect(robotSrc).toContain('pageOrigin: null')
  })

  it('the DOM probe runs on the timeout path too (not conditioned on resp)', () => {
    // The probe call must not sit inside an `if (resp…)` — source-level check:
    // the probe line follows the settle unconditionally.
    const probeIdx = robotSrc.indexOf('page.evaluate(domProbe)')
    const settleIdx = robotSrc.indexOf('settle fonts / late paints')
    expect(probeIdx).toBeGreaterThan(settleIdx)
    const between = robotSrc.slice(settleIdx, probeIdx)
    expect(between).not.toContain('if (resp')
  })
})
