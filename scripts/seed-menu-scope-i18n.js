// scripts/seed-menu-scope-i18n.js
// /menu : scoping par établissement + fil d'Ariane (Agent 13).
// Additive ONLY: Object.assign's the keys below into each locale, never
// removes anything. Source of truth = fr.json; all locales must stay complete
// (npm run check:i18n). Dedicated seed — NOT translate-messages.js.
//
// Adds (per locale):
//   menu.bc.root         → breadcrumb root  "Mes établissements" → /dashboard/establishments
//   menu.bc.menuLabel    → breadcrumb tail  "Menu" (current page, non-clickable)
//   menu.brandsHint      → sober hint above the brand selector
//                          ("Marques de cet établissement")
//   menu.brandsAria      → aria-label on the brand selector group
//
// Reuses existing keys (NOT redefined here):
//   menu.empty.* / menu.loading / menu.adopt.*
//
// Run:  node scripts/seed-menu-scope-i18n.js   then   npm run check:i18n

const fs = require('fs')
const path = require('path')

const T = {
  fr: {
    bc: {
      root:      'Mes établissements',
      menuLabel: 'Menu',
    },
    brandsHint: 'Marques de cet établissement',
    brandsAria: 'Choisir une marque',
  },
  en: {
    bc: {
      root:      'My establishments',
      menuLabel: 'Menu',
    },
    brandsHint: 'Brands of this establishment',
    brandsAria: 'Choose a brand',
  },
  es: {
    bc: {
      root:      'Mis establecimientos',
      menuLabel: 'Menú',
    },
    brandsHint: 'Marcas de este establecimiento',
    brandsAria: 'Elegir una marca',
  },
  it: {
    bc: {
      root:      'Le mie strutture',
      menuLabel: 'Menù',
    },
    brandsHint: 'Marchi di questa struttura',
    brandsAria: 'Scegli un marchio',
  },
  ar: {
    bc: {
      root:      'منشآتي',
      menuLabel: 'القائمة',
    },
    brandsHint: 'علامات هذه المنشأة',
    brandsAria: 'اختر علامة تجارية',
  },
}

for (const [loc, kv] of Object.entries(T)) {
  const p = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(p, 'utf8'))

  if (!m.menu) m.menu = {}
  if (!m.menu.bc) m.menu.bc = {}
  Object.assign(m.menu.bc, kv.bc)
  m.menu.brandsHint = kv.brandsHint
  m.menu.brandsAria = kv.brandsAria

  fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`${loc}: +menu.bc.{root,menuLabel} +menu.brandsHint +menu.brandsAria`)
}
