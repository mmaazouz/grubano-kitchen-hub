#!/usr/bin/env node
// Seed the ghost-orders i18n keys (eat.track.* awaiting/expired states) into the
// 5 locale files. Additive + idempotent.
//   node scripts/seed-ghost-orders-i18n.js
const fs = require('fs')
const path = require('path')

const KEYS = {
  fr: {
    awaitingTitle: 'En attente de paiement',
    awaitingDesc:  'Votre commande sera transmise au restaurant dès que le paiement sera confirmé.',
    awaitingCta:   'Finaliser le paiement',
    expiredTitle:  'Commande expirée',
    expiredDesc:   'Le paiement n’a pas été finalisé — cette commande n’a pas été transmise au restaurant. Rien n’a été débité.',
  },
  en: {
    awaitingTitle: 'Awaiting payment',
    awaitingDesc:  'Your order will be sent to the restaurant as soon as the payment is confirmed.',
    awaitingCta:   'Finish the payment',
    expiredTitle:  'Order expired',
    expiredDesc:   'The payment was never completed — this order was not sent to the restaurant. Nothing was charged.',
  },
  es: {
    awaitingTitle: 'Pendiente de pago',
    awaitingDesc:  'Su pedido se enviará al restaurante en cuanto se confirme el pago.',
    awaitingCta:   'Finalizar el pago',
    expiredTitle:  'Pedido expirado',
    expiredDesc:   'El pago no se completó — este pedido no se envió al restaurante. No se cobró nada.',
  },
  it: {
    awaitingTitle: 'In attesa di pagamento',
    awaitingDesc:  'Il tuo ordine sarà inviato al ristorante non appena il pagamento sarà confermato.',
    awaitingCta:   'Completa il pagamento',
    expiredTitle:  'Ordine scaduto',
    expiredDesc:   'Il pagamento non è stato completato — questo ordine non è stato inviato al ristorante. Nulla è stato addebitato.',
  },
  ar: {
    awaitingTitle: 'بانتظار الدفع',
    awaitingDesc:  'سيُرسل طلبك إلى المطعم فور تأكيد الدفع.',
    awaitingCta:   'إتمام الدفع',
    expiredTitle:  'انتهت صلاحية الطلب',
    expiredDesc:   'لم يُستكمل الدفع — لم يُرسل هذا الطلب إلى المطعم. لم يُخصم أي مبلغ.',
  },
}

const messagesDir = path.join(__dirname, '..', 'messages')
for (const [locale, dict] of Object.entries(KEYS)) {
  const file = path.join(messagesDir, `${locale}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.eat = json.eat ?? {}
  json.eat.track = { ...(json.eat.track ?? {}), ...dict }
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`${locale}.json — eat.track: +${Object.keys(dict).length} keys`)
}
console.log('Done.')
