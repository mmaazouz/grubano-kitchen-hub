// Fix #3 + #5: clearer labels.
//   #3 establishment.activeChip ("Actif") → establishment.selectedChip
//      ("Sélectionné") — the badge marks the establishment CURRENTLY DRIVING the
//      dashboard, distinct from the En ligne / Hors ligne validation status.
//   #5 brands.darkKitchen ("Dark kitchen · Grubano", bad literal AR) →
//      brands.brandKind ("Marque virtuelle") — plain language, no raw jargon.

const fs = require('fs')
const path = require('path')

const SELECTED = { fr: 'Sélectionné', en: 'Selected', es: 'Seleccionado', it: 'Selezionato', ar: 'محدد' }
const BRAND_KIND = { fr: 'Marque virtuelle', en: 'Virtual brand', es: 'Marca virtual', it: 'Marchio virtuale', ar: 'علامة افتراضية' }

for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
  const p = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(p, 'utf8'))

  if (!m.establishment) m.establishment = {}
  m.establishment.selectedChip = SELECTED[loc]
  delete m.establishment.activeChip

  if (!m.brands) m.brands = {}
  m.brands.brandKind = BRAND_KIND[loc]
  delete m.brands.darkKitchen

  fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`${loc}: selectedChip set / activeChip removed · brandKind set / darkKitchen removed`)
}
