/* eslint-disable */
// ── business.grubano.com PREMIUM landing v2 i18n (Agent 14) ───────────────────
// Enriches business.landing with the new marketing sections (hero eyebrow + product
// mockup labels, métiers, how-it-works, benefits, final CTA, footer). Keeps the
// existing hero/CTA/reassurance keys. Vouvoiement, x5 locales. Idempotent.
// Run: node scripts/add-business-landing-v2-i18n.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

const L = {
  // Hero (kept + eyebrow)
  heroEyebrow: ['Espace partenaires', 'Partner space', 'Espacio de socios', 'Spazio partner', 'مساحة الشركاء'],
  heroTitle: [
    'Développez votre activité avec Grubano', 'Grow your business with Grubano',
    'Haz crecer tu negocio con Grubano', 'Fai crescere la tua attività con Grubano', 'طوّر نشاطك مع Grubano',
  ],
  heroSubtitle: [
    'Restaurateurs, fournisseurs, créateurs, logistique — un seul espace, une vérification instantanée, un compte pour tout gérer.',
    'Restaurants, suppliers, creators, logistics — one space, instant verification, one account to manage it all.',
    'Restaurantes, proveedores, creadores, logística — un espacio, verificación instantánea, una cuenta para todo.',
    'Ristoratori, fornitori, creatori, logistica — un unico spazio, verifica istantanea, un account per gestire tutto.',
    'مطاعم، موردون، صنّاع محتوى، خدمات لوجستية — مساحة واحدة، تحقق فوري، وحساب واحد لإدارة كل شيء.',
  ],
  ctaPrimary: ['Devenir partenaire', 'Become a partner', 'Hazte socio', 'Diventa partner', 'كن شريكًا'],
  ctaSecondary: ['Se connecter', 'Sign in', 'Iniciar sesión', 'Accedi', 'تسجيل الدخول'],
  reassure1: ['Vérification instantanée', 'Instant verification', 'Verificación instantánea', 'Verifica istantanea', 'تحقق فوري'],
  reassure2: ['Paiements sécurisés', 'Secure payments', 'Pagos seguros', 'Pagamenti sicuri', 'مدفوعات آمنة'],
  reassure3: ['Un compte, plusieurs activités', 'One account, multiple activities', 'Una cuenta, varias actividades', 'Un account, più attività', 'حساب واحد، أنشطة متعددة'],
  // Hero product mockup
  mockUrl: ['espace.grubano.com', 'space.grubano.com', 'espacio.grubano.com', 'spazio.grubano.com', 'space.grubano.com'],
  mockOrders: ['Commandes', 'Orders', 'Pedidos', 'Ordini', 'الطلبات'],
  mockRevenue: ['Revenus', 'Revenue', 'Ingresos', 'Ricavi', 'الإيرادات'],
  mockActivity: ['Activité récente', 'Recent activity', 'Actividad reciente', 'Attività recente', 'النشاط الأخير'],
  mockRow1: ['Nouvelle commande reçue', 'New order received', 'Nuevo pedido recibido', 'Nuovo ordine ricevuto', 'تم استلام طلب جديد'],
  mockRow2: ['Produit ajouté au catalogue', 'Product added to catalogue', 'Producto añadido al catálogo', 'Prodotto aggiunto al catalogo', 'تمت إضافة منتج إلى الكتالوج'],
  mockRow3: ['Paiement reçu', 'Payment received', 'Pago recibido', 'Pagamento ricevuto', 'تم استلام الدفعة'],
  // Métiers
  tradesTitle: ['Un espace pour chaque métier', 'A space for every trade', 'Un espacio para cada oficio', 'Uno spazio per ogni mestiere', 'مساحة لكل مهنة'],
  tradesSubtitle: [
    'Quatre familles de partenaires, une seule plateforme.', 'Four partner families, one platform.',
    'Cuatro familias de socios, una sola plataforma.', 'Quattro famiglie di partner, una sola piattaforma.', 'أربع فئات من الشركاء، منصة واحدة.',
  ],
  tradeRestaurateur: ['Restaurateur', 'Restaurateur', 'Restaurador', 'Ristoratore', 'صاحب مطعم'],
  tradeRestaurateurDesc: ['Gérez votre établissement et vos commandes.', 'Run your venue and your orders.', 'Gestiona tu local y tus pedidos.', 'Gestisci il tuo locale e i tuoi ordini.', 'أدر منشأتك وطلباتك.'],
  tradeFournisseur: ['Fournisseur', 'Supplier', 'Proveedor', 'Fornitore', 'مورّد'],
  tradeFournisseurDesc: ['Vendez vos produits aux restaurants.', 'Sell your products to restaurants.', 'Vende tus productos a los restaurantes.', 'Vendi i tuoi prodotti ai ristoranti.', 'بِع منتجاتك للمطاعم.'],
  tradeCreator: ['Chef & Créateur', 'Chef & Creator', 'Chef y creador', 'Chef e creatore', 'طاهٍ ومبتكر'],
  tradeCreatorDesc: ['Monétisez vos recettes signature.', 'Monetise your signature recipes.', 'Monetiza tus recetas de autor.', 'Monetizza le tue ricette d’autore.', 'حقّق دخلًا من وصفاتك المميزة.'],
  tradeLogistique: ['Logistique', 'Logistics', 'Logística', 'Logistica', 'الخدمات اللوجستية'],
  tradeLogistiqueDesc: ['Livrez repas, produits et B2B.', 'Deliver meals, products and B2B.', 'Entrega comidas, productos y B2B.', 'Consegna pasti, prodotti e B2B.', 'وصّل الوجبات والمنتجات وطلبات B2B.'],
  // How it works
  howTitle: ['Comment ça marche', 'How it works', 'Cómo funciona', 'Come funziona', 'كيف يعمل'],
  howSubtitle: ['Trois étapes, zéro paperasse.', 'Three steps, zero paperwork.', 'Tres pasos, sin papeleo.', 'Tre passi, zero scartoffie.', 'ثلاث خطوات، بلا أوراق.'],
  step1Title: ['Choisissez votre activité', 'Choose your activity', 'Elige tu actividad', 'Scegli la tua attività', 'اختر نشاطك'],
  step1Desc: ['Restaurateur, fournisseur, créateur ou logistique.', 'Restaurateur, supplier, creator or logistics.', 'Restaurador, proveedor, creador o logística.', 'Ristoratore, fornitore, creatore o logistica.', 'مطعم، مورّد، مبتكر أو خدمات لوجستية.'],
  step2Title: ['Vérification instantanée', 'Instant verification', 'Verificación instantánea', 'Verifica istantanea', 'تحقق فوري'],
  step2Desc: ['Votre entreprise est validée via le registre officiel.', 'Your business is validated via the official registry.', 'Tu empresa se valida mediante el registro oficial.', 'La tua azienda è convalidata tramite il registro ufficiale.', 'يتم التحقق من شركتك عبر السجل الرسمي.'],
  step3Title: ['Démarrez', 'Get started', 'Empieza', 'Inizia', 'ابدأ'],
  step3Desc: ['Votre espace est activé — gérez tout au même endroit.', 'Your space is live — manage everything in one place.', 'Tu espacio está activo — gestiona todo en un solo lugar.', 'Il tuo spazio è attivo — gestisci tutto in un unico posto.', 'مساحتك مُفعّلة — أدر كل شيء في مكان واحد.'],
  // Benefits
  benefitsTitle: ['Pensé pour les pros', 'Built for pros', 'Pensado para profesionales', 'Pensato per i professionisti', 'مُصمَّم للمحترفين'],
  benefit1Title: ['Vérification officielle', 'Official verification', 'Verificación oficial', 'Verifica ufficiale', 'تحقق رسمي'],
  benefit1Desc: ['Identité d’entreprise confirmée via le registre — sans attente.', 'Business identity confirmed via the registry — no waiting.', 'Identidad de empresa confirmada mediante el registro — sin esperas.', 'Identità aziendale confermata tramite il registro — senza attese.', 'هوية الشركة مؤكدة عبر السجل — دون انتظار.'],
  benefit2Title: ['Paiements sécurisés', 'Secure payments', 'Pagos seguros', 'Pagamenti sicuri', 'مدفوعات آمنة'],
  benefit2Desc: ['Encaissements protégés, conformes et traçables.', 'Protected, compliant and traceable payouts.', 'Cobros protegidos, conformes y rastreables.', 'Incassi protetti, conformi e tracciabili.', 'مقبوضات محمية ومتوافقة وقابلة للتتبع.'],
  benefit3Title: ['Un compte, plusieurs activités', 'One account, many activities', 'Una cuenta, varias actividades', 'Un account, più attività', 'حساب واحد، أنشطة متعددة'],
  benefit3Desc: ['Ajoutez d’autres métiers quand vous voulez, sans recréer de compte.', 'Add more trades whenever you want, without a new account.', 'Añade más oficios cuando quieras, sin crear otra cuenta.', 'Aggiungi altri mestieri quando vuoi, senza creare un nuovo account.', 'أضف مهنًا أخرى متى شئت، دون إنشاء حساب جديد.'],
  // Final CTA
  finalTitle: ['Prêt à développer votre activité ?', 'Ready to grow your business?', '¿List@ para hacer crecer tu negocio?', 'Pronto a far crescere la tua attività?', 'مستعد لتطوير نشاطك؟'],
  finalSubtitle: ['Rejoignez les partenaires Grubano en quelques minutes.', 'Join Grubano partners in minutes.', 'Únete a los socios de Grubano en minutos.', 'Unisciti ai partner Grubano in pochi minuti.', 'انضم إلى شركاء Grubano في دقائق.'],
  // Footer
  footerTagline: ['La plateforme des partenaires de la restauration.', 'The platform for foodservice partners.', 'La plataforma de los socios de la restauración.', 'La piattaforma dei partner della ristorazione.', 'منصة شركاء قطاع المطاعم.'],
  footerLegal: ['Mentions légales', 'Legal notice', 'Aviso legal', 'Note legali', 'إشعار قانوني'],
  footerRights: ['© {year} Grubano. Tous droits réservés.', '© {year} Grubano. All rights reserved.', '© {year} Grubano. Todos los derechos reservados.', '© {year} Grubano. Tutti i diritti riservati.', '© {year} Grubano. جميع الحقوق محفوظة.'],
}

LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.business = json.business || {}
  json.business.landing = json.business.landing || {}
  for (const k of Object.keys(L)) json.business.landing[k] = L[k][i]
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`  ✓ ${loc}.json — business.landing v2 (${Object.keys(L).length} keys)`)
})
console.log('[add-business-landing-v2-i18n] done.')
