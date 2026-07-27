// Seed i18n — HYGIÈNE PRÉ-LIVE phase 3 : la section « Mes commandes » du
// profil conso (les badges réutilisent les clés eat.track existantes —
// seule la nouvelle clé de titre est ajoutée).
//
// Usage: node scripts/seed-account-orders-i18n.js   puis   npm run check:i18n

const fs = require('fs')
const path = require('path')

const TITLES = {
  fr: 'Mes commandes',
  en: 'My orders',
  es: 'Mis pedidos',
  it: 'I miei ordini',
  ar: 'طلباتي',
}

for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(file, 'utf8'))
  m.eat.account.ordersTitle = TITLES[loc]
  fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`[seed-account-orders-i18n] ${loc}.json OK`)
}
console.log('[seed-account-orders-i18n] Done — run: npm run check:i18n')
