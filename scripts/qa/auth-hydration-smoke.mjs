#!/usr/bin/env node
/**
 * scripts/qa/auth-hydration-smoke.mjs — P0 AUTH HYDRATION regression (2026-09-06)
 *
 * Proves, in a REAL headless Chrome with a fresh profile (no cookies, logged out),
 * that the authentication surfaces actually hydrate and become interactive:
 *
 *   /fr/auth/magic  (business / partner passwordless login, also reached from
 *                    business.grubano.com and /fr/business/auth)
 *   /fr/eat/auth    (consumer login / register)
 *
 * For every base URL given on the command line, at a desktop and a mobile viewport:
 *   - the page answers 200 and every /_next/static asset it loads answers < 400;
 *   - no `pageerror` (uncaught exception) and no React/Next hydration error in the console;
 *   - the Suspense skeleton (`[aria-hidden] .animate-pulse`) is GONE;
 *   - an email field and a submit control are VISIBLE and ENABLED;
 *   - typing into the email field is reflected (controlled React input ⇒ hydrated);
 *   - on /fr/auth/magic the partner sign-up link stays visible.
 * Nothing is submitted: no request reaches the magic-link API, no email is sent.
 *
 * Usage:
 *   node scripts/qa/auth-hydration-smoke.mjs https://app.grubano.com https://business.grubano.com
 *   CHROME_BIN=/path/to/chrome node scripts/qa/auth-hydration-smoke.mjs http://localhost:3000
 * Exit 0 = every check PASS · exit 1 = at least one FAIL · exit 2 = no Chrome / bad args.
 * A JSON report is printed last (one line per check) for the ops record.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const bases = process.argv.slice(2).map((b) => b.replace(/\/+$/, ''))
if (bases.length === 0) { console.error('usage: node scripts/qa/auth-hydration-smoke.mjs <baseUrl> [...]'); process.exit(2) }

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

const PAGES = [
  { path: '/fr/auth/magic', name: 'business-magic-auth', signup: 'a[href*="/business/start"]' },
  { path: '/fr/eat/auth',   name: 'consumer-auth',       signup: null },
]
const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 820 },
  { name: 'mobile',  width: 390,  height: 844, isMobile: true, hasTouch: true },
]
const EMAIL = 'input[type="email"]'
const SUBMIT = 'button[type="submit"]'
const SKELETON = '[aria-hidden="true"] .animate-pulse'
const HYDRATION_RE = /hydrat|Minified React error #(418|419|420|421|422|423|424|425)|Text content does not match|did not match/i

async function visibleEnabled(page, selector) {
  return page.evaluate((sel) => {
    const els = Array.from(document.querySelectorAll(sel))
    const vis = els.filter((el) => {
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'
    })
    return { total: els.length, visible: vis.length, enabled: vis.filter((el) => !el.disabled).length }
  }, selector)
}

async function runCheck(browser, base, pg, vp) {
  const context = await browser.createBrowserContext()
  const page = await context.newPage()
  await page.setViewport({ width: vp.width, height: vp.height, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch })
  const pageErrors = []
  const consoleErrors = []
  const badAssets = []
  page.on('pageerror', (e) => pageErrors.push(String(e && e.message || e)))
  page.on('console', (m) => { if (m.type() === 'error' || HYDRATION_RE.test(m.text())) consoleErrors.push(m.text()) })
  const throttled = []
  page.on('response', (r) => {
    const u = r.url()
    if (u.includes('/_next/') && r.status() >= 400) badAssets.push(`${r.status()} ${u}`)
    // Attribution of 429s (hosting WAF vs app): keep the response headers + a body snippet.
    if (r.status() === 429 && throttled.length < 2) {
      const h = r.headers()
      r.text().then((body) => throttled.push({ url: u, server: h['server'], retryAfter: h['retry-after'], contentType: h['content-type'], body: String(body).replace(/\s+/g, ' ').slice(0, 300) })).catch(() => throttled.push({ url: u, server: h['server'] }))
    }
  })
  page.on('requestfailed', (r) => { const u = r.url(); if (u.includes('/_next/')) badAssets.push(`FAILED ${u} ${r.failure()?.errorText || ''}`) })

  const url = base + pg.path
  const result = { base, page: pg.name, url, viewport: vp.name, status: null, pass: false, reasons: [] }
  try {
    const res = await page.goto(url, { waitUntil: 'networkidle0', timeout: 60_000 })
    result.status = res ? res.status() : null
    if (result.status !== 200) result.reasons.push(`HTTP ${result.status}`)

    // Wait for the controls (hydration completes asynchronously after load).
    let email = { visible: 0, enabled: 0 }
    let submit = { visible: 0, enabled: 0 }
    let skeleton = 1
    const deadline = Date.now() + 20_000
    while (Date.now() < deadline) {
      email = await visibleEnabled(page, EMAIL)
      submit = await visibleEnabled(page, SUBMIT)
      skeleton = await page.evaluate((sel) => document.querySelectorAll(sel).length, SKELETON)
      if (email.visible > 0 && submit.visible > 0 && skeleton === 0) break
      await new Promise((r) => setTimeout(r, 500))
    }
    if (skeleton > 0) result.reasons.push(`permanent skeleton (${skeleton} placeholder(s) still rendered)`)
    if (email.visible === 0) result.reasons.push('email field not visible')
    else if (email.enabled === 0) result.reasons.push('email field disabled')
    if (submit.visible === 0) result.reasons.push('submit control not visible')

    // Controlled-input proof: a React-managed <input> only reflects typing once hydrated.
    if (email.visible > 0) {
      const handle = (await page.$$(EMAIL)).length ? await page.evaluateHandle((sel) => {
        return Array.from(document.querySelectorAll(sel)).find((el) => el.getBoundingClientRect().width > 0)
      }, EMAIL) : null
      const el = handle && handle.asElement()
      if (el) {
        await el.click({ clickCount: 3 })
        await el.type('qa-hydration@example.invalid', { delay: 5 })
        const value = await page.evaluate((e) => e.value, el)
        if (value !== 'qa-hydration@example.invalid') result.reasons.push(`typing not reflected (value="${value}")`)
      }
    }
    if (pg.signup) {
      const signup = await visibleEnabled(page, pg.signup)
      if (signup.visible === 0) result.reasons.push('partner sign-up link not visible')
    }
    if (pageErrors.length) result.reasons.push(`pageerror: ${pageErrors.slice(0, 3).join(' | ')}`)
    const hyd = consoleErrors.filter((t) => HYDRATION_RE.test(t))
    if (hyd.length) result.reasons.push(`hydration error: ${hyd.slice(0, 2).join(' | ')}`)
    if (badAssets.length) result.reasons.push(`asset failures: ${badAssets.slice(0, 5).join(' | ')}`)
    result.consoleErrors = consoleErrors.slice(0, 5)
    if (throttled.length) result.throttled = throttled
    // Hosting WAF (o2switch "Tiger Protect") answers 429 to automated-browser bursts on some
    // domains (measured 2026-09-06 on business.grubano.com). That is a TRANSPORT verdict, not
    // a hydration verdict: label it so a WAF block is never misread as a broken auth page.
    const waf = throttled.some((t) => /tiger-protect|Security_Rule/i.test(t.body || '')) || (result.status === 429)
    if (waf) {
      result.throttledByHost = true
      result.reasons = [`HOST WAF 429 (o2switch Tiger Protect) — hydration NOT MEASURABLE in this run; re-run later or verify in an interactive browser`]
    }
  } catch (e) {
    result.reasons.push(`exception: ${String(e && e.message || e)}`)
  } finally {
    await context.close().catch(() => {})
  }
  result.pass = result.reasons.length === 0
  return result
}

const chrome = findChrome()
if (!chrome) { console.error('No installed Chrome/Edge found. Set CHROME_BIN=/path/to/chrome.'); process.exit(2) }
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'grubano-auth-smoke-'))
const browser = await puppeteer.launch({
  executablePath: chrome, headless: true, userDataDir: profile,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars', '--force-device-scale-factor=1'],
})
const results = []
try {
  for (const base of bases) for (const pg of PAGES) for (const vp of VIEWPORTS) {
    // Human pacing between page loads: the shared host throttles automated bursts (429 on
    // HTML/CSS), which would mask the hydration verdict with a transport artefact.
    if (results.length) await new Promise((r) => setTimeout(r, 2500))
    const r = await runCheck(browser, base, pg, vp)
    results.push(r)
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.url}  [${vp.name}]  HTTP ${r.status}${r.pass ? '' : '  → ' + r.reasons.join('; ')}`)
  }
} finally {
  await browser.close().catch(() => {})
  try { fs.rmSync(profile, { recursive: true, force: true }) } catch {}
}
const failed = results.filter((r) => !r.pass).length
console.log(JSON.stringify({ measuredAt: new Date().toISOString(), chrome: path.basename(chrome), checks: results.length, failed, results }))
process.exit(failed ? 1 : 0)
