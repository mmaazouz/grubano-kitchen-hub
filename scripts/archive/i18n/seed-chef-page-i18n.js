// Seed i18n — MISSION 1 CREATOR STUDIO : page publique /chef/<slug> (Agent 13).
// Namespace chef.* (page publique) + creators.home.pageSales (stat studio).
// Les clés eat.creator.* existantes (orderFrom, soonNearYou, followers,
// verifiedBadge, notFound*, recipesTitle…) sont RÉUTILISÉES par la page.
//
// Usage: node scripts/seed-chef-page-i18n.js   puis   npm run check:i18n

const fs = require('fs')
const path = require('path')

const KEYS = {
  fr: {
    chef: {
      metaTitle:       '{name} — Chef créateur sur Grubano',
      metaFallbackDesc:'Découvrez les créations de {name} et les restaurants qui les servent près de chez vous.',
      heroTagline:     'Chef créateur',
      specialties:     'Spécialités',
      proofBanner:     '{sales, plural, =1 {1 vente} other {# ventes}} · {restaurants, plural, =1 {1 restaurant partenaire} other {# restaurants partenaires}}',
      partnersTitle:   'Ses restaurants partenaires',
      partnersSubtitle:'Commandez ses créations chez les restaurants qui les servent.',
      sortGeoCta:      'Trier par distance',
      sortGeoActive:   'Triés par distance',
      sortGeoDenied:   'Localisation refusée — tri par ville.',
      distanceKm:      'à {km} km',
      servesRecipes:   '{count, plural, =1 {1 création servie} other {# créations servies}}',
      orderCta:        'Commander',
      portfolioTitle:  'Ses créations',
      noPartnersYet:   'Ses créations arrivent bientôt dans des restaurants partenaires.',
      ctaClientTitle:  'Envie de goûter ?',
      ctaClientBody:   'Ses créations sont servies dans de vrais restaurants — commandez directement.',
      ctaClientBtn:    'Découvrir les restaurants',
      ctaRestoTitle:   'Vous êtes restaurateur ?',
      ctaRestoBody:    'Adoptez ses recettes à votre carte et profitez de son audience.',
      ctaRestoBtn:     'Adopter ses recettes',
    },
    creators: { home: { pageSales: '{count, plural, =1 {1 commande via ma page} other {# commandes via ma page}}' } },
  },
  en: {
    chef: {
      metaTitle:       '{name} — Creator chef on Grubano',
      metaFallbackDesc:'Discover {name}’s creations and the restaurants serving them near you.',
      heroTagline:     'Creator chef',
      specialties:     'Specialties',
      proofBanner:     '{sales, plural, =1 {1 sale} other {# sales}} · {restaurants, plural, =1 {1 partner restaurant} other {# partner restaurants}}',
      partnersTitle:   'Partner restaurants',
      partnersSubtitle:'Order their creations from the restaurants that serve them.',
      sortGeoCta:      'Sort by distance',
      sortGeoActive:   'Sorted by distance',
      sortGeoDenied:   'Location denied — sorted by city.',
      distanceKm:      '{km} km away',
      servesRecipes:   '{count, plural, =1 {1 creation served} other {# creations served}}',
      orderCta:        'Order',
      portfolioTitle:  'Their creations',
      noPartnersYet:   'Their creations are coming soon to partner restaurants.',
      ctaClientTitle:  'Want a taste?',
      ctaClientBody:   'These creations are served in real restaurants — order directly.',
      ctaClientBtn:    'Discover the restaurants',
      ctaRestoTitle:   'Are you a restaurateur?',
      ctaRestoBody:    'Adopt these recipes on your menu and benefit from their audience.',
      ctaRestoBtn:     'Adopt the recipes',
    },
    creators: { home: { pageSales: '{count, plural, =1 {1 order via my page} other {# orders via my page}}' } },
  },
  es: {
    chef: {
      metaTitle:       '{name} — Chef creador en Grubano',
      metaFallbackDesc:'Descubre las creaciones de {name} y los restaurantes que las sirven cerca de ti.',
      heroTagline:     'Chef creador',
      specialties:     'Especialidades',
      proofBanner:     '{sales, plural, =1 {1 venta} other {# ventas}} · {restaurants, plural, =1 {1 restaurante asociado} other {# restaurantes asociados}}',
      partnersTitle:   'Sus restaurantes asociados',
      partnersSubtitle:'Pide sus creaciones en los restaurantes que las sirven.',
      sortGeoCta:      'Ordenar por distancia',
      sortGeoActive:   'Ordenados por distancia',
      sortGeoDenied:   'Ubicación denegada — orden por ciudad.',
      distanceKm:      'a {km} km',
      servesRecipes:   '{count, plural, =1 {1 creación servida} other {# creaciones servidas}}',
      orderCta:        'Pedir',
      portfolioTitle:  'Sus creaciones',
      noPartnersYet:   'Sus creaciones llegan pronto a restaurantes asociados.',
      ctaClientTitle:  '¿Quieres probarlas?',
      ctaClientBody:   'Sus creaciones se sirven en restaurantes reales — pide directamente.',
      ctaClientBtn:    'Descubrir los restaurantes',
      ctaRestoTitle:   '¿Eres restaurador?',
      ctaRestoBody:    'Adopta sus recetas en tu carta y aprovecha su audiencia.',
      ctaRestoBtn:     'Adoptar sus recetas',
    },
    creators: { home: { pageSales: '{count, plural, =1 {1 pedido vía mi página} other {# pedidos vía mi página}}' } },
  },
  it: {
    chef: {
      metaTitle:       '{name} — Chef creator su Grubano',
      metaFallbackDesc:'Scopri le creazioni di {name} e i ristoranti che le servono vicino a te.',
      heroTagline:     'Chef creator',
      specialties:     'Specialità',
      proofBanner:     '{sales, plural, =1 {1 vendita} other {# vendite}} · {restaurants, plural, =1 {1 ristorante partner} other {# ristoranti partner}}',
      partnersTitle:   'I suoi ristoranti partner',
      partnersSubtitle:'Ordina le sue creazioni nei ristoranti che le servono.',
      sortGeoCta:      'Ordina per distanza',
      sortGeoActive:   'Ordinati per distanza',
      sortGeoDenied:   'Posizione negata — ordine per città.',
      distanceKm:      'a {km} km',
      servesRecipes:   '{count, plural, =1 {1 creazione servita} other {# creazioni servite}}',
      orderCta:        'Ordina',
      portfolioTitle:  'Le sue creazioni',
      noPartnersYet:   'Le sue creazioni arrivano presto nei ristoranti partner.',
      ctaClientTitle:  'Vuoi assaggiarle?',
      ctaClientBody:   'Le sue creazioni sono servite in veri ristoranti — ordina direttamente.',
      ctaClientBtn:    'Scopri i ristoranti',
      ctaRestoTitle:   'Sei un ristoratore?',
      ctaRestoBody:    'Adotta le sue ricette nel tuo menù e approfitta del suo pubblico.',
      ctaRestoBtn:     'Adotta le sue ricette',
    },
    creators: { home: { pageSales: '{count, plural, =1 {1 ordine dalla mia pagina} other {# ordini dalla mia pagina}}' } },
  },
  ar: {
    chef: {
      metaTitle:       '{name} — شيف مبدع على Grubano',
      metaFallbackDesc:'اكتشف إبداعات {name} والمطاعم التي تقدّمها بالقرب منك.',
      heroTagline:     'شيف مبدع',
      specialties:     'التخصصات',
      proofBanner:     '{sales, plural, =1 {بيع واحد} other {# مبيعات}} · {restaurants, plural, =1 {مطعم شريك واحد} other {# مطاعم شريكة}}',
      partnersTitle:   'مطاعمه الشريكة',
      partnersSubtitle:'اطلب إبداعاته من المطاعم التي تقدّمها.',
      sortGeoCta:      'الترتيب حسب المسافة',
      sortGeoActive:   'مرتبة حسب المسافة',
      sortGeoDenied:   'تم رفض الموقع — الترتيب حسب المدينة.',
      distanceKm:      'على بعد {km} كم',
      servesRecipes:   '{count, plural, =1 {إبداع واحد يُقدَّم} other {# إبداعات تُقدَّم}}',
      orderCta:        'اطلب',
      portfolioTitle:  'إبداعاته',
      noPartnersYet:   'إبداعاته قادمة قريبًا إلى مطاعم شريكة.',
      ctaClientTitle:  'هل تريد التذوق؟',
      ctaClientBody:   'تُقدَّم إبداعاته في مطاعم حقيقية — اطلب مباشرة.',
      ctaClientBtn:    'اكتشف المطاعم',
      ctaRestoTitle:   'هل أنت صاحب مطعم؟',
      ctaRestoBody:    'اعتمد وصفاته في قائمتك واستفد من جمهوره.',
      ctaRestoBtn:     'اعتماد وصفاته',
    },
    creators: { home: { pageSales: '{count, plural, =1 {طلب واحد عبر صفحتي} other {# طلبات عبر صفحتي}}' } },
  },
}

function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      if (!target[key] || typeof target[key] !== 'object') target[key] = {}
      deepMerge(target[key], source[key])
    } else {
      target[key] = source[key]
    }
  }
}

for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(file, 'utf8'))
  deepMerge(m, KEYS[loc])
  fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`[seed-chef-page-i18n] ${loc}.json OK`)
}
console.log('[seed-chef-page-i18n] Done — run: npm run check:i18n')
