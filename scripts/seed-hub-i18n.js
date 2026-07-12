// scripts/seed-hub-i18n.js
// C13-2 — Seeds the establishment HUB + breadcrumb labels across the 5 locales
// under dashboard.hub.*. Additive: only Object.assign's the new keys, never
// removes existing keys. Source of truth = fr.json; the other locales must stay
// complete (check:i18n). Dedicated seed — NOT translate-messages.js.
//
// Run:  node scripts/seed-hub-i18n.js   then   npm run check:i18n

const fs = require('fs')
const path = require('path')

const T = {
  fr: {
    bcRoot:        'Mes établissements',
    bcMenu:        'Menu',
    online:        'En ligne',
    offline:       'Hors ligne',
    accessHours:   'Horaires & service',
    accessTables:  'Tables & réservations',
    brandsTitle:   'Vos marques',
    brandsHint:    'Cliquez une marque pour ouvrir son menu',
    addBrand:      'Ajouter une marque',
    addBrandHint:  'Vierge ou copier une marque existante',
    openMenu:      'Voir le menu',
    statMenu:      'plats',
    statCreators:  'créateurs',
    statusActive:  'Active',
    statusPaused:  'En pause',
    emptyTitle:    'Aucune marque pour le moment',
    emptyDesc:     'Ajoutez votre première marque pour démarrer votre carte.',
    loading:       'Chargement…',
  },
  en: {
    bcRoot:        'My locations',
    bcMenu:        'Menu',
    online:        'Online',
    offline:       'Offline',
    accessHours:   'Hours & service',
    accessTables:  'Tables & bookings',
    brandsTitle:   'Your brands',
    brandsHint:    'Tap a brand to open its menu',
    addBrand:      'Add a brand',
    addBrandHint:  'From scratch or copy an existing brand',
    openMenu:      'View menu',
    statMenu:      'dishes',
    statCreators:  'creators',
    statusActive:  'Active',
    statusPaused:  'Paused',
    emptyTitle:    'No brand yet',
    emptyDesc:     'Add your first brand to start your menu.',
    loading:       'Loading…',
  },
  es: {
    bcRoot:        'Mis establecimientos',
    bcMenu:        'Menú',
    online:        'En línea',
    offline:       'Desconectado',
    accessHours:   'Horario y servicio',
    accessTables:  'Mesas y reservas',
    brandsTitle:   'Tus marcas',
    brandsHint:    'Toca una marca para abrir su menú',
    addBrand:      'Añadir una marca',
    addBrandHint:  'Desde cero o copiar una marca existente',
    openMenu:      'Ver menú',
    statMenu:      'platos',
    statCreators:  'creadores',
    statusActive:  'Activa',
    statusPaused:  'En pausa',
    emptyTitle:    'Aún no hay marcas',
    emptyDesc:     'Añade tu primera marca para empezar tu carta.',
    loading:       'Cargando…',
  },
  it: {
    bcRoot:        'I miei locali',
    bcMenu:        'Menù',
    online:        'Online',
    offline:       'Offline',
    accessHours:   'Orari e servizio',
    accessTables:  'Tavoli e prenotazioni',
    brandsTitle:   'I tuoi marchi',
    brandsHint:    'Tocca un marchio per aprire il suo menù',
    addBrand:      'Aggiungi un marchio',
    addBrandHint:  'Da zero o copia un marchio esistente',
    openMenu:      'Vedi menù',
    statMenu:      'piatti',
    statCreators:  'creator',
    statusActive:  'Attivo',
    statusPaused:  'In pausa',
    emptyTitle:    'Ancora nessun marchio',
    emptyDesc:     'Aggiungi il tuo primo marchio per iniziare il menù.',
    loading:       'Caricamento…',
  },
  ar: {
    bcRoot:        'منشآتي',
    bcMenu:        'القائمة',
    online:        'متصل',
    offline:       'غير متصل',
    accessHours:   'المواعيد والخدمة',
    accessTables:  'الطاولات والحجوزات',
    brandsTitle:   'علاماتك التجارية',
    brandsHint:    'اضغط على علامة تجارية لفتح قائمتها',
    addBrand:      'إضافة علامة تجارية',
    addBrandHint:  'من الصفر أو نسخ علامة موجودة',
    openMenu:      'عرض القائمة',
    statMenu:      'أطباق',
    statCreators:  'صنّاع المحتوى',
    statusActive:  'نشطة',
    statusPaused:  'متوقفة',
    emptyTitle:    'لا توجد علامات تجارية بعد',
    emptyDesc:     'أضف علامتك التجارية الأولى لبدء قائمتك.',
    loading:       'جارٍ التحميل…',
  },
}

for (const [loc, kv] of Object.entries(T)) {
  const p = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(p, 'utf8'))
  if (!m.dashboard) m.dashboard = {}
  if (!m.dashboard.hub) m.dashboard.hub = {}
  Object.assign(m.dashboard.hub, kv)
  fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`${loc}: dashboard.hub = ${Object.keys(m.dashboard.hub).length} keys (+${Object.keys(kv).length})`)
}
