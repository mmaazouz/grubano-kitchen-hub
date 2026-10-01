/**
 * B1.3-C i18n seeder (Agent 32) — "add an activity" hub + nav entry.
 *
 * Adds the `addActivity` namespace (hub copy + per-activity cards) and one key
 * `roleSwitcher.addActivity` (the nav entry label). Idempotent: only fills missing
 * leaf keys, never overwrites. FR vouvoiement; es/it informal; ar RTL.
 * Run: node scripts/b13c-add-activity-i18n.js
 */
const fs = require('fs')
const path = require('path')

const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

const T = {
  'roleSwitcher.addActivity': {
    fr: 'Ajouter une activité', en: 'Add an activity', es: 'Añadir una actividad',
    it: 'Aggiungi un’attività', ar: 'إضافة نشاط',
  },
  'addActivity.title': {
    fr: 'Ajouter une activité', en: 'Add an activity', es: 'Añadir una actividad',
    it: 'Aggiungi un’attività', ar: 'إضافة نشاط',
  },
  'addActivity.subtitle': {
    fr: 'Développez votre compte Grubano. Vos informations vérifiées sont réutilisées — vous ne les saisissez qu’une fois.',
    en: 'Grow your Grubano account. Your verified details are reused — entered only once.',
    es: 'Haz crecer tu cuenta de Grubano. Reutilizamos tus datos verificados: los introduces una sola vez.',
    it: 'Fai crescere il tuo account Grubano. I tuoi dati verificati vengono riutilizzati: li inserisci una sola volta.',
    ar: 'طوّر حسابك في Grubano. تُعاد تعبئة بياناتك المُوثّقة — تُدخلها مرة واحدة فقط.',
  },
  'addActivity.empty': {
    fr: 'Vous avez déjà toutes les activités disponibles.',
    en: 'You already have every available activity.',
    es: 'Ya tienes todas las actividades disponibles.',
    it: 'Hai già tutte le attività disponibili.',
    ar: 'لديك بالفعل جميع الأنشطة المتاحة.',
  },
  'addActivity.prefillNote': {
    fr: 'Pré-rempli depuis votre compte — modifiable.',
    en: 'Prefilled from your account — editable.',
    es: 'Rellenado desde tu cuenta: editable.',
    it: 'Precompilato dal tuo account: modificabile.',
    ar: 'مملوء مسبقًا من حسابك — قابل للتعديل.',
  },
  'addActivity.emailLocked': {
    fr: 'Cette activité sera rattachée à votre compte connecté.',
    en: 'This activity will be linked to your connected account.',
    es: 'Esta actividad se vinculará a tu cuenta conectada.',
    it: 'Questa attività sarà collegata al tuo account connesso.',
    ar: 'سيتم ربط هذا النشاط بحسابك المتصل.',
  },
  'addActivity.start':            { fr: 'Commencer', en: 'Get started', es: 'Empezar', it: 'Inizia', ar: 'ابدأ' },
  'addActivity.apply':            { fr: 'Déposer une candidature', en: 'Apply', es: 'Enviar candidatura', it: 'Invia candidatura', ar: 'تقديم طلب' },
  'addActivity.candidatureBadge': { fr: 'Sur candidature', en: 'By application', es: 'Por candidatura', it: 'Su candidatura', ar: 'بموجب طلب' },

  'addActivity.supplierTitle': { fr: 'Fournisseur', en: 'Supplier', es: 'Proveedor', it: 'Fornitore', ar: 'مورّد' },
  'addActivity.supplierDesc': {
    fr: 'Vendez vos produits aux restaurants sur la marketplace B2B.',
    en: 'Sell your products to restaurants on the B2B marketplace.',
    es: 'Vende tus productos a los restaurantes en el marketplace B2B.',
    it: 'Vendi i tuoi prodotti ai ristoranti sul marketplace B2B.',
    ar: 'بِع منتجاتك للمطاعم عبر سوق B2B.',
  },
  'addActivity.creatorTitle': { fr: 'Créateur', en: 'Creator', es: 'Creador', it: 'Creator', ar: 'صانع محتوى' },
  'addActivity.creatorDesc': {
    fr: 'Proposez vos recettes ou faites la promotion des établissements.',
    en: 'Offer your recipes or promote establishments.',
    es: 'Ofrece tus recetas o promociona establecimientos.',
    it: 'Proponi le tue ricette o promuovi i locali.',
    ar: 'قدّم وصفاتك أو روّج للمنشآت.',
  },
  'addActivity.logisticsTitle': { fr: 'Logistique', en: 'Logistics', es: 'Logística', it: 'Logistica', ar: 'الخدمات اللوجستية' },
  'addActivity.logisticsDesc': {
    fr: 'Effectuez des livraisons pour les restaurants et les fournisseurs.',
    en: 'Run deliveries for restaurants and suppliers.',
    es: 'Realiza entregas para restaurantes y proveedores.',
    it: 'Effettua consegne per ristoranti e fornitori.',
    ar: 'نفّذ عمليات التوصيل للمطاعم والموردين.',
  },
  'addActivity.franchiseTitle': { fr: 'Franchise', en: 'Franchise', es: 'Franquicia', it: 'Franchising', ar: 'امتياز تجاري' },
  'addActivity.franchiseDesc': {
    fr: 'Ouvrez un point de vente sous l’une de nos marques (sur candidature).',
    en: 'Open an outlet under one of our brands (by application).',
    es: 'Abre un punto de venta con una de nuestras marcas (por candidatura).',
    it: 'Apri un punto vendita con uno dei nostri marchi (su candidatura).',
    ar: 'افتح نقطة بيع تحت إحدى علاماتنا (بموجب طلب).',
  },
}

function setDeep(obj, dotted, value) {
  const parts = dotted.split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {}
    cur = cur[parts[i]]
  }
  const leaf = parts[parts.length - 1]
  if (!(leaf in cur)) cur[leaf] = value
}

for (const locale of LOCALES) {
  const file = path.join(__dirname, '..', 'messages', `${locale}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  let added = 0
  for (const [dotted, byLocale] of Object.entries(T)) {
    const before = JSON.stringify(json)
    setDeep(json, dotted, byLocale[locale])
    if (JSON.stringify(json) !== before) added++
  }
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`[b13c-i18n] ${locale}.json — +${added} key(s)`)
}
console.log('[b13c-i18n] done.')
