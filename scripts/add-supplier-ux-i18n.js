/* eslint-disable */
// ── Supplier onboarding UX-pass i18n seeder (Agent 14) ────────────────────────
// Presentation-only pass: rewords supplier copy (no more "48 h"/human review, FR
// addressed as "vous"), adds SIREN field hint/error + empty-state + CTAs, and adds
// a NEW `magic` namespace so the passwordless login page is fully i18n'd (x5).
// Idempotent. Run: node scripts/add-supplier-ux-i18n.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

// ── supplier namespace (reworded + new keys) ──────────────────────────────────
const SUP = {
  registerSubtitle: [
    "Vérification instantanée de votre entreprise via le registre officiel.",
    'Instant verification of your business via the official registry.',
    'Verificación instantánea de tu empresa mediante el registro oficial.',
    'Verifica istantanea della tua azienda tramite il registro ufficiale.',
    'تحقق فوري من شركتك عبر السجل الرسمي.',
  ],
  submit: [
    'Vérifier et créer mon espace', 'Verify and create my account',
    'Verificar y crear mi cuenta', 'Verifica e crea il mio spazio', 'تحقّق وأنشئ حسابي',
  ],
  submitting: [
    'Vérification en cours…', 'Verifying…', 'Verificando…', 'Verifica in corso…', 'جارٍ التحقق…',
  ],
  fieldSiren: [
    "SIREN ou SIRET de votre entreprise", 'Your business SIREN or SIRET',
    'SIREN o SIRET de tu empresa', 'SIREN o SIRET della tua azienda', 'رقم SIREN أو SIRET لشركتك',
  ],
  fieldSirenHint: [
    "Votre numéro officiel : SIREN (9 chiffres) ou SIRET (14). Vérification officielle et gratuite.",
    'Your official number: SIREN (9 digits) or SIRET (14). Official, free verification.',
    'Tu número oficial: SIREN (9 dígitos) o SIRET (14). Verificación oficial y gratuita.',
    'Il tuo numero ufficiale: SIREN (9 cifre) o SIRET (14). Verifica ufficiale e gratuita.',
    'رقمك الرسمي: SIREN (9 أرقام) أو SIRET (14). تحقق رسمي ومجاني.',
  ],
  fieldSirenError: [
    'Entrez un SIREN (9 chiffres) ou un SIRET (14 chiffres).',
    'Enter a SIREN (9 digits) or a SIRET (14 digits).',
    'Introduce un SIREN (9 dígitos) o un SIRET (14 dígitos).',
    'Inserisci un SIREN (9 cifre) o un SIRET (14 cifre).',
    'أدخل SIREN (9 أرقام) أو SIRET (14 رقمًا).',
  ],
  successTitleActive: [
    'Votre entreprise est vérifiée ✅', 'Your business is verified ✅',
    'Tu empresa está verificada ✅', 'La tua azienda è verificata ✅', 'تم التحقق من شركتك ✅',
  ],
  successBodyActive: [
    "Votre espace fournisseur est activé. Connectez-vous via le lien envoyé à votre email pour gérer votre catalogue. Pour encaisser les paiements, finalisez l'activation Stripe depuis votre espace.",
    'Your supplier account is active. Sign in via the link sent to your email to manage your catalogue. To receive payments, finish the Stripe activation from your dashboard.',
    'Tu cuenta de proveedor está activa. Inicia sesión con el enlace enviado a tu email para gestionar tu catálogo. Para recibir pagos, finaliza la activación de Stripe desde tu panel.',
    "Il tuo account fornitore è attivo. Accedi tramite il link inviato alla tua email per gestire il catalogo. Per ricevere i pagamenti, completa l'attivazione Stripe dal tuo pannello.",
    'حساب المورّد مُفعّل. سجّل الدخول عبر الرابط المُرسل إلى بريدك لإدارة كتالوجك. لاستلام المدفوعات، أكمل تفعيل Stripe من لوحتك.',
  ],
  successCtaActive: [
    'Accéder à mon espace', 'Go to my account', 'Ir a mi cuenta', 'Vai al mio spazio', 'الذهاب إلى حسابي',
  ],
  successTitle: [
    'Vérification en cours', 'Verification in progress', 'Verificación en curso', 'Verifica in corso', 'جارٍ التحقق',
  ],
  successBody: [
    "Nous finalisons la vérification de votre entreprise auprès du registre officiel. Vous recevrez un accès dès validation.",
    'We are finalising your business verification with the official registry. You will get access as soon as it is confirmed.',
    'Estamos finalizando la verificación de tu empresa en el registro oficial. Tendrás acceso en cuanto se confirme.',
    "Stiamo completando la verifica della tua azienda nel registro ufficiale. Riceverai l'accesso non appena confermata.",
    'نُنهي التحقق من شركتك لدى السجل الرسمي. ستحصل على الوصول بمجرد التأكيد.',
  ],
  successTitleRejected: [
    'Demande non retenue', 'Application not accepted', 'Solicitud no aceptada', 'Richiesta non accettata', 'لم يتم قبول الطلب',
  ],
  successBodyRejected: [
    "Nous n'avons pas pu vérifier votre entreprise automatiquement. Vérifiez votre SIREN/SIRET et réessayez, ou contactez-nous si vous pensez qu'il s'agit d'une erreur.",
    "We couldn't verify your business automatically. Check your SIREN/SIRET and try again, or contact us if you think this is a mistake.",
    'No pudimos verificar tu empresa automáticamente. Revisa tu SIREN/SIRET e inténtalo de nuevo, o contáctanos si crees que es un error.',
    'Non siamo riusciti a verificare la tua azienda automaticamente. Controlla il tuo SIREN/SIRET e riprova, oppure contattaci se pensi sia un errore.',
    'تعذّر التحقق من شركتك تلقائيًا. تحقق من رقم SIREN/SIRET وأعد المحاولة، أو تواصل معنا إذا كنت تعتقد أن هذا خطأ.',
  ],
  statusPendingTitle: [
    'Vérification en cours', 'Verification in progress', 'Verificación en curso', 'Verifica in corso', 'جارٍ التحقق',
  ],
  statusPendingBody: [
    "Nous finalisons la vérification de votre entreprise. Votre catalogue sera visible des restaurants dès validation.",
    'We are finalising your business verification. Your catalogue will be visible to restaurants once confirmed.',
    'Estamos finalizando la verificación de tu empresa. Tu catálogo será visible para los restaurantes en cuanto se confirme.',
    'Stiamo completando la verifica della tua azienda. Il tuo catalogo sarà visibile ai ristoranti una volta confermata.',
    'نُنهي التحقق من شركتك. سيظهر كتالوجك للمطاعم بمجرد التأكيد.',
  ],
  catalogEmptyTitle: [
    'Ajoutez votre premier produit', 'Add your first product', 'Añade tu primer producto', 'Aggiungi il tuo primo prodotto', 'أضف منتجك الأول',
  ],
  catalogEmptyDesc: [
    "Votre catalogue est vide. Ajoutez un produit, ou importez-les en masse via un fichier CSV.",
    'Your catalogue is empty. Add a product, or bulk-import them with a CSV file.',
    'Tu catálogo está vacío. Añade un producto o impórtalos en masa con un archivo CSV.',
    'Il tuo catalogo è vuoto. Aggiungi un prodotto o importali in blocco con un file CSV.',
    'كتالوجك فارغ. أضف منتجًا، أو استورد المنتجات دفعة واحدة عبر ملف CSV.',
  ],
  addFirstProduct: [
    'Ajouter mon premier produit', 'Add my first product', 'Añadir mi primer producto', 'Aggiungi il mio primo prodotto', 'أضف منتجي الأول',
  ],
}

// ── magic namespace (NEW) — passwordless login page ───────────────────────────
const MAGIC = {
  title: ['Connexion à Grubano', 'Sign in to Grubano', 'Conectarse a Grubano', 'Accedi a Grubano', 'تسجيل الدخول إلى Grubano'],
  subtitle: [
    'Connectez-vous sans mot de passe grâce à un lien envoyé par email.',
    'Sign in without a password via a link sent to your email.',
    'Inicia sesión sin contraseña mediante un enlace enviado a tu email.',
    'Accedi senza password tramite un link inviato via email.',
    'سجّل الدخول بدون كلمة مرور عبر رابط يُرسل إلى بريدك.',
  ],
  verifying: ['Connexion en cours…', 'Signing you in…', 'Iniciando sesión…', 'Accesso in corso…', 'جارٍ تسجيل الدخول…'],
  sentTitle: ['Vérifiez votre boîte mail', 'Check your inbox', 'Revisa tu correo', 'Controlla la tua email', 'تحقق من بريدك'],
  sentBody: [
    "Si un compte existe pour cet email, un lien de connexion vient d'être envoyé. Il expire dans 15 minutes.",
    'If an account exists for this email, a sign-in link has just been sent. It expires in 15 minutes.',
    'Si existe una cuenta para este email, acabamos de enviar un enlace de acceso. Caduca en 15 minutos.',
    'Se esiste un account per questa email, abbiamo appena inviato un link di accesso. Scade tra 15 minuti.',
    'إذا كان هناك حساب لهذا البريد، فقد أُرسل للتو رابط دخول. ينتهي خلال 15 دقيقة.',
  ],
  errorMsg: [
    'Ce lien est invalide ou expiré. Demandez-en un nouveau ci-dessous.',
    'This link is invalid or expired. Request a new one below.',
    'Este enlace no es válido o ha caducado. Solicita uno nuevo abajo.',
    'Questo link non è valido o è scaduto. Richiedine uno nuovo qui sotto.',
    'هذا الرابط غير صالح أو منتهي الصلاحية. اطلب رابطًا جديدًا أدناه.',
  ],
  emailLabel: ['Email professionnel', 'Work email', 'Email profesional', 'Email aziendale', 'البريد المهني'],
  emailPlaceholder: ['vous@entreprise.fr', 'you@company.com', 'tu@empresa.com', 'tu@azienda.it', 'you@company.com'],
  submit: [
    'Recevoir mon lien de connexion', 'Send my sign-in link', 'Recibir mi enlace de acceso',
    'Ricevi il mio link di accesso', 'إرسال رابط الدخول',
  ],
  submitting: ['Envoi…', 'Sending…', 'Enviando…', 'Invio…', 'جارٍ الإرسال…'],
  hint: [
    'Vous recevrez un lien à usage unique, valable 15 minutes.',
    "You'll get a single-use link, valid for 15 minutes.",
    'Recibirás un enlace de un solo uso, válido 15 minutos.',
    'Riceverai un link monouso, valido 15 minuti.',
    'ستتلقى رابطًا للاستخدام مرة واحدة، صالحًا لمدة 15 دقيقة.',
  ],
  registerPrompt: ['Pas encore inscrit ?', 'Not registered yet?', '¿Aún no te has registrado?', 'Non sei ancora registrato?', 'لم تسجّل بعد؟'],
  registerCta: ['Inscrire mon entreprise', 'Register my business', 'Registrar mi empresa', 'Registra la mia azienda', 'سجّل شركتي'],
}

LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.supplier = json.supplier || {}
  for (const k of Object.keys(SUP)) json.supplier[k] = SUP[k][i]
  json.magic = json.magic || {}
  for (const k of Object.keys(MAGIC)) json.magic[k] = MAGIC[k][i]
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`  ✓ ${loc}.json — supplier UX (${Object.keys(SUP).length}) + magic (${Object.keys(MAGIC).length})`)
})
console.log('[add-supplier-ux-i18n] done.')
