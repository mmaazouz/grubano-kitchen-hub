/* eslint-disable */
// ── P3 Chantier 3 — externalize hardcoded nav labels (Agent 19) ───────────────
// Adds the i18n keys for the creator/franchise portal sidebar + mobile-header brand
// labels (were hardcoded FR in the components → es/it/ar showed French), plus a
// shared common.openMenu. The « Fermer » aria-label reuses the EXISTING common.close.
// x5 locales, parity preserved, idempotent. Brand product names (Grubano Studio /
// Grubano Network) are kept identical across locales (they are brand names).
// Run: node scripts/p3-nav-labels-i18n.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

// dotted path -> [fr, en, es, it, ar]
const KEYS = {
  'creators.nav.brandTitle':    ['Créateurs', 'Creators', 'Creadores', 'Creator', 'المبدعون'],
  'creators.nav.brandSubtitle': ['Grubano Studio', 'Grubano Studio', 'Grubano Studio', 'Grubano Studio', 'Grubano Studio'],
  'franchise.nav.brandTitle':   ['Franchise', 'Franchise', 'Franquicia', 'Franchising', 'الامتياز'],
  'franchise.nav.brandSubtitle':['Grubano Network', 'Grubano Network', 'Grubano Network', 'Grubano Network', 'Grubano Network'],
  'common.openMenu':            ['Ouvrir le menu', 'Open menu', 'Abrir el menú', 'Apri il menu', 'فتح القائمة'],
}

function setPath(root, dotted, value) {
  const parts = dotted.split('.')
  const leaf = parts.pop()
  let o = root
  for (const p of parts) { if (o[p] == null || typeof o[p] !== 'object') o[p] = {}; o = o[p] }
  o[leaf] = value
}

LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  for (const [p, vals] of Object.entries(KEYS)) setPath(json, p, vals[i])
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`  ✓ ${loc}.json — ${Object.keys(KEYS).length} nav-label key(s) ensured`)
})
console.log('[p3-nav-labels-i18n] done. (common.close reused, not re-added)')
