// EMAIL FACTUAL PACK — derives per-tranche MANIFEST / COPY / CURRENT-VISUALS from the core
// files by EMAIL ID (no retyping). Run from the repo root: node EMAIL-FACTUAL-PACK/tools/build-tranches.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const PACK = 'EMAIL-FACTUAL-PACK'
const manifest = readFileSync(join(PACK, 'EMAIL-MANIFEST.md'), 'utf8')
const copy     = readFileSync(join(PACK, 'EMAIL-COPY-VERBATIM.md'), 'utf8')
const visuals  = readFileSync(join(PACK, 'EMAIL-CURRENT-VISUALS.md'), 'utf8')

const T = {
  E1: {
    title: 'E1 — GLOBAL EMAIL DESIGN SYSTEM · AUTH · CONSUMER ORDER LIFECYCLE · PARTNER CORE ORDER',
    ids: ['AUTH_MAGIC_LINK', 'AUTH_MAGIC_LINK_WITH_OTP', 'AUTH_PASSWORD_RESET', 'AUTH_PASSWORD_CHANGED', 'CONSUMER_WELCOME',
      'CONSUMER_ORDER_CONFIRMATION', 'PARTNER_NEW_ORDER', 'CONSUMER_ORDER_ACCEPTED', 'CONSUMER_ORDER_READY', 'CONSUMER_ORDER_ENROUTE',
      'CONSUMER_ORDER_COMPLETED', 'CONSUMER_ORDER_CANCELLED_GENERIC', 'CONSUMER_ORDER_CANCELLED_PAID_CLAIMS_OFF'],
    renders: ['AUTH_MAGIC_LINK', 'AUTH_MAGIC_LINK_WITH_OTP', 'AUTH_PASSWORD_RESET', 'AUTH_PASSWORD_CHANGED', 'CONSUMER_WELCOME',
      'CONSUMER_ORDER_CONFIRMATION_PICKUP', 'CONSUMER_ORDER_CONFIRMATION_DELIVERY', 'PARTNER_NEW_ORDER', 'CONSUMER_ORDER_ACCEPTED',
      'CONSUMER_ORDER_READY_PICKUP', 'CONSUMER_ORDER_READY_DELIVERY', 'CONSUMER_ORDER_ENROUTE', 'CONSUMER_ORDER_COMPLETED_PICKUP',
      'CONSUMER_ORDER_DELIVERED', 'CONSUMER_ORDER_CANCELLED_GENERIC', 'CONSUMER_ORDER_CANCELLED_PAID_CLAIMS_OFF'],
  },
  E2: {
    title: 'E2 — CLAIMS / SAV · REFUNDS · SAFETY · ADMIN MONEY REVIEW · FINANCIAL EXCEPTIONS',
    ids: ['CLAIM_RECEIVED', 'CLAIM_DECISION_ACCEPTED', 'CLAIM_DECISION_REFUSED', 'CLAIM_DECISION_APPROVED', 'CLAIM_DECISION_REFUNDED',
      'CLAIM_DECISION_REFUSED_FINAL', 'ADMIN_STALE_CLAIM', 'CONSUMER_ORDER_CANCELLED_PAID_CLAIMS_ON', 'REFUND_SUCCEEDED',
      'ADMIN_PAID_CANCELLATION', 'ADMIN_GHOST_ORDER', 'ADMIN_STALE_PI', 'ADMIN_MONEY_REVIEW', 'ADMIN_RECONCILE_DIGEST', 'CRON_LEDGER_ALERT'],
    renders: ['CLAIM_RECEIVED', 'CLAIM_RECEIVED__ar', 'CLAIM_DECISION_ACCEPTED', 'CLAIM_DECISION_REFUSED', 'CLAIM_DECISION_APPROVED',
      'CLAIM_DECISION_REFUNDED', 'CLAIM_DECISION_REFUNDED__en', 'CLAIM_DECISION_REFUSED_FINAL', 'ADMIN_STALE_CLAIM',
      'CONSUMER_ORDER_CANCELLED_PAID_CLAIMS_ON', 'CONSUMER_ORDER_CANCELLED_PAID_CLAIMS_ON_EXISTING', 'REFUND_SUCCEEDED_FULL',
      'REFUND_SUCCEEDED_PARTIAL', 'ADMIN_PAID_CANCELLATION', 'ADMIN_GHOST_ORDER', 'ADMIN_STALE_PI', 'ADMIN_MONEY_REVIEW', 'ADMIN_RECONCILE_DIGEST'],
  },
  E3: {
    title: 'E3 — SECONDARY ACCOUNT · RESTAURANT ONBOARDING · PARTNER APPROVAL/REJECTION · COURIER WAITLIST · RESERVATIONS (OUT) · OTHER OPS',
    ids: ['AUTH_STEPUP_CODE', 'ACCOUNT_EMAIL_CHANGE_CODE', 'ACCOUNT_EMAIL_CHANGE_LINK', 'ACCOUNT_EMAIL_CHANGED_ALERT', 'ACCOUNT_EMAIL_CHANGE_CONFIRM',
      'ACCOUNT_EMAIL_ALREADY_USED', 'PARTNER_EMAIL_VERIFY', 'ADMIN_PARTNER_PENDING', 'PARTNER_ACCOUNT_VALIDATED', 'PARTNER_ACCOUNT_REJECTED',
      'PARTNER_DOCS_NEEDED', 'COURIER_WAITLIST_CONFIRMATION', 'ONBOARDING_NUDGE_RESTAURANT', 'ONBOARDING_NUDGE_GENERIC',
      'OPERATOR_SUPPLIER_PURCHASE_ORDER', 'CREATOR_DISH_ADOPTED', 'PARTNER_WAITLIST_OFFER',
      'CONSUMER_RESERVATION_CONFIRMED', 'PARTNER_NEW_RESERVATION', 'CONSUMER_RESERVATION_CANCELLED_BY_CLIENT', 'PARTNER_RESERVATION_CANCELLED_BY_CLIENT',
      'CONSUMER_RESERVATION_CANCELLED_BY_OWNER', 'CONSUMER_RESERVATION_CANCELLED_BY_CLOSURE', 'CONSUMER_NOSHOW_PENALTY_CHARGED',
      'CRON_CREATOR_EARNINGS_RECAP', 'CRON_MONTHLY_INVOICES_RECAP'],
    renders: ['AUTH_STEPUP_CODE', 'ACCOUNT_EMAIL_CHANGE_CODE', 'ACCOUNT_EMAIL_CHANGE_LINK', 'ACCOUNT_EMAIL_CHANGED_ALERT', 'ACCOUNT_EMAIL_CHANGE_CONFIRM',
      'ACCOUNT_EMAIL_ALREADY_USED', 'PARTNER_EMAIL_VERIFY', 'ADMIN_PARTNER_PENDING', 'ADMIN_PARTNER_PENDING__from_route', 'PARTNER_ACCOUNT_VALIDATED',
      'PARTNER_ACCOUNT_REJECTED', 'PARTNER_DOCS_NEEDED_UNWIRED', 'COURIER_WAITLIST_CONFIRMATION', 'ONBOARDING_NUDGE_RESTAURANT', 'ONBOARDING_NUDGE_GENERIC',
      'OPERATOR_SUPPLIER_PURCHASE_ORDER', 'CREATOR_DISH_ADOPTED', 'PARTNER_WAITLIST_OFFER', 'CONSUMER_RESERVATION_CONFIRMED',
      'CONSUMER_RESERVATION_CONFIRMED_DEPOSIT', 'PARTNER_NEW_RESERVATION', 'CONSUMER_RESERVATION_CANCELLED_BY_CLIENT',
      'PARTNER_RESERVATION_CANCELLED_BY_CLIENT', 'CONSUMER_RESERVATION_CANCELLED_BY_OWNER', 'CONSUMER_RESERVATION_CANCELLED_BY_CLOSURE',
      'CONSUMER_NOSHOW_PENALTY_CHARGED'],
  },
}

// manifest rows: any table line whose first cell equals an id
const manifestRows = manifest.split('\n').filter((l) => l.startsWith('| '))
const headerFor = (row) => {
  // find the nearest preceding header line in the manifest for this row
  const idx = manifest.indexOf(row)
  const before = manifest.slice(0, idx).split('\n').reverse()
  const header = before.find((l) => l.startsWith('| EMAIL ID'))
  const sep = before.find((l) => /^\|---/.test(l))
  return [header, sep]
}
const copySections = Object.fromEntries([...copy.matchAll(/\n### ([A-Za-z0-9_]+)\n([\s\S]*?)(?=\n### |\n## |$)/g)].map((m) => [m[1], m[2]]))
const visualRows = Object.fromEntries(visuals.split('\n').filter((l) => /^\| [A-Z]/.test(l)).map((l) => [l.split('|')[1].trim(), l]))

for (const [key, t] of Object.entries(T)) {
  const dir = join(PACK, key); mkdirSync(dir, { recursive: true })
  // MANIFEST
  let md = `# ${key}-MANIFEST — rows extracted from \`../EMAIL-MANIFEST.md\` (same columns, same evidence)\n\n> ${t.title}\n> Status legend: A live+reachable · B code exists, gated/unreachable/uncalled · D dead. Maturity + reachability in the row. Read \`../EMAIL-MANIFEST.md §0\` once for definitions.\n`
  let lastHeader = ''
  for (const id of t.ids) {
    const row = manifestRows.find((l) => l.split('|')[1].trim() === id)
    if (!row) { md += `\n| ${id} | **NOT FOUND in core manifest** |\n`; continue }
    const [h, s] = headerFor(row)
    if (h !== lastHeader) { md += `\n${h}\n${s}\n`; lastHeader = h }
    md += `${row}\n`
  }
  writeFileSync(join(dir, `${key}-MANIFEST.md`), md)
  // COPY
  let c = `# ${key}-COPY — current copy verbatim for this tranche (extracted from \`../EMAIL-COPY-VERBATIM.md\`)\n\n> Fixtures: Léa Martin / Gnocchi Bar / GR-ABC123 / 12 sept. 2026 19:30. Do not rewrite here — designed copy goes in the tranche deliverables.\n`
  for (const r of t.renders) {
    if (copySections[r]) c += `\n### ${r}\n${copySections[r]}\n`
    else c += `\n### ${r}\n_(text-only or not renderable — see \`../EMAIL-COPY-VERBATIM.md\` §H/§I)_\n`
  }
  if (key === 'E2') c += `\n### CRON_LEDGER_ALERT\n_(plain-text cron alert — template in \`../EMAIL-COPY-VERBATIM.md §H\`)_\n`
  if (key === 'E3') c += `\n### CRON_CREATOR_EARNINGS_RECAP / CRON_MONTHLY_INVOICES_RECAP\n_(plain-text cron recaps — templates in \`../EMAIL-COPY-VERBATIM.md §H\`)_\n`
  writeFileSync(join(dir, `${key}-COPY.md`), c)
  // VISUALS
  let v = `# ${key}-CURRENT-VISUALS — fossils for this tranche\n\n> Raw fragments \`../current-renders/<ID>.html\`, screenshots \`../current-renders/png/<ID>@600.png\` / \`@390.png\`. Gallery: \`../current-gallery.html\`. Zero images in every template; plain-text part only where marked. Shared observations in \`../EMAIL-CURRENT-VISUALS.md\`.\n\n| ID | Subject | To (fixture) | text part | 600 px | 390 px |\n|---|---|---|---|---|---|\n`
  for (const r of t.renders) {
    const row = visualRows[r]
    if (row) v += row.replace(/\]\(current-renders\//g, '](../current-renders/') + '\n'
    else v += `| ${r} | — | — | — | — | — |\n`
  }
  writeFileSync(join(dir, `${key}-CURRENT-VISUALS.md`), v)
  const missing = t.ids.filter((id) => !manifestRows.some((l) => l.split('|')[1].trim() === id))
  console.log(key, 'ids', t.ids.length, 'renders', t.renders.length, 'missing manifest rows:', missing.join(',') || 'none', 'missing copy:', t.renders.filter((r) => !copySections[r]).join(',') || 'none')
}
