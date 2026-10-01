// Adds the `claims` namespace (P4.5-C1 customer refund-claim cycle) to all 5 locales
// with perfect parity. Idempotent. Order: [fr, en, es, it, ar]. Run: node scripts/add-claims-i18n.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

// reason enum labels
const REASON = {
  missing_item:  ['Article manquant', 'Missing item', 'Artículo faltante', 'Articolo mancante', 'عنصر مفقود'],
  wrong_order:   ['Mauvaise commande', 'Wrong order', 'Pedido equivocado', 'Ordine sbagliato', 'طلب خاطئ'],
  quality:       ['Problème de qualité', 'Quality issue', 'Problema de calidad', 'Problema di qualità', 'مشكلة في الجودة'],
  not_delivered: ['Non livrée', 'Not delivered', 'No entregado', 'Non consegnato', 'لم يتم التوصيل'],
  other:         ['Autre', 'Other', 'Otro', 'Altro', 'أخرى'],
}

// status labels (client + resto display)
const STATUS = {
  restaurant_review: ['En attente de réponse du restaurant', 'Awaiting restaurant response', 'Esperando respuesta del restaurante', 'In attesa di risposta del ristorante', 'بانتظار رد المطعم'],
  approved:          ['Approuvée — remboursement en cours', 'Approved — refund in progress', 'Aprobada — reembolso en curso', 'Approvata — rimborso in corso', 'تمت الموافقة — جارٍ رد المبلغ'],
  refunding:         ['Remboursement en cours', 'Refund in progress', 'Reembolso en curso', 'Rimborso in corso', 'جارٍ رد المبلغ'],
  refunded:          ['Remboursée', 'Refunded', 'Reembolsada', 'Rimborsata', 'تم رد المبلغ'],
  refused:           ['Refusée', 'Refused', 'Rechazada', 'Rifiutata', 'مرفوضة'],
}

// client UI
const CLIENT = {
  reportProblem:  ['Signaler un problème', 'Report a problem', 'Reportar un problema', 'Segnala un problema', 'الإبلاغ عن مشكلة'],
  title:          ['Demander un remboursement', 'Request a refund', 'Solicitar un reembolso', 'Richiedi un rimborso', 'طلب استرداد'],
  description:    ['Dites-nous ce qui s’est passé. Le restaurant a 24 h pour répondre.', 'Tell us what happened. The restaurant has 24h to respond.', 'Cuéntenos qué pasó. El restaurante tiene 24 h para responder.', 'Ci dica cosa è successo. Il ristorante ha 24 h per rispondere.', 'أخبرنا بما حدث. أمام المطعم 24 ساعة للرد.'],
  reasonLabel:    ['Motif', 'Reason', 'Motivo', 'Motivo', 'السبب'],
  amountLabel:    ['Montant à rembourser', 'Amount to refund', 'Importe a reembolsar', 'Importo da rimborsare', 'المبلغ المطلوب رده'],
  wholeOrder:     ['Toute la commande', 'Whole order', 'Todo el pedido', 'Tutto l’ordine', 'الطلب بالكامل'],
  customAmount:   ['Un montant précis', 'A specific amount', 'Un importe específico', 'Un importo specifico', 'مبلغ محدد'],
  descriptionLabel: ['Détails (facultatif)', 'Details (optional)', 'Detalles (opcional)', 'Dettagli (facoltativo)', 'تفاصيل (اختياري)'],
  descriptionPlaceholder: ['Décrivez le problème…', 'Describe the problem…', 'Describa el problema…', 'Descriva il problema…', 'صف المشكلة…'],
  photoLabel:     ['Photo (facultatif)', 'Photo (optional)', 'Foto (opcional)', 'Foto (facoltativo)', 'صورة (اختياري)'],
  photoHint:      ['Ajoutez une photo pour appuyer votre demande.', 'Add a photo to support your request.', 'Añada una foto para respaldar su solicitud.', 'Aggiunga una foto a supporto della richiesta.', 'أضف صورة لدعم طلبك.'],
  submit:         ['Envoyer la réclamation', 'Submit claim', 'Enviar reclamación', 'Invia il reclamo', 'إرسال الشكوى'],
  submitting:     ['Envoi…', 'Submitting…', 'Enviando…', 'Invio…', 'جارٍ الإرسال…'],
  success:        ['Réclamation envoyée. Le restaurant a 24 h pour répondre.', 'Claim submitted. The restaurant has 24h to respond.', 'Reclamación enviada. El restaurante tiene 24 h para responder.', 'Reclamo inviato. Il ristorante ha 24 h per rispondere.', 'تم إرسال الشكوى. أمام المطعم 24 ساعة للرد.'],
  statusTitle:    ['Votre réclamation', 'Your claim', 'Su reclamación', 'Il suo reclamo', 'شكواك'],
  refusedReason:  ['Motif du refus', 'Refusal reason', 'Motivo del rechazo', 'Motivo del rifiuto', 'سبب الرفض'],
  maxRefundable:  ['Maximum remboursable : {amount}', 'Maximum refundable: {amount}', 'Máximo reembolsable: {amount}', 'Massimo rimborsabile: {amount}', 'الحد الأقصى القابل للرد: {amount}'],
  cancel:         ['Annuler', 'Cancel', 'Cancelar', 'Annulla', 'إلغاء'],
  errorGeneric:   ['Une erreur est survenue. Réessayez.', 'Something went wrong. Please try again.', 'Se produjo un error. Inténtelo de nuevo.', 'Si è verificato un errore. Riprovi.', 'حدث خطأ. حاول مرة أخرى.'],
}

// restaurant UI
const RESTAURANT = {
  title:          ['Réclamations clients', 'Customer claims', 'Reclamaciones de clientes', 'Reclami dei clienti', 'شكاوى العملاء'],
  empty:          ['Aucune réclamation en attente.', 'No pending claims.', 'No hay reclamaciones pendientes.', 'Nessun reclamo in sospeso.', 'لا توجد شكاوى معلقة.'],
  order:          ['Commande', 'Order', 'Pedido', 'Ordine', 'الطلب'],
  reason:         ['Motif', 'Reason', 'Motivo', 'Motivo', 'السبب'],
  requested:      ['Montant réclamé', 'Requested amount', 'Importe reclamado', 'Importo richiesto', 'المبلغ المطلوب'],
  details:        ['Détails', 'Details', 'Detalles', 'Dettagli', 'التفاصيل'],
  viewPhoto:      ['Voir la photo', 'View photo', 'Ver foto', 'Vedi foto', 'عرض الصورة'],
  timeLeft:       ['{hours} h restantes pour répondre', '{hours}h left to respond', '{hours} h restantes para responder', '{hours} h rimaste per rispondere', 'يتبقى {hours} ساعة للرد'],
  expired:        ['Délai dépassé — approbation automatique imminente', 'Deadline passed — auto-approval imminent', 'Plazo vencido — aprobación automática inminente', 'Termine scaduto — approvazione automatica imminente', 'انتهى الموعد — الموافقة التلقائية وشيكة'],
  accept:         ['Accepter et rembourser', 'Accept and refund', 'Aceptar y reembolsar', 'Accetta e rimborsa', 'القبول ورد المبلغ'],
  refuse:         ['Refuser', 'Refuse', 'Rechazar', 'Rifiuta', 'رفض'],
  refuseReasonLabel: ['Motif du refus', 'Refusal reason', 'Motivo del rechazo', 'Motivo del rifiuto', 'سبب الرفض'],
  refuseReasonPlaceholder: ['Expliquez pourquoi…', 'Explain why…', 'Explique por qué…', 'Spieghi perché…', 'اشرح السبب…'],
  confirmRefuse:  ['Confirmer le refus', 'Confirm refusal', 'Confirmar rechazo', 'Conferma il rifiuto', 'تأكيد الرفض'],
  accepted:       ['Réclamation acceptée, remboursement déclenché.', 'Claim accepted, refund triggered.', 'Reclamación aceptada, reembolso iniciado.', 'Reclamo accettato, rimborso avviato.', 'تم قبول الشكوى وبدء رد المبلغ.'],
  refused:        ['Réclamation refusée.', 'Claim refused.', 'Reclamación rechazada.', 'Reclamo rifiutato.', 'تم رفض الشكوى.'],
  refundPending:  ['Acceptée — remboursement en attente d’activation.', 'Accepted — refund pending activation.', 'Aceptada — reembolso pendiente de activación.', 'Accettata — rimborso in attesa di attivazione.', 'تم القبول — رد المبلغ بانتظار التفعيل.'],
  processing:     ['Traitement…', 'Processing…', 'Procesando…', 'Elaborazione…', 'جارٍ المعالجة…'],
  autoApproveNote: ['Sans réponse sous 24 h, la réclamation est approuvée automatiquement.', 'Without a response within 24h, the claim is approved automatically.', 'Sin respuesta en 24 h, la reclamación se aprueba automáticamente.', 'Senza risposta entro 24 h, il reclamo viene approvato automaticamente.', 'بدون رد خلال 24 ساعة، تتم الموافقة على الشكوى تلقائيًا.'],
}

function assign(target, group, i) {
  for (const k of Object.keys(group)) target[k] = group[k][i]
}

LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.claims = json.claims || {}
  json.claims.reason = json.claims.reason || {}
  json.claims.status = json.claims.status || {}
  json.claims.client = json.claims.client || {}
  json.claims.restaurant = json.claims.restaurant || {}
  assign(json.claims.reason, REASON, i)
  assign(json.claims.status, STATUS, i)
  assign(json.claims.client, CLIENT, i)
  assign(json.claims.restaurant, RESTAURANT, i)
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  const count = Object.keys(REASON).length + Object.keys(STATUS).length + Object.keys(CLIENT).length + Object.keys(RESTAURANT).length
  console.log(`  ✓ ${loc}.json — claims (+${count})`)
})
