/* eslint-disable */
// ── Logistics dashboard i18n (P1, Agent 17) ───────────────────────────────────
// Seeds the `business.logistics.dashboard.*` subtree for the courier/logistics
// dashboard (/logistics/dashboard) + `roleSwitcher.spaceLogistics` (the multi-role
// switcher label). ADDITIVE + distinct from the existing register keys under
// business.logistics. x5 locales, idempotent. FR formal (vous); other locales match
// the existing business.logistics tone.
// Run: node scripts/add-logistics-dashboard-i18n.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

// business.logistics.dashboard.* — [fr, en, es, it, ar]
const D = {
  // Header
  welcome:  ['Votre espace logistique', 'Your logistics space', 'Tu espacio logístico', 'Il tuo spazio logistico', 'مساحتك اللوجستية'],
  subtitle: [
    'Gérez votre profil et vos missions de livraison.',
    'Manage your profile and delivery missions.',
    'Gestiona tu perfil y tus misiones de entrega.',
    'Gestisci il tuo profilo e le tue missioni di consegna.',
    'أدِر ملفك الشخصي ومهام التوصيل الخاصة بك.',
  ],
  // Status banner — active
  activeTitle: ['Votre compte est actif', 'Your account is active', 'Tu cuenta está activa', 'Il tuo account è attivo', 'حسابك نشط'],
  activeBody: [
    'Votre espace livreur est prêt. Vos missions de livraison apparaîtront ici dès leur lancement.',
    'Your courier space is ready. Your delivery missions will appear here as soon as they launch.',
    'Tu espacio de repartidor está listo. Tus misiones de entrega aparecerán aquí en cuanto se lancen.',
    'Il tuo spazio rider è pronto. Le tue missioni di consegna appariranno qui non appena disponibili.',
    'مساحة التوصيل الخاصة بك جاهزة. ستظهر مهام التوصيل هنا فور إطلاقها.',
  ],
  // Status banner — pending
  pendingTitle: ['Vérification en cours', 'Verification in progress', 'Verificación en curso', 'Verifica in corso', 'التحقق جارٍ'],
  pendingBody: [
    'Nous finalisons la vérification de votre entreprise auprès du registre officiel. Vous aurez un accès complet dès validation.',
    'We are finalising the verification of your business with the official registry. You will get full access once validated.',
    'Estamos finalizando la verificación de tu empresa en el registro oficial. Tendrás acceso completo en cuanto se valide.',
    'Stiamo completando la verifica della tua azienda presso il registro ufficiale. Avrai accesso completo una volta convalidata.',
    'نقوم بإنهاء التحقق من شركتك لدى السجل الرسمي. ستحصل على وصول كامل بمجرد التحقق.',
  ],
  // Status banner — rejected
  rejectedTitle: ['Compte non vérifié', 'Account not verified', 'Cuenta no verificada', 'Account non verificato', 'الحساب غير مُتحقق منه'],
  rejectedBody: [
    'Nous n’avons pas pu vérifier votre entreprise. Contactez-nous si vous pensez qu’il s’agit d’une erreur.',
    'We could not verify your business. Contact us if you think this is a mistake.',
    'No pudimos verificar tu empresa. Contáctanos si crees que es un error.',
    'Non siamo riusciti a verificare la tua azienda. Contattaci se pensi che sia un errore.',
    'لم نتمكن من التحقق من شركتك. تواصل معنا إذا كنت تعتقد أن هذا خطأ.',
  ],
  // Status banner — suspended
  suspendedTitle: ['Compte suspendu', 'Account suspended', 'Cuenta suspendida', 'Account sospeso', 'الحساب موقوف'],
  suspendedBody: [
    'Votre accès est temporairement suspendu. Contactez le support Grubano pour le rétablir.',
    'Your access is temporarily suspended. Contact Grubano support to restore it.',
    'Tu acceso está temporalmente suspendido. Contacta con el soporte de Grubano para restablecerlo.',
    'Il tuo accesso è temporaneamente sospeso. Contatta il supporto Grubano per ripristinarlo.',
    'تم تعليق وصولك مؤقتًا. تواصل مع دعم Grubano لإعادة تفعيله.',
  ],
  // Profile summary (read-only)
  profileTitle:      ['Votre profil partenaire', 'Your partner profile', 'Tu perfil de socio', 'Il tuo profilo partner', 'ملف الشريك الخاص بك'],
  labelPartnerType:  ['Statut', 'Status', 'Estatus', 'Stato', 'الوضع'],
  labelSiren:        ['SIREN', 'SIREN', 'SIREN', 'SIREN', 'SIREN'],
  labelMissionTypes: ['Types de mission', 'Mission types', 'Tipos de misión', 'Tipi di missione', 'أنواع المهام'],
  labelVehicleTypes: ['Véhicules', 'Vehicles', 'Vehículos', 'Veicoli', 'المركبات'],
  labelZones:        ['Zones de livraison', 'Delivery zones', 'Zonas de entrega', 'Zone di consegna', 'مناطق التوصيل'],
  labelContact:      ['Contact', 'Contact', 'Contacto', 'Contatto', 'جهة الاتصال'],
  labelPhone:        ['Téléphone', 'Phone', 'Teléfono', 'Telefono', 'الهاتف'],
  emptyValue:        ['—', '—', '—', '—', '—'],
  verifiedBadge:     ['Vérifié', 'Verified', 'Verificado', 'Verificato', 'مُتحقق منه'],
  // Status badge labels
  statusActive:    ['Actif', 'Active', 'Activo', 'Attivo', 'نشط'],
  statusPending:   ['En vérification', 'Under review', 'En revisión', 'In verifica', 'قيد التحقق'],
  statusSuspended: ['Suspendu', 'Suspended', 'Suspendido', 'Sospeso', 'موقوف'],
  statusRejected:  ['Non vérifié', 'Not verified', 'No verificado', 'Non verificato', 'غير مُتحقق منه'],
  // Missions placeholder
  missionsTitle:     ['Missions', 'Missions', 'Misiones', 'Missioni', 'المهام'],
  missionsSoonBadge: ['Bientôt', 'Soon', 'Pronto', 'Presto', 'قريبًا'],
  missionsSoonBody: [
    'Le système de missions de livraison arrive bientôt. Vous gérerez ici vos courses et tournées.',
    'The delivery-missions system is coming soon. You will manage your runs and rounds here.',
    'El sistema de misiones de entrega llegará pronto. Aquí gestionarás tus envíos y rutas.',
    'Il sistema di missioni di consegna arriverà presto. Qui gestirai le tue corse e i tuoi giri.',
    'نظام مهام التوصيل قادم قريبًا. ستدير هنا رحلاتك وجولاتك.',
  ],
  // No-profile (defence in depth)
  noProfileTitle: ['Aucun profil logistique', 'No logistics profile', 'Sin perfil logístico', 'Nessun profilo logistico', 'لا يوجد ملف لوجستي'],
  noProfileBody: [
    'Nous n’avons pas trouvé de profil logistique pour ce compte. Inscrivez-vous comme partenaire logistique pour commencer.',
    'We could not find a logistics profile for this account. Register as a logistics partner to get started.',
    'No encontramos un perfil logístico para esta cuenta. Regístrate como socio logístico para empezar.',
    'Non abbiamo trovato un profilo logistico per questo account. Registrati come partner logistico per iniziare.',
    'لم نعثر على ملف لوجستي لهذا الحساب. سجّل كشريك لوجستي للبدء.',
  ],
  registerCta: ['Devenir partenaire logistique', 'Become a logistics partner', 'Conviértete en socio logístico', 'Diventa partner logistico', 'كن شريكًا لوجستيًا'],
}

// roleSwitcher.spaceLogistics — multi-role switcher label.
const SPACE_LOGISTICS = ['Espace logistique', 'Logistics', 'Logística', 'Logistica', 'الخدمات اللوجستية']

LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.business = json.business || {}
  json.business.logistics = json.business.logistics || {}
  json.business.logistics.dashboard = json.business.logistics.dashboard || {}
  for (const k of Object.keys(D)) json.business.logistics.dashboard[k] = D[k][i]
  json.roleSwitcher = json.roleSwitcher || {}
  json.roleSwitcher.spaceLogistics = SPACE_LOGISTICS[i]
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`  ✓ ${loc}.json — business.logistics.dashboard (${Object.keys(D).length} keys) + roleSwitcher.spaceLogistics`)
})
console.log('[add-logistics-dashboard-i18n] done.')
