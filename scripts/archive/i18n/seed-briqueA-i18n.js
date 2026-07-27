// scripts/seed-briqueA-i18n.js
// Brique A (Agent 13) — short reservation code + session navigation.
// Additive ONLY. Dedicated seed — NOT translate-messages.js.
//
// Adds (per locale) under session.*:
//   walkin           → "Walk-in" pill when ticket has no reservationId
//   sessionLabel     → "Session" / "Service" prefix word (UI annotation)
//   codeTooltip      → tooltip on the badge ("Identifiant de session")
//   yourSessionNo    → consumer-side "Votre n° de session" (Done screen)
//   openTableTitle   → "Voir l'addition" tooltip on a clickable table
//   noOpenBill       → empty state caption when a table has no open bill
//
// Run:  node scripts/seed-briqueA-i18n.js   then   npm run check:i18n

const fs = require('fs')
const path = require('path')

const T = {
  fr: {
    walkin:         'Walk-in',
    sessionLabel:   'Session',
    codeTooltip:    'Identifiant de session',
    yourSessionNo:  'Votre n° de session',
    openTableTitle: 'Voir l’addition',
    noOpenBill:     'Aucune addition en cours',
  },
  en: {
    walkin:         'Walk-in',
    sessionLabel:   'Session',
    codeTooltip:    'Session ID',
    yourSessionNo:  'Your session ID',
    openTableTitle: 'View the bill',
    noOpenBill:     'No open bill',
  },
  es: {
    walkin:         'Walk-in',
    sessionLabel:   'Sesión',
    codeTooltip:    'ID de sesión',
    yourSessionNo:  'Tu ID de sesión',
    openTableTitle: 'Ver la cuenta',
    noOpenBill:     'No hay cuenta abierta',
  },
  it: {
    walkin:         'Walk-in',
    sessionLabel:   'Sessione',
    codeTooltip:    'ID sessione',
    yourSessionNo:  'Il tuo ID di sessione',
    openTableTitle: 'Vedi il conto',
    noOpenBill:     'Nessun conto aperto',
  },
  ar: {
    walkin:         'بدون حجز',
    sessionLabel:   'الجلسة',
    codeTooltip:    'معرّف الجلسة',
    yourSessionNo:  'معرّف جلستك',
    openTableTitle: 'عرض الفاتورة',
    noOpenBill:     'لا توجد فاتورة مفتوحة',
  },
}

for (const [loc, kv] of Object.entries(T)) {
  const p = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(p, 'utf8'))
  if (!m.session) m.session = {}
  Object.assign(m.session, kv)
  fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`${loc}: +session.* (${Object.keys(kv).length} keys)`)
}
