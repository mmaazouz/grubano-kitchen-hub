// scripts/add-stepup-i18n.js — Money step-up on withdrawal (Phase 3, Agent 88).
// Adds affiliate.withdrawStepUp* (the code prompt before a withdrawal). FR vouvoiement,
// real Arabic (RTL). Idempotent; 2-space JSON. Run: node scripts/add-stepup-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

const ADD = {
  fr: {
    withdrawStepUpTitle: "Confirmation requise",
    withdrawStepUpPrompt: "Saisissez le code à 6 chiffres envoyé à votre adresse e-mail pour confirmer ce retrait.",
    withdrawStepUpLabel: "Code de confirmation", withdrawStepUpConfirm: "Confirmer le retrait",
    withdrawStepUpResend: "Renvoyer un code", withdrawStepUpError: "Code invalide ou expiré. Réessayez ou renvoyez un code.",
  },
  en: {
    withdrawStepUpTitle: "Confirmation required",
    withdrawStepUpPrompt: "Enter the 6-digit code sent to your email to confirm this withdrawal.",
    withdrawStepUpLabel: "Confirmation code", withdrawStepUpConfirm: "Confirm withdrawal",
    withdrawStepUpResend: "Resend a code", withdrawStepUpError: "Invalid or expired code. Try again or resend a code.",
  },
  es: {
    withdrawStepUpTitle: "Confirmación requerida",
    withdrawStepUpPrompt: "Introduzca el código de 6 dígitos enviado a su correo para confirmar esta retirada.",
    withdrawStepUpLabel: "Código de confirmación", withdrawStepUpConfirm: "Confirmar la retirada",
    withdrawStepUpResend: "Reenviar un código", withdrawStepUpError: "Código no válido o caducado. Inténtelo de nuevo o reenvíe un código.",
  },
  it: {
    withdrawStepUpTitle: "Conferma richiesta",
    withdrawStepUpPrompt: "Inserisca il codice a 6 cifre inviato alla sua e-mail per confermare questo prelievo.",
    withdrawStepUpLabel: "Codice di conferma", withdrawStepUpConfirm: "Confermare il prelievo",
    withdrawStepUpResend: "Inviare di nuovo un codice", withdrawStepUpError: "Codice non valido o scaduto. Riprovi o richieda un nuovo codice.",
  },
  ar: {
    withdrawStepUpTitle: "التأكيد مطلوب",
    withdrawStepUpPrompt: "أدخل الرمز المكوّن من 6 أرقام المُرسَل إلى بريدك لتأكيد هذا السحب.",
    withdrawStepUpLabel: "رمز التأكيد", withdrawStepUpConfirm: "تأكيد السحب",
    withdrawStepUpResend: "إعادة إرسال رمز", withdrawStepUpError: "رمز غير صالح أو منتهي الصلاحية. أعد المحاولة أو اطلب رمزًا جديدًا.",
  },
}

let changed = 0
for (const loc of Object.keys(ADD)) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.affiliate = Object.assign({}, json.affiliate, ADD[loc])
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
  console.log(`✓ ${loc}: affiliate.withdrawStepUp*`)
}
console.log(`Done — ${changed} locale files updated.`)
