// scripts/seed-cloture-table-i18n.js
// Brique alerte impayé + clôturer la table (Agent 13).
// Additive ONLY. Dedicated seed — NOT translate-messages.js.
//
// Adds (per locale) under tickets.cloture.*:
//   unpaidTitle / unpaidBody / unpaidAmount / unpaidExplain
//   prevSession / actionPay / actionVoid
//   confirmVoidTitle / confirmVoidBody / confirmVoidCta / cancel
//   savingPay / savingVoid / voidedToast / paidToast
//   closeTitle / closeWithItems / closeEmpty / closeCta
//   releaseTable / inlinePayTitle / errPay / errVoid
//
// Run:  node scripts/seed-cloture-table-i18n.js   then   npm run check:i18n

const fs = require('fs')
const path = require('path')

const T = {
  fr: {
    unpaidTitle:       'Addition impayée du service précédent',
    unpaidBody:        'Cette table a une addition non réglée d’un client précédent. Encaissez-la ou annulez-la avant d’ouvrir l’addition du nouveau client.',
    unpaidAmount:      'Montant à régler : {amount}',
    unpaidExplain:     'Le n° de session ci-dessous correspond à l’addition impayée, pas au nouveau client.',
    prevSession:       'Service précédent',
    actionPay:         'Encaisser l’addition précédente',
    actionVoid:        'Annuler l’addition précédente',
    confirmVoidTitle:  'Annuler cette addition ?',
    confirmVoidBody:   'L’addition de {amount} sera annulée. Le client n’est PAS débité. Cette action ne peut pas être annulée. Utilisez « Encaisser » à la place s’il a consommé.',
    confirmVoidCta:    'Confirmer l’annulation',
    cancel:            'Annuler',
    savingPay:         'Préparation du paiement…',
    savingVoid:        'Annulation…',
    voidedToast:       'Addition annulée — table libérée',
    paidToast:         'Encaissé — table libérée',
    closeTitle:        'Clôturer la table',
    closeWithItems:    'Encaissez l’addition pour libérer la table.',
    closeEmpty:        'Aucun article — libérez la table sans encaisser.',
    closeCta:          'Encaisser & clôturer',
    releaseTable:      'Libérer la table',
    inlinePayTitle:    'Paiement',
    errPay:            'Impossible de démarrer le paiement. Réessayez.',
    errVoid:           'Impossible d’annuler. Réessayez.',
  },
  en: {
    unpaidTitle:       'Unpaid bill from previous service',
    unpaidBody:        'This table has an unpaid bill from a previous guest. Settle it or void it before opening the new guest\'s bill.',
    unpaidAmount:      'Amount due: {amount}',
    unpaidExplain:     'The session ID below refers to the unpaid bill, not the new guest.',
    prevSession:       'Previous service',
    actionPay:         'Settle the previous bill',
    actionVoid:        'Void the previous bill',
    confirmVoidTitle:  'Void this bill?',
    confirmVoidBody:   'The {amount} bill will be voided. The guest is NOT charged. This action cannot be undone. Use "Settle" instead if they consumed.',
    confirmVoidCta:    'Confirm void',
    cancel:            'Cancel',
    savingPay:         'Preparing payment…',
    savingVoid:        'Voiding…',
    voidedToast:       'Bill voided — table released',
    paidToast:         'Settled — table released',
    closeTitle:        'Close the table',
    closeWithItems:    'Settle the bill to free the table.',
    closeEmpty:        'No items — release the table without billing.',
    closeCta:          'Settle & close',
    releaseTable:      'Release the table',
    inlinePayTitle:    'Payment',
    errPay:            'Could not start the payment. Please retry.',
    errVoid:           'Could not void. Please retry.',
  },
  es: {
    unpaidTitle:       'Cuenta sin pagar del servicio anterior',
    unpaidBody:        'Esta mesa tiene una cuenta sin pagar de un cliente anterior. Cóbrala o anúlala antes de abrir la cuenta del nuevo cliente.',
    unpaidAmount:      'Importe a pagar: {amount}',
    unpaidExplain:     'El ID de sesión a continuación corresponde a la cuenta impagada, no al nuevo cliente.',
    prevSession:       'Servicio anterior',
    actionPay:         'Cobrar la cuenta anterior',
    actionVoid:        'Anular la cuenta anterior',
    confirmVoidTitle:  '¿Anular esta cuenta?',
    confirmVoidBody:   'La cuenta de {amount} se anulará. El cliente NO es cobrado. Esta acción no se puede deshacer. Usa «Cobrar» si consumió.',
    confirmVoidCta:    'Confirmar anulación',
    cancel:            'Cancelar',
    savingPay:         'Preparando el pago…',
    savingVoid:        'Anulando…',
    voidedToast:       'Cuenta anulada — mesa liberada',
    paidToast:         'Cobrado — mesa liberada',
    closeTitle:        'Cerrar la mesa',
    closeWithItems:    'Cobra la cuenta para liberar la mesa.',
    closeEmpty:        'Sin artículos — libera la mesa sin cobrar.',
    closeCta:          'Cobrar y cerrar',
    releaseTable:      'Liberar la mesa',
    inlinePayTitle:    'Pago',
    errPay:            'No se pudo iniciar el pago. Inténtalo de nuevo.',
    errVoid:           'No se pudo anular. Inténtalo de nuevo.',
  },
  it: {
    unpaidTitle:       'Conto non pagato del servizio precedente',
    unpaidBody:        'Questo tavolo ha un conto non pagato di un cliente precedente. Incassalo o annullalo prima di aprire il conto del nuovo cliente.',
    unpaidAmount:      'Importo da pagare: {amount}',
    unpaidExplain:     'L\'ID sessione qui sotto si riferisce al conto non pagato, non al nuovo cliente.',
    prevSession:       'Servizio precedente',
    actionPay:         'Incassa il conto precedente',
    actionVoid:        'Annulla il conto precedente',
    confirmVoidTitle:  'Annullare questo conto?',
    confirmVoidBody:   'Il conto di {amount} sarà annullato. Il cliente NON viene addebitato. Azione irreversibile. Usa «Incassa» se ha consumato.',
    confirmVoidCta:    'Conferma annullamento',
    cancel:            'Annulla',
    savingPay:         'Preparazione del pagamento…',
    savingVoid:        'Annullamento…',
    voidedToast:       'Conto annullato — tavolo liberato',
    paidToast:         'Incassato — tavolo liberato',
    closeTitle:        'Chiudi il tavolo',
    closeWithItems:    'Incassa il conto per liberare il tavolo.',
    closeEmpty:        'Nessun articolo — libera il tavolo senza incassare.',
    closeCta:          'Incassa e chiudi',
    releaseTable:      'Libera il tavolo',
    inlinePayTitle:    'Pagamento',
    errPay:            'Impossibile avviare il pagamento. Riprova.',
    errVoid:           'Impossibile annullare. Riprova.',
  },
  ar: {
    unpaidTitle:       'فاتورة غير مدفوعة من الخدمة السابقة',
    unpaidBody:        'هذه الطاولة لديها فاتورة غير مدفوعة من زبون سابق. اقبضها أو ألغها قبل فتح فاتورة الزبون الجديد.',
    unpaidAmount:      'المبلغ المستحق: {amount}',
    unpaidExplain:     'معرّف الجلسة أدناه يخصّ الفاتورة غير المدفوعة، وليس الزبون الجديد.',
    prevSession:       'الخدمة السابقة',
    actionPay:         'قبض الفاتورة السابقة',
    actionVoid:        'إلغاء الفاتورة السابقة',
    confirmVoidTitle:  'إلغاء هذه الفاتورة؟',
    confirmVoidBody:   'سيتم إلغاء فاتورة {amount}. لن يتم خصم أي مبلغ من الزبون. لا يمكن التراجع. استخدم «قبض» إذا استهلك.',
    confirmVoidCta:    'تأكيد الإلغاء',
    cancel:            'إلغاء',
    savingPay:         'جارٍ تجهيز الدفع…',
    savingVoid:        'جارٍ الإلغاء…',
    voidedToast:       'تم إلغاء الفاتورة — تم تحرير الطاولة',
    paidToast:         'تم القبض — تم تحرير الطاولة',
    closeTitle:        'إغلاق الطاولة',
    closeWithItems:    'اقبض الفاتورة لتحرير الطاولة.',
    closeEmpty:        'لا توجد عناصر — حرّر الطاولة دون قبض.',
    closeCta:          'القبض والإغلاق',
    releaseTable:      'تحرير الطاولة',
    inlinePayTitle:    'الدفع',
    errPay:            'تعذر بدء الدفع. أعد المحاولة.',
    errVoid:           'تعذر الإلغاء. أعد المحاولة.',
  },
}

for (const [loc, kv] of Object.entries(T)) {
  const p = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(p, 'utf8'))
  if (!m.tickets) m.tickets = {}
  if (!m.tickets.cloture) m.tickets.cloture = {}
  Object.assign(m.tickets.cloture, kv)
  fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`${loc}: +tickets.cloture.* (${Object.keys(kv).length} keys)`)
}
