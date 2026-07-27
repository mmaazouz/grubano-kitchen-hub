// scripts/seed-brique2-paiement-i18n.js
// Brique 2 paiement addition (Agent 13) — page /t/[tableId] + bouton conso.
// Additive ONLY. Dedicated seed — NOT translate-messages.js.
//
// Adds (per locale) under bill.*:
//   loadingTicket / loadingPay / processing
//   noTicketTitle / noTicketDesc
//   yourBill / item / total
//   payTitle / payButton / payIntro (with {amount})
//   payRealDebitNote
//   testCardHint
//   paidTitle / paidBody
//   errAlreadyPaid / errCardDeclined / errGeneric / errLoad / errStripeNotReady
//   accountSectionTitle / accountSubtitle
//   accountReservationLine (with {restaurant, date})
//   accountPayButton / accountNoTicket
//   accountClearLastResa
//   close
//
// Run:  node scripts/seed-brique2-paiement-i18n.js   then   npm run check:i18n

const fs = require('fs')
const path = require('path')

const T = {
  fr: {
    loadingTicket:        'Chargement de votre addition…',
    loadingPay:           'Préparation du paiement…',
    processing:           'Paiement en cours…',
    noTicketTitle:        'Votre addition arrive bientôt',
    noTicketDesc:         'Le restaurant ouvrira votre addition. Vous pourrez la régler ici dès qu’elle sera prête.',
    yourBill:             'Votre addition',
    item:                 'Article',
    total:                'Total',
    payTitle:             'Payer mon addition',
    payButton:            'Payer maintenant',
    payIntro:             'Vous réglez {amount} — débit immédiat. L’empreinte de garantie de votre réservation est libérée automatiquement.',
    payRealDebitNote:     'Ce paiement est un vrai débit (capture immédiate), pas une empreinte.',
    testCardHint:         'Carte de test : 4242 4242 4242 4242, date future, CVC libre.',
    paidTitle:            'Payé ✅ Merci !',
    paidBody:             'Votre addition a été réglée. À très vite !',
    errAlreadyPaid:       'Addition déjà payée.',
    errCardDeclined:      'Carte refusée. Essayez une autre carte.',
    errGeneric:           'Le paiement a échoué. Vérifiez votre carte et réessayez.',
    errLoad:              'Impossible de charger votre addition.',
    errStripeNotReady:    'Le paiement n’est pas disponible. Réessayez dans un instant.',
    accountSectionTitle:  'Votre dernière réservation',
    accountSubtitle:      'Payez votre addition sans scanner.',
    accountReservationLine: '{restaurant} · {date}',
    accountPayButton:     'Payer mon addition',
    accountNoTicket:      'Aucune addition en cours sur votre table.',
    accountClearLastResa: 'Retirer cette réservation',
    close:                'Fermer',
  },
  en: {
    loadingTicket:        'Loading your bill…',
    loadingPay:           'Preparing payment…',
    processing:           'Processing payment…',
    noTicketTitle:        'Your bill is on the way',
    noTicketDesc:         'The restaurant will open your bill. You\'ll be able to pay right here as soon as it\'s ready.',
    yourBill:             'Your bill',
    item:                 'Item',
    total:                'Total',
    payTitle:             'Pay my bill',
    payButton:            'Pay now',
    payIntro:             'You\'re paying {amount} — immediate charge. The reservation hold is released automatically.',
    payRealDebitNote:     'This payment is a real charge (immediate capture), not a hold.',
    testCardHint:         'Test card: 4242 4242 4242 4242, future date, any CVC.',
    paidTitle:            'Paid ✅ Thank you!',
    paidBody:             'Your bill has been paid. See you soon!',
    errAlreadyPaid:       'Bill already paid.',
    errCardDeclined:      'Card declined. Try another card.',
    errGeneric:           'Payment failed. Check your card and retry.',
    errLoad:              'Could not load your bill.',
    errStripeNotReady:    'Payment is not available. Please retry shortly.',
    accountSectionTitle:  'Your last reservation',
    accountSubtitle:      'Pay your bill without scanning.',
    accountReservationLine: '{restaurant} · {date}',
    accountPayButton:     'Pay my bill',
    accountNoTicket:      'No bill open on your table yet.',
    accountClearLastResa: 'Remove this reservation',
    close:                'Close',
  },
  es: {
    loadingTicket:        'Cargando tu cuenta…',
    loadingPay:           'Preparando el pago…',
    processing:           'Procesando el pago…',
    noTicketTitle:        'Tu cuenta llega pronto',
    noTicketDesc:         'El restaurante abrirá tu cuenta. Podrás pagar aquí en cuanto esté lista.',
    yourBill:             'Tu cuenta',
    item:                 'Artículo',
    total:                'Total',
    payTitle:             'Pagar mi cuenta',
    payButton:            'Pagar ahora',
    payIntro:             'Estás pagando {amount} — cobro inmediato. La huella de la reserva se libera automáticamente.',
    payRealDebitNote:     'Este pago es un cobro real (captura inmediata), no una huella.',
    testCardHint:         'Tarjeta de prueba: 4242 4242 4242 4242, fecha futura, CVC libre.',
    paidTitle:            '¡Pagado ✅ Gracias!',
    paidBody:             'Tu cuenta ha sido pagada. ¡Hasta pronto!',
    errAlreadyPaid:       'Cuenta ya pagada.',
    errCardDeclined:      'Tarjeta rechazada. Prueba otra tarjeta.',
    errGeneric:           'Pago fallido. Comprueba tu tarjeta y reintenta.',
    errLoad:              'No se pudo cargar tu cuenta.',
    errStripeNotReady:    'El pago no está disponible. Reintenta en un momento.',
    accountSectionTitle:  'Tu última reserva',
    accountSubtitle:      'Paga sin escanear.',
    accountReservationLine: '{restaurant} · {date}',
    accountPayButton:     'Pagar mi cuenta',
    accountNoTicket:      'Aún no hay cuenta abierta en tu mesa.',
    accountClearLastResa: 'Quitar esta reserva',
    close:                'Cerrar',
  },
  it: {
    loadingTicket:        'Caricamento del tuo conto…',
    loadingPay:           'Preparazione del pagamento…',
    processing:           'Pagamento in corso…',
    noTicketTitle:        'Il tuo conto sta arrivando',
    noTicketDesc:         'Il ristorante aprirà il tuo conto. Potrai pagare qui appena pronto.',
    yourBill:             'Il tuo conto',
    item:                 'Articolo',
    total:                'Totale',
    payTitle:             'Paga il mio conto',
    payButton:            'Paga ora',
    payIntro:             'Stai pagando {amount} — addebito immediato. L\'impronta della prenotazione viene rilasciata automaticamente.',
    payRealDebitNote:     'Questo pagamento è un addebito reale (cattura immediata), non un\'impronta.',
    testCardHint:         'Carta di test: 4242 4242 4242 4242, data futura, CVC libero.',
    paidTitle:            'Pagato ✅ Grazie!',
    paidBody:             'Il tuo conto è stato saldato. A presto!',
    errAlreadyPaid:       'Conto già pagato.',
    errCardDeclined:      'Carta rifiutata. Prova un\'altra carta.',
    errGeneric:           'Pagamento fallito. Verifica la carta e riprova.',
    errLoad:              'Impossibile caricare il tuo conto.',
    errStripeNotReady:    'Pagamento non disponibile. Riprova tra poco.',
    accountSectionTitle:  'La tua ultima prenotazione',
    accountSubtitle:      'Paga senza scansionare.',
    accountReservationLine: '{restaurant} · {date}',
    accountPayButton:     'Paga il mio conto',
    accountNoTicket:      'Nessun conto aperto al tuo tavolo.',
    accountClearLastResa: 'Rimuovi questa prenotazione',
    close:                'Chiudi',
  },
  ar: {
    loadingTicket:        'تحميل فاتورتك…',
    loadingPay:           'تجهيز الدفع…',
    processing:           'جارٍ معالجة الدفع…',
    noTicketTitle:        'فاتورتك قادمة قريبًا',
    noTicketDesc:         'سيقوم المطعم بفتح فاتورتك. يمكنك الدفع هنا بمجرد أن تكون جاهزة.',
    yourBill:             'فاتورتك',
    item:                 'صنف',
    total:                'الإجمالي',
    payTitle:             'ادفع فاتورتي',
    payButton:            'ادفع الآن',
    payIntro:             'تدفع {amount} — خصم فوري. يتم تحرير ضمان الحجز تلقائيًا.',
    payRealDebitNote:     'هذا الدفع خصم حقيقي (فوري)، وليس ضمانًا.',
    testCardHint:         'بطاقة اختبار: 4242 4242 4242 4242، تاريخ مستقبلي، CVC حر.',
    paidTitle:            'تم الدفع ✅ شكرًا!',
    paidBody:             'تم دفع فاتورتك. إلى اللقاء قريبًا!',
    errAlreadyPaid:       'الفاتورة مدفوعة بالفعل.',
    errCardDeclined:      'تم رفض البطاقة. جرب بطاقة أخرى.',
    errGeneric:           'فشل الدفع. تحقق من بطاقتك وأعد المحاولة.',
    errLoad:              'تعذر تحميل فاتورتك.',
    errStripeNotReady:    'الدفع غير متاح حاليًا. أعد المحاولة بعد قليل.',
    accountSectionTitle:  'حجزك الأخير',
    accountSubtitle:      'ادفع فاتورتك بدون مسح ضوئي.',
    accountReservationLine: '{restaurant} · {date}',
    accountPayButton:     'ادفع فاتورتي',
    accountNoTicket:      'لا توجد فاتورة مفتوحة على طاولتك بعد.',
    accountClearLastResa: 'إزالة هذا الحجز',
    close:                'إغلاق',
  },
}

for (const [loc, kv] of Object.entries(T)) {
  const p = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(p, 'utf8'))
  if (!m.bill) m.bill = {}
  Object.assign(m.bill, kv)
  fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`${loc}: +bill.* (${Object.keys(kv).length} keys)`)
}
