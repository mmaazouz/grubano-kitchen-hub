#!/usr/bin/env node
/**
 * design-qa.mjs — Grubano visual QA diff robot.
 *
 * For each configured screen it produces, AUTOMATICALLY and per viewport/state:
 *   • app.png   — screenshot of the REAL local page (Next dev/prod server)
 *   • ref.png   — screenshot of the CD reference mock (a local HTML file, file://)
 *   • diff.png  — pixel-diff highlight (pixelmatch)
 *   • resume.json — % of differing pixels per case
 * It uses an ALREADY-INSTALLED Chrome (no browser download — the network blocks that)
 * driven by puppeteer-core, plus pixelmatch + pngjs for the diff.
 *
 * TOOLING ONLY — never imports or touches app code, routes, money or auth.
 *
 * Usage:
 *   node scripts/design-qa.mjs                 # all screens in the config
 *   node scripts/design-qa.mjs eat-auth        # one screen
 *   BASE_URL=http://localhost:3000 node scripts/design-qa.mjs
 *   CHROME_BIN="C:/path/to/chrome.exe" node scripts/design-qa.mjs
 */
import puppeteer from 'puppeteer-core'
import pixelmatch from 'pixelmatch'
import { PNG } from 'pngjs'
import fs from 'node:fs'
import path from 'node:path'
import http from 'node:http'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const OUT_ROOT = path.join(ROOT, 'design-qa')
const BASE_URL = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '')

/* ── locate an installed Chrome/Edge (no download) ──────────────────────────── */
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

/* ── make sure a Next server answers at BASE_URL (reuse one, else spawn) ─────── */
function ping(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode > 0) })
    req.on('error', () => resolve(false))
    req.setTimeout(2500, () => { req.destroy(); resolve(false) })
  })
}
async function ensureServer() {
  if (await ping(BASE_URL)) return { kill: null, started: false }
  const port = Number(new URL(BASE_URL).port || 3000)
  console.log(`· no server at ${BASE_URL} — starting "next start -p ${port}" (needs a prior build)…`)
  const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['next', 'start', '-p', String(port)],
    { cwd: ROOT, stdio: 'ignore', shell: process.platform === 'win32' })
  for (let i = 0; i < 40; i++) { await new Promise((r) => setTimeout(r, 1000)); if (await ping(BASE_URL)) {
    console.log('· server ready'); return { kill: () => { try { child.kill() } catch {} }, started: true } } }
  try { child.kill() } catch {}
  throw new Error(`Next server never came up at ${BASE_URL}. Run "npm run build" first, or start it yourself.`)
}

/* ── screenshot helpers ─────────────────────────────────────────────────────── */
async function shoot(browser, target, vp, opts = {}) {
  const page = await browser.newPage()
  try {
    await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 1 })
    if (opts.before) await page.evaluateOnNewDocument(opts.before) // seed sessionStorage / stub fetch before load
    // a state that keeps a request pending on purpose (e.g. a hung verify spinner) never reaches
    // networkidle — `waitUntil` can opt down to domcontentloaded, and goto errors are swallowed so
    // we still screenshot what is on screen.
    await page.goto(target, { waitUntil: opts.waitUntil || 'networkidle0', timeout: 30000 }).catch(() => {})
    if (opts.theme) await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), opts.theme)
    if (opts.rootClass) await page.evaluate((c) => { const el = document.querySelector('main,.auth,#root,body>div'); if (el) el.classList.add(c) }, opts.rootClass)
    if (opts.action) await page.evaluate(opts.action) // a string body run in page context
    try { await page.evaluate(() => document.fonts && document.fonts.ready) } catch {}
    await new Promise((r) => setTimeout(r, opts.settle ?? 450)) // let fonts paint / animations settle
    return await page.screenshot({ type: 'png' }) // viewport-clip (deterministic same-size)
  } finally { await page.close() }
}

function diffPng(appBuf, refBuf) {
  const a = PNG.sync.read(appBuf), b = PNG.sync.read(refBuf)
  const w = Math.min(a.width, b.width), h = Math.min(a.height, b.height)
  const crop = (src) => { if (src.width === w && src.height === h) return src
    const d = new PNG({ width: w, height: h }); PNG.bitblt(src, d, 0, 0, w, h, 0, 0); return d }
  const ca = crop(a), cb = crop(b), out = new PNG({ width: w, height: h })
  const nDiff = pixelmatch(ca.data, cb.data, out.data, w, h, { threshold: 0.1 })
  return { diffBuf: PNG.sync.write(out), pct: +((100 * nDiff) / (w * h)).toFixed(2),
    appSize: `${a.width}x${a.height}`, refSize: `${b.width}x${b.height}`, compared: `${w}x${h}` }
}

/* ── main ───────────────────────────────────────────────────────────────────── */
async function main() {
  const only = process.argv[2]
  const { screens } = await import(pathToFileURL(path.join(__dirname, 'design-qa.config.mjs')).href)
  const list = only ? screens.filter((s) => s.name === only) : screens
  if (!list.length) { console.error(`No screen "${only}" in design-qa.config.mjs. Known: ${screens.map((s) => s.name).join(', ')}`); process.exit(1) }

  const chrome = findChrome()
  if (!chrome) { console.error('No installed Chrome/Edge found. Set CHROME_BIN=/path/to/chrome.'); process.exit(2) }
  console.log(`· chrome: ${chrome}`)

  const server = await ensureServer()
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--hide-scrollbars', '--force-device-scale-factor=1'] })

  const grand = []
  try {
    for (const screen of list) {
      const refUrl = pathToFileURL(path.join(ROOT, screen.reference)).href
      const states = screen.states ?? [{ name: 'default' }]
      const viewports = screen.viewports ?? [{ name: 'mobile', w: 390, h: 844 }, { name: 'desktop', w: 1280, h: 820 }]
      const cases = []
      for (const st of states) {
        for (const vp of viewports) {
          const dir = path.join(OUT_ROOT, screen.name, `${st.name}-${vp.name}`)
          fs.mkdirSync(dir, { recursive: true })
          const appUrl = BASE_URL + screen.url + (st.query || '')
          const common = { theme: st.theme, settle: screen.settle }
          const appBuf = await shoot(browser, appUrl, vp, { ...common, action: st.action, before: st.before, waitUntil: st.waitUntil })
          const refBuf = await shoot(browser, refUrl, vp, { ...common, rootClass: st.refClass, action: st.refAction })
          fs.writeFileSync(path.join(dir, 'app.png'), appBuf)
          fs.writeFileSync(path.join(dir, 'ref.png'), refBuf)
          const d = diffPng(appBuf, refBuf)
          fs.writeFileSync(path.join(dir, 'diff.png'), d.diffBuf)
          const rec = { state: st.name, viewport: vp.name, theme: st.theme || 'default', diffPercent: d.pct,
            appSize: d.appSize, refSize: d.refSize, compared: d.compared, dir: path.relative(ROOT, dir).replace(/\\/g, '/') }
          cases.push(rec); grand.push({ screen: screen.name, ...rec })
          console.log(`  ${screen.name} · ${st.name} · ${vp.name}${st.theme ? ' · ' + st.theme : ''} → diff ${d.pct}% (${d.compared})`)
        }
      }
      const resume = { screen: screen.name, url: screen.url, reference: screen.reference, generatedBy: 'design-qa.mjs', cases }
      fs.writeFileSync(path.join(OUT_ROOT, screen.name, 'resume.json'), JSON.stringify(resume, null, 2))
    }
  } finally {
    await browser.close()
    if (server.kill) server.kill()
  }
  console.log(`\n✓ done — artifacts under design-qa/ (app.png · ref.png · diff.png · resume.json)`)
  console.table(grand.map((g) => ({ screen: g.screen, case: `${g.state}/${g.viewport}`, theme: g.theme, 'diff%': g.diffPercent })))
}

main().catch((e) => { console.error('design-qa failed:', e.message); process.exit(1) })
