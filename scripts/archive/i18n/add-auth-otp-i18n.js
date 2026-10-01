// scripts/add-auth-otp-i18n.js — Auth login email-code (Phase 3, Agent 88).
// Adds magic.otp* (the 6-digit code fallback on the "sent" screen). FR vouvoiement,
// real Arabic (RTL). Idempotent; 2-space JSON. Run: node scripts/add-auth-otp-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

const ADD = {
  fr: {
    otpPrompt: "Le lien s’ouvre dans le mauvais navigateur ? Saisissez le code à 6 chiffres reçu par e-mail.",
    otpLabel: "Code à 6 chiffres", otpSubmit: "Valider le code", otpSubmitting: "Vérification…",
    otpError: "Code invalide ou expiré. Vérifiez-le ou demandez un nouveau lien.",
  },
  en: {
    otpPrompt: "Link opened in the wrong browser? Enter the 6-digit code from your email.",
    otpLabel: "6-digit code", otpSubmit: "Verify code", otpSubmitting: "Verifying…",
    otpError: "Invalid or expired code. Check it or request a new link.",
  },
  es: {
    otpPrompt: "¿El enlace se abrió en el navegador equivocado? Introduzca el código de 6 dígitos recibido por correo.",
    otpLabel: "Código de 6 dígitos", otpSubmit: "Validar el código", otpSubmitting: "Verificando…",
    otpError: "Código no válido o caducado. Compruébelo o solicite un nuevo enlace.",
  },
  it: {
    otpPrompt: "Il link si è aperto nel browser sbagliato? Inserisca il codice a 6 cifre ricevuto via e-mail.",
    otpLabel: "Codice a 6 cifre", otpSubmit: "Convalidare il codice", otpSubmitting: "Verifica…",
    otpError: "Codice non valido o scaduto. Lo verifichi o richieda un nuovo link.",
  },
  ar: {
    otpPrompt: "هل فُتح الرابط في المتصفح الخطأ؟ أدخل الرمز المكوّن من 6 أرقام الذي وصلك بالبريد.",
    otpLabel: "رمز من 6 أرقام", otpSubmit: "تأكيد الرمز", otpSubmitting: "جارٍ التحقق…",
    otpError: "رمز غير صالح أو منتهي الصلاحية. تحقّق منه أو اطلب رابطًا جديدًا.",
  },
}

let changed = 0
for (const loc of Object.keys(ADD)) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.magic = Object.assign({}, json.magic, ADD[loc])
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
  console.log(`✓ ${loc}: magic.otp*`)
}
console.log(`Done — ${changed} locale files updated.`)
