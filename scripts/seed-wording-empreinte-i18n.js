// scripts/seed-wording-empreinte-i18n.js
// Bloc H étape 3 — empreinte lifecycle wording update (copy-only, no new keys).
// The cycle changed: the hold is NO LONGER released at arrival. It stays
// active until the bill is paid (webhook releases it automatically) or until
// the traced closure settles it. Rewrites the 3 stale strings across the 5
// locales. Dedicated seed — NOT translate-messages.js.

const fs = require('fs')
const path = require('path')

const T = {
  fr: {
    depositIntro:       'Empreinte de {amount} — elle reste active jusqu’au paiement de l’addition et est libérée automatiquement au paiement. Vous ne serez débité qu’en cas de no-show.',
    noShowHint:         'Montant bloqué sur la carte du client à la réservation. L’empreinte reste active jusqu’au paiement de l’addition (libérée automatiquement au paiement). 0 = aucune empreinte demandée.',
    customerSeesPrefix: 'Le client voit : {amount}€ bloqués sur sa carte jusqu’au paiement de l’addition.',
  },
  en: {
    depositIntro:       'Hold of {amount} — it stays active until the bill is paid and is released automatically at payment. You are only charged in case of a no-show.',
    noShowHint:         'Amount held on the guest\'s card at booking. The hold stays active until the bill is paid (released automatically at payment). 0 = no hold required.',
    customerSeesPrefix: 'Guests see: {amount}€ held on their card until the bill is paid.',
  },
  es: {
    depositIntro:       'Huella de {amount} — permanece activa hasta el pago de la cuenta y se libera automáticamente al pagar. Solo se cobra en caso de no-show.',
    noShowHint:         'Importe retenido en la tarjeta del cliente al reservar. La huella permanece activa hasta el pago de la cuenta (liberada automáticamente al pagar). 0 = sin huella.',
    customerSeesPrefix: 'El cliente ve: {amount}€ retenidos en su tarjeta hasta el pago de la cuenta.',
  },
  it: {
    depositIntro:       'Impronta di {amount} — resta attiva fino al pagamento del conto e viene rilasciata automaticamente al pagamento. Verrai addebitato solo in caso di no-show.',
    noShowHint:         'Importo bloccato sulla carta del cliente alla prenotazione. L\'impronta resta attiva fino al pagamento del conto (rilasciata automaticamente al pagamento). 0 = nessuna impronta.',
    customerSeesPrefix: 'Il cliente vede: {amount}€ bloccati sulla sua carta fino al pagamento del conto.',
  },
  ar: {
    depositIntro:       'ضمان بقيمة {amount} — يبقى نشطًا حتى دفع الفاتورة ويُحرَّر تلقائيًا عند الدفع. لن يتم الخصم إلا في حال عدم الحضور.',
    noShowHint:         'مبلغ يُحجز على بطاقة العميل عند الحجز. يبقى الضمان نشطًا حتى دفع الفاتورة (يُحرَّر تلقائيًا عند الدفع). 0 = لا ضمان مطلوب.',
    customerSeesPrefix: 'يرى العميل: {amount}€ محجوزة على بطاقته حتى دفع الفاتورة.',
  },
}

for (const [loc, kv] of Object.entries(T)) {
  const p = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(p, 'utf8'))
  if (m.eat?.reservation) m.eat.reservation.depositIntro = kv.depositIntro
  if (m.tables?.noShow) {
    m.tables.noShow.depositHint = kv.noShowHint
    m.tables.noShow.customerSeesPrefix = kv.customerSeesPrefix
  }
  fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`${loc}: wording empreinte mis à jour (3 clés réécrites)`)
}
