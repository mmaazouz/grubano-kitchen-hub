/* eslint-disable */
// ── P4 Chantier 3 — "Autre activité ?" line on /business/start (Agent 20) ─────
// Adds business.start.otherActivityPrompt + otherActivityCta (mailto link text).
// Additive, x5 locales, vouvoiement, idempotent, RTL ar.
// Run: node scripts/add-other-activity-i18n.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

// [fr, en, es, it, ar]
const KEYS = {
  otherActivityPrompt: ['Autre activité ?', 'Another activity?', '¿Otra actividad?', 'Un’altra attività?', 'نشاط آخر؟'],
  otherActivityCta:    ['Écrivez-nous', 'Write to us', 'Escríbenos', 'Scrivici', 'راسلنا'],
}

LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.business = json.business || {}
  json.business.start = json.business.start || {}
  for (const k of Object.keys(KEYS)) json.business.start[k] = KEYS[k][i]
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`  ✓ ${loc}.json — business.start.otherActivity{Prompt,Cta}`)
})
console.log('[add-other-activity-i18n] done.')
