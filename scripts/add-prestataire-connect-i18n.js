// scripts/add-prestataire-connect-i18n.js — Prestataire P7 (Agent 80).
// Adds the CONNECT (Stripe payout onboarding) copy under prestataire.connect.* — the
// PrestataireConnectCard on /prestataire/dashboard. FR vouvoiement, real Arabic (RTL).
// ⚠️ Account onboarding only — NO money wording (the real payment is P8). Idempotent;
// 2-space JSON. Run: node scripts/add-prestataire-connect-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

const ADD = {
  fr: {
    title: "Paiements", subtitle: "Recevez vos virements via Stripe.",
    start: "Activer les paiements", continue: "Continuer la configuration",
    error: "Une erreur est survenue. Réessayez.",
    payoutNone: "Non raccordé", payoutPending: "En cours", payoutActive: "Actif", payoutRestricted: "Incomplet",
  },
  en: {
    title: "Payments", subtitle: "Receive your payouts via Stripe.",
    start: "Enable payments", continue: "Continue setup",
    error: "Something went wrong. Please try again.",
    payoutNone: "Not connected", payoutPending: "In progress", payoutActive: "Active", payoutRestricted: "Incomplete",
  },
  es: {
    title: "Pagos", subtitle: "Reciba sus pagos mediante Stripe.",
    start: "Activar los pagos", continue: "Continuar la configuración",
    error: "Se ha producido un error. Inténtelo de nuevo.",
    payoutNone: "No conectado", payoutPending: "En curso", payoutActive: "Activo", payoutRestricted: "Incompleto",
  },
  it: {
    title: "Pagamenti", subtitle: "Ricevete i vostri versamenti tramite Stripe.",
    start: "Attivare i pagamenti", continue: "Continuare la configurazione",
    error: "Si è verificato un errore. Riprovate.",
    payoutNone: "Non collegato", payoutPending: "In corso", payoutActive: "Attivo", payoutRestricted: "Incompleto",
  },
  ar: {
    title: "المدفوعات", subtitle: "استلم تحويلاتك عبر Stripe.",
    start: "تفعيل المدفوعات", continue: "متابعة الإعداد",
    error: "حدث خطأ. حاول مرّة أخرى.",
    payoutNone: "غير مرتبط", payoutPending: "قيد الإنجاز", payoutActive: "نشط", payoutRestricted: "غير مكتمل",
  },
}

let changed = 0
for (const loc of Object.keys(ADD)) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.prestataire = json.prestataire || {}
  json.prestataire.connect = Object.assign({}, json.prestataire.connect, ADD[loc])
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
  console.log(`✓ ${loc}: prestataire.connect.*`)
}
console.log(`Done — ${changed} locale files updated.`)
