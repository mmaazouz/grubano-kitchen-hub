// Seed i18n — ANNULATION DE RÉSERVATION CÔTÉ CLIENT (Agent 13).
// Clés sous premium.mysession.* (la carte « Ma session » porte le bouton).
//
// Usage: node scripts/seed-annulation-client-i18n.js   puis   npm run check:i18n

const fs = require('fs')
const path = require('path')

const KEYS = {
  fr: {
    cancelCta:        'Annuler la réservation',
    cancelDeadline:   'Annulable jusqu’à {deadline}',
    cancelClosedHint: 'Pour annuler, contactez le restaurant.',
    cancelClosedPhone:'Pour annuler, contactez le restaurant au {phone}.',
    cancelTitle:      'Annuler cette réservation ?',
    cancelBody:       'Votre réservation chez {restaurant} du {date} sera annulée.',
    cancelBodyDeposit:'Votre empreinte bancaire sera libérée — aucun débit.',
    cancelConfirm:    'Oui, annuler',
    cancelAbort:      'Garder ma réservation',
    cancelling:       'Annulation…',
    cancelledOk:      'Réservation annulée — un email de confirmation vous a été envoyé.',
    cancelErrWindow:  'L’annulation en ligne n’est plus possible — contactez le restaurant.',
    cancelErrState:   'Cette réservation ne peut plus être annulée en ligne.',
    cancelErrGeneric: 'Annulation impossible — réessayez.',
  },
  en: {
    cancelCta:        'Cancel the reservation',
    cancelDeadline:   'Cancellable until {deadline}',
    cancelClosedHint: 'To cancel, contact the restaurant.',
    cancelClosedPhone:'To cancel, contact the restaurant at {phone}.',
    cancelTitle:      'Cancel this reservation?',
    cancelBody:       'Your reservation at {restaurant} on {date} will be cancelled.',
    cancelBodyDeposit:'Your card hold will be released — nothing charged.',
    cancelConfirm:    'Yes, cancel',
    cancelAbort:      'Keep my reservation',
    cancelling:       'Cancelling…',
    cancelledOk:      'Reservation cancelled — a confirmation email is on its way.',
    cancelErrWindow:  'Online cancellation is no longer possible — contact the restaurant.',
    cancelErrState:   'This reservation can no longer be cancelled online.',
    cancelErrGeneric: 'Could not cancel — please retry.',
  },
  es: {
    cancelCta:        'Anular la reserva',
    cancelDeadline:   'Anulable hasta {deadline}',
    cancelClosedHint: 'Para anular, contacta con el restaurante.',
    cancelClosedPhone:'Para anular, contacta con el restaurante en el {phone}.',
    cancelTitle:      '¿Anular esta reserva?',
    cancelBody:       'Tu reserva en {restaurant} del {date} será anulada.',
    cancelBodyDeposit:'Tu retención bancaria se liberará — sin ningún cargo.',
    cancelConfirm:    'Sí, anular',
    cancelAbort:      'Mantener mi reserva',
    cancelling:       'Anulando…',
    cancelledOk:      'Reserva anulada — te hemos enviado un email de confirmación.',
    cancelErrWindow:  'La anulación en línea ya no es posible — contacta con el restaurante.',
    cancelErrState:   'Esta reserva ya no puede anularse en línea.',
    cancelErrGeneric: 'No se pudo anular — reinténtalo.',
  },
  it: {
    cancelCta:        'Annulla la prenotazione',
    cancelDeadline:   'Annullabile fino alle {deadline}',
    cancelClosedHint: 'Per annullare, contatta il ristorante.',
    cancelClosedPhone:'Per annullare, contatta il ristorante al {phone}.',
    cancelTitle:      'Annullare questa prenotazione?',
    cancelBody:       'La tua prenotazione da {restaurant} del {date} sarà annullata.',
    cancelBodyDeposit:'La tua impronta bancaria sarà rilasciata — nessun addebito.',
    cancelConfirm:    'Sì, annulla',
    cancelAbort:      'Mantieni la prenotazione',
    cancelling:       'Annullamento…',
    cancelledOk:      'Prenotazione annullata — ti abbiamo inviato un’email di conferma.',
    cancelErrWindow:  'L’annullamento online non è più possibile — contatta il ristorante.',
    cancelErrState:   'Questa prenotazione non può più essere annullata online.',
    cancelErrGeneric: 'Annullamento impossibile — riprova.',
  },
  ar: {
    cancelCta:        'إلغاء الحجز',
    cancelDeadline:   'يمكن الإلغاء حتى {deadline}',
    cancelClosedHint: 'للإلغاء، اتصل بالمطعم.',
    cancelClosedPhone:'للإلغاء، اتصل بالمطعم على {phone}.',
    cancelTitle:      'إلغاء هذا الحجز؟',
    cancelBody:       'سيُلغى حجزك في {restaurant} بتاريخ {date}.',
    cancelBodyDeposit:'سيُحرَّر الضمان البنكي — دون أي خصم.',
    cancelConfirm:    'نعم، إلغاء',
    cancelAbort:      'الاحتفاظ بحجزي',
    cancelling:       'جارٍ الإلغاء…',
    cancelledOk:      'تم إلغاء الحجز — أرسلنا لك بريدًا للتأكيد.',
    cancelErrWindow:  'لم يعد الإلغاء عبر الإنترنت ممكنًا — اتصل بالمطعم.',
    cancelErrState:   'لم يعد بالإمكان إلغاء هذا الحجز عبر الإنترنت.',
    cancelErrGeneric: 'تعذّر الإلغاء — أعد المحاولة.',
  },
}

for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!m.premium) m.premium = {}
  if (!m.premium.mysession) m.premium.mysession = {}
  Object.assign(m.premium.mysession, KEYS[loc])
  fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`[seed-annulation-client-i18n] ${loc}.json OK`)
}
console.log('[seed-annulation-client-i18n] Done — run: npm run check:i18n')
