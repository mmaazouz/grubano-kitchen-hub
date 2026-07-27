/* eslint-disable */
// ── B2B supply PAYMENT i18n seeder (Slice 5c, Agent 14) ───────────────────────
// Idempotent: adds the pay keys to the `marketplace` namespace in all 5 locales.
// Run: node scripts/add-supply-pay-i18n.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

const M = {
  actionPay:    ['Payer', 'Pay', 'Pagar', 'Paga', 'ادفع'],
  payBadgePaid: ['Payée', 'Paid', 'Pagado', 'Pagato', 'مدفوعة'],
  payError:     ["Le paiement n'a pas pu démarrer. Réessayez.", 'Could not start the payment. Please try again.', 'No se pudo iniciar el pago. Inténtalo de nuevo.', 'Impossibile avviare il pagamento. Riprova.', 'تعذّر بدء الدفع. حاول مرة أخرى.'],
}

const keys = Object.keys(M)
LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.marketplace = json.marketplace || {}
  for (const k of keys) json.marketplace[k] = M[k][i]
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`  ✓ ${loc}.json — marketplace pay (${keys.length} keys)`)
})
console.log('[add-supply-pay-i18n] done.')
