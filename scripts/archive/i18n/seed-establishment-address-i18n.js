// Vague 1: address-field validation message. Added under BOTH entry points'
// namespaces — establishment.* (hub modal) and business.onboarding.* (initial
// onboarding) — so the same wording shows in both. Bespoke seeder (not
// translate-messages.js).

const fs = require('fs')
const path = require('path')

const ERR_ADDRESS_INVALID = {
  fr: 'Adresse invalide — saisis une adresse complète (numéro et rue).',
  en: 'Invalid address — enter a complete address (street number and name).',
  es: 'Dirección no válida — escribe una dirección completa (número y calle).',
  it: 'Indirizzo non valido — inserisci un indirizzo completo (numero civico e via).',
  ar: 'عنوان غير صالح — أدخل عنواناً كاملاً (رقم واسم الشارع).',
}

for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
  const p = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(p, 'utf8'))

  if (!m.establishment) m.establishment = {}
  m.establishment.errAddressInvalid = ERR_ADDRESS_INVALID[loc]

  if (!m.business) m.business = {}
  if (!m.business.onboarding) m.business.onboarding = {}
  m.business.onboarding.errAddressInvalid = ERR_ADDRESS_INVALID[loc]

  fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`${loc}: establishment.errAddressInvalid + business.onboarding.errAddressInvalid set`)
}
