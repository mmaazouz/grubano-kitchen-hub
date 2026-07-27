#!/usr/bin/env node
// Seed the Orders-v2 i18n keys (tabs + new-order toast + see-more) into the
// `orders` namespace of the 5 locale files. Additive + idempotent.
//   node scripts/seed-orders-v2-i18n.js
const fs = require('fs')
const path = require('path')

const KEYS = {
  fr: {
    tabTodo: 'À traiter', tabInProgress: 'En cours', tabDone: 'Terminées',
    newOrderToast: 'Nouvelle commande',
    newOrdersToast: '{count} nouvelles commandes',
    seeMore: 'Voir plus',
  },
  en: {
    tabTodo: 'To handle', tabInProgress: 'In progress', tabDone: 'Completed',
    newOrderToast: 'New order',
    newOrdersToast: '{count} new orders',
    seeMore: 'Show more',
  },
  es: {
    tabTodo: 'Por gestionar', tabInProgress: 'En curso', tabDone: 'Completados',
    newOrderToast: 'Nuevo pedido',
    newOrdersToast: '{count} nuevos pedidos',
    seeMore: 'Ver más',
  },
  it: {
    tabTodo: 'Da gestire', tabInProgress: 'In corso', tabDone: 'Completati',
    newOrderToast: 'Nuovo ordine',
    newOrdersToast: '{count} nuovi ordini',
    seeMore: 'Mostra altro',
  },
  ar: {
    tabTodo: 'قيد المعالجة', tabInProgress: 'جارية', tabDone: 'منتهية',
    newOrderToast: 'طلب جديد',
    newOrdersToast: '{count} طلبات جديدة',
    seeMore: 'عرض المزيد',
  },
}

const messagesDir = path.join(__dirname, '..', 'messages')
for (const [locale, dict] of Object.entries(KEYS)) {
  const file = path.join(messagesDir, `${locale}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.orders = { ...(json.orders ?? {}), ...dict }
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`${locale}.json — orders: +${Object.keys(dict).length} keys`)
}
console.log('Done.')
