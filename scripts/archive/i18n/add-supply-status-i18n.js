/* eslint-disable */
// ── Supply order STATUS + history i18n seeder (B2B Slice 3, Agent 14) ─────────
// Idempotent: status labels + supplier actions → `supplier` namespace; resto
// "my orders" + cancel → `marketplace` namespace. All 5 locales.
// Run: node scripts/add-supply-status-i18n.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

// supplier namespace — status labels (statusPlaced already exists) + supplier actions
const S = {
  statusConfirmed:  ['Confirmée', 'Confirmed', 'Confirmado', 'Confermato', 'مؤكَّد'],
  statusPreparing:  ['En préparation', 'Preparing', 'En preparación', 'In preparazione', 'قيد التحضير'],
  statusDelivered:  ['Livrée', 'Delivered', 'Entregado', 'Consegnato', 'تم التسليم'],
  statusCancelled:  ['Annulée', 'Cancelled', 'Cancelado', 'Annullato', 'ملغاة'],
  statusDeclined:   ['Refusée', 'Declined', 'Rechazado', 'Rifiutato', 'مرفوضة'],
  actionConfirmed:  ['Confirmer', 'Confirm', 'Confirmar', 'Conferma', 'تأكيد'],
  actionDeclined:   ['Refuser', 'Decline', 'Rechazar', 'Rifiuta', 'رفض'],
  actionPreparing:  ['Préparer', 'Prepare', 'Preparar', 'Prepara', 'تحضير'],
  actionDelivered:  ['Marquer livrée', 'Mark delivered', 'Marcar entregado', 'Segna consegnato', 'وضع كمسلَّمة'],
}

// marketplace namespace — resto order history + cancel
const M = {
  myOrdersTitle:    ['Mes commandes', 'My orders', 'Mis pedidos', 'I miei ordini', 'طلباتي'],
  myOrdersSubtitle: ['Suivez vos commandes fournisseurs.', 'Track your supplier orders.', 'Sigue tus pedidos a proveedores.', 'Segui i tuoi ordini ai fornitori.', 'تابع طلباتك من الموردين.'],
  myOrdersEmpty:    ['Aucune commande pour le moment.', 'No orders yet.', 'Aún no hay pedidos.', 'Ancora nessun ordine.', 'لا توجد طلبات بعد.'],
  myOrdersNav:      ['Mes commandes', 'My orders', 'Mis pedidos', 'I miei ordini', 'طلباتي'],
  orderTo:          ['Commande à {supplier}', 'Order to {supplier}', 'Pedido a {supplier}', 'Ordine a {supplier}', 'طلب إلى {supplier}'],
  actionCancel:     ['Annuler', 'Cancel', 'Cancelar', 'Annulla', 'إلغاء'],
  cancelConfirm:    ['Annuler cette commande ?', 'Cancel this order?', '¿Cancelar este pedido?', 'Annullare questo ordine?', 'إلغاء هذا الطلب؟'],
}

const sKeys = Object.keys(S)
const mKeys = Object.keys(M)
LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.supplier = json.supplier || {}
  for (const k of sKeys) json.supplier[k] = S[k][i]
  json.marketplace = json.marketplace || {}
  for (const k of mKeys) json.marketplace[k] = M[k][i]
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`  ✓ ${loc}.json — supplier status/actions (${sKeys.length}) + marketplace history (${mKeys.length})`)
})
console.log('[add-supply-status-i18n] done.')
