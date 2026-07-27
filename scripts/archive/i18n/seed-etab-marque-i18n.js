// scripts/seed-etab-marque-i18n.js
// Refonte UX établissement/marque + suppression /brands redondance.
// Additive ONLY: Object.assign's the keys below into each locale, never removes
// anything. Source of truth = fr.json; all locales must stay complete
// (npm run check:i18n). Dedicated seed — NOT translate-messages.js.
//
// Adds (per locale):
//   dashboard.hub.accessDelivery    → 3rd access chip "Livraison · Retrait" (→ /dashboard/fulfillment)
//   dashboard.hub.editBrand         → discrete pencil button aria-label on each brand card
//   dashboard.hub.deleteBrand       → discrete trash button aria-label on each brand card
//   dashboard.hub.editBrandAria     → "Modifier la marque {name}"
//   dashboard.hub.deleteBrandAria   → "Supprimer la marque {name}"
//   dashboard.hub.brandActionsHint  → tiny "Actions" caption shown next to icons
//   brands.pageTitleCreate          → /brands stripped page header "Nouvelle marque"
//   brands.pageDescCreate           → explanatory subtitle
//   brands.backToHub                → link back to /dashboard/establishments
//
// Reuses existing keys (NOT redefined here):
//   brands.editTitle / brands.createTitle / brands.deleteConfirmTitle
//   brands.editBrand / brands.deleteBrand (modal-level labels)
//   brands.confirmDelete / brands.cancel
//   brands.errDeleteMenu / brands.errDeleteLastBrand / brands.errDeleteRelated / brands.errDeleteFailed
//
// Run:  node scripts/seed-etab-marque-i18n.js   then   npm run check:i18n

const fs = require('fs')
const path = require('path')

const T = {
  fr: {
    hub: {
      accessDelivery:   'Livraison · Retrait',
      editBrand:        'Modifier',
      deleteBrand:      'Supprimer',
      editBrandAria:    'Modifier la marque {name}',
      deleteBrandAria:  'Supprimer la marque {name}',
      brandActionsHint: 'Actions',
    },
    brands: {
      pageTitleCreate: 'Nouvelle marque',
      pageDescCreate:  'Créez une marque à partir de zéro ou copiez une marque existante vers cet établissement.',
      backToHub:       'Retour à mes établissements',
    },
  },
  en: {
    hub: {
      accessDelivery:   'Delivery · Pickup',
      editBrand:        'Edit',
      deleteBrand:      'Delete',
      editBrandAria:    'Edit brand {name}',
      deleteBrandAria:  'Delete brand {name}',
      brandActionsHint: 'Actions',
    },
    brands: {
      pageTitleCreate: 'New brand',
      pageDescCreate:  'Create a brand from scratch, or copy an existing brand into this establishment.',
      backToHub:       'Back to my establishments',
    },
  },
  es: {
    hub: {
      accessDelivery:   'Entrega · Recogida',
      editBrand:        'Editar',
      deleteBrand:      'Eliminar',
      editBrandAria:    'Editar la marca {name}',
      deleteBrandAria:  'Eliminar la marca {name}',
      brandActionsHint: 'Acciones',
    },
    brands: {
      pageTitleCreate: 'Nueva marca',
      pageDescCreate:  'Crea una marca desde cero o copia una marca existente a este establecimiento.',
      backToHub:       'Volver a mis establecimientos',
    },
  },
  it: {
    hub: {
      accessDelivery:   'Consegna · Ritiro',
      editBrand:        'Modifica',
      deleteBrand:      'Elimina',
      editBrandAria:    'Modifica il marchio {name}',
      deleteBrandAria:  'Elimina il marchio {name}',
      brandActionsHint: 'Azioni',
    },
    brands: {
      pageTitleCreate: 'Nuovo marchio',
      pageDescCreate:  'Crea un marchio da zero o copia un marchio esistente in questa struttura.',
      backToHub:       'Torna alle mie strutture',
    },
  },
  ar: {
    hub: {
      accessDelivery:   'التوصيل · الاستلام',
      editBrand:        'تعديل',
      deleteBrand:      'حذف',
      editBrandAria:    'تعديل العلامة التجارية {name}',
      deleteBrandAria:  'حذف العلامة التجارية {name}',
      brandActionsHint: 'إجراءات',
    },
    brands: {
      pageTitleCreate: 'علامة تجارية جديدة',
      pageDescCreate:  'أنشئ علامة تجارية من الصفر أو انسخ علامة تجارية موجودة إلى هذه المنشأة.',
      backToHub:       'العودة إلى منشآتي',
    },
  },
}

for (const [loc, kv] of Object.entries(T)) {
  const p = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(p, 'utf8'))

  if (!m.dashboard) m.dashboard = {}
  if (!m.dashboard.hub) m.dashboard.hub = {}
  Object.assign(m.dashboard.hub, kv.hub)

  if (!m.brands) m.brands = {}
  Object.assign(m.brands, kv.brands)

  fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`${loc}: +dashboard.hub.* (6) +brands.* (3)`)
}
