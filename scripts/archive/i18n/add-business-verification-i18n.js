/* eslint-disable */
// ── Supplier BUSINESS-VERIFICATION i18n seeder (Agent 14) ─────────────────────
// Adds the SIREN/SIRET field strings and REWORDS the review/pending success copy
// to drop the human "notre équipe validera / 48 h" promise (now automatic). The
// 'active'/'rejected' success keys already exist (auto-onboarding slice).
// Idempotent. Run: node scripts/add-business-verification-i18n.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

const M = {
  fieldSiren: [
    'SIREN ou SIRET', 'SIREN or SIRET', 'SIREN o SIRET', 'SIREN o SIRET', 'SIREN أو SIRET',
  ],
  fieldSirenHint: [
    "Numéro officiel de ton entreprise (SIREN 9 chiffres ou SIRET 14) — vérifié automatiquement.",
    "Your company's official number (SIREN 9 digits or SIRET 14) — verified automatically.",
    'Número oficial de tu empresa (SIREN 9 dígitos o SIRET 14) — verificado automáticamente.',
    'Numero ufficiale della tua azienda (SIREN 9 cifre o SIRET 14) — verificato automaticamente.',
    'الرقم الرسمي لشركتك (SIREN من 9 أرقام أو SIRET من 14) — يتم التحقق منه تلقائيًا.',
  ],
  // Reworded: the pending/review case is now an automatic registry verification.
  successTitle: [
    'Vérification en cours', 'Verification in progress', 'Verificación en curso', 'Verifica in corso', 'جارٍ التحقق',
  ],
  successBody: [
    "Nous vérifions ton entreprise auprès du registre officiel. Tu recevras un accès dès que c'est validé.",
    "We're verifying your company against the official registry. You'll get access as soon as it's confirmed.",
    'Estamos verificando tu empresa en el registro oficial. Tendrás acceso en cuanto se confirme.',
    "Stiamo verificando la tua azienda nel registro ufficiale. Riceverai l'accesso non appena confermata.",
    'نتحقق من شركتك لدى السجل الرسمي. ستحصل على الوصول بمجرد التأكيد.',
  ],
}

const keys = Object.keys(M)
LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.supplier = json.supplier || {}
  for (const k of keys) json.supplier[k] = M[k][i]
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`  ✓ ${loc}.json — supplier business-verification (${keys.length} keys)`)
})
console.log('[add-business-verification-i18n] done.')
