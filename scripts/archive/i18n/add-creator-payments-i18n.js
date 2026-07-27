/* eslint-disable */
// ── Agent 40 — creator payments UI i18n (P4-UI) ──────────────────────────────
// Adds creators.payments.* : the Connect onboarding card + balance card + payout
// history shown in the creator "Mes gains" page (gated by CREATOR_CONNECT_ENABLED).
// x5 locales, strict parity, idempotent. FR vouvoiement; es/it/en natural; ar RTL.
// Run: node scripts/add-creator-payments-i18n.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

// creators.payments.* — [fr, en, es, it, ar]
const P = {
  sectionTitle: ['Paiements', 'Payments', 'Pagos', 'Pagamenti', 'المدفوعات'],
  errLoad: [
    'Impossible de charger vos informations de paiement.',
    'Could not load your payment information.',
    'No se pudo cargar tu información de pago.',
    'Impossibile caricare le tue informazioni di pagamento.',
    'تعذّر تحميل معلومات الدفع الخاصة بك.',
  ],

  // ── Connect (payout account) card ──
  connectTitle: ['Compte de versement', 'Payout account', 'Cuenta de pagos', 'Account per i versamenti', 'حساب الدفع'],
  connectSubtitle: [
    'Configurez votre compte pour recevoir vos versements.',
    'Set up your account to receive your payouts.',
    'Configura tu cuenta para recibir tus pagos.',
    'Configura il tuo account per ricevere i versamenti.',
    'أعدّ حسابك لتلقّي مدفوعاتك.',
  ],
  connectStart: ['Configurer mes versements', 'Set up payouts', 'Configurar pagos', 'Configura i versamenti', 'إعداد المدفوعات'],
  connectContinue: ['Continuer la configuration', 'Continue setup', 'Continuar configuración', 'Continua la configurazione', 'متابعة الإعداد'],
  connectGated: [
    'Les versements ne sont pas encore ouverts. Cette option sera bientôt disponible.',
    'Payouts are not open yet. This option will be available soon.',
    'Los pagos aún no están disponibles. Esta opción estará disponible pronto.',
    'I versamenti non sono ancora attivi. L’opzione sarà presto disponibile.',
    'لم تُفتح المدفوعات بعد. سيتوفّر هذا الخيار قريبًا.',
  ],
  connectError: [
    'La configuration a échoué. Réessayez.',
    'Setup failed. Please try again.',
    'La configuración falló. Inténtalo de nuevo.',
    'Configurazione non riuscita. Riprova.',
    'فشل الإعداد. حاول مرة أخرى.',
  ],
  payoutNone: ['Non configuré', 'Not set up', 'Sin configurar', 'Non configurato', 'غير مُعدّ'],
  payoutPending: ['En attente', 'Pending', 'Pendiente', 'In attesa', 'قيد الانتظار'],
  payoutActive: ['Actif', 'Active', 'Activo', 'Attivo', 'نشط'],
  payoutRestricted: ['Action requise', 'Action required', 'Acción requerida', 'Azione richiesta', 'مطلوب إجراء'],

  // ── Balance card ──
  balanceTitle: ['Votre solde', 'Your balance', 'Tu saldo', 'Il tuo saldo', 'رصيدك'],
  earned: ['Gagné', 'Earned', 'Ganado', 'Guadagnato', 'المكتسب'],
  paidOut: ['Versé', 'Paid out', 'Pagado', 'Versato', 'المدفوع'],
  available: ['Disponible', 'Available', 'Disponible', 'Disponibile', 'المتاح'],
  maturationHint: [
    'Vos gains deviennent disponibles après une période de maturation (7 jours après la commande). Les versements sont effectués automatiquement.',
    'Your earnings become available after a maturation period (7 days after the order). Payouts are made automatically.',
    'Tus ganancias quedan disponibles tras un período de maduración (7 días después del pedido). Los pagos se realizan automáticamente.',
    'I tuoi guadagni diventano disponibili dopo un periodo di maturazione (7 giorni dopo l’ordine). I versamenti avvengono automaticamente.',
    'تصبح أرباحك متاحة بعد فترة استحقاق (7 أيام بعد الطلب). تُنفَّذ المدفوعات تلقائيًّا.',
  ],

  // ── Payout history ──
  historyTitle: ['Historique des versements', 'Payout history', 'Historial de pagos', 'Storico dei versamenti', 'سجل المدفوعات'],
  historyEmpty: [
    'Aucun versement pour le moment.',
    'No payouts yet.',
    'Aún no hay pagos.',
    'Nessun versamento per ora.',
    'لا توجد مدفوعات حتى الآن.',
  ],
  poStatusPending: ['En cours', 'In progress', 'En curso', 'In corso', 'قيد التنفيذ'],
  poStatusPaid: ['Versé', 'Paid', 'Pagado', 'Versato', 'مدفوع'],
  poStatusFailed: ['Échec', 'Failed', 'Fallido', 'Non riuscito', 'فشل'],
}

LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.creators = json.creators || {}
  json.creators.payments = json.creators.payments || {}
  for (const k of Object.keys(P)) json.creators.payments[k] = P[k][i]
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`  ✓ ${loc}.json — creators.payments (+${Object.keys(P).length})`)
})
console.log('[add-creator-payments-i18n] done.')
