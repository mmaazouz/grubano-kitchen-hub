// E1-A packaging — derives E1-A-MANIFEST / E1-A-COPY / E1-A-CURRENT-VISUALS / E1-A-DATA-CONTRACTS
// subsets from the core pack for the 3 representative emails, then assembles the portable bundle
// folder (the zip is produced by the caller). Run from the repo root:
//   node EMAIL-FACTUAL-PACK/tools/build-e1a.mjs
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const PACK   = 'EMAIL-FACTUAL-PACK'
const OUT    = join(PACK, 'E1-A')
const BUNDLE = join(OUT, 'CLAUDE-DESIGN-E1-A-BUNDLE')
mkdirSync(OUT, { recursive: true })
rmSync(BUNDLE, { recursive: true, force: true })
mkdirSync(join(BUNDLE, 'current-renders', 'png'), { recursive: true })

const IDS     = ['AUTH_MAGIC_LINK', 'CONSUMER_ORDER_READY', 'PARTNER_NEW_ORDER']
const RENDERS = ['AUTH_MAGIC_LINK', 'CONSUMER_ORDER_READY_PICKUP', 'PARTNER_NEW_ORDER']

const manifest = readFileSync(join(PACK, 'EMAIL-MANIFEST.md'), 'utf8')
const copy     = readFileSync(join(PACK, 'EMAIL-COPY-VERBATIM.md'), 'utf8')
const visuals  = readFileSync(join(PACK, 'EMAIL-CURRENT-VISUALS.md'), 'utf8')
const rows = manifest.split('\n').filter((l) => l.startsWith('| '))
const headerFor = (row) => {
  const idx = manifest.indexOf(row)
  const before = manifest.slice(0, idx).split('\n').reverse()
  return [before.find((l) => l.startsWith('| EMAIL ID')), before.find((l) => /^\|---/.test(l))]
}
const copySections = Object.fromEntries([...copy.matchAll(/\n### ([A-Za-z0-9_]+)\n([\s\S]*?)(?=\n### |\n## |$)/g)].map((m) => [m[1], m[2]]))
const visualRows = Object.fromEntries(visuals.split('\n').filter((l) => /^\| [A-Z]/.test(l)).map((l) => [l.split('|')[1].trim(), l]))

// ── E1-A-MANIFEST ─────────────────────────────────────────────────────────────
let md = '# E1-A-MANIFEST — the 3 representative emails (rows extracted verbatim from the core manifest, post-P0 fixes 2026-09-05)\n\n> Status A = live + reachable in the closed beta. Every fact is file:line-anchored in the core pack.\n'
let last = ''
for (const id of IDS) {
  const row = rows.find((l) => l.split('|')[1].trim() === id)
  const [h, s] = headerFor(row)
  if (h !== last) { md += `\n${h}\n${s}\n`; last = h }
  md += row + '\n'
}
md += [
  '',
  '## Fact classification (2026-09-06) — CURRENT · DORMANT · OUT_OF_BETA · PRE-FIX / HISTORICAL',
  '- **CONSUMER_ORDER_READY** (CURRENT = pickup state only): « votre commande … est prête — vous pouvez venir la récupérer ». The delivery state is DORMANT / OUT_OF_BETA (delivery is not sold in the closed beta). A pickup order can no longer receive any « en route » email.',
  '- **PARTNER_NEW_ORDER** (CURRENT): reachable **server-side — no browser tab needs to stay open**; the checkout poll is only a fast path. Mode label = « Click & collect » in the beta. Cancelled/expired paid orders never receive it. Any "depends on the browser poll" wording is PRE-FIX / HISTORICAL.',
  '- **AUTH_MAGIC_LINK** (CURRENT): link valid 15 min, single use. The optional 6-digit-code state is DORMANT (feature switch off); its current copy says « 15 minutes » while the code is valid 10 — design the code state with the correct value.',
  '',
].join('\n')
writeFileSync(join(OUT, 'E1-A-MANIFEST.md'), md)

// ── E1-A-COPY ────────────────────────────────────────────────────────────────
let c = '# E1-A-COPY — current copy verbatim for the 3 representative emails (fixtures: Léa Martin / Gnocchi Bar / GR-ABC123)\n\n> Do not rewrite here. Designed copy goes in the E1-A deliverables (formal French). Both magic-link states (with / without code) exist in the core pack; the primary state is below.\n'
for (const r of RENDERS) c += `\n### ${r}\n${copySections[r]}\n`
writeFileSync(join(OUT, 'E1-A-COPY.md'), c)

// ── E1-A-CURRENT-VISUALS ────────────────────────────────────────────────────
let v = '# E1-A-CURRENT-VISUALS — fossils of the 3 representative emails\n\n> Raw fragment `current-renders/<ID>.html` (exact HTML handed to Nodemailer), `<ID>.json` (from/to/subject/flags), `<ID>.txt` (plain-text part — magic link only). Screenshots `current-renders/png/<ID>@600.png` and `@390.png`, white ground, 16 px padding. Zero images in every template (images-off = N/A today).\n\n| ID | Subject | To (fixture) | text part | 600 px | 390 px |\n|---|---|---|---|---|---|\n'
for (const r of RENDERS) v += visualRows[r] + '\n'
v += [
  '',
  '## Shared observations (current state to move away from)',
  '- Fragment only (no `<html>`, no `lang`, no preheader, no `<title>`), 480 px column, `Inter,Arial` requested but never embedded, legacy `#F97316` orange heading / `#1a1a2e` text, styled `<a>` button (no VML), one footer sentence, no logo, no support block.',
  '- Contrast: footer grey `#9ca3af` 12 px ≈ 2.9:1 (fails AA); orange `#F97316` heading on white ≈ 2.8:1 and white-on-orange button ≈ 2.8:1 (fail AA).',
  '- Status conveyed by heading text + « ✓ » + colour only.',
  '',
].join('\n')
writeFileSync(join(OUT, 'E1-A-CURRENT-VISUALS.md'), v)

// ── E1-A-DATA-CONTRACTS (scoped) ─────────────────────────────────────────────
writeFileSync(join(OUT, 'E1-A-DATA-CONTRACTS.md'), [
  '# E1-A-DATA-CONTRACTS — fields available to the 3 representative emails',
  '',
  'Formats: order reference `GR-XXXXXX` (display ref, 6 chars, not unique); money cents → `fr-FR` « 12,50 € »; base URL = deployment `NEXTAUTH_URL` (staging `https://app.grubano.com`); restaurant name = `Restaurant.name`.',
  '',
  '| Email | Required (passed today) | Optional / conditional | Nullable → fallback | Available but NOT passed (needs plumbing) |',
  '|---|---|---|---|---|',
  '| AUTH_MAGIC_LINK | `to`, `link` (absolute, allow-listed host, `/{locale}/eat/magic?token=` or `/auth/magic`) | `name` (empty → « Bonjour, »), `code` (6 digits, only when `AUTH_EMAIL_OTP_ENABLED`) | — | recipient locale (body FR only), device/IP (not tracked) |',
  '| CONSUMER_ORDER_READY (pickup) | `orderId`, `to`, `customerName` (route passes name ?? email), `restaurantName`, `orderRef`, `status:\'ready\'`, `fulfillmentType` | delivery state = OUT-OF-BETA dormant (`DELIVERY_FULFILLMENT_ENABLED`) | restaurant → « votre restaurant » | items, total (status emails are status-only by design), **restaurant address / opening hours / phone** (`Restaurant.*` — the natural pickup information), pickup pass link (`/eat/order/[id]/pickup` exists), `Order.createdAt` |',
  '| PARTNER_NEW_ORDER | `orderId`, `to` (`restaurant.operator.email`), `restaurantName`, `orderRef`, `fulfillmentType` (→ « Click & collect »), `items[{name, qty}]`, `totalCents` (server `order.total`) | — | `items` may be `[]` | consumer name (privacy: not passed), payment method (card only in beta), `Order.createdAt`, dashboard deep link (path `/orders` known, not passed), item options/notes |',
  '',
  'Idempotency: magic link none (legitimate repeats); READY = `order_ready` / `order:<id>` (one per order); NEW_ORDER = `resto_order_received` / `order:<id>` (one per order; now guaranteed server-side).',
  '',
  'Conditional states to design: empty name · empty items · long restaurant / item names · code present/absent (auth) · RTL readiness (future ×5) · dark mode · images-off · plain text.',
  '',
].join('\n'))

// ── BUNDLE ───────────────────────────────────────────────────────────────────
const files = ['CLAUDE-DESIGN-E1-A-START.md', 'E1-A-MANIFEST.md', 'E1-A-COPY.md', 'E1-A-DATA-CONTRACTS.md', 'E1-A-CURRENT-VISUALS.md', 'E1-A-DESIGN-BRIEF.md']
for (const f of files) {
  if (!existsSync(join(OUT, f))) { console.error('MISSING authored file:', f); process.exitCode = 1; continue }
  copyFileSync(join(OUT, f), join(BUNDLE, f))
}
copyFileSync(join(PACK, 'EMAIL-DESIGN-SYSTEM-FACTS.md'), join(BUNDLE, 'EMAIL-DESIGN-SYSTEM-FACTS.md'))
for (const r of RENDERS) {
  for (const ext of ['html', 'json', 'txt']) {
    const p = join(PACK, 'current-renders', `${r}.${ext}`)
    if (existsSync(p)) copyFileSync(p, join(BUNDLE, 'current-renders', `${r}.${ext}`))
  }
  for (const w of [600, 390]) copyFileSync(join(PACK, 'current-renders', 'png', `${r}@${w}.png`), join(BUNDLE, 'current-renders', 'png', `${r}@${w}.png`))
}
const list = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? list(join(d, e.name)) : [join(d, e.name)]))
const all = list(BUNDLE)
console.log(`bundle files: ${all.length}`)
for (const f of all) console.log('  ' + f.slice(BUNDLE.length + 1).replace(/\\/g, '/'))
