// scripts/add-prestataire-deposit-i18n.js — Prestataire P8c (Agent 83).
// Adds the DEPOSIT (acompte) copy:
//   - prestataire.missions.fDepositPct*               → the quote form deposit % field (prestataire)
//   - marketplace.prestataireMissions.payDeposit* / depositPaid → the « Payer l'acompte » button (resto)
// FR vouvoiement, real Arabic (RTL). Idempotent; 2-space JSON. ⚠️ REAL money (TEST) — server amounts.
// Run: node scripts/add-prestataire-deposit-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

const ADD = {
  fr: {
    missions: { fDepositPct: "Acompte (%)", fDepositPctHint: "Optionnel. % du devis à régler à l’acceptation (0 = pas d’acompte). Le solde est payé à la réalisation." },
    resto: { payDepositCta: "Payer l’acompte ({pct} %)", payDepositErr: "Le paiement de l’acompte n’a pas pu démarrer. Réessayez.", depositPaid: "Acompte payé" },
  },
  en: {
    missions: { fDepositPct: "Deposit (%)", fDepositPctHint: "Optional. % of the quote due at acceptance (0 = no deposit). The balance is paid at completion." },
    resto: { payDepositCta: "Pay the deposit ({pct}%)", payDepositErr: "The deposit payment couldn’t start. Please try again.", depositPaid: "Deposit paid" },
  },
  es: {
    missions: { fDepositPct: "Anticipo (%)", fDepositPctHint: "Opcional. % del presupuesto a pagar en la aceptación (0 = sin anticipo). El saldo se paga al finalizar." },
    resto: { payDepositCta: "Pagar el anticipo ({pct} %)", payDepositErr: "No se pudo iniciar el pago del anticipo. Inténtelo de nuevo.", depositPaid: "Anticipo pagado" },
  },
  it: {
    missions: { fDepositPct: "Acconto (%)", fDepositPctHint: "Facoltativo. % del preventivo da pagare all’accettazione (0 = nessun acconto). Il saldo si paga al completamento." },
    resto: { payDepositCta: "Pagare l’acconto ({pct} %)", payDepositErr: "Impossibile avviare il pagamento dell’acconto. Riprovate.", depositPaid: "Acconto pagato" },
  },
  ar: {
    missions: { fDepositPct: "العربون (%)", fDepositPctHint: "اختياري. نسبة من التسعيرة تُدفع عند القبول (0 = بدون عربون). يُدفع الرصيد عند الإنجاز." },
    resto: { payDepositCta: "ادفع العربون ({pct}%)", payDepositErr: "تعذّر بدء دفع العربون. حاول مجدّدًا.", depositPaid: "تم دفع العربون" },
  },
}

let changed = 0
for (const loc of Object.keys(ADD)) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  const a = ADD[loc]
  json.prestataire = json.prestataire || {}
  json.prestataire.missions = Object.assign({}, json.prestataire.missions, a.missions)
  json.marketplace = json.marketplace || {}
  json.marketplace.prestataireMissions = Object.assign({}, json.marketplace.prestataireMissions, a.resto)
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
  console.log(`✓ ${loc}: prestataire.missions.fDepositPct* + marketplace.prestataireMissions.payDeposit*`)
}
console.log(`Done — ${changed} locale files updated.`)
