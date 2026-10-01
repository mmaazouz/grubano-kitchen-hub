// E1-B packaging — derives E1-B-MANIFEST / E1-B-COPY / E1-B-CURRENT-VISUALS / E1-B-DATA-CONTRACTS
// from the core pack for the 10 auth/account emails and assembles the portable bundle folder
// (the zip is produced by the caller). Run from the repo root: node EMAIL-FACTUAL-PACK/tools/build-e1b.mjs
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync, rmSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const PACK   = 'EMAIL-FACTUAL-PACK'
const OUT    = join(PACK, 'E1-B')
const BUNDLE = join(OUT, 'CLAUDE-DESIGN-E1-B-BUNDLE')
mkdirSync(OUT, { recursive: true })
rmSync(BUNDLE, { recursive: true, force: true })
mkdirSync(join(BUNDLE, 'current-renders', 'png'), { recursive: true })
mkdirSync(join(BUNDLE, 'APPROVED-E1-A-SYSTEM'), { recursive: true })

const IDS = ['AUTH_MAGIC_LINK_WITH_OTP', 'AUTH_PASSWORD_RESET', 'AUTH_PASSWORD_CHANGED', 'CONSUMER_WELCOME', 'AUTH_STEPUP_CODE',
  'ACCOUNT_EMAIL_CHANGE_CODE', 'ACCOUNT_EMAIL_CHANGE_LINK', 'ACCOUNT_EMAIL_CHANGED_ALERT', 'ACCOUNT_EMAIL_CHANGE_CONFIRM', 'ACCOUNT_EMAIL_ALREADY_USED']
const RENDERS = IDS // render ids coincide with email ids for this family

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

// ── E1-B-MANIFEST ─────────────────────────────────────────────────────────────
let md = '# E1-B-MANIFEST — the 10 auth / account emails (rows extracted verbatim from the core manifest)\n\n> Status A = live + reachable in the closed beta · B = real code behind a feature switch that is OFF in the beta (DORMANT — design fully, label DORMANT, never present as live). Every fact is file:line-anchored in the core pack.\n'
let last = ''
for (const id of IDS) {
  const row = rows.find((l) => l.split('|')[1].trim() === id)
  if (!row) { console.error('missing manifest row', id); process.exitCode = 1; continue }
  const [h, s] = headerFor(row)
  if (h !== last) { md += `\n${h}\n${s}\n`; last = h }
  md += row + '\n'
}
md += [
  '',
  '## Fact classification (2026-09-06, POST-HOTFIX) — CURRENT · DORMANT',
  '- CURRENT (A): AUTH_PASSWORD_RESET (password accounts only), AUTH_PASSWORD_CHANGED, CONSUMER_WELCOME.',
  '- DORMANT (B, feature switch OFF in the closed beta): AUTH_MAGIC_LINK_WITH_OTP (code state of the E1-A magic link), AUTH_STEPUP_CODE, ACCOUNT_EMAIL_CHANGE_CODE, ACCOUNT_EMAIL_CHANGE_LINK, ACCOUNT_EMAIL_CHANGED_ALERT, ACCOUNT_EMAIL_CHANGE_CONFIRM, ACCOUNT_EMAIL_ALREADY_USED.',
  '- Validities (measured in code): magic link 15 min (`lib/magic-link.ts`) · 6-digit codes 10 min (`lib/email-otp.ts`) · reset link 1 h · email-change link 15 min · all single use. The live copy derives these from the constants (`lib/auth-email-copy.ts`); the combined link + code e-mail distinguishes 15 (lien) and 10 (code).',
  '- TRUTHFULNESS HOTFIX APPLIED (2026-09-06, live code): formal French in every reachable auth e-mail (magic link, welcome, partner verify) · welcome no longer promises « réserver une table » (sur place OUT) and its CTA follows the deployment base URL · no auth route claims « lien envoyé » when the mail transport is not configured (honest 503) · the changed-email alert (DORMANT) still names no contact channel: the design adds `contact@grubano.com`.',
  '- The renders in `current-renders/` are POST-HOTFIX fossils (regenerated 2026-09-06).',
  '',
].join('\n')
writeFileSync(join(OUT, 'E1-B-MANIFEST.md'), md)

// ── E1-B-COPY ────────────────────────────────────────────────────────────────
let c = '# E1-B-COPY — current copy verbatim for the 10 auth / account emails (fixtures: Léa Martin, lea.martin@example.invalid, code 424242, new address lea.new@example.invalid)\n\n> Do not rewrite here. Designed copy goes in the E1-B deliverables (formal French).\n'
for (const r of RENDERS) c += `\n### ${r}\n${copySections[r] ?? '_(no render)_'}\n`
writeFileSync(join(OUT, 'E1-B-COPY.md'), c)

// ── E1-B-CURRENT-VISUALS ────────────────────────────────────────────────────
let v = '# E1-B-CURRENT-VISUALS — fossils of the 10 auth / account emails\n\n> Raw fragment `current-renders/<ID>.html` (exact HTML handed to the transport), `<ID>.json` (from/to/subject/flags), `<ID>.txt` (plain-text part — only the magic link and the two code emails have one). Screenshots `current-renders/png/<ID>@600.png` and `@390.png`. Zero images in every template (images-off = N/A today). These are fossils, not references — the visual authority is `APPROVED-E1-A-SYSTEM/`.\n\n| ID | Subject | To (fixture) | text part | 600 px | 390 px |\n|---|---|---|---|---|---|\n'
for (const r of RENDERS) v += (visualRows[r] ?? `| ${r} | — | — | — | — | — |`) + '\n'
writeFileSync(join(OUT, 'E1-B-CURRENT-VISUALS.md'), v)

// ── E1-B-DATA-CONTRACTS ──────────────────────────────────────────────────────
writeFileSync(join(OUT, 'E1-B-DATA-CONTRACTS.md'), [
  '# E1-B-DATA-CONTRACTS — fields available to the auth / account emails',
  '',
  'Base URL = deployment origin (staging `https://app.grubano.com`; the welcome CTA follows it since the 2026-09-06 hotfix). No order data in this family. All codes are 6 digits; all links are absolute and single use.',
  '',
  '| Email | Passed today | Conditional / nullable | Available but NOT passed (needs plumbing) |',
  '|---|---|---|---|',
  '| AUTH_MAGIC_LINK_WITH_OTP | `to`, `link`, `code` | `name` (empty → « Bonjour, ») | recipient locale |',
  '| AUTH_PASSWORD_RESET | `to`, `name`, `resetUrl` (absolute; today carries token + email + space in the query) | — | expiry timestamp (1 h constant) |',
  '| AUTH_PASSWORD_CHANGED | `to`, `name` | — | date/time, device, IP (not tracked) |',
  '| CONSUMER_WELCOME | `to`, `name` | — | loyalty balance (0 at signup) |',
  '| AUTH_STEPUP_CODE | `to`, `code`, `purpose` → label (confirmer un retrait / modifier vos informations bancaires / modifier l\'e-mail de votre compte; fallback « confirmer une action sensible ») | — | expiry timestamp (10 min constant) |',
  '| ACCOUNT_EMAIL_CHANGE_CODE | `to` (current address), `code` | — | — |',
  '| ACCOUNT_EMAIL_CHANGE_LINK | `to` (new address), `link` | — | expiry (15 min constant) |',
  '| ACCOUNT_EMAIL_CHANGED_ALERT | `to` (old address), `newEmailMasked` (`l***@e***`) | — | date/time; support address may be hardcoded (`contact@grubano.com` is the product channel) |',
  '| ACCOUNT_EMAIL_CHANGE_CONFIRM | `to` (new address) | — | — |',
  '| ACCOUNT_EMAIL_ALREADY_USED | `to` (existing holder) | — | — |',
  '',
  'Idempotency facts that shape states: codes and links are never de-duplicated (a re-request re-sends); password reset/changed never de-duplicated (legitimate repeats); email-change notices once per change; already-used notice at most once per address ever.',
  '',
  'Conditional states: empty name · code present/absent · masked address · long URL wrapping · RTL readiness · dark mode · images-off · plain text.',
  '',
].join('\n'))

// ── APPROVED-E1-A-SYSTEM — founder-approved outputs, archived in-repo (EMAIL-FACTUAL-PACK/E1-A/APPROVED)
//    since 2026-09-06 with the factual TTL patch (APPROVED/E1-A-FACTUAL-PATCH-2026-09-06.md) ─────────
const APPROVED = join(PACK, 'E1-A', 'APPROVED')
const copyTree = (from, to) => {
  mkdirSync(to, { recursive: true })
  for (const e of readdirSync(from, { withFileTypes: true })) {
    if (e.isDirectory()) copyTree(join(from, e.name), join(to, e.name))
    else copyFileSync(join(from, e.name), join(to, e.name))
  }
}
for (const must of ['CLAUDE-DESIGN-GRUBANO-EMAIL-SYSTEM-CONTRACT.md', 'E1-A-components.html', 'E1-A-DESIGN-MANIFEST.md', 'E1-A-email-gallery.html', 'emails/auth-magic-link.html', 'emails/consumer-order-ready-pickup.html', 'emails/partner-new-order.html']) {
  if (!existsSync(join(APPROVED, must))) { console.error('MISSING approved E1-A file:', must); process.exitCode = 1 }
}
copyTree(APPROVED, join(BUNDLE, 'APPROVED-E1-A-SYSTEM'))
copyFileSync(join(PACK, 'E1-A', 'FOUNDER-DECISION-2026-09-06.md'), join(BUNDLE, 'APPROVED-E1-A-SYSTEM', 'E1-A-FOUNDER-DECISION.md'))

// ── BUNDLE ───────────────────────────────────────────────────────────────────
const files = ['CLAUDE-DESIGN-E1-B-START.md', 'E1-B-MANIFEST.md', 'E1-B-COPY.md', 'E1-B-DATA-CONTRACTS.md', 'E1-B-CURRENT-VISUALS.md', 'E1-B-DESIGN-BRIEF.md']
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
