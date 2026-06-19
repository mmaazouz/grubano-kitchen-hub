// Adds the P4.4-B invoice-PDF button label to financeRail in all 5 locales. Idempotent.
// Order: [fr, en, es, it, ar]. Run: node scripts/add-invoice-pdf-i18n.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

const KEYS = {
  invoicePdf: ['PDF', 'PDF', 'PDF', 'PDF', 'PDF'], // universal acronym
}

LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.financeRail = json.financeRail || {}
  for (const k of Object.keys(KEYS)) json.financeRail[k] = KEYS[k][i]
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`  ✓ ${loc}.json — financeRail.invoicePdf`)
})
