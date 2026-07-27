/* eslint-disable */
// ── Supplier i18n seeder (B2B marketplace Slice 0, Agent 14) ──────────────────
// Idempotent: adds `roleSwitcher.spaceSupplier` + the `supplier` namespace to all
// 5 locale files (fr/en/es/it/ar) so `npm run check:i18n` stays green (key parity).
// Re-running is safe (it just re-sets the same keys). Run: node scripts/add-supplier-i18n.js
const fs = require('fs')
const path = require('path')

const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

// One row per key → its 5 translations. Order: fr, en, es, it, ar.
const T = {
  // roleSwitcher.spaceSupplier (multi-role space label)
  spaceSupplier:          ['Espace fournisseur', 'Supplier space', 'Espacio proveedor', 'Spazio fornitore', 'مساحة المورّد'],

  // ── Landing (/supplier) ──
  landingTitle:           ['Devenez fournisseur Grubano', 'Become a Grubano supplier', 'Conviértete en proveedor Grubano', 'Diventa fornitore Grubano', 'كن مورّدًا لدى غروبانو'],
  landingSubtitle:        ['Approvisionnez les cuisines Grubano. Inscrivez votre entreprise et gérez votre profil fournisseur.', 'Supply Grubano kitchens. Register your business and manage your supplier profile.', 'Abastece las cocinas Grubano. Registra tu empresa y gestiona tu perfil de proveedor.', 'Rifornisci le cucine Grubano. Registra la tua azienda e gestisci il tuo profilo fornitore.', 'زوّد مطابخ غروبانو. سجّل شركتك وأدِر ملف المورّد الخاص بك.'],
  landingBenefit1:        ['Accédez à un réseau de cuisines multi-marques', 'Reach a network of multi-brand kitchens', 'Accede a una red de cocinas multimarca', 'Raggiungi una rete di cucine multimarca', 'تواصل مع شبكة من المطابخ متعددة العلامات'],
  landingBenefit2:        ['Définissez vos zones de livraison et conditions', 'Set your delivery zones and terms', 'Define tus zonas de entrega y condiciones', 'Imposta le tue zone di consegna e le condizioni', 'حدّد مناطق التوصيل والشروط الخاصة بك'],
  landingBenefit3:        ['Gérez votre profil depuis un espace dédié', 'Manage your profile from a dedicated space', 'Gestiona tu perfil desde un espacio dedicado', 'Gestisci il tuo profilo da uno spazio dedicato', 'أدِر ملفك من مساحة مخصصة'],
  registerCta:            ['Inscrire mon entreprise', 'Register my business', 'Registrar mi empresa', 'Registra la mia azienda', 'سجّل شركتي'],
  loginPrompt:            ['Déjà fournisseur ?', 'Already a supplier?', '¿Ya eres proveedor?', 'Sei già fornitore?', 'هل أنت مورّد بالفعل؟'],
  loginCta:               ['Se connecter', 'Sign in', 'Iniciar sesión', 'Accedi', 'تسجيل الدخول'],

  // ── Registration (/supplier/register) ──
  registerTitle:          ['Inscription fournisseur', 'Supplier registration', 'Registro de proveedor', 'Registrazione fornitore', 'تسجيل المورّد'],
  registerSubtitle:       ['Parlez-nous de votre entreprise. Validation sous 48 h.', 'Tell us about your business. Reviewed within 48h.', 'Cuéntanos sobre tu empresa. Validación en 48 h.', 'Parlaci della tua azienda. Verifica entro 48 h.', 'أخبرنا عن شركتك. تتم المراجعة خلال 48 ساعة.'],
  fieldCompanyName:       ['Nom commercial', 'Company name', 'Nombre comercial', 'Nome commerciale', 'الاسم التجاري'],
  fieldContactName:       ['Nom du contact', 'Contact name', 'Nombre de contacto', 'Nome del contatto', 'اسم جهة الاتصال'],
  fieldEmail:             ['Email', 'Email', 'Correo electrónico', 'Email', 'البريد الإلكتروني'],
  fieldPhone:             ['Téléphone', 'Phone', 'Teléfono', 'Telefono', 'الهاتف'],
  fieldCity:              ['Ville', 'City', 'Ciudad', 'Città', 'المدينة'],
  fieldCategories:        ['Catégories de produits', 'Product categories', 'Categorías de productos', 'Categorie di prodotti', 'فئات المنتجات'],
  fieldDeliveryZones:     ['Zones de livraison', 'Delivery zones', 'Zonas de entrega', 'Zone di consegna', 'مناطق التوصيل'],
  fieldDeliveryZonesHint: ['Villes ou codes postaux, séparés par des virgules.', 'Cities or postal codes, comma-separated.', 'Ciudades o códigos postales, separados por comas.', 'Città o codici postali, separati da virgole.', 'مدن أو رموز بريدية، مفصولة بفواصل.'],
  fieldMinimumOrder:      ['Commande minimum (€)', 'Minimum order (€)', 'Pedido mínimo (€)', 'Ordine minimo (€)', 'الحد الأدنى للطلب (€)'],
  fieldLeadTime:          ['Délai de livraison (jours)', 'Lead time (days)', 'Plazo de entrega (días)', 'Tempi di consegna (giorni)', 'مدة التوصيل (أيام)'],
  fieldPaymentTerms:      ['Conditions de paiement', 'Payment terms', 'Condiciones de pago', 'Condizioni di pagamento', 'شروط الدفع'],
  fieldPaymentTermsHint:  ['Ex. paiement à 30 jours, virement, etc.', 'E.g. net 30, bank transfer, etc.', 'Ej. pago a 30 días, transferencia, etc.', 'Es. pagamento a 30 giorni, bonifico, ecc.', 'مثال: الدفع خلال 30 يومًا، تحويل بنكي، إلخ.'],
  consentLabel:           ["J'accepte que Grubano traite ces informations pour étudier ma candidature fournisseur.", 'I agree that Grubano may process this information to review my supplier application.', 'Acepto que Grubano trate esta información para evaluar mi solicitud de proveedor.', 'Accetto che Grubano tratti queste informazioni per esaminare la mia candidatura come fornitore.', 'أوافق على معالجة غروبانو لهذه المعلومات لدراسة طلبي كمورّد.'],
  submit:                 ['Envoyer ma candidature', 'Submit application', 'Enviar solicitud', 'Invia candidatura', 'إرسال الطلب'],
  submitting:             ['Envoi…', 'Submitting…', 'Enviando…', 'Invio…', 'جارٍ الإرسال…'],
  successTitle:           ['Candidature reçue', 'Application received', 'Solicitud recibida', 'Candidatura ricevuta', 'تم استلام الطلب'],
  successBody:            ['Notre équipe validera votre inscription. Vous recevrez un lien de connexion par email une fois votre espace activé.', "Our team will review your registration. You'll get a sign-in link by email once your space is activated.", 'Nuestro equipo validará tu registro. Recibirás un enlace de acceso por correo cuando se active tu espacio.', 'Il nostro team verificherà la tua registrazione. Riceverai un link di accesso via email una volta attivato il tuo spazio.', 'سيراجع فريقنا تسجيلك. ستتلقى رابط تسجيل الدخول عبر البريد الإلكتروني بمجرد تفعيل مساحتك.'],
  backToLogin:            ['Aller à la connexion', 'Go to sign-in', 'Ir a iniciar sesión', "Vai all'accesso", 'الذهاب إلى تسجيل الدخول'],
  errorGeneric:           ['Une erreur est survenue. Réessayez.', 'Something went wrong. Please try again.', 'Algo salió mal. Inténtalo de nuevo.', 'Qualcosa è andato storto. Riprova.', 'حدث خطأ ما. حاول مرة أخرى.'],

  // ── Product categories ──
  catFresh:               ['Produits frais', 'Fresh produce', 'Productos frescos', 'Prodotti freschi', 'منتجات طازجة'],
  catMeat:                ['Viande', 'Meat', 'Carne', 'Carne', 'لحوم'],
  catFish:                ['Poisson', 'Fish', 'Pescado', 'Pesce', 'أسماك'],
  catDairy:               ['Crémerie', 'Dairy', 'Lácteos', 'Latticini', 'ألبان'],
  catDrinks:              ['Boissons', 'Drinks', 'Bebidas', 'Bevande', 'مشروبات'],
  catGrocery:             ['Épicerie', 'Grocery', 'Ultramarinos', 'Drogheria', 'بقالة'],
  catPackaging:           ['Emballages', 'Packaging', 'Embalajes', 'Imballaggi', 'تغليف'],

  // ── Dashboard (/supplier/dashboard) ──
  dashWelcome:            ['Espace fournisseur', 'Supplier space', 'Espacio proveedor', 'Spazio fornitore', 'مساحة المورّد'],
  noProfileTitle:         ['Profil fournisseur introuvable', 'Supplier profile not found', 'Perfil de proveedor no encontrado', 'Profilo fornitore non trovato', 'لم يتم العثور على ملف المورّد'],
  noProfileBody:          ["Aucun profil fournisseur n'est associé à ce compte. Contactez-nous si vous pensez qu'il s'agit d'une erreur.", 'No supplier profile is linked to this account. Contact us if you think this is a mistake.', 'No hay ningún perfil de proveedor vinculado a esta cuenta. Contáctanos si crees que es un error.', 'Nessun profilo fornitore è collegato a questo account. Contattaci se pensi sia un errore.', 'لا يوجد ملف مورّد مرتبط بهذا الحساب. تواصل معنا إذا كنت تعتقد أن هذا خطأ.'],
  statusPendingTitle:     ['Candidature en cours de validation', 'Application under review', 'Solicitud en revisión', 'Candidatura in fase di verifica', 'الطلب قيد المراجعة'],
  statusPendingBody:      ["Votre espace est en lecture seule jusqu'à l'approbation de votre compte.", 'Your space is read-only until your account is approved.', 'Tu espacio es de solo lectura hasta que se apruebe tu cuenta.', "Il tuo spazio è in sola lettura fino all'approvazione del tuo account.", 'مساحتك للقراءة فقط حتى تتم الموافقة على حسابك.'],
  statusPending:          ['En attente', 'Pending', 'Pendiente', 'In attesa', 'قيد الانتظار'],
  statusActive:           ['Actif', 'Active', 'Activo', 'Attivo', 'نشط'],
  statusSuspended:        ['Suspendu', 'Suspended', 'Suspendido', 'Sospeso', 'موقوف'],
  labelCategories:        ['Catégories', 'Categories', 'Categorías', 'Categorie', 'الفئات'],
  labelDeliveryZones:     ['Zones de livraison', 'Delivery zones', 'Zonas de entrega', 'Zone di consegna', 'مناطق التوصيل'],
  labelMinimumOrder:      ['Commande minimum', 'Minimum order', 'Pedido mínimo', 'Ordine minimo', 'الحد الأدنى للطلب'],
  labelLeadTime:          ['Délai de livraison', 'Lead time', 'Plazo de entrega', 'Tempi di consegna', 'مدة التوصيل'],
  labelPaymentTerms:      ['Conditions de paiement', 'Payment terms', 'Condiciones de pago', 'Condizioni di pagamento', 'شروط الدفع'],
  leadTimeValue:          ['{days} jours', '{days} days', '{days} días', '{days} giorni', '{days} يوم'],
  emptyValue:             ['Non renseigné', 'Not provided', 'No indicado', 'Non indicato', 'غير محدد'],
}

// Keys that live under the `supplier` namespace (everything except spaceSupplier).
const SUPPLIER_KEYS = Object.keys(T).filter((k) => k !== 'spaceSupplier')

let changed = 0
LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))

  // 1) roleSwitcher.spaceSupplier
  json.roleSwitcher = json.roleSwitcher || {}
  json.roleSwitcher.spaceSupplier = T.spaceSupplier[i]

  // 2) supplier namespace
  json.supplier = json.supplier || {}
  for (const key of SUPPLIER_KEYS) json.supplier[key] = T[key][i]

  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
  console.log(`  ✓ ${loc}.json — supplier (${SUPPLIER_KEYS.length} keys) + roleSwitcher.spaceSupplier`)
})
console.log(`[add-supplier-i18n] done — ${changed} locale files updated.`)
