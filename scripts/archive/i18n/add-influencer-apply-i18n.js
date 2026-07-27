/* eslint-disable */
// ── Influencer-entry title for /creators/apply (P2, Agent 18) ─────────────────
// Adds creators.apply.titleInfluencer — shown when the page is reached via the
// /business/start influencer teaser (?type=influencer). Additive, x5 locales,
// vouvoiement, idempotent. Run: node scripts/add-influencer-apply-i18n.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

// creators.apply.titleInfluencer — [fr, en, es, it, ar]
const TITLE_INFLUENCER = [
  "Devenir influenceur / partenaire d'affiliation",
  'Become an influencer / affiliate partner',
  'Conviértete en influencer / socio de afiliación',
  'Diventa influencer / partner di affiliazione',
  'كن مؤثرًا / شريكًا في الإحالة',
]

LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.creators = json.creators || {}
  json.creators.apply = json.creators.apply || {}
  json.creators.apply.titleInfluencer = TITLE_INFLUENCER[i]
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`  ✓ ${loc}.json — creators.apply.titleInfluencer`)
})
console.log('[add-influencer-apply-i18n] done.')
