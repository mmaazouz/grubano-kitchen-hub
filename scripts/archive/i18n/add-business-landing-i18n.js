/* eslint-disable */
// ── business.grubano.com premium entry i18n seeder (Agent 14) ─────────────────
// Adds the partner LANDING (business.landing), rewrites the "Quel type de
// partenaire ?" choice page (business.start, v1.5 structure), and adds the
// logistics "soon" page (business.logisticsSoon). Vouvoiement, x5 locales.
// Idempotent. Run: node scripts/add-business-landing-i18n.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

const LANDING = {
  heroTitle: [
    'Développez votre activité avec Grubano', 'Grow your business with Grubano',
    'Haz crecer tu negocio con Grubano', 'Fai crescere la tua attività con Grubano', 'طوّر نشاطك مع Grubano',
  ],
  heroSubtitle: [
    'Restaurateurs, fournisseurs, créateurs, logistique — un seul espace.',
    'Restaurants, suppliers, creators, logistics — one single space.',
    'Restaurantes, proveedores, creadores, logística — un solo espacio.',
    'Ristoratori, fornitori, creatori, logistica — un unico spazio.',
    'مطاعم، موردون، صنّاع محتوى، خدمات لوجستية — مساحة واحدة.',
  ],
  ctaPrimary: ['Devenir partenaire', 'Become a partner', 'Hazte socio', 'Diventa partner', 'كن شريكًا'],
  ctaSecondary: ['Se connecter', 'Sign in', 'Iniciar sesión', 'Accedi', 'تسجيل الدخول'],
  reassure1: ['Vérification instantanée', 'Instant verification', 'Verificación instantánea', 'Verifica istantanea', 'تحقق فوري'],
  reassure2: ['Paiements sécurisés', 'Secure payments', 'Pagos seguros', 'Pagamenti sicuri', 'مدفوعات آمنة'],
  reassure3: [
    'Un compte, plusieurs activités', 'One account, multiple activities',
    'Una cuenta, varias actividades', 'Un account, più attività', 'حساب واحد، أنشطة متعددة',
  ],
}

const START = {
  title: [
    'Quel type de partenaire êtes-vous ?', 'What kind of partner are you?',
    '¿Qué tipo de socio eres?', 'Che tipo di partner sei?', 'ما نوع الشريك الذي أنت عليه؟',
  ],
  subtitle: [
    'Un seul compte — vous ajouterez d’autres activités après.',
    'One account — you can add other activities later.',
    'Una sola cuenta — podrás añadir otras actividades después.',
    'Un solo account — potrai aggiungere altre attività in seguito.',
    'حساب واحد — يمكنك إضافة أنشطة أخرى لاحقًا.',
  ],
  coreLabel: ['LE CŒUR DE GRUBANO', 'THE HEART OF GRUBANO', 'EL CORAZÓN DE GRUBANO', 'IL CUORE DI GRUBANO', 'قلب GRUBANO'],
  partnersLabel: ['LES PARTENAIRES', 'THE PARTNERS', 'LOS SOCIOS', 'I PARTNER', 'الشركاء'],
  restaurateurTitle: ['Restaurateur', 'Restaurateur', 'Restaurador', 'Ristoratore', 'صاحب مطعم'],
  restaurateurDesc: [
    'Servez vos clients, gérez votre établissement.', 'Serve your customers, run your venue.',
    'Atiende a tus clientes, gestiona tu local.', 'Servi i tuoi clienti, gestisci il tuo locale.', 'اخدم عملاءك وأدر منشأتك.',
  ],
  fournisseurTitle: ['Fournisseur', 'Supplier', 'Proveedor', 'Fornitore', 'مورّد'],
  fournisseurDesc: [
    'Vendez vos produits aux restaurants.', 'Sell your products to restaurants.',
    'Vende tus productos a los restaurantes.', 'Vendi i tuoi prodotti ai ristoranti.', 'بِع منتجاتك للمطاعم.',
  ],
  creatorTitle: [
    'Chef & Créateur de recettes', 'Chef & Recipe creator',
    'Chef y creador de recetas', 'Chef e creatore di ricette', 'طاهٍ ومبتكر وصفات',
  ],
  creatorDesc: ['Monétisez vos recettes.', 'Monetise your recipes.', 'Monetiza tus recetas.', 'Monetizza le tue ricette.', 'حقّق دخلًا من وصفاتك.'],
  logistiqueTitle: ['Logistique', 'Logistics', 'Logística', 'Logistica', 'الخدمات اللوجستية'],
  logistiqueDesc: [
    'Livrez repas, produits, B2B.', 'Deliver meals, products, B2B.',
    'Entrega comidas, productos, B2B.', 'Consegna pasti, prodotti, B2B.', 'وصّل الوجبات والمنتجات وطلبات B2B.',
  ],
  logistiqueSoon: ['Bientôt', 'Soon', 'Pronto', 'Presto', 'قريبًا'],
  influencerTeaser: [
    'Influenceur ou site à audience ? Rejoignez l’affiliation Grubano',
    'Influencer or audience site? Join Grubano affiliation',
    '¿Influencer o sitio con audiencia? Únete a la afiliación Grubano',
    'Influencer o sito con pubblico? Unisciti all’affiliazione Grubano',
    'مؤثّر أو موقع بجمهور؟ انضم إلى نظام الإحالة في Grubano',
  ],
  franchiseLine: [
    'Réseau / plusieurs établissements ?', 'Network / several venues?',
    '¿Red / varios locales?', 'Rete / più sedi?', 'شبكة / عدة منشآت؟',
  ],
  franchiseCta: ['Groupe & Franchise', 'Group & Franchise', 'Grupo y franquicia', 'Gruppo e franchising', 'مجموعة وامتياز'],
  alreadyAccount: ['Déjà partenaire ?', 'Already a partner?', '¿Ya eres socio?', 'Già partner?', 'شريك بالفعل؟'],
  signIn: ['Se connecter', 'Sign in', 'Iniciar sesión', 'Accedi', 'تسجيل الدخول'],
}

const LOGISTICS_SOON = {
  badge: ['Bientôt', 'Soon', 'Pronto', 'Presto', 'قريبًا'],
  title: ['Livraison & logistique', 'Delivery & logistics', 'Entrega y logística', 'Consegna e logistica', 'التوصيل والخدمات اللوجستية'],
  body: [
    'L’espace livreur arrive très bientôt. Livrez des repas, des produits et des commandes B2B sur Grubano.',
    'The courier space is coming very soon. Deliver meals, products and B2B orders on Grubano.',
    'El espacio para repartidores llega muy pronto. Entrega comidas, productos y pedidos B2B en Grubano.',
    'Lo spazio per i corrieri arriva prestissimo. Consegna pasti, prodotti e ordini B2B su Grubano.',
    'مساحة عامل التوصيل قادمة قريبًا جدًا. وصّل الوجبات والمنتجات وطلبات B2B على Grubano.',
  ],
  dedicatedSupport: [
    'Inscription prioritaire à l’ouverture', 'Priority sign-up at launch',
    'Registro prioritario en el lanzamiento', 'Iscrizione prioritaria al lancio', 'تسجيل بأولوية عند الإطلاق',
  ],
  contactCta: ['Être prévenu au lancement', 'Get notified at launch', 'Avisarme en el lanzamiento', 'Avvisami al lancio', 'أبلغني عند الإطلاق'],
  back: ['Retour', 'Back', 'Volver', 'Indietro', 'رجوع'],
}

LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.business = json.business || {}
  json.business.landing = json.business.landing || {}
  json.business.start = json.business.start || {}
  json.business.logisticsSoon = json.business.logisticsSoon || {}
  for (const k of Object.keys(LANDING))        json.business.landing[k] = LANDING[k][i]
  for (const k of Object.keys(START))          json.business.start[k] = START[k][i]
  for (const k of Object.keys(LOGISTICS_SOON)) json.business.logisticsSoon[k] = LOGISTICS_SOON[k][i]
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`  ✓ ${loc}.json — business.landing (${Object.keys(LANDING).length}) + start (${Object.keys(START).length}) + logisticsSoon (${Object.keys(LOGISTICS_SOON).length})`)
})
console.log('[add-business-landing-i18n] done.')
