/* eslint-disable */
// ── B2B marketplace (Slice 2) i18n seeder — Agent 14 ──────────────────────────
// Idempotent: adds the `marketplace` namespace (resto discovery + cart/order) and
// the supplier-reception keys to the `supplier` namespace, in all 5 locale files.
// Run: node scripts/add-marketplace-i18n.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

// marketplace namespace — key → [fr, en, es, it, ar]
const M = {
  discoverTitle:    ['Fournisseurs', 'Suppliers', 'Proveedores', 'Fornitori', 'الموردون'],
  discoverSubtitle: ['Commandez auprès des fournisseurs de la plateforme.', 'Order from the platform suppliers.', 'Compra a los proveedores de la plataforma.', 'Ordina dai fornitori della piattaforma.', 'اطلب من موردي المنصة.'],
  discoverEmpty:    ['Aucun fournisseur actif pour le moment.', 'No active suppliers yet.', 'Aún no hay proveedores activos.', 'Ancora nessun fornitore attivo.', 'لا يوجد موردون نشطون بعد.'],
  errLoad:          ['Impossible de charger les fournisseurs.', 'Could not load suppliers.', 'No se pudieron cargar los proveedores.', 'Impossibile caricare i fornitori.', 'تعذّر تحميل الموردين.'],
  products:         ['{count} produits', '{count} products', '{count} productos', '{count} prodotti', '{count} منتجات'],
  minOrder:         ['Min. {amount}', 'Min. {amount}', 'Mín. {amount}', 'Min. {amount}', 'الحد الأدنى {amount}'],
  backToList:       ['Tous les fournisseurs', 'All suppliers', 'Todos los proveedores', 'Tutti i fornitori', 'كل الموردين'],
  supplierNotFound: ['Fournisseur introuvable.', 'Supplier not found.', 'Proveedor no encontrado.', 'Fornitore non trovato.', 'المورّد غير موجود.'],
  catalogEmpty:     ['Ce fournisseur n’a pas encore de produits.', 'This supplier has no products yet.', 'Este proveedor aún no tiene productos.', 'Questo fornitore non ha ancora prodotti.', 'لا توجد منتجات لهذا المورّد بعد.'],
  addToCart:        ['Ajouter', 'Add', 'Añadir', 'Aggiungi', 'إضافة'],
  cartTitle:        ['Votre commande', 'Your order', 'Tu pedido', 'Il tuo ordine', 'طلبك'],
  cartTotal:        ['Total', 'Total', 'Total', 'Totale', 'الإجمالي'],
  cartCount:        ['{count} articles', '{count} items', '{count} artículos', '{count} articoli', '{count} عناصر'],
  placeOrder:       ['Passer commande', 'Place order', 'Realizar pedido', 'Invia ordine', 'إرسال الطلب'],
  placing:          ['Envoi…', 'Placing…', 'Enviando…', 'Invio…', 'جارٍ الإرسال…'],
  confirmOrder:     ['Confirmer la commande', 'Confirm order', 'Confirmar pedido', 'Conferma ordine', 'تأكيد الطلب'],
  close:            ['Fermer', 'Close', 'Cerrar', 'Chiudi', 'إغلاق'],
  notesLabel:       ['Note pour le fournisseur (optionnel)', 'Note for the supplier (optional)', 'Nota para el proveedor (opcional)', 'Nota per il fornitore (facoltativa)', 'ملاحظة للمورّد (اختياري)'],
  notesPlaceholder: ['Livraison, horaires…', 'Delivery, timing…', 'Entrega, horarios…', 'Consegna, orari…', 'التوصيل، المواعيد…'],
  minOrderWarning:  ['Minimum {amount}', 'Minimum {amount}', 'Mínimo {amount}', 'Minimo {amount}', 'الحد الأدنى {amount}'],
  orderPlacedTitle: ['Commande envoyée', 'Order placed', 'Pedido enviado', 'Ordine inviato', 'تم إرسال الطلب'],
  orderPlacedBody:  ['Votre commande a été transmise à {supplier}.', 'Your order was sent to {supplier}.', 'Tu pedido se envió a {supplier}.', 'Il tuo ordine è stato inviato a {supplier}.', 'تم إرسال طلبك إلى {supplier}.'],
  backToSuppliers:  ['Retour aux fournisseurs', 'Back to suppliers', 'Volver a proveedores', 'Torna ai fornitori', 'العودة إلى الموردين'],
  errOrder:         ['La commande a échoué. Réessayez.', 'The order failed. Please try again.', 'El pedido falló. Inténtalo de nuevo.', 'Ordine non riuscito. Riprova.', 'فشل الطلب. حاول مرة أخرى.'],
}

// supplier namespace additions (reception page + dashboard CTA)
const S = {
  ordersTitle:        ['Commandes reçues', 'Received orders', 'Pedidos recibidos', 'Ordini ricevuti', 'الطلبات الواردة'],
  ordersSubtitle:     ['Les commandes passées par les restaurateurs.', 'Orders placed by restaurateurs.', 'Pedidos realizados por los restauradores.', 'Ordini effettuati dai ristoratori.', 'الطلبات التي قدّمها أصحاب المطاعم.'],
  ordersEmpty:        ['Aucune commande pour le moment.', 'No orders yet.', 'Aún no hay pedidos.', 'Ancora nessun ordine.', 'لا توجد طلبات بعد.'],
  ordersFrom:         ['Commande de {name}', 'Order from {name}', 'Pedido de {name}', 'Ordine da {name}', 'طلب من {name}'],
  orderNotes:         ['Note', 'Note', 'Nota', 'Nota', 'ملاحظة'],
  orderTotal:         ['Total', 'Total', 'Total', 'Totale', 'الإجمالي'],
  statusPlaced:       ['Reçue', 'Placed', 'Recibido', 'Ricevuto', 'مستلَم'],
  dashOrdersSubtitle: ['Commandes entrantes des restaurateurs', 'Incoming orders from restaurateurs', 'Pedidos entrantes de los restauradores', 'Ordini in arrivo dai ristoratori', 'الطلبات الواردة من المطاعم'],
}

const mKeys = Object.keys(M)
const sKeys = Object.keys(S)
LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.marketplace = json.marketplace || {}
  for (const k of mKeys) json.marketplace[k] = M[k][i]
  json.supplier = json.supplier || {}
  for (const k of sKeys) json.supplier[k] = S[k][i]
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`  ✓ ${loc}.json — marketplace (${mKeys.length}) + supplier orders (${sKeys.length})`)
})
console.log('[add-marketplace-i18n] done.')
