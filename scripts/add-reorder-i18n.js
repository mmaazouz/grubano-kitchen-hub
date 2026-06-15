/* eslint-disable */
// ── Stock → reorder bridge i18n seeder (B2B Slice 4, Agent 14) ────────────────
// Idempotent: adds the reorder panel + discovery-search keys to the `marketplace`
// namespace in all 5 locale files. Run: node scripts/add-reorder-i18n.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

const M = {
  reorderTitle:      ['À réapprovisionner', 'To reorder', 'Para reabastecer', 'Da riordinare', 'لإعادة التزويد'],
  reorderSubtitle:   ['Vos produits en stock bas — commandez chez un fournisseur.', 'Your low-stock products — order from a supplier.', 'Tus productos con stock bajo — compra a un proveedor.', 'I tuoi prodotti con scorte basse — ordina da un fornitore.', 'منتجاتك منخفضة المخزون — اطلب من مورّد.'],
  reorderEmpty:      ['Aucun produit en stock bas. 👍', 'No low-stock products. 👍', 'No hay productos con stock bajo. 👍', 'Nessun prodotto con scorte basse. 👍', 'لا توجد منتجات منخفضة المخزون. 👍'],
  findSuppliers:     ['Chercher chez les fournisseurs', 'Find suppliers', 'Buscar proveedores', 'Cerca fornitori', 'ابحث عن موردين'],
  stockMin:          ['seuil {min} {unit}', 'threshold {min} {unit}', 'umbral {min} {unit}', 'soglia {min} {unit}', 'الحد {min} {unit}'],
  stockUrgent:       ['Critique', 'Critical', 'Crítico', 'Critico', 'حرج'],
  stockSoon:         ['Bas', 'Low', 'Bajo', 'Basso', 'منخفض'],
  browseAll:         ['Parcourir tous les fournisseurs', 'Browse all suppliers', 'Ver todos los proveedores', 'Sfoglia tutti i fornitori', 'تصفّح كل الموردين'],
  searchPlaceholder: ['Rechercher un produit…', 'Search a product…', 'Buscar un producto…', 'Cerca un prodotto…', 'ابحث عن منتج…'],
  noMatch:           ['Aucun fournisseur ne propose « {q} ».', 'No supplier offers “{q}”.', 'Ningún proveedor ofrece «{q}».', 'Nessun fornitore offre «{q}».', 'لا يوجد مورّد يقدّم «{q}».'],
}

const keys = Object.keys(M)
LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.marketplace = json.marketplace || {}
  for (const k of keys) json.marketplace[k] = M[k][i]
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`  ✓ ${loc}.json — marketplace reorder/search (${keys.length} keys)`)
})
console.log('[add-reorder-i18n] done.')
