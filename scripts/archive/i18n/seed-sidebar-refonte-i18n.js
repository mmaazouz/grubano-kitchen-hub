// scripts/seed-sidebar-refonte-i18n.js
// C13-1 — Seeds the regrouped, anti-jargon dashboard sidebar labels across the
// 5 locales under dashboard.sidebar.*. Additive: only Object.assign's the new
// keys, never removes the existing identity keys (subtitle*, role*, connected…).
// Source of truth = fr.json; the other locales must stay complete (check:i18n).
//
// Run:  node scripts/seed-sidebar-refonte-i18n.js   then   npm run check:i18n

const fs = require('fs')
const path = require('path')

const T = {
  fr: {
    // Group headers (5 intentions; the "Accueil" group is rendered headerless)
    groupRestaurant:    'Mon restaurant',
    groupDaily:         'Au quotidien',
    groupClients:       'Mes clients',
    groupGrowth:        'Faire grandir',
    // Nav items
    navHome:            'Accueil',
    navRestaurantCard:  'Ma carte',
    navRestaurantSingle:'Mon restaurant',
    navRestaurantMulti: 'Mes établissements',
    navTables:          'Tables & réservations',
    navHours:           'Horaires & service',
    navOrders:          'Commandes',
    navStocks:          'Stocks',
    navSuppliers:       'Fournisseurs',
    navReviews:         'Avis',
    navClients:         'Clients & Fidélité',
    navPerformance:     'Performances',
    navInfluencers:     'Influenceurs & Créateurs',
    navFinance:         'Finances & Wallet',
    navFranchise:       'Franchise',
    navBriefing:        'Briefing',
    navNotifications:   'Notifications',
  },
  en: {
    groupRestaurant:    'My restaurant',
    groupDaily:         'Daily',
    groupClients:       'My customers',
    groupGrowth:        'Grow',
    navHome:            'Home',
    navRestaurantCard:  'My menu',
    navRestaurantSingle:'My restaurant',
    navRestaurantMulti: 'My locations',
    navTables:          'Tables & bookings',
    navHours:           'Hours & service',
    navOrders:          'Orders',
    navStocks:          'Inventory',
    navSuppliers:       'Suppliers',
    navReviews:         'Reviews',
    navClients:         'Customers & Loyalty',
    navPerformance:     'Performance',
    navInfluencers:     'Influencers & Creators',
    navFinance:         'Finances & Wallet',
    navFranchise:       'Franchise',
    navBriefing:        'Briefing',
    navNotifications:   'Notifications',
  },
  es: {
    groupRestaurant:    'Mi restaurante',
    groupDaily:         'Día a día',
    groupClients:       'Mis clientes',
    groupGrowth:        'Crecer',
    navHome:            'Inicio',
    navRestaurantCard:  'Mi carta',
    navRestaurantSingle:'Mi restaurante',
    navRestaurantMulti: 'Mis establecimientos',
    navTables:          'Mesas y reservas',
    navHours:           'Horario y servicio',
    navOrders:          'Pedidos',
    navStocks:          'Inventario',
    navSuppliers:       'Proveedores',
    navReviews:         'Reseñas',
    navClients:         'Clientes y Fidelidad',
    navPerformance:     'Rendimiento',
    navInfluencers:     'Influencers y Creadores',
    navFinance:         'Finanzas y Wallet',
    navFranchise:       'Franquicia',
    navBriefing:        'Resumen',
    navNotifications:   'Notificaciones',
  },
  it: {
    groupRestaurant:    'Il mio ristorante',
    groupDaily:         'Quotidiano',
    groupClients:       'I miei clienti',
    groupGrowth:        'Cresci',
    navHome:            'Home',
    navRestaurantCard:  'Il mio menù',
    navRestaurantSingle:'Il mio ristorante',
    navRestaurantMulti: 'I miei locali',
    navTables:          'Tavoli e prenotazioni',
    navHours:           'Orari e servizio',
    navOrders:          'Ordini',
    navStocks:          'Magazzino',
    navSuppliers:       'Fornitori',
    navReviews:         'Recensioni',
    navClients:         'Clienti e Fedeltà',
    navPerformance:     'Performance',
    navInfluencers:     'Influencer e Creator',
    navFinance:         'Finanze e Wallet',
    navFranchise:       'Franchising',
    navBriefing:        'Briefing',
    navNotifications:   'Notifiche',
  },
  ar: {
    groupRestaurant:    'مطعمي',
    groupDaily:         'يوميًا',
    groupClients:       'عملائي',
    groupGrowth:        'النمو',
    navHome:            'الرئيسية',
    navRestaurantCard:  'قائمتي',
    navRestaurantSingle:'مطعمي',
    navRestaurantMulti: 'منشآتي',
    navTables:          'الطاولات والحجوزات',
    navHours:           'المواعيد والخدمة',
    navOrders:          'الطلبات',
    navStocks:          'المخزون',
    navSuppliers:       'الموردون',
    navReviews:         'التقييمات',
    navClients:         'العملاء والولاء',
    navPerformance:     'الأداء',
    navInfluencers:     'المؤثرون والمبدعون',
    navFinance:         'المالية والمحفظة',
    navFranchise:       'الامتياز',
    navBriefing:        'الموجز',
    navNotifications:   'الإشعارات',
  },
}

for (const [loc, kv] of Object.entries(T)) {
  const p = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(p, 'utf8'))
  if (!m.dashboard) m.dashboard = {}
  if (!m.dashboard.sidebar) m.dashboard.sidebar = {}
  Object.assign(m.dashboard.sidebar, kv)
  fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`${loc}: dashboard.sidebar = ${Object.keys(m.dashboard.sidebar).length} keys (+${Object.keys(kv).length})`)
}
