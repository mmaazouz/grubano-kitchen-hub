#!/usr/bin/env node
/**
 * operator-visual-qa.mjs — auth-gated OPERATOR visual-QA robot.
 *
 * Logs in as a REAL staging test operator (programmatic NextAuth Credentials sign-in
 * over fetch — NO auth weakening: it hits the same /api/auth endpoints a browser does),
 * then drives an ALREADY-INSTALLED Chrome (puppeteer-core, no download) to screenshot
 * each configured operator screen, and pixel-diffs the ones that have a committed CD ref.
 *
 * Per screen / viewport it writes:
 *   design-qa/operator/<name>/<viewport>/app.png   — the real staging page
 *   design-qa/operator/<name>/<viewport>/ref.png   — the CD reference mock (when a ref exists)
 *   design-qa/operator/<name>/<viewport>/diff.png  — pixelmatch highlight (when a ref exists)
 * plus a resume.json + a console.table of {screen, hasRef, diff%, render health}.
 *
 * RENDER-HEALTH GUARD (mission CK): a capture whose critical static resources
 * (CSS, fonts, /_next/ chunks) failed to load is NOT comparable — the robot
 * records renderHealth/renderErrors (and refRenderHealth for the CD mock shot,
 * which hot-links Google Fonts), skips the pixel diff with an explicit
 * skipReason, and prints RENDER INVALID — CRITICAL STATIC RESOURCE FAILED
 * instead of a meaningless diffPercent. See operator-qa-render-health.mjs.
 *
 * TOOLING ONLY — never imports app code; only calls public HTTP endpoints + reads local CD mocks.
 *
 * Env:
 *   QA_BASE_URL       (default 'https://app.grubano.com')
 *   QA_EMAIL          the seeded staging operator email
 *   QA_PASSWORD       its password
 *   QA_RESTAURANT_ID  \_ used by operator-qa.config.mjs for the dynamic [id] routes
 *   QA_BRAND_ID       /
 *   CHROME_BIN        explicit Chrome/Edge path (else auto-detected)
 *
 * Usage:
 *   QA_BASE_URL=https://app.grubano.com QA_EMAIL=… QA_PASSWORD=… \
 *   QA_RESTAURANT_ID=… QA_BRAND_ID=… node scripts/qa/operator-visual-qa.mjs
 */
import puppeteer from 'puppeteer-core'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { diagnoseShot } from './operator-qa-diagnose.mjs'
import { classifyRenderHealth, domProbe } from './operator-qa-render-health.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..', '..')
const OUT_ROOT = path.join(ROOT, 'design-qa', 'operator')
const BASE = (process.env.QA_BASE_URL || 'https://app.grubano.com').replace(/\/$/, '')
const EMAIL = process.env.QA_EMAIL || ''
const PASSWORD = process.env.QA_PASSWORD || ''

/* ── locate an installed Chrome/Edge (no download) — mirrors design-qa.mjs ─────── */
function findChrome() {
  if (process.env.CHROME_BIN && fs.existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN
  const pf = process.env['ProgramFiles'] || 'C:/Program Files'
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)'
  const local = process.env['LOCALAPPDATA'] || ''
  const candidates = [
    `${pf}/Google/Chrome/Application/chrome.exe`,
    `${pf86}/Google/Chrome/Application/chrome.exe`,
    `${local}/Google/Chrome/Application/chrome.exe`,
    `${pf}/Microsoft/Edge/Application/msedge.exe`,
    `${pf86}/Microsoft/Edge/Application/msedge.exe`,
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].map((p) => p.replace(/\\/g, '/'))
  return candidates.find((p) => { try { return fs.existsSync(p) } catch { return false } }) || null
}

/* ── cookie helpers ───────────────────────────────────────────────────────────── */
// A NextAuth Set-Cookie line → { name, value }. We only need the name=value pair for
// the Cookie header (the rest — Path/HttpOnly/Secure — is irrelevant to the request).
function parseSetCookie(line) {
  const first = String(line).split(';', 1)[0]
  const eq = first.indexOf('=')
  if (eq < 0) return null
  return { name: first.slice(0, eq).trim(), value: first.slice(eq + 1).trim() }
}
function cookieHeader(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ')
}

/* ── programmatic NextAuth Credentials login (same endpoints a browser uses) ───── */
async function login() {
  if (!EMAIL || !PASSWORD) throw new Error('QA_EMAIL / QA_PASSWORD must be set.')
  const jar = {}

  // 1) CSRF token (+ capture the csrf cookie NextAuth sets).
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`, { headers: { accept: 'application/json' } })
  for (const line of csrfRes.headers.getSetCookie()) {
    const c = parseSetCookie(line)
    if (c) jar[c.name] = c.value
  }
  const { csrfToken } = await csrfRes.json()
  if (!csrfToken) throw new Error('No csrfToken from /api/auth/csrf — is the base URL correct?')

  // 2) POST the Credentials callback (email + password). redirect:'manual' so we can
  //    read the Set-Cookie on the 302 without following it.
  const body = new URLSearchParams({
    csrfToken,
    email: EMAIL,
    password: PASSWORD,
    callbackUrl: `${BASE}/dashboard`,
    json: 'true',
  })
  const loginRes = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: cookieHeader(jar),
    },
    body: body.toString(),
  })
  for (const line of loginRes.headers.getSetCookie()) {
    const c = parseSetCookie(line)
    if (c) jar[c.name] = c.value
  }

  // 3) Extract the SESSION cookie (secure or plain variant).
  const sessionName = Object.keys(jar).find((n) =>
    /(^|\.)next-auth\.session-token$/.test(n) || /^__Secure-next-auth\.session-token$/.test(n),
  )
  if (!sessionName || !jar[sessionName]) {
    throw new Error(
      'login failed — no next-auth session cookie was set. ' +
      'Check QA_EMAIL / QA_PASSWORD and that the account exists (status active, role restaurant) on staging.',
    )
  }
  return { name: sessionName, value: jar[sessionName] }
}

/* ── pixel diff — mirrors design-qa.mjs (crop to the common min box) ───────────── */
function diffPng(appBuf, refBuf) {
  const a = PNG.sync.read(appBuf), b = PNG.sync.read(refBuf)
  const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height)
  const crop = (src) => {
    if (src.width === w && src.height === h) return src
    const d = new PNG({ width: w, height: h }); PNG.bitblt(src, d, 0, 0, w, h, 0, 0); return d
  }
  const ca = crop(a), cb = crop(b), out = new PNG({ width: w, height: h })
  const nDiff = pixelmatch(ca.data, cb.data, out.data, w, h, { threshold: 0.1 })
  return {
    diffBuf: PNG.sync.write(out),
    pct: +((100 * nDiff) / (w * h)).toFixed(2),
    appSize: `${a.width}x${a.height}`, refSize: `${b.width}x${b.height}`, compared: `${w}x${h}`,
  }
}

/* ── screenshot helper (full page at the given viewport) ──────────────────────── */
async function shoot(browser, target, vp, sessionCookie) {
  const page = await browser.newPage()
  try {
    await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 1 })
    // Auth: inject the session cookie for app URLs. (Ref mocks are file:// → no cookie.)
    if (sessionCookie) {
      await page.setCookie({
        name: sessionCookie.name,
        value: sessionCookie.value,
        domain: new URL(BASE).hostname,
        path: '/',
        httpOnly: true,
        secure: BASE.startsWith('https'),
      })
    }
    // Render-health collection (mission CK) — listeners attached BEFORE goto so
    // the navigation's own subresources are observed. Handler bodies never throw
    // (a throw inside a page.on handler would abort the whole multi-screen run).
    // A 429 is a COMPLETED response → it arrives via 'response'; 'requestfailed'
    // only carries net-level errors. The MAIN-frame document is excluded here
    // (diagnoseShot owns it); SUB-frame documents are recorded.
    const failures = []
    let pageErrors = 0
    page.on('pageerror', () => { pageErrors += 1 })
    // frame() is NULLABLE ("null if navigating to error pages" — puppeteer
    // types.d.ts:3894-3897): a net-level failure of the MAIN document arrives
    // with a null frame, so a bare `frame() === mainFrame()` comparison would
    // let the main document slip into failures as a phantom sub-frame
    // (adversarial review). diagnoseShot owns the main document either way.
    const isMainDocument = (req) =>
      req.resourceType() === 'document' &&
      (req.frame() === page.mainFrame() || req.frame() === null)
    page.on('response', (response) => {
      try {
        if (response.status() < 400) return
        const req = response.request()
        if (isMainDocument(req)) return
        failures.push({ type: req.resourceType(), url: response.url(), status: response.status() })
      } catch { /* never break the shot */ }
    })
    page.on('requestfailed', (request) => {
      try {
        const errorText = request.failure()?.errorText ?? 'unknown'
        // net::ERR_ABORTED = benign cancellation (navigation, media-off <link>…);
        // ERR_FAILED and the rest stay — CORS-blocked fonts land there.
        if (errorText === 'net::ERR_ABORTED') return
        if (isMainDocument(request)) return
        failures.push({ type: request.resourceType(), url: request.url(), status: null, errorText })
      } catch { /* never break the shot */ }
    })
    // goto errors are swallowed so we still capture whatever painted — but the
    // response is kept so the caller can diagnose HTTP errors (mission CD).
    const resp = await page.goto(target, { waitUntil: 'networkidle0', timeout: 30000 }).catch(() => null)
    try { await page.evaluate(() => document.fonts && document.fonts.ready) } catch {}
    await new Promise((r) => setTimeout(r, 600)) // settle fonts / late paints
    // DOM ground-truth probe (mission CK) — runs EVEN when goto timed out
    // (resp === null): the capture still happens, so its health must still be
    // judged. A probe failure yields null → health 'unknown', never a crash.
    let probe = null
    try { probe = await page.evaluate(domProbe) } catch { /* probe = null */ }
    const finalUrl = page.url()
    const buf = await page.screenshot({ type: 'png', fullPage: true })
    return { buf, finalUrl, status: resp ? resp.status() : null, failures, probe, pageErrors }
  } finally {
    await page.close()
  }
}

/* ── main ─────────────────────────────────────────────────────────────────────── */
async function main() {
  const chrome = findChrome()
  if (!chrome) { console.error('No installed Chrome/Edge found. Set CHROME_BIN=/path/to/chrome.'); process.exit(2) }
  console.log(`· chrome : ${chrome}`)
  console.log(`· base   : ${BASE}`)

  // Login FIRST — fail fast with a clear message before launching the browser.
  console.log(`· login  : ${EMAIL} …`)
  const sessionCookie = await login()
  console.log(`· session: got ${sessionCookie.name} (len ${sessionCookie.value.length})`)

  const { screens } = await import(pathToFileURL(path.join(__dirname, 'operator-qa.config.mjs')).href)
  if (!screens.length) { console.error('No screens to shoot (all dynamic ones skipped?). Set QA_RESTAURANT_ID / QA_BRAND_ID.'); process.exit(1) }

  const browser = await puppeteer.launch({
    executablePath: chrome, headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars', '--force-device-scale-factor=1'],
  })

  const grand = []
  // One console warning per DIAGNOSIS KIND (not per screen — an unauthenticated
  // run would otherwise warn 30+ times); every case still records its verdict
  // in resume.json.
  const warnedKinds = new Set()
  try {
    for (const screen of screens) {
      const viewports = screen.viewports ?? [{ name: 'desktop', w: 1440, h: 1024 }]
      const refPath = screen.ref ? path.join(ROOT, screen.ref) : null
      const refExists = refPath && fs.existsSync(refPath)
      const refUrl = refExists ? pathToFileURL(refPath).href : null
      const cases = []

      for (const vp of viewports) {
        const dir = path.join(OUT_ROOT, screen.name, vp.name)
        fs.mkdirSync(dir, { recursive: true })

        // App shot (authenticated).
        const { buf: appBuf, finalUrl, status, failures, probe, pageErrors } =
          await shoot(browser, BASE + screen.url, vp, sessionCookie)
        fs.writeFileSync(path.join(dir, 'app.png'), appBuf)

        // Guard (mission CD): classify the navigation outcome — unauthenticated /
        // role-mismatch / app-error / ok — instead of the previous inverted check.
        // A true LOGIN failure is diagnosed earlier by login(), which throws.
        const verdict = diagnoseShot({ requestedUrl: BASE + screen.url, finalUrl, status })
        if (verdict.kind !== 'ok' && !warnedKinds.has(verdict.kind)) {
          console.warn(`⚠ ${screen.name} [${verdict.kind}]: ${verdict.message}`)
          warnedKinds.add(verdict.kind)
        }

        // Guard (mission CK): classify the RENDER health of the capture — a doc
        // 200 whose CSS/fonts were refused (the /fr/orders 738x844 case) is a
        // valid navigation but an INVALID capture for visual comparison.
        const appHealth = classifyRenderHealth({
          pageOrigin: new URL(BASE).origin, failures, probe, navSettled: status !== null,
        })
        // The auth verdict is the primary fact — the render warning is printed
        // only when navigation was clean, and once per health kind (a 429 storm
        // must not print 35 identical lines). Every case still records its
        // health in resume.json.
        if (verdict.kind === 'ok' && appHealth.message && !warnedKinds.has(`render-${appHealth.health}`)) {
          console.warn(`⚠ ${screen.name} [render-${appHealth.health}]: ${appHealth.message}`)
          warnedKinds.add(`render-${appHealth.health}`)
        }

        const rec = {
          screen: screen.name, viewport: vp.name, hasRef: !!refExists, diffPercent: null,
          finalUrl, httpStatus: status, authDiagnosis: verdict.kind,
          renderHealth: appHealth.health, pageErrors, skipReason: null,
        }
        if (appHealth.errors.length) rec.renderErrors = appHealth.errors.slice(0, 20)
        if (refUrl) {
          // Ref shot (no cookie needed for a local file). Same health guard: the
          // committed CD mocks hot-link Google Fonts — a ref rendered in fallback
          // glyphs is as non-comparable as an unstyled app page.
          const refShot = await shoot(browser, refUrl, vp, null)
          fs.writeFileSync(path.join(dir, 'ref.png'), refShot.buf)
          const refHealth = classifyRenderHealth({
            pageOrigin: null, failures: refShot.failures, probe: refShot.probe,
            navSettled: refShot.status !== null,
          })
          rec.refRenderHealth = refHealth.health
          rec.refPageErrors = refShot.pageErrors
          if (refHealth.errors.length) rec.refRenderErrors = refHealth.errors.slice(0, 20)

          // The pixel diff is a VERDICT — it exists only when the document was
          // accepted AND both captures actually rendered. Otherwise app.png/
          // ref.png stay on disk for diagnosis, diffPercent stays null and
          // skipReason says why. (Ref invalid ⇒ diff annulled too — flagged to
          // the founder as an open decision; flip: compute d and keep pct.)
          if (verdict.kind !== 'ok') rec.skipReason = `auth-${verdict.kind}`
          else if (appHealth.health === 'invalid') rec.skipReason = 'render-invalid'
          else if (appHealth.health === 'unknown') rec.skipReason = 'render-unknown'
          else if (refHealth.health === 'invalid') rec.skipReason = 'ref-render-invalid'
          else if (refHealth.health === 'unknown') rec.skipReason = 'ref-render-unknown'

          if (!rec.skipReason) {
            const d = diffPng(appBuf, refShot.buf)
            fs.writeFileSync(path.join(dir, 'diff.png'), d.diffBuf)
            rec.diffPercent = d.pct
            rec.appSize = d.appSize; rec.refSize = d.refSize; rec.compared = d.compared
          } else {
            // A skipped case must not leave a STALE diff.png from a previous
            // run sitting next to fresh app/ref captures (adversarial review).
            try { fs.rmSync(path.join(dir, 'diff.png'), { force: true }) } catch {}
          }
        }
        rec.dir = path.relative(ROOT, dir).replace(/\\/g, '/')
        cases.push(rec); grand.push(rec)
        const degraded = rec.renderHealth === 'degraded' || rec.refRenderHealth === 'degraded'
        console.log(`  ${screen.name} · ${vp.name}${
          !refExists ? ' (capture-only)'
          : rec.skipReason ? ` → diff SKIPPED (${rec.skipReason})`
          : ` → diff ${rec.diffPercent}%${degraded ? ' ⚠ DEGRADED (not a normal verdict)' : ''}`}`)
      }

      const resume = { screen: screen.name, url: screen.url, ref: screen.ref || null, generatedBy: 'operator-visual-qa.mjs', cases }
      fs.writeFileSync(path.join(OUT_ROOT, screen.name, 'resume.json'), JSON.stringify(resume, null, 2))
    }
  } finally {
    await browser.close()
  }

  // Top-level resume + table.
  fs.mkdirSync(OUT_ROOT, { recursive: true })
  fs.writeFileSync(path.join(OUT_ROOT, 'resume.json'), JSON.stringify({ base: BASE, generatedBy: 'operator-visual-qa.mjs', cases: grand }, null, 2))
  console.log(`\n✓ done — artifacts under design-qa/operator/ (app.png · ref.png · diff.png · resume.json)`)
  console.table(grand.map((g) => ({
    screen: g.screen, viewport: g.viewport, hasRef: g.hasRef,
    // A diffPercent is only shown when it IS a verdict; degraded is impossible
    // to miss; skipped rows say why instead of a number.
    'diff%': g.diffPercent === null
      ? (g.skipReason ?? (g.hasRef ? '—' : ''))
      : (g.renderHealth === 'degraded' || g.refRenderHealth === 'degraded'
        ? `${g.diffPercent} ⚠ degraded` : g.diffPercent),
    render: g.renderHealth, ref: g.refRenderHealth ?? '', pageErr: g.pageErrors,
  })))
}

main().catch((e) => { console.error('operator-visual-qa failed:', e?.message || e); process.exit(1) })
