// scripts/seed-vague1-finitions-i18n.js
// Vague 1 finitions — i18n for the "Créer une marque" empty-states + the
// establishment-card → hub discoverability affordance. Across the 5 locales.
// Additive / copy-only: Object.assign's the keys below, never removes anything.
// Source of truth = fr.json; all locales must stay complete (check:i18n).
// Dedicated seed — NOT translate-messages.js.
//
//   dashboard.hub.emptyCta          → CTA button on the hub's 0-brand empty state
//   establishment.openHub           → card affordance label (→ brands & menus)
//   establishment.openHubAria        → stretched-link aria-label ({name})
//   menu.empty.{title,desc,cta}      → rewritten copy: explicit + actionable,
//                                      drops the jargon "Configurer ma marque"
//
// Run:  node scripts/seed-vague1-finitions-i18n.js   then   npm run check:i18n

const fs = require('fs')
const path = require('path')

const T = {
  fr: {
    hub:   { emptyCta: 'Créer une marque' },
    estab: {
      openHub:     'Voir les marques & menus',
      openHubAria: 'Ouvrir {name} — voir ses marques et menus',
    },
    menuEmpty: {
      title: 'Aucune marque pour le moment',
      desc:  'Créez votre première marque pour démarrer votre carte et ajouter vos plats.',
      cta:   'Créer une marque',
    },
  },
  en: {
    hub:   { emptyCta: 'Create a brand' },
    estab: {
      openHub:     'View brands & menus',
      openHubAria: 'Open {name} — view its brands and menus',
    },
    menuEmpty: {
      title: 'No brand yet',
      desc:  'Create your first brand to start your menu and add your dishes.',
      cta:   'Create a brand',
    },
  },
  es: {
    hub:   { emptyCta: 'Crear una marca' },
    estab: {
      openHub:     'Ver marcas y menús',
      openHubAria: 'Abrir {name} — ver sus marcas y menús',
    },
    menuEmpty: {
      title: 'Aún no hay marcas',
      desc:  'Crea tu primera marca para empezar tu carta y añadir tus platos.',
      cta:   'Crear una marca',
    },
  },
  it: {
    hub:   { emptyCta: 'Crea un marchio' },
    estab: {
      openHub:     'Vedi marchi e menù',
      openHubAria: 'Apri {name} — vedi i suoi marchi e menù',
    },
    menuEmpty: {
      title: 'Ancora nessun marchio',
      desc:  'Crea il tuo primo marchio per iniziare il menù e aggiungere i tuoi piatti.',
      cta:   'Crea un marchio',
    },
  },
  ar: {
    hub:   { emptyCta: 'إنشاء علامة تجارية' },
    estab: {
      openHub:     'عرض العلامات والقوائم',
      openHubAria: 'فتح {name} — عرض علاماته التجارية وقوائمه',
    },
    menuEmpty: {
      title: 'لا توجد علامة تجارية بعد',
      desc:  'أنشئ علامتك التجارية الأولى لبدء قائمتك وإضافة أطباقك.',
      cta:   'إنشاء علامة تجارية',
    },
  },
}

for (const [loc, kv] of Object.entries(T)) {
  const p = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(p, 'utf8'))

  // dashboard.hub.emptyCta
  if (!m.dashboard) m.dashboard = {}
  if (!m.dashboard.hub) m.dashboard.hub = {}
  Object.assign(m.dashboard.hub, kv.hub)

  // establishment.openHub / openHubAria
  if (!m.establishment) m.establishment = {}
  Object.assign(m.establishment, kv.estab)

  // menu.empty.{title,desc,cta} (rewritten copy)
  if (!m.menu) m.menu = {}
  if (!m.menu.empty) m.menu.empty = {}
  Object.assign(m.menu.empty, kv.menuEmpty)

  fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`${loc}: +hub.emptyCta, +establishment.openHub/openHubAria, menu.empty rewritten`)
}
