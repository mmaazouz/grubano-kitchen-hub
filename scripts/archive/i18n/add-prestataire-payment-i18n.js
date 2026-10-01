// scripts/add-prestataire-payment-i18n.js — Prestataire P8 (Agent 81).
// Adds the PAYMENT copy under prestataire.invoice.* (the « Payer » button + paid state in
// ServiceInvoiceModal, resto side). FR vouvoiement, real Arabic (RTL). Idempotent; 2-space JSON.
// ⚠️ REAL money (TEST) — the amount is server-derived, never shown for input here.
// Run: node scripts/add-prestataire-payment-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

const ADD = {
  fr: { pay: "Payer", paid: "Payée", payErr: "Le paiement n’a pas pu démarrer. Réessayez." },
  en: { pay: "Pay", paid: "Paid", payErr: "Payment couldn’t start. Please try again." },
  es: { pay: "Pagar", paid: "Pagada", payErr: "No se pudo iniciar el pago. Inténtelo de nuevo." },
  it: { pay: "Paga", paid: "Pagata", payErr: "Impossibile avviare il pagamento. Riprovate." },
  ar: { pay: "ادفع", paid: "مدفوعة", payErr: "تعذّر بدء الدفع. حاول مجدّدًا." },
}

let changed = 0
for (const loc of Object.keys(ADD)) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.prestataire = json.prestataire || {}
  json.prestataire.invoice = Object.assign({}, json.prestataire.invoice, ADD[loc])
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
  console.log(`✓ ${loc}: prestataire.invoice.pay/paid/payErr`)
}
console.log(`Done — ${changed} locale files updated.`)
