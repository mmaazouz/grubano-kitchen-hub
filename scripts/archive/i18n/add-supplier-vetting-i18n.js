/* eslint-disable */
// ── Supplier AUTO-ONBOARDING i18n seeder (Agent 14) ───────────────────────────
// Idempotent: adds the outcome-aware success keys to the `supplier` namespace in
// all 5 locales (the existing successTitle/successBody stay = the 'pending' copy).
// Run: node scripts/add-supplier-vetting-i18n.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

const M = {
  successTitleActive: [
    'Espace fournisseur activé ✅',
    'Supplier account activated ✅',
    'Cuenta de proveedor activada ✅',
    'Account fornitore attivato ✅',
    'تم تفعيل حساب المورّد ✅',
  ],
  successBodyActive: [
    "Bienvenue ! Ton espace est actif : connecte-toi par lien magique pour gérer ton catalogue. Pour encaisser les paiements, finalise l'activation Stripe depuis ton espace.",
    'Welcome! Your account is active: sign in with a magic link to manage your catalogue. To receive payments, finish the Stripe activation from your dashboard.',
    '¡Bienvenido! Tu cuenta está activa: inicia sesión con un enlace mágico para gestionar tu catálogo. Para recibir pagos, finaliza la activación de Stripe desde tu panel.',
    "Benvenuto! Il tuo account è attivo: accedi con un link magico per gestire il catalogo. Per ricevere i pagamenti, completa l'attivazione Stripe dal tuo pannello.",
    'مرحبًا! حسابك مُفعّل: سجّل الدخول عبر الرابط السحري لإدارة كتالوجك. لاستلام المدفوعات، أكمل تفعيل Stripe من لوحتك.',
  ],
  successTitleRejected: [
    'Demande non retenue',
    'Application not accepted',
    'Solicitud no aceptada',
    'Richiesta non accettata',
    'لم يتم قبول الطلب',
  ],
  successBodyRejected: [
    "Nous n'avons pas pu valider automatiquement ta demande d'inscription fournisseur. Si tu penses qu'il s'agit d'une erreur, contacte-nous.",
    "We couldn't automatically validate your supplier registration. If you believe this is a mistake, please contact us.",
    'No pudimos validar automáticamente tu registro de proveedor. Si crees que es un error, contáctanos.',
    'Non siamo riusciti a convalidare automaticamente la tua registrazione come fornitore. Se pensi che sia un errore, contattaci.',
    'تعذّر علينا التحقق تلقائيًا من تسجيلك كمورّد. إذا كنت تعتقد أن هذا خطأ، يرجى التواصل معنا.',
  ],
}

const keys = Object.keys(M)
LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.supplier = json.supplier || {}
  for (const k of keys) json.supplier[k] = M[k][i]
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`  ✓ ${loc}.json — supplier auto-onboarding (${keys.length} keys)`)
})
console.log('[add-supplier-vetting-i18n] done.')
