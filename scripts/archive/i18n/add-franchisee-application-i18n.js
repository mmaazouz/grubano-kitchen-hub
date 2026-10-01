/* eslint-disable */
// ── Agent 48 — franchisee enrolment (B7) i18n ────────────────────────────────────────
// Adds the RESTAURATEUR join flow (franchise.join.*) + the FRANCHISOR review flow
// (franchise.applications.*) + franchise.nav.applications + franchise.becomeFranchisor
// (hero CTA = become a franchisor, distinct from the per-brand "join with my restaurant").
// x5 locales, strict parity, idempotent. FR vouvoiement; es/it/en natural; ar real RTL.
// Run: node scripts/add-franchisee-application-i18n.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

// franchise.<key> (top-level additions) — [fr, en, es, it, ar]
const TOP = {
  becomeFranchisor: ['Créer ma propre enseigne', 'Create my own brand', 'Crear mi propia marca', 'Crea il mio marchio', 'إنشاء علامتي الخاصة'],
}

// franchise.nav.<key>
const NAV = {
  applications: ['Candidatures', 'Applications', 'Candidaturas', 'Candidature', 'الطلبات'],
}

// franchise.join.* — restaurateur joins a brand with their restaurant
const JOIN = {
  cta:           ['Rejoindre avec mon restaurant', 'Join with my restaurant', 'Unirme con mi restaurante', 'Unisciti col mio ristorante', 'الانضمام بمطعمي'],
  modalTitle:    ['Rejoindre {name}', 'Join {name}', 'Unirse a {name}', 'Unisciti a {name}', 'الانضمام إلى {name}'],
  pickRestaurant:['Votre restaurant', 'Your restaurant', 'Su restaurante', 'Il suo ristorante', 'مطعمك'],
  messageLabel:  ['Message au franchiseur (facultatif)', 'Message to the franchisor (optional)', 'Mensaje al franquiciador (opcional)', 'Messaggio al franchisor (facoltativo)', 'رسالة إلى مانح الامتياز (اختياري)'],
  messagePlaceholder: [
    'Présentez votre restaurant en quelques mots…',
    'Introduce your restaurant in a few words…',
    'Presente su restaurante en pocas palabras…',
    'Presenti il suo ristorante in poche parole…',
    'قدّم مطعمك بإيجاز…',
  ],
  submit:        ['Envoyer la candidature', 'Send application', 'Enviar candidatura', 'Invia candidatura', 'إرسال الطلب'],
  submitting:    ['Envoi…', 'Sending…', 'Enviando…', 'Invio…', 'جارٍ الإرسال…'],
  cancel:        ['Annuler', 'Cancel', 'Cancelar', 'Annulla', 'إلغاء'],
  close:         ['Fermer', 'Close', 'Cerrar', 'Chiudi', 'إغلاق'],
  successTitle:  ['Candidature envoyée', 'Application sent', 'Candidatura enviada', 'Candidatura inviata', 'تم إرسال الطلب'],
  successBody: [
    'Le franchiseur examinera votre demande.',
    'The franchisor will review your request.',
    'El franquiciador revisará su solicitud.',
    'Il franchisor esaminerà la sua richiesta.',
    'سيراجع مانح الامتياز طلبك.',
  ],
  alreadyPending: [
    'Vous avez déjà une candidature en attente pour cette enseigne.',
    'You already have a pending application for this brand.',
    'Ya tiene una candidatura pendiente para esta marca.',
    'Ha già una candidatura in attesa per questo marchio.',
    'لديك بالفعل طلب قيد الانتظار لهذه العلامة.',
  ],
  alreadyApproved: [
    'Votre restaurant est déjà rattaché à cette enseigne.',
    'Your restaurant is already attached to this brand.',
    'Su restaurante ya está vinculado a esta marca.',
    'Il suo ristorante è già collegato a questo marchio.',
    'مطعمك مرتبط بالفعل بهذه العلامة.',
  ],
  noEligible: [
    'Aucun restaurant éligible (déjà rattaché, ou vous n’avez pas de restaurant).',
    'No eligible restaurant (already attached, or you have no restaurant).',
    'Ningún restaurante elegible (ya vinculado, o no tiene restaurante).',
    'Nessun ristorante idoneo (già collegato, o non ha ristoranti).',
    'لا يوجد مطعم مؤهل (مرتبط بالفعل، أو ليس لديك مطعم).',
  ],
  errorGeneric: [
    'Une erreur est survenue. Veuillez réessayer.',
    'Something went wrong. Please try again.',
    'Ocurrió un error. Inténtelo de nuevo.',
    'Si è verificato un errore. Riprovi.',
    'حدث خطأ. يرجى المحاولة مرة أخرى.',
  ],
  myApplicationsTitle: ['Mes candidatures', 'My applications', 'Mis candidaturas', 'Le mie candidature', 'طلباتي'],
  statusPending:  ['En attente', 'Pending', 'Pendiente', 'In attesa', 'قيد الانتظار'],
  statusApproved: ['Approuvée', 'Approved', 'Aprobada', 'Approvata', 'مقبولة'],
  statusRejected: ['Refusée', 'Rejected', 'Rechazada', 'Rifiutata', 'مرفوضة'],
}

// franchise.applications.* — franchisor reviews join requests to their brands
const APPS = {
  title:    ['Candidatures', 'Applications', 'Candidaturas', 'Candidature', 'الطلبات'],
  subtitle: [
    'Les restaurateurs qui souhaitent rejoindre vos enseignes.',
    'Restaurateurs who want to join your brands.',
    'Restauradores que desean unirse a sus marcas.',
    'Ristoratori che desiderano unirsi ai suoi marchi.',
    'أصحاب المطاعم الراغبون في الانضمام إلى علاماتك.',
  ],
  empty:    ['Aucune candidature en attente.', 'No pending applications.', 'No hay candidaturas pendientes.', 'Nessuna candidatura in attesa.', 'لا توجد طلبات قيد الانتظار.'],
  joinBrand:['Souhaite rejoindre {brand}', 'Wants to join {brand}', 'Quiere unirse a {brand}', 'Desidera unirsi a {brand}', 'يرغب في الانضمام إلى {brand}'],
  approve:  ['Approuver', 'Approve', 'Aprobar', 'Approva', 'قبول'],
  reject:   ['Refuser', 'Reject', 'Rechazar', 'Rifiuta', 'رفض'],
  statusPending:  ['En attente', 'Pending', 'Pendiente', 'In attesa', 'قيد الانتظار'],
  statusApproved: ['Approuvée', 'Approved', 'Aprobada', 'Approvata', 'مقبولة'],
  statusRejected: ['Refusée', 'Rejected', 'Rechazada', 'Rifiutata', 'مرفوضة'],
  loadError:    ['Impossible de charger les candidatures.', 'Could not load applications.', 'No se pudieron cargar las candidaturas.', 'Impossibile caricare le candidature.', 'تعذّر تحميل الطلبات.'],
  errorNetwork: ['Erreur réseau.', 'Network error.', 'Error de red.', 'Errore di rete.', 'خطأ في الشبكة.'],
  backToDashboard: ['Tableau de bord', 'Dashboard', 'Panel', 'Dashboard', 'لوحة التحكم'],
}

LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.franchise = json.franchise || {}
  json.franchise.nav = json.franchise.nav || {}
  json.franchise.join = json.franchise.join || {}
  json.franchise.applications = json.franchise.applications || {}
  for (const k of Object.keys(TOP))  json.franchise[k]              = TOP[k][i]
  for (const k of Object.keys(NAV))  json.franchise.nav[k]          = NAV[k][i]
  for (const k of Object.keys(JOIN)) json.franchise.join[k]         = JOIN[k][i]
  for (const k of Object.keys(APPS)) json.franchise.applications[k] = APPS[k][i]
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  const n = Object.keys(TOP).length + Object.keys(NAV).length + Object.keys(JOIN).length + Object.keys(APPS).length
  console.log(`  ✓ ${loc}.json — franchise B7 (+${n})`)
})
console.log('[add-franchisee-application-i18n] done.')
