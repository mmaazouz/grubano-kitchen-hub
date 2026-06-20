// scripts/add-prestataire-missions-i18n.js — Prestataire P3 (Agent 76).
// Adds the DEVIS + MISSION copy:
//   - prestataire.missions.*            → the prestataire's received-missions page
//   - prestataire.dashboard.missions*   → the dashboard « Demandes & missions » card
//   - marketplace.prestataireMissions.* → the resto's requests/missions page
//   - marketplace.prestataires.request* + myRequestsNav → the fiche request-a-quote flow
// FR vouvoiement, real Arabic (RTL). Idempotent; 2-space JSON. Run:
//   node scripts/add-prestataire-missions-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

const ADD = {
  fr: {
    missions: {
      title: "Demandes & missions", subtitle: "Les demandes de devis reçues et vos missions en cours.",
      back: "Tableau de bord", emptyTitle: "Aucune demande", emptyDesc: "Les demandes de devis des restaurants apparaîtront ici.",
      errLoad: "Impossible de charger vos missions.", errSave: "Impossible d’enregistrer, réessayez.",
      errAmount: "Montant invalide", errDescription: "Description requise",
      status_requested: "Devis demandé", status_quoted: "Devis envoyé", status_accepted: "Acceptée",
      status_declined: "Refusée", status_cancelled: "Annulée", status_done: "Réalisée",
      quoteCta: "Chiffrer", declineCta: "Refuser", doneCta: "Marquer réalisée",
      quoteTitle: "Établir un devis", quoteSend: "Envoyer le devis",
      quoteHint: "Le montant est indicatif et sera confirmé ; aucun paiement n’est encore prélevé.",
      fAmount: "Montant (€)", fDescription: "Description du devis", fProposedDate: "Date proposée",
      cancel: "Annuler", saving: "Envoi…",
    },
    dashboard: { missionsTitle: "Demandes & missions", missionsBody: "Répondez aux demandes de devis et suivez vos missions." },
    prestataireMissions: {
      title: "Mes demandes", subtitle: "Vos demandes de devis et missions auprès des prestataires.",
      discoverNav: "Trouver un prestataire", empty: "Vous n’avez pas encore fait de demande.",
      errLoad: "Impossible de charger vos demandes.",
      status_requested: "En attente de devis", status_quoted: "Devis reçu", status_accepted: "Acceptée",
      status_declined: "Refusée", status_cancelled: "Annulée", status_done: "Réalisée",
      quoteLabel: "Devis", acceptCta: "Accepter", declineCta: "Refuser", cancelCta: "Annuler",
    },
    prestataires: {
      myRequestsNav: "Mes demandes",
      requestQuoteCta: "Demander un devis", requestQuoteTitle: "Demander un devis",
      requestQuoteDesc: "Décrivez votre besoin ; le prestataire vous répondra avec un devis.",
      requestServiceCta: "Demander un devis", requestForService: "Pour : {service}",
      requestDetailsLabel: "Votre besoin", requestDetailsPlaceholder: "Décrivez la prestation souhaitée, le contexte, l’urgence…",
      requestDetailsRequired: "Décrivez votre besoin",
      requestSend: "Envoyer la demande", requestSending: "Envoi…", requestCancel: "Annuler",
      requestErr: "Impossible d’envoyer, réessayez.",
      requestDoneTitle: "Demande envoyée", requestDoneBody: "Le prestataire va étudier votre demande et vous proposer un devis.",
      requestDoneCta: "Voir mes demandes",
    },
  },
  en: {
    missions: {
      title: "Requests & missions", subtitle: "Quote requests received and your ongoing missions.",
      back: "Dashboard", emptyTitle: "No requests", emptyDesc: "Quote requests from restaurants will appear here.",
      errLoad: "Couldn't load your missions.", errSave: "Couldn't save, please try again.",
      errAmount: "Invalid amount", errDescription: "Description required",
      status_requested: "Quote requested", status_quoted: "Quote sent", status_accepted: "Accepted",
      status_declined: "Declined", status_cancelled: "Cancelled", status_done: "Completed",
      quoteCta: "Quote", declineCta: "Decline", doneCta: "Mark completed",
      quoteTitle: "Prepare a quote", quoteSend: "Send quote",
      quoteHint: "The amount is indicative and will be confirmed; no payment is taken yet.",
      fAmount: "Amount (€)", fDescription: "Quote description", fProposedDate: "Proposed date",
      cancel: "Cancel", saving: "Sending…",
    },
    dashboard: { missionsTitle: "Requests & missions", missionsBody: "Answer quote requests and track your missions." },
    prestataireMissions: {
      title: "My requests", subtitle: "Your quote requests and missions with providers.",
      discoverNav: "Find a provider", empty: "You haven't made any request yet.",
      errLoad: "Couldn't load your requests.",
      status_requested: "Awaiting quote", status_quoted: "Quote received", status_accepted: "Accepted",
      status_declined: "Declined", status_cancelled: "Cancelled", status_done: "Completed",
      quoteLabel: "Quote", acceptCta: "Accept", declineCta: "Decline", cancelCta: "Cancel",
    },
    prestataires: {
      myRequestsNav: "My requests",
      requestQuoteCta: "Request a quote", requestQuoteTitle: "Request a quote",
      requestQuoteDesc: "Describe your need; the provider will reply with a quote.",
      requestServiceCta: "Request a quote", requestForService: "For: {service}",
      requestDetailsLabel: "Your need", requestDetailsPlaceholder: "Describe the service, context, urgency…",
      requestDetailsRequired: "Describe your need",
      requestSend: "Send request", requestSending: "Sending…", requestCancel: "Cancel",
      requestErr: "Couldn't send, please try again.",
      requestDoneTitle: "Request sent", requestDoneBody: "The provider will review your request and send a quote.",
      requestDoneCta: "View my requests",
    },
  },
  es: {
    missions: {
      title: "Solicitudes y misiones", subtitle: "Las solicitudes de presupuesto recibidas y sus misiones en curso.",
      back: "Panel", emptyTitle: "Sin solicitudes", emptyDesc: "Las solicitudes de presupuesto de los restaurantes aparecerán aquí.",
      errLoad: "No se pudieron cargar sus misiones.", errSave: "No se pudo guardar, inténtelo de nuevo.",
      errAmount: "Importe no válido", errDescription: "Descripción obligatoria",
      status_requested: "Presupuesto solicitado", status_quoted: "Presupuesto enviado", status_accepted: "Aceptada",
      status_declined: "Rechazada", status_cancelled: "Cancelada", status_done: "Realizada",
      quoteCta: "Presupuestar", declineCta: "Rechazar", doneCta: "Marcar realizada",
      quoteTitle: "Crear un presupuesto", quoteSend: "Enviar presupuesto",
      quoteHint: "El importe es indicativo y se confirmará; aún no se cobra ningún pago.",
      fAmount: "Importe (€)", fDescription: "Descripción del presupuesto", fProposedDate: "Fecha propuesta",
      cancel: "Cancelar", saving: "Enviando…",
    },
    dashboard: { missionsTitle: "Solicitudes y misiones", missionsBody: "Responda a las solicitudes de presupuesto y siga sus misiones." },
    prestataireMissions: {
      title: "Mis solicitudes", subtitle: "Sus solicitudes de presupuesto y misiones con los proveedores.",
      discoverNav: "Buscar un proveedor", empty: "Aún no ha realizado ninguna solicitud.",
      errLoad: "No se pudieron cargar sus solicitudes.",
      status_requested: "Esperando presupuesto", status_quoted: "Presupuesto recibido", status_accepted: "Aceptada",
      status_declined: "Rechazada", status_cancelled: "Cancelada", status_done: "Realizada",
      quoteLabel: "Presupuesto", acceptCta: "Aceptar", declineCta: "Rechazar", cancelCta: "Cancelar",
    },
    prestataires: {
      myRequestsNav: "Mis solicitudes",
      requestQuoteCta: "Solicitar presupuesto", requestQuoteTitle: "Solicitar presupuesto",
      requestQuoteDesc: "Describa su necesidad; el proveedor le responderá con un presupuesto.",
      requestServiceCta: "Solicitar presupuesto", requestForService: "Para: {service}",
      requestDetailsLabel: "Su necesidad", requestDetailsPlaceholder: "Describa el servicio deseado, el contexto, la urgencia…",
      requestDetailsRequired: "Describa su necesidad",
      requestSend: "Enviar solicitud", requestSending: "Enviando…", requestCancel: "Cancelar",
      requestErr: "No se pudo enviar, inténtelo de nuevo.",
      requestDoneTitle: "Solicitud enviada", requestDoneBody: "El proveedor revisará su solicitud y le enviará un presupuesto.",
      requestDoneCta: "Ver mis solicitudes",
    },
  },
  it: {
    missions: {
      title: "Richieste e missioni", subtitle: "Le richieste di preventivo ricevute e le vostre missioni in corso.",
      back: "Pannello", emptyTitle: "Nessuna richiesta", emptyDesc: "Le richieste di preventivo dei ristoranti appariranno qui.",
      errLoad: "Impossibile caricare le vostre missioni.", errSave: "Impossibile salvare, riprovate.",
      errAmount: "Importo non valido", errDescription: "Descrizione obbligatoria",
      status_requested: "Preventivo richiesto", status_quoted: "Preventivo inviato", status_accepted: "Accettata",
      status_declined: "Rifiutata", status_cancelled: "Annullata", status_done: "Completata",
      quoteCta: "Preventivare", declineCta: "Rifiutare", doneCta: "Segna completata",
      quoteTitle: "Creare un preventivo", quoteSend: "Invia preventivo",
      quoteHint: "L’importo è indicativo e sarà confermato; nessun pagamento viene ancora addebitato.",
      fAmount: "Importo (€)", fDescription: "Descrizione del preventivo", fProposedDate: "Data proposta",
      cancel: "Annulla", saving: "Invio…",
    },
    dashboard: { missionsTitle: "Richieste e missioni", missionsBody: "Rispondete alle richieste di preventivo e seguite le vostre missioni." },
    prestataireMissions: {
      title: "Le mie richieste", subtitle: "Le vostre richieste di preventivo e missioni con i prestatori.",
      discoverNav: "Trovare un prestatore", empty: "Non avete ancora fatto richieste.",
      errLoad: "Impossibile caricare le vostre richieste.",
      status_requested: "In attesa di preventivo", status_quoted: "Preventivo ricevuto", status_accepted: "Accettata",
      status_declined: "Rifiutata", status_cancelled: "Annullata", status_done: "Completata",
      quoteLabel: "Preventivo", acceptCta: "Accetta", declineCta: "Rifiuta", cancelCta: "Annulla",
    },
    prestataires: {
      myRequestsNav: "Le mie richieste",
      requestQuoteCta: "Richiedere un preventivo", requestQuoteTitle: "Richiedere un preventivo",
      requestQuoteDesc: "Descrivete la vostra esigenza; il prestatore vi risponderà con un preventivo.",
      requestServiceCta: "Richiedere un preventivo", requestForService: "Per: {service}",
      requestDetailsLabel: "La vostra esigenza", requestDetailsPlaceholder: "Descrivete il servizio desiderato, il contesto, l’urgenza…",
      requestDetailsRequired: "Descrivete la vostra esigenza",
      requestSend: "Invia richiesta", requestSending: "Invio…", requestCancel: "Annulla",
      requestErr: "Impossibile inviare, riprovate.",
      requestDoneTitle: "Richiesta inviata", requestDoneBody: "Il prestatore esaminerà la vostra richiesta e vi invierà un preventivo.",
      requestDoneCta: "Vedi le mie richieste",
    },
  },
  ar: {
    missions: {
      title: "الطلبات والمهام", subtitle: "طلبات عروض الأسعار المستلمة ومهامك الجارية.",
      back: "لوحة التحكم", emptyTitle: "لا توجد طلبات", emptyDesc: "ستظهر هنا طلبات عروض الأسعار من المطاعم.",
      errLoad: "تعذّر تحميل مهامك.", errSave: "تعذّر الحفظ، حاول مجدّدًا.",
      errAmount: "مبلغ غير صالح", errDescription: "الوصف مطلوب",
      status_requested: "طُلب عرض سعر", status_quoted: "أُرسل عرض السعر", status_accepted: "مقبولة",
      status_declined: "مرفوضة", status_cancelled: "ملغاة", status_done: "منجزة",
      quoteCta: "تسعير", declineCta: "رفض", doneCta: "وضع علامة منجزة",
      quoteTitle: "إعداد عرض سعر", quoteSend: "إرسال عرض السعر",
      quoteHint: "المبلغ استرشادي وسيُؤكَّد؛ لا يُخصم أي مبلغ بعد.",
      fAmount: "المبلغ (€)", fDescription: "وصف عرض السعر", fProposedDate: "التاريخ المقترح",
      cancel: "إلغاء", saving: "جارٍ الإرسال…",
    },
    dashboard: { missionsTitle: "الطلبات والمهام", missionsBody: "ردّ على طلبات عروض الأسعار وتابع مهامك." },
    prestataireMissions: {
      title: "طلباتي", subtitle: "طلبات عروض الأسعار ومهامك مع مقدّمي الخدمات.",
      discoverNav: "ابحث عن مقدّم خدمة", empty: "لم تقدّم أي طلب بعد.",
      errLoad: "تعذّر تحميل طلباتك.",
      status_requested: "بانتظار عرض السعر", status_quoted: "تمّ استلام عرض السعر", status_accepted: "مقبولة",
      status_declined: "مرفوضة", status_cancelled: "ملغاة", status_done: "منجزة",
      quoteLabel: "عرض السعر", acceptCta: "قبول", declineCta: "رفض", cancelCta: "إلغاء",
    },
    prestataires: {
      myRequestsNav: "طلباتي",
      requestQuoteCta: "طلب عرض سعر", requestQuoteTitle: "طلب عرض سعر",
      requestQuoteDesc: "صِف حاجتك؛ سيردّ عليك مقدّم الخدمة بعرض سعر.",
      requestServiceCta: "طلب عرض سعر", requestForService: "لِـ: {service}",
      requestDetailsLabel: "حاجتك", requestDetailsPlaceholder: "صِف الخدمة المطلوبة والسياق ودرجة الاستعجال…",
      requestDetailsRequired: "صِف حاجتك",
      requestSend: "إرسال الطلب", requestSending: "جارٍ الإرسال…", requestCancel: "إلغاء",
      requestErr: "تعذّر الإرسال، حاول مجدّدًا.",
      requestDoneTitle: "تمّ إرسال الطلب", requestDoneBody: "سيدرس مقدّم الخدمة طلبك ويرسل لك عرض سعر.",
      requestDoneCta: "عرض طلباتي",
    },
  },
}

let changed = 0
for (const loc of Object.keys(ADD)) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  const a = ADD[loc]
  // prestataire.missions.* (nested) + prestataire.dashboard.missions* (merge)
  json.prestataire = json.prestataire || {}
  json.prestataire.missions = json.prestataire.missions || {}
  Object.assign(json.prestataire.missions, a.missions)
  json.prestataire.dashboard = json.prestataire.dashboard || {}
  Object.assign(json.prestataire.dashboard, a.dashboard)
  // marketplace.prestataireMissions.* (nested) + marketplace.prestataires.* (merge additions)
  json.marketplace = json.marketplace || {}
  json.marketplace.prestataireMissions = json.marketplace.prestataireMissions || {}
  Object.assign(json.marketplace.prestataireMissions, a.prestataireMissions)
  json.marketplace.prestataires = json.marketplace.prestataires || {}
  Object.assign(json.marketplace.prestataires, a.prestataires)
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
  console.log(`✓ ${loc}: prestataire.missions + dashboard.missions* + marketplace.prestataireMissions + prestataires.request*`)
}
console.log(`Done — ${changed} locale files updated.`)
