/**
 * B1.2 i18n seeder (Agent 28) — activation checklist + discovery banner.
 *
 * Adds ONE new top-level namespace `activation` to each locale file, used by the
 * restaurateur dashboard activation checklist + discovery banner. Idempotent:
 * re-running only fills missing leaf keys, never overwrites existing ones, and
 * never touches other namespaces. Tone: FR vouvoiement; es/it informal; ar RTL.
 *
 * Run: node scripts/b12-activation-i18n.js
 */
const fs = require('fs')
const path = require('path')

const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

// Flat map: dotted sub-key under `activation` → translation per locale.
// Keeping it flat guarantees PERFECT parity across the 5 files (same leaf set).
const T = {
  'banner.title': {
    fr: 'Bienvenue sur Grubano', en: 'Welcome to Grubano', es: 'Bienvenido a Grubano',
    it: 'Benvenuto su Grubano', ar: 'مرحبًا بك في Grubano',
  },
  'banner.subtitle': {
    fr: "Voici les étapes pour mettre votre établissement en ligne. Avancez à votre rythme — chaque information vous est demandée au bon moment.",
    en: 'Here are the steps to get your establishment online. Go at your own pace — each detail is asked for only when it is needed.',
    es: 'Estos son los pasos para poner tu establecimiento en línea. Ve a tu ritmo: te pedimos cada dato solo cuando hace falta.',
    it: 'Ecco i passaggi per mettere online il tuo locale. Vai al tuo ritmo: ogni informazione ti viene chiesta solo quando serve.',
    ar: 'إليك خطوات نشر منشأتك على الإنترنت. تقدّم بالوتيرة التي تناسبك — تُطلب كل معلومة عند الحاجة إليها فقط.',
  },
  'title': {
    fr: 'Votre activation', en: 'Your activation', es: 'Tu activación',
    it: 'La tua attivazione', ar: 'تفعيل حسابك',
  },
  'progress': {
    fr: '{done} étape(s) sur {total} terminée(s)', en: '{done} of {total} steps done',
    es: '{done} de {total} pasos completados', it: '{done} di {total} passaggi completati',
    ar: '{done} من {total} خطوات مكتملة',
  },
  'activeTitle': {
    fr: 'Votre établissement est actif', en: 'Your establishment is live',
    es: 'Tu establecimiento está activo', it: 'Il tuo locale è attivo',
    ar: 'منشأتك نشطة الآن',
  },
  'activeSubtitle': {
    fr: 'Toutes les étapes sont terminées. Vous êtes visible sur Grubano.',
    en: 'Every step is done. You are visible on Grubano.',
    es: 'Todos los pasos están completados. Ya eres visible en Grubano.',
    it: 'Tutti i passaggi sono completati. Sei visibile su Grubano.',
    ar: 'اكتملت جميع الخطوات. أصبحت ظاهرًا على Grubano.',
  },
  'loadError': {
    fr: 'Impossible de charger votre progression. Réessayez plus tard.',
    en: 'We could not load your progress. Please try again later.',
    es: 'No pudimos cargar tu progreso. Inténtalo de nuevo más tarde.',
    it: 'Non è stato possibile caricare i tuoi progressi. Riprova più tardi.',
    ar: 'تعذّر تحميل تقدّمك. حاول مرة أخرى لاحقًا.',
  },
  'status.done':    { fr: 'Terminé',   en: 'Done',        es: 'Completado', it: 'Completato', ar: 'مكتمل' },
  'status.current': { fr: 'En cours',  en: 'In progress', es: 'En curso',   it: 'In corso',   ar: 'قيد التنفيذ' },
  'status.todo':    { fr: 'À faire',   en: 'To do',       es: 'Pendiente',  it: 'Da fare',    ar: 'قيد الانتظار' },
  'status.locked':  { fr: 'Verrouillé', en: 'Locked',     es: 'Bloqueado',  it: 'Bloccato',   ar: 'مقفل' },

  'steps.account.title': {
    fr: 'Compte créé', en: 'Account created', es: 'Cuenta creada', it: 'Account creato', ar: 'تم إنشاء الحساب',
  },
  'steps.account.desc': {
    fr: 'Votre adresse e-mail est vérifiée et vous êtes connecté.',
    en: 'Your email is verified and you are signed in.',
    es: 'Tu correo está verificado y has iniciado sesión.',
    it: "La tua email è verificata e hai effettuato l'accesso.",
    ar: 'تم التحقق من بريدك الإلكتروني وأنت مسجّل الدخول.',
  },
  'steps.establishment.title': {
    fr: 'Créer votre établissement', en: 'Create your establishment', es: 'Crea tu establecimiento',
    it: 'Crea il tuo locale', ar: 'أنشئ منشأتك',
  },
  'steps.establishment.desc': {
    fr: 'Renseignez votre marque et votre établissement (nom, adresse, cuisine).',
    en: 'Set up your brand and establishment (name, address, cuisine).',
    es: 'Configura tu marca y tu establecimiento (nombre, dirección, cocina).',
    it: 'Imposta il tuo brand e il tuo locale (nome, indirizzo, cucina).',
    ar: 'أعدّ علامتك التجارية ومنشأتك (الاسم، العنوان، نوع المطبخ).',
  },
  'steps.establishment.cta': {
    fr: 'Compléter mon établissement', en: 'Complete my establishment', es: 'Completar mi establecimiento',
    it: 'Completa il mio locale', ar: 'أكمل منشأتي',
  },
  'steps.menu.title': {
    fr: 'Composer votre menu', en: 'Build your menu', es: 'Crea tu menú', it: 'Crea il tuo menu', ar: 'أنشئ قائمتك',
  },
  'steps.menu.desc': {
    fr: 'Ajoutez au moins un plat pour pouvoir passer en ligne.',
    en: 'Add at least one dish so you can go live.',
    es: 'Añade al menos un plato para poder publicarte.',
    it: 'Aggiungi almeno un piatto per poter andare online.',
    ar: 'أضف طبقًا واحدًا على الأقل لتتمكن من النشر.',
  },
  'steps.menu.cta': {
    fr: 'Ajouter un plat', en: 'Add a dish', es: 'Añadir un plato', it: 'Aggiungi un piatto', ar: 'أضف طبقًا',
  },
  'steps.publish.title': {
    fr: 'Mise en ligne', en: 'Go live', es: 'Publicación', it: 'Pubblicazione', ar: 'النشر',
  },
  'steps.publish.descOnline': {
    fr: 'Votre établissement est en ligne et visible des clients.',
    en: 'Your establishment is live and visible to customers.',
    es: 'Tu establecimiento está en línea y visible para los clientes.',
    it: 'Il tuo locale è online e visibile ai clienti.',
    ar: 'منشأتك على الإنترنت وظاهرة للعملاء.',
  },
  'steps.publish.descAwaiting': {
    fr: "Votre établissement est complet. L'équipe Grubano le validera avant sa mise en ligne.",
    en: 'Your establishment is complete. The Grubano team will validate it before it goes live.',
    es: 'Tu establecimiento está completo. El equipo de Grubano lo validará antes de publicarlo.',
    it: 'Il tuo locale è completo. Il team Grubano lo convaliderà prima della pubblicazione.',
    ar: 'منشأتك مكتملة. سيتحقق منها فريق Grubano قبل نشرها.',
  },
  'steps.publish.descLocked': {
    fr: 'Terminez votre menu avant la mise en ligne.',
    en: 'Finish your menu before going live.',
    es: 'Termina tu menú antes de publicarte.',
    it: 'Completa il tuo menu prima della pubblicazione.',
    ar: 'أكمل قائمتك قبل النشر.',
  },
  'steps.payments.title': {
    fr: 'Activer les paiements', en: 'Enable payments', es: 'Activar los pagos',
    it: 'Attiva i pagamenti', ar: 'تفعيل المدفوعات',
  },
  'steps.payments.desc': {
    fr: 'Connectez votre compte Stripe pour encaisser les commandes en ligne.',
    en: 'Connect your Stripe account to collect online orders.',
    es: 'Conecta tu cuenta de Stripe para cobrar los pedidos en línea.',
    it: 'Collega il tuo account Stripe per incassare gli ordini online.',
    ar: 'اربط حساب Stripe الخاص بك لتحصيل الطلبات عبر الإنترنت.',
  },
  'steps.payments.cta': {
    fr: 'Configurer les paiements', en: 'Set up payments', es: 'Configurar los pagos',
    it: 'Configura i pagamenti', ar: 'إعداد المدفوعات',
  },
  'steps.payouts.title': {
    fr: 'Recevoir vos virements', en: 'Receive your payouts', es: 'Recibe tus transferencias',
    it: 'Ricevi i tuoi versamenti', ar: 'استلام تحويلاتك',
  },
  'steps.payouts.descActive': {
    fr: 'Vos virements sont activés : Stripe vous reverse automatiquement vos recettes.',
    en: 'Your payouts are enabled: Stripe automatically transfers your earnings.',
    es: 'Tus transferencias están activadas: Stripe te abona automáticamente tus ingresos.',
    it: 'I tuoi versamenti sono attivi: Stripe ti trasferisce automaticamente i ricavi.',
    ar: 'تم تفعيل تحويلاتك: يقوم Stripe بتحويل أرباحك تلقائيًا.',
  },
  'steps.payouts.descLocked': {
    fr: "Activez d'abord les paiements pour recevoir vos virements.",
    en: 'Enable payments first to receive your payouts.',
    es: 'Activa primero los pagos para recibir tus transferencias.',
    it: 'Attiva prima i pagamenti per ricevere i tuoi versamenti.',
    ar: 'فعّل المدفوعات أولًا لاستلام تحويلاتك.',
  },
  'blocked.needEstablishment': {
    fr: "Créez d'abord votre établissement.", en: 'Create your establishment first.',
    es: 'Crea primero tu establecimiento.', it: 'Crea prima il tuo locale.', ar: 'أنشئ منشأتك أولًا.',
  },
  'blocked.awaitingApproval': {
    fr: "En attente de validation par l'équipe Grubano.",
    en: 'Awaiting validation by the Grubano team.',
    es: 'A la espera de la validación del equipo de Grubano.',
    it: 'In attesa di convalida da parte del team Grubano.',
    ar: 'بانتظار الموافقة من فريق Grubano.',
  },
  'blocked.completeMenuFirst': {
    fr: 'Terminez votre menu pour débloquer cette étape.',
    en: 'Finish your menu to unlock this step.',
    es: 'Termina tu menú para desbloquear este paso.',
    it: 'Completa il tuo menu per sbloccare questo passaggio.',
    ar: 'أكمل قائمتك لإلغاء قفل هذه الخطوة.',
  },
  'blocked.activatePaymentsFirst': {
    fr: 'Activez les paiements pour débloquer cette étape.',
    en: 'Enable payments to unlock this step.',
    es: 'Activa los pagos para desbloquear este paso.',
    it: 'Attiva i pagamenti per sbloccare questo passaggio.',
    ar: 'فعّل المدفوعات لإلغاء قفل هذه الخطوة.',
  },
}

/** Set obj at a dotted path, creating intermediate objects. Never overwrites a leaf. */
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
  json.activation = json.activation || {}
  let added = 0
  for (const [subkey, byLocale] of Object.entries(T)) {
    const before = JSON.stringify(json.activation)
    setDeep(json.activation, subkey, byLocale[locale])
    if (JSON.stringify(json.activation) !== before) added++
  }
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`[b12-i18n] ${locale}.json — activation: ${added} leaf(s) ensured`)
}
console.log('[b12-i18n] done.')
