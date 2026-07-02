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
 * plus a resume.json + a console.table of {screen, hasRef, diff%}.
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
    // goto errors are swallowed so we still capture whatever painted.
    await page.goto(target, { waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {})
    try { await page.evaluate(() => document.fonts && document.fonts.ready) } catch {}
    await new Promise((r) => setTimeout(r, 600)) // settle fonts / late paints
    const finalUrl = page.url()
    const buf = await page.screenshot({ type: 'png', fullPage: true })
    return { buf, finalUrl }
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
  let roleWarned = false
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
        const { buf: appBuf, finalUrl } = await shoot(browser, BASE + screen.url, vp, sessionCookie)
        fs.writeFileSync(path.join(dir, 'app.png'), appBuf)

        // Guard: a session that still bounces to /eat/auth ⇒ the account lacks the operator role.
        if (!roleWarned && /\/eat\/auth/.test(finalUrl)) {
          console.warn(
            `⚠ ${screen.name}: navigated to ${finalUrl} — the session is valid but the account may ` +
            `lack the operator role (expected role 'restaurant'/'admin'). Re-seed with role 'restaurant'.`,
          )
          roleWarned = true
        }

        const rec = { screen: screen.name, viewport: vp.name, hasRef: !!refExists, diffPercent: null, finalUrl }
        if (refUrl) {
          // Ref shot (no cookie needed for a local file).
          const { buf: refBuf } = await shoot(browser, refUrl, vp, null)
          fs.writeFileSync(path.join(dir, 'ref.png'), refBuf)
          const d = diffPng(appBuf, refBuf)
          fs.writeFileSync(path.join(dir, 'diff.png'), d.diffBuf)
          rec.diffPercent = d.pct
          rec.appSize = d.appSize; rec.refSize = d.refSize; rec.compared = d.compared
        }
        rec.dir = path.relative(ROOT, dir).replace(/\\/g, '/')
        cases.push(rec); grand.push(rec)
        console.log(`  ${screen.name} · ${vp.name}${refExists ? ` → diff ${rec.diffPercent}%` : ' (capture-only)'}`)
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
  console.table(grand.map((g) => ({ screen: g.screen, viewport: g.viewport, hasRef: g.hasRef, 'diff%': g.diffPercent })))
}

main().catch((e) => { console.error('operator-visual-qa failed:', e?.message || e); process.exit(1) })
