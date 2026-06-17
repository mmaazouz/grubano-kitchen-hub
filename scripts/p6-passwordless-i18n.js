/* eslint-disable */
// ── P6 — passwordless restaurateur signup i18n (Agent 24) ─────────────────────
// (1) Rewrites business.auth.confirmationGeneric → passwordless + magic-link copy.
// (2) Purges the now-DEAD business.auth password keys (the /business/register form
//     no longer has a password field; the consumer /eat/auth keeps its OWN
//     eat.auth.* password keys — a DIFFERENT namespace, untouched).
// Symmetric x5, idempotent. FR vouvoiement; es/it informal; ar RTL.
// Run: node scripts/p6-passwordless-i18n.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

// business.auth.confirmationGeneric — [fr, en, es, it, ar]
const CONFIRMATION = [
  "Si ces informations sont valides, un e-mail de vérification vient d'être envoyé. Vérifiez votre boîte de réception (et les spams), activez votre compte, puis connectez-vous par lien magique.",
  'If these details are valid, a verification e-mail has just been sent. Check your inbox (and spam), activate your account, then sign in with a magic link.',
  'Si estos datos son válidos, acabamos de enviarte un correo de verificación. Revisa tu bandeja (y el spam), activa tu cuenta y luego inicia sesión con un enlace mágico.',
  "Se questi dati sono validi, ti abbiamo appena inviato un'email di verifica. Controlla la posta (e lo spam), attiva il tuo account e poi accedi con un link magico.",
  'إذا كانت هذه المعلومات صحيحة، فقد أرسلنا للتو بريد تحقق. تحقّق من صندوق الوارد (والبريد المزعج)، فعّل حسابك، ثم سجّل الدخول عبر رابط سحري.',
]

// DEAD business.auth password keys (0 runtime usage after the form lost its password
// field; only the historical seeder + the separate eat.auth namespace referenced
// these names). Deleted symmetrically across all locales.
const DEAD = [
  'passwordLabel', 'pwHint', 'pwPlaceholder',
  'pwWeak', 'pwOk', 'pwGood', 'pwStrong', 'pwTooWeak',
  'showPassword', 'hidePassword',
]

LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  const auth = (json.business && json.business.auth) || {}
  if (json.business && json.business.auth) {
    json.business.auth.confirmationGeneric = CONFIRMATION[i]
    let removed = 0
    for (const k of DEAD) if (Object.prototype.hasOwnProperty.call(auth, k)) { delete auth[k]; removed++ }
    console.log(`  ✓ ${loc}.json — confirmationGeneric rewritten · ${removed} dead password key(s) removed`)
  }
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
})
console.log('[p6-passwordless-i18n] done.')
