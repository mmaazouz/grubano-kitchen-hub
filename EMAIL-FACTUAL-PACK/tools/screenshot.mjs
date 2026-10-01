// EMAIL FACTUAL PACK — screenshot every current-render at 600 px (desktop) and 390 px
// (mobile) with headless Edge/Chrome. READ-ONLY; no network; no external assets exist in
// any template (verified: zero <img>). Run from the repo root:
//   node EMAIL-FACTUAL-PACK/tools/screenshot.mjs
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

const DIR  = resolve('EMAIL-FACTUAL-PACK/current-renders')
const WRAP = join(DIR, '_wrapped'); mkdirSync(WRAP, { recursive: true })
const PNG  = join(DIR, 'png');      mkdirSync(PNG,  { recursive: true })
const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
]
const browser = BROWSERS.find((p) => existsSync(p))
if (!browser) { console.error('no headless browser found'); process.exit(1) }

const files = readdirSync(DIR).filter((f) => f.endsWith('.html'))
const WIDTHS = [600, 390]
let n = 0
for (const f of files) {
  const id = f.replace(/\.html$/, '')
  const body = readFileSync(join(DIR, f), 'utf8')
  // Minimal client-like wrapper: white ground, no reset, fragment rendered as-is.
  const doc = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head><body style="margin:0;padding:16px;background:#ffffff">${body}</body></html>`
  const wrapped = join(WRAP, f)
  writeFileSync(wrapped, doc)
  for (const w of WIDTHS) {
    const out = join(PNG, `${id}@${w}.png`)
    // fresh profile per shot: a SHARED profile makes Edge/Chrome hand off to a running
    // instance and exit 0 WITHOUT writing the screenshot (observed: 14/120 written).
    const profile = join(tmpdir(), `gb-shot-${process.pid}-${n}`)
    try {
      execFileSync(browser, [
        '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
        `--window-size=${w},1400`, `--screenshot=${out}`, `--user-data-dir=${profile}`,
        'file:///' + wrapped.replace(/\\/g, '/'),
      ], { stdio: 'ignore', timeout: 60000 })
      if (!existsSync(out)) throw new Error('no file written')
      n++
    } catch (e) {
      console.error('screenshot failed', id, w, e?.message)
    } finally { try { rmSync(profile, { recursive: true, force: true }) } catch {} }
  }
}
console.log(`done: ${n} screenshots for ${files.length} renders → ${PNG}`)
