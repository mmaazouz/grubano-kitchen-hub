/* eslint-disable */
// ── Logistics / courier onboarding i18n (Slice 1, Agent 15) ───────────────────
// Seeds the `business.logistics.*` namespace for the self-serve courier registration
// (/business/logistics/register). Vouvoiement, x5 locales, idempotent.
// Run: node scripts/add-logistics-i18n.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

const L = {
  // Header
  registerTitle: ['Devenir partenaire logistique', 'Become a logistics partner', 'Conviértete en socio logístico', 'Diventa partner logistico', 'كن شريكًا لوجستيًا'],
  registerSubtitle: [
    'Vérification instantanée de votre entreprise via le registre officiel.',
    'Instant verification of your business via the official registry.',
    'Verificación instantánea de tu empresa mediante el registro oficial.',
    'Verifica istantanea della tua azienda tramite il registro ufficiale.',
    'تحقق فوري من شركتك عبر السجل الرسمي.',
  ],
  // Partner type
  fieldPartnerType: ['Votre statut', 'Your status', 'Tu estatus', 'Il tuo stato', 'وضعك'],
  partnerTypeIndependent: ['Indépendant / auto-entrepreneur', 'Independent / sole trader', 'Autónomo / independiente', 'Indipendente / lavoratore autonomo', 'مستقل / صاحب عمل فردي'],
  partnerTypeCompany: ['Société', 'Company', 'Empresa', 'Società', 'شركة'],
  // SIREN
  fieldSiren: ['SIREN ou SIRET de votre entreprise', 'Your company SIREN or SIRET', 'SIREN o SIRET de tu empresa', 'SIREN o SIRET della tua azienda', 'رقم SIREN أو SIRET لشركتك'],
  fieldSirenHint: [
    'Votre numéro officiel : SIREN (9 chiffres) ou SIRET (14). Vérification officielle et gratuite.',
    'Your official number: SIREN (9 digits) or SIRET (14). Official, free verification.',
    'Tu número oficial: SIREN (9 dígitos) o SIRET (14). Verificación oficial y gratuita.',
    'Il tuo numero ufficiale: SIREN (9 cifre) o SIRET (14). Verifica ufficiale e gratuita.',
    'رقمك الرسمي: SIREN (9 أرقام) أو SIRET (14). تحقق رسمي ومجاني.',
  ],
  fieldSirenError: ['Entrez un SIREN (9 chiffres) ou un SIRET (14 chiffres).', 'Enter a SIREN (9 digits) or a SIRET (14 digits).', 'Introduce un SIREN (9 dígitos) o un SIRET (14 dígitos).', 'Inserisci un SIREN (9 cifre) o un SIRET (14 cifre).', 'أدخل رقم SIREN (9 أرقام) أو SIRET (14 رقمًا).'],
  // Mission types
  fieldMissionTypes: ['Types de mission', 'Mission types', 'Tipos de misión', 'Tipi di missione', 'أنواع المهام'],
  missionRepas: ['Livraison de repas', 'Meal delivery', 'Entrega de comidas', 'Consegna pasti', 'توصيل الوجبات'],
  missionProduits: ['Produits fournisseurs', 'Supplier products', 'Productos de proveedores', 'Prodotti dei fornitori', 'منتجات الموردين'],
  missionB2b: ['Logistique B2B', 'B2B logistics', 'Logística B2B', 'Logistica B2B', 'الخدمات اللوجستية B2B'],
  missionFroid: ['Chaîne du froid', 'Cold chain', 'Cadena de frío', 'Catena del freddo', 'سلسلة التبريد'],
  // Vehicle types
  fieldVehicleTypes: ['Véhicule(s)', 'Vehicle(s)', 'Vehículo(s)', 'Veicolo/i', 'المركبات'],
  vehicleVelo: ['Vélo', 'Bike', 'Bicicleta', 'Bici', 'دراجة'],
  vehicleScooter: ['Scooter', 'Scooter', 'Scooter', 'Scooter', 'سكوتر'],
  vehicleVoiture: ['Voiture', 'Car', 'Coche', 'Auto', 'سيارة'],
  vehicleCamionnette: ['Camionnette', 'Van', 'Furgoneta', 'Furgone', 'شاحنة صغيرة'],
  vehicleFrigorifique: ['Frigorifique', 'Refrigerated', 'Refrigerado', 'Frigorifero', 'مبردة'],
  // Zones
  fieldZones: ['Zone(s) de livraison', 'Delivery zone(s)', 'Zona(s) de entrega', 'Zona/e di consegna', 'مناطق التوصيل'],
  fieldZonesHint: ['Villes ou codes postaux, séparés par des virgules.', 'Cities or postal codes, comma-separated.', 'Ciudades o códigos postales, separados por comas.', 'Città o codici postali, separati da virgole.', 'مدن أو رموز بريدية، مفصولة بفواصل.'],
  // Contact
  fieldContactName: ['Nom du contact', 'Contact name', 'Nombre del contacto', 'Nome del contatto', 'اسم جهة الاتصال'],
  fieldContactEmail: ['Email', 'Email', 'Correo electrónico', 'Email', 'البريد الإلكتروني'],
  fieldContactPhone: ['Téléphone', 'Phone', 'Teléfono', 'Telefono', 'الهاتف'],
  // Consent + submit
  consentLabel: [
    'J’accepte que Grubano traite ces informations pour étudier ma candidature de partenaire logistique.',
    'I agree that Grubano may process this information to review my logistics-partner application.',
    'Acepto que Grubano trate esta información para estudiar mi candidatura de socio logístico.',
    'Accetto che Grubano tratti queste informazioni per valutare la mia candidatura come partner logistico.',
    'أوافق على أن تعالج Grubano هذه المعلومات لدراسة طلبي كشريك لوجستي.',
  ],
  submit: ['Vérifier et créer mon espace', 'Verify and create my space', 'Verificar y crear mi espacio', 'Verifica e crea il mio spazio', 'تحقّق وأنشئ مساحتي'],
  submitting: ['Vérification en cours…', 'Verifying…', 'Verificando…', 'Verifica in corso…', 'جارٍ التحقق…'],
  back: ['Retour', 'Back', 'Volver', 'Indietro', 'رجوع'],
  backToLogin: ['Aller à la connexion', 'Go to sign-in', 'Ir a iniciar sesión', 'Vai all’accesso', 'الذهاب إلى تسجيل الدخول'],
  // Errors
  errorGeneric: ['Une erreur est survenue. Réessayez.', 'Something went wrong. Please try again.', 'Se produjo un error. Inténtalo de nuevo.', 'Si è verificato un errore. Riprova.', 'حدث خطأ. حاول مرة أخرى.'],
  errorMissionRequired: ['Choisissez au moins un type de mission.', 'Choose at least one mission type.', 'Elige al menos un tipo de misión.', 'Scegli almeno un tipo di missione.', 'اختر نوع مهمة واحدًا على الأقل.'],
  errorVehicleRequired: ['Choisissez au moins un véhicule.', 'Choose at least one vehicle.', 'Elige al menos un vehículo.', 'Scegli almeno un veicolo.', 'اختر مركبة واحدة على الأقل.'],
  // Success — review (pending)
  successTitle: ['Vérification en cours', 'Verification in progress', 'Verificación en curso', 'Verifica in corso', 'التحقق جارٍ'],
  successBody: [
    'Nous finalisons la vérification de votre entreprise auprès du registre officiel. Vous recevrez un accès dès validation.',
    'We are finalising the verification of your business with the official registry. You will receive access once validated.',
    'Estamos finalizando la verificación de tu empresa en el registro oficial. Recibirás acceso en cuanto se valide.',
    'Stiamo completando la verifica della tua azienda presso il registro ufficiale. Riceverai l’accesso una volta convalidata.',
    'نقوم بإنهاء التحقق من شركتك لدى السجل الرسمي. ستتلقى صلاحية الوصول بمجرد التحقق.',
  ],
  // Success — active
  successTitleActive: ['Votre entreprise est vérifiée ✅', 'Your business is verified ✅', 'Tu empresa está verificada ✅', 'La tua azienda è verificata ✅', 'تم التحقق من شركتك ✅'],
  successBodyActive: [
    'Votre espace livreur est activé. Connectez-vous via le lien envoyé à votre email pour gérer vos missions de livraison.',
    'Your courier space is active. Sign in via the link sent to your email to manage your delivery missions.',
    'Tu espacio de repartidor está activo. Inicia sesión con el enlace enviado a tu correo para gestionar tus misiones de entrega.',
    'Il tuo spazio rider è attivo. Accedi tramite il link inviato alla tua email per gestire le tue missioni di consegna.',
    'مساحة التوصيل الخاصة بك مُفعّلة. سجّل الدخول عبر الرابط المُرسل إلى بريدك لإدارة مهام التوصيل.',
  ],
  successCtaActive: ['Accéder à mon espace', 'Go to my space', 'Acceder a mi espacio', 'Vai al mio spazio', 'الذهاب إلى مساحتي'],
  // Success — rejected
  successTitleRejected: ['Demande non retenue', 'Application not accepted', 'Solicitud no aceptada', 'Richiesta non accolta', 'لم يُقبل الطلب'],
  successBodyRejected: [
    'Nous n’avons pas pu vérifier votre entreprise automatiquement. Vérifiez votre SIREN/SIRET et réessayez, ou contactez-nous si vous pensez qu’il s’agit d’une erreur.',
    'We could not verify your business automatically. Check your SIREN/SIRET and try again, or contact us if you think this is a mistake.',
    'No pudimos verificar tu empresa automáticamente. Comprueba tu SIREN/SIRET e inténtalo de nuevo, o contáctanos si crees que es un error.',
    'Non siamo riusciti a verificare automaticamente la tua azienda. Controlla il tuo SIREN/SIRET e riprova, oppure contattaci se pensi che sia un errore.',
    'لم نتمكن من التحقق من شركتك تلقائيًا. تحقق من رقم SIREN/SIRET وحاول مجددًا، أو تواصل معنا إذا كنت تعتقد أن هذا خطأ.',
  ],
}

LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.business = json.business || {}
  json.business.logistics = json.business.logistics || {}
  for (const k of Object.keys(L)) json.business.logistics[k] = L[k][i]
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`  ✓ ${loc}.json — business.logistics (${Object.keys(L).length} keys)`)
})
console.log('[add-logistics-i18n] done.')
