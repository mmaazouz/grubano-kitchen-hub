/* eslint-disable */
// ── P3 Chantier 2 (purge dead keys) + Chantier 4 (mockUrl) (Agent 19) ─────────
// Symmetric across all 5 locales → parity preserved. Idempotent (deleting an absent
// key is a no-op; setting mockUrl is stable).
//
// DEAD keys (confirmed 0 RUNTIME usage by grep — the only references are historical
// committed i18n SEEDERS, which are dev generators, never run by the app or CI):
//   business.start.{influencerTitle,influencerDesc,franchisorTitle,franchisorDesc}
//       — the /business/start page (v1.5) renders restaurateur/fournisseur/creator/
//         logistique cards + an influencer TEASER + a franchise LINE; it never reads
//         these old standalone card keys.
//   business.auth.{signInMissing,signInFailed,partnerOnlyNote,tabLogin}
//       — the password LOGIN was removed in S2 (/business/auth now redirects to
//         /auth/magic). /eat/auth uses its OWN namespace (eat.auth), not business.auth.
//       — tabRegister is KEPT (the /business/register page still renders it).
//   business.logisticsSoon.*  (whole subtree)
//       — the /business/logistics-soon page became a pure redirect in P1; nothing
//         renders this subtree any more.
// business.landing.footerLegal is intentionally KEPT (to be wired in P4).
//
// Chantier 4: business.landing.mockUrl → "business.grubano.com" (the product-preview
// URL shown on the landing) in every locale.
// Run: node scripts/p3-i18n-cleanup.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

const DEAD_PATHS = [
  'business.start.influencerTitle',
  'business.start.influencerDesc',
  'business.start.franchisorTitle',
  'business.start.franchisorDesc',
  'business.auth.signInMissing',
  'business.auth.signInFailed',
  'business.auth.partnerOnlyNote',
  'business.auth.tabLogin',
  'business.logisticsSoon', // whole subtree
]

function delPath(root, dotted) {
  const parts = dotted.split('.')
  const leaf = parts.pop()
  let o = root
  for (const p of parts) { if (o == null || typeof o !== 'object') return false; o = o[p] }
  if (o && Object.prototype.hasOwnProperty.call(o, leaf)) { delete o[leaf]; return true }
  return false
}

for (const loc of LOCALES) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  let deleted = 0
  for (const p of DEAD_PATHS) if (delPath(json, p)) deleted++
  // Chantier 4 — mockUrl (only set if the landing namespace exists).
  let mock = 'n/a'
  if (json.business && json.business.landing && 'mockUrl' in json.business.landing) {
    json.business.landing.mockUrl = 'business.grubano.com'
    mock = 'set'
  }
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`  ✓ ${loc}.json — ${deleted} dead path(s) removed · mockUrl ${mock}`)
}
console.log('[p3-i18n-cleanup] done.')
