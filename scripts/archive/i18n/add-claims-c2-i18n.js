// Adds the P4.5-C2 keys to the `claims` namespace (contest + admin arbitration) in all 5
// locales with parity. Idempotent. Order: [fr, en, es, it, ar]. Run: node scripts/add-claims-c2-i18n.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

// extra status labels (C2)
const STATUS = {
  arbitration:   ['En arbitrage Grubano', 'Under Grubano arbitration', 'En arbitraje de Grubano', 'In arbitrato Grubano', 'قيد تحكيم Grubano'],
  refused_final: ['Refus confirmé', 'Refusal confirmed', 'Rechazo confirmado', 'Rifiuto confermato', 'تم تأكيد الرفض'],
}

// client contest UI (added to claims.client)
const CLIENT = {
  contest:                 ['Contester la décision', 'Contest the decision', 'Impugnar la decisión', 'Contesta la decisione', 'الاعتراض على القرار'],
  contestTitle:            ['Contester le refus', 'Contest the refusal', 'Impugnar el rechazo', 'Contesta il rifiuto', 'الاعتراض على الرفض'],
  contestDescription:      ['Grubano examinera votre réclamation de façon neutre.', 'Grubano will review your claim neutrally.', 'Grubano revisará su reclamación de forma neutral.', 'Grubano esaminerà il suo reclamo in modo neutrale.', 'ستراجع Grubano شكواك بحياد.'],
  contestReasonLabel:      ['Pourquoi contestez-vous ?', 'Why are you contesting?', '¿Por qué impugna?', 'Perché contesta?', 'لماذا تعترض؟'],
  contestReasonPlaceholder:['Expliquez votre désaccord…', 'Explain your disagreement…', 'Explique su desacuerdo…', 'Spieghi il suo disaccordo…', 'اشرح اعتراضك…'],
  contestSubmit:           ['Envoyer la contestation', 'Submit contest', 'Enviar impugnación', 'Invia contestazione', 'إرسال الاعتراض'],
  contestSuccess:          ['Contestation envoyée. Grubano va trancher.', 'Contest submitted. Grubano will decide.', 'Impugnación enviada. Grubano decidirá.', 'Contestazione inviata. Grubano deciderà.', 'تم إرسال الاعتراض. ستبتّ Grubano.'],
  arbitrationInfo:         ['Votre contestation est en cours d’examen par Grubano.', 'Your contest is being reviewed by Grubano.', 'Su impugnación está siendo revisada por Grubano.', 'La sua contestazione è in esame da Grubano.', 'يخضع اعتراضك للمراجعة من Grubano.'],
  refusalReasonShown:      ['Motif du refus', 'Refusal reason', 'Motivo del rechazo', 'Motivo del rifiuto', 'سبب الرفض'],
}

// admin arbitration console (NEW claims.admin)
const ADMIN = {
  title:              ['Arbitrage des réclamations', 'Claim arbitration', 'Arbitraje de reclamaciones', 'Arbitrato dei reclami', 'تحكيم الشكاوى'],
  subtitle:           ['Tranchez de façon neutre les réclamations contestées (vous n’êtes ni le client ni le restaurant).', 'Neutrally decide contested claims (you are neither the customer nor the restaurant).', 'Decida de forma neutral las reclamaciones impugnadas (no es ni el cliente ni el restaurante).', 'Decida in modo neutrale i reclami contestati (non è né il cliente né il ristorante).', 'احكم بحياد في الشكاوى المتنازع عليها (لست العميل ولا المطعم).'],
  empty:              ['Aucune réclamation en arbitrage.', 'No claims in arbitration.', 'No hay reclamaciones en arbitraje.', 'Nessun reclamo in arbitrato.', 'لا توجد شكاوى قيد التحكيم.'],
  order:              ['Commande', 'Order', 'Pedido', 'Ordine', 'الطلب'],
  reason:             ['Motif client', 'Customer reason', 'Motivo del cliente', 'Motivo del cliente', 'سبب العميل'],
  requested:          ['Montant réclamé', 'Requested amount', 'Importe reclamado', 'Importo richiesto', 'المبلغ المطلوب'],
  clientDetails:      ['Détails du client', 'Customer details', 'Detalles del cliente', 'Dettagli del cliente', 'تفاصيل العميل'],
  refusalReason:      ['Motif du refus (restaurant)', 'Refusal reason (restaurant)', 'Motivo del rechazo (restaurante)', 'Motivo del rifiuto (ristorante)', 'سبب الرفض (المطعم)'],
  contestReason:      ['Contestation du client', 'Customer contest', 'Impugnación del cliente', 'Contestazione del cliente', 'اعتراض العميل'],
  viewPhoto:          ['Voir la photo', 'View photo', 'Ver foto', 'Vedi foto', 'عرض الصورة'],
  approve:            ['Approuver & rembourser', 'Approve & refund', 'Aprobar y reembolsar', 'Approva e rimborsa', 'الموافقة ورد المبلغ'],
  refuseFinal:        ['Confirmer le refus', 'Confirm refusal', 'Confirmar el rechazo', 'Conferma il rifiuto', 'تأكيد الرفض'],
  decisionReasonLabel:['Motivation (facultatif)', 'Reasoning (optional)', 'Justificación (opcional)', 'Motivazione (facoltativo)', 'التبرير (اختياري)'],
  decisionReasonPlaceholder: ['Expliquez votre décision…', 'Explain your decision…', 'Explique su decisión…', 'Spieghi la sua decisione…', 'اشرح قرارك…'],
  approved:           ['Réclamation approuvée, remboursement déclenché.', 'Claim approved, refund triggered.', 'Reclamación aprobada, reembolso iniciado.', 'Reclamo approvato, rimborso avviato.', 'تمت الموافقة على الشكوى وبدء رد المبلغ.'],
  refusedFinalDone:   ['Refus confirmé.', 'Refusal confirmed.', 'Rechazo confirmado.', 'Rifiuto confermato.', 'تم تأكيد الرفض.'],
  processing:         ['Traitement…', 'Processing…', 'Procesando…', 'Elaborazione…', 'جارٍ المعالجة…'],
  signalsTitle:       ['Signaux', 'Signals', 'Señales', 'Segnali', 'المؤشرات'],
  consumerSignal:     ['Client : {recent} réclamation(s) récente(s), {rate}% approuvées', 'Customer: {recent} recent claim(s), {rate}% approved', 'Cliente: {recent} reclamación(es) reciente(s), {rate}% aprobadas', 'Cliente: {recent} reclamo/i recente/i, {rate}% approvati', 'العميل: {recent} شكوى حديثة، {rate}% موافق عليها'],
  restaurantSignal:   ['Restaurant : {overturned}/{refused} refus infirmés en arbitrage', 'Restaurant: {overturned}/{refused} refusals overturned in arbitration', 'Restaurante: {overturned}/{refused} rechazos revocados en arbitraje', 'Ristorante: {overturned}/{refused} rifiuti ribaltati in arbitrato', 'المطعم: {overturned}/{refused} رفض أُلغي في التحكيم'],
  flaggedConsumer:    ['Client à surveiller', 'Customer to watch', 'Cliente a vigilar', 'Cliente da monitorare', 'عميل يستحق المتابعة'],
  flaggedRestaurant:  ['Restaurant à surveiller', 'Restaurant to watch', 'Restaurante a vigilar', 'Ristorante da monitorare', 'مطعم يستحق المتابعة'],
}

function assign(target, group, i) { for (const k of Object.keys(group)) target[k] = group[k][i] }

LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.claims = json.claims || {}
  json.claims.status = json.claims.status || {}
  json.claims.client = json.claims.client || {}
  json.claims.admin = json.claims.admin || {}
  assign(json.claims.status, STATUS, i)
  assign(json.claims.client, CLIENT, i)
  assign(json.claims.admin, ADMIN, i)
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  const count = Object.keys(STATUS).length + Object.keys(CLIENT).length + Object.keys(ADMIN).length
  console.log(`  ✓ ${loc}.json — claims C2 (+${count})`)
})
