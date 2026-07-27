/* eslint-disable */
// ── Supplier Stripe Connect i18n seeder (B2B Slice 5b, Agent 14) ──────────────
// Idempotent: adds the payout/Connect keys to the `supplier` namespace in all 5
// locale files. Run: node scripts/add-supplier-connect-i18n.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

const S = {
  connectTitle:     ['Paiements', 'Payments', 'Pagos', 'Pagamenti', 'المدفوعات'],
  connectSubtitle:  ['Recevez vos virements via Stripe.', 'Receive your payouts via Stripe.', 'Recibe tus pagos vía Stripe.', 'Ricevi i tuoi pagamenti via Stripe.', 'استلم تحويلاتك عبر Stripe.'],
  connectStart:     ['Raccorder mes paiements', 'Connect my payouts', 'Conectar mis pagos', 'Collega i miei pagamenti', 'اربط مدفوعاتي'],
  connectContinue:  ['Continuer la configuration', 'Continue setup', 'Continuar la configuración', 'Continua la configurazione', 'متابعة الإعداد'],
  connectGated:     ["Bientôt — l'activation des paiements est en cours côté Grubano.", 'Coming soon — payouts activation is in progress at Grubano.', 'Próximamente — la activación de pagos está en curso en Grubano.', "A breve — l'attivazione dei pagamenti è in corso lato Grubano.", 'قريبًا — تفعيل المدفوعات قيد التنفيذ لدى غروبانو.'],
  connectError:     ['Une erreur est survenue. Réessayez.', 'Something went wrong. Please try again.', 'Algo salió mal. Inténtalo de nuevo.', 'Qualcosa è andato storto. Riprova.', 'حدث خطأ ما. حاول مرة أخرى.'],
  payoutNone:       ['Non raccordé', 'Not connected', 'No conectado', 'Non collegato', 'غير مرتبط'],
  payoutPending:    ['En cours', 'In progress', 'En curso', 'In corso', 'قيد التنفيذ'],
  payoutActive:     ['Actif', 'Active', 'Activo', 'Attivo', 'نشط'],
  payoutRestricted: ['Incomplet', 'Incomplete', 'Incompleto', 'Incompleto', 'غير مكتمل'],
}

const keys = Object.keys(S)
LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.supplier = json.supplier || {}
  for (const k of keys) json.supplier[k] = S[k][i]
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`  ✓ ${loc}.json — supplier connect (${keys.length} keys)`)
})
console.log('[add-supplier-connect-i18n] done.')
