// Seed i18n — Carte « Encaissements / Compte Stripe » (Agent 13, contrat A1
// section 6). Namespace connect.* — la carte 4 états de la page établissement
// + le toast de retour d'onboarding sur le dashboard.
//
// Usage: node scripts/seed-connect-card-i18n.js   puis   npm run check:i18n

const fs = require('fs')
const path = require('path')

const KEYS = {
  fr: {
    title:            'Encaissements',
    inviteTitle:      'Configurez vos encaissements',
    inviteDesc:       'Recevez les paiements de vos clients directement sur votre compte, reversements quotidiens.',
    ctaConfigure:     'Configurer',
    ctaResume:        'Reprendre',
    statusPending:    'Onboarding à terminer',
    pendingDesc:      'Finalisez votre dossier pour activer les encaissements.',
    statusActive:     'Compte actif — reversements quotidiens',
    statusRestricted: 'Action requise',
    restrictedDesc:   'Stripe a besoin d’une information complémentaire pour poursuivre les versements.',
    errStart:         'Impossible d’ouvrir la page Stripe — réessayez.',
    toastActivated:   'Encaissements activés ✓',
  },
  en: {
    title:            'Payouts',
    inviteTitle:      'Set up your payouts',
    inviteDesc:       'Receive your customers’ payments directly on your account, with daily payouts.',
    ctaConfigure:     'Set up',
    ctaResume:        'Resume',
    statusPending:    'Onboarding to finish',
    pendingDesc:      'Complete your file to activate payouts.',
    statusActive:     'Account active — daily payouts',
    statusRestricted: 'Action required',
    restrictedDesc:   'Stripe needs an additional piece of information to keep paying you out.',
    errStart:         'Could not open the Stripe page — please retry.',
    toastActivated:   'Payouts activated ✓',
  },
  es: {
    title:            'Cobros',
    inviteTitle:      'Configura tus cobros',
    inviteDesc:       'Recibe los pagos de tus clientes directamente en tu cuenta, con transferencias diarias.',
    ctaConfigure:     'Configurar',
    ctaResume:        'Reanudar',
    statusPending:    'Onboarding por terminar',
    pendingDesc:      'Completa tu expediente para activar los cobros.',
    statusActive:     'Cuenta activa — transferencias diarias',
    statusRestricted: 'Acción requerida',
    restrictedDesc:   'Stripe necesita información adicional para seguir realizando los pagos.',
    errStart:         'No se pudo abrir la página de Stripe — reinténtalo.',
    toastActivated:   'Cobros activados ✓',
  },
  it: {
    title:            'Incassi',
    inviteTitle:      'Configura i tuoi incassi',
    inviteDesc:       'Ricevi i pagamenti dei tuoi clienti direttamente sul tuo conto, con versamenti giornalieri.',
    ctaConfigure:     'Configura',
    ctaResume:        'Riprendi',
    statusPending:    'Onboarding da completare',
    pendingDesc:      'Completa la tua pratica per attivare gli incassi.',
    statusActive:     'Account attivo — versamenti giornalieri',
    statusRestricted: 'Azione richiesta',
    restrictedDesc:   'Stripe ha bisogno di un’informazione aggiuntiva per continuare i versamenti.',
    errStart:         'Impossibile aprire la pagina Stripe — riprova.',
    toastActivated:   'Incassi attivati ✓',
  },
  ar: {
    title:            'التحصيلات',
    inviteTitle:      'أعدّ تحصيلاتك',
    inviteDesc:       'استلم مدفوعات عملائك مباشرة في حسابك، مع تحويلات يومية.',
    ctaConfigure:     'إعداد',
    ctaResume:        'استئناف',
    statusPending:    'إجراءات يجب إكمالها',
    pendingDesc:      'أكمل ملفك لتفعيل التحصيلات.',
    statusActive:     'الحساب نشط — تحويلات يومية',
    statusRestricted: 'إجراء مطلوب',
    restrictedDesc:   'يحتاج Stripe إلى معلومة إضافية لمواصلة التحويلات.',
    errStart:         'تعذّر فتح صفحة Stripe — أعد المحاولة.',
    toastActivated:   'تم تفعيل التحصيلات ✓',
  },
}

for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!m.connect || typeof m.connect !== 'object') m.connect = {}
  Object.assign(m.connect, KEYS[loc])
  fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`[seed-connect-card-i18n] ${loc}.json OK`)
}
console.log('[seed-connect-card-i18n] Done — run: npm run check:i18n')
