// scripts/add-prestataire-i18n.js — Prestataire P1 (Agent 74).
// Adds the prestataire.* namespace (register form + dashboard shell + service-category
// labels + modality) and the scaffold entries (business.start + addActivity cards,
// roleSwitcher.spacePrestataire). FR vouvoiement, real Arabic. Idempotent; 2-space JSON.
// Run: node scripts/add-prestataire-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

// Service-category + modality labels (top-level prestataire.*) — shared by the form + the
// dashboard. Form/dashboard copy too. dashboard.* nested for the dashboard-specific keys.
const ADD = {
  fr: {
    prestataire: {
      registerTitle: "Devenez prestataire de services",
      registerSubtitle: "Proposez vos services aux restaurants du réseau Grubano.",
      fieldCompanyName: "Nom de l’entreprise", fieldContactName: "Nom du contact",
      fieldSiren: "SIREN ou SIRET", fieldSirenHint: "9 ou 14 chiffres — vérifié au registre officiel.",
      fieldSirenError: "SIREN (9 chiffres) ou SIRET (14 chiffres) requis", fieldEmail: "E-mail",
      fieldPhone: "Téléphone", fieldCity: "Ville",
      fieldServices: "Services proposés", fieldModality: "Modalité d’intervention",
      fieldCoverageZones: "Zones couvertes", fieldCoverageZonesHint: "Villes ou codes postaux, séparés par des virgules.",
      fieldIndicativeRate: "Tarif indicatif (facultatif)", fieldIndicativeRatePlaceholder: "ex. sur devis, dès 80 €/h",
      fieldIndicativeRateHint: "Indicatif uniquement — chaque mission fera l’objet d’un devis (à venir).",
      consentLabel: "J’accepte les conditions et la politique de confidentialité de Grubano.",
      submit: "Envoyer ma demande", submitting: "Envoi…", back: "Retour", backToLogin: "Retour à la connexion",
      errorGeneric: "Une erreur est survenue, réessayez.",
      successTitle: "Demande reçue", successBody: "Nous vérifions votre entreprise. Vous serez prévenu(e) dès l’activation de votre espace prestataire.",
      successTitleActive: "Espace prestataire activé", successBodyActive: "Votre entreprise est vérifiée. Connectez-vous pour accéder à votre espace.",
      successCtaActive: "Se connecter",
      successTitleRejected: "Demande non aboutie", successBodyRejected: "Nous n’avons pas pu vérifier ce SIREN au registre officiel. Vérifiez le numéro et réessayez.",
      svcElectricity: "Électricité", svcPlumbing: "Plomberie", svcHaccp: "HACCP / hygiène", svcCleaning: "Nettoyage",
      svcPestControl: "Dératisation / nuisibles", svcFridgeRepair: "Réparation frigorifique", svcKitchenMaintenance: "Maintenance cuisine",
      svcAccounting: "Comptabilité", svcTraining: "Formation", svcOther: "Autre",
      modalityOnSite: "Sur place", modalityRemote: "À distance", modalityBoth: "Les deux",
      dashboard: {
        welcome: "Espace prestataire", subtitle: "Votre activité de services sur Grubano",
        noProfileTitle: "Aucun profil prestataire", noProfileBody: "Inscrivez votre entreprise pour proposer vos services aux restaurants.",
        registerCta: "Devenir prestataire",
        statusPendingTitle: "Dossier en cours de revue", statusPendingBody: "Votre entreprise est en cours de vérification. Vous serez prévenu(e) dès l’activation.",
        statusPending: "En attente", statusActive: "Actif", statusSuspended: "Suspendu", statusRejected: "Refusé",
        comingSoonTitle: "Bientôt disponible", comingSoonBody: "Les outils de votre activité de services arrivent.",
        soonServices: "Services", soonQuotes: "Devis", soonMissions: "Missions", soonCalendar: "Calendrier", soonReviews: "Avis", soonInvoicing: "Facturation",
        labelServices: "Services", labelCoverageZones: "Zones couvertes", labelModality: "Modalité", labelRate: "Tarif indicatif",
        emptyValue: "Non renseigné", editProfileCta: "Modifier mon profil",
      },
    },
    businessStart: { prestataireTitle: "Prestataire", prestataireDesc: "Vendez vos services aux restaurants (électricité, HACCP, nettoyage…)." },
    addActivity: { prestataireTitle: "Prestataire", prestataireDesc: "Proposez vos services aux restaurants du réseau." },
    roleSwitcher: { spacePrestataire: "Espace prestataire" },
  },
  en: {
    prestataire: {
      registerTitle: "Become a service provider",
      registerSubtitle: "Offer your services to restaurants in the Grubano network.",
      fieldCompanyName: "Company name", fieldContactName: "Contact name",
      fieldSiren: "SIREN or SIRET", fieldSirenHint: "9 or 14 digits — checked against the official registry.",
      fieldSirenError: "SIREN (9 digits) or SIRET (14 digits) required", fieldEmail: "Email",
      fieldPhone: "Phone", fieldCity: "City",
      fieldServices: "Services offered", fieldModality: "Service modality",
      fieldCoverageZones: "Coverage areas", fieldCoverageZonesHint: "Cities or postal codes, comma-separated.",
      fieldIndicativeRate: "Indicative rate (optional)", fieldIndicativeRatePlaceholder: "e.g. on quote, from €80/h",
      fieldIndicativeRateHint: "Indicative only — each mission will be quoted (coming soon).",
      consentLabel: "I accept Grubano's terms and privacy policy.",
      submit: "Send my request", submitting: "Sending…", back: "Back", backToLogin: "Back to sign in",
      errorGeneric: "Something went wrong, please try again.",
      successTitle: "Request received", successBody: "We're verifying your company. You'll be notified as soon as your provider space is activated.",
      successTitleActive: "Provider space activated", successBodyActive: "Your company is verified. Sign in to access your space.",
      successCtaActive: "Sign in",
      successTitleRejected: "Request not completed", successBodyRejected: "We couldn't verify this SIREN against the official registry. Check the number and try again.",
      svcElectricity: "Electricity", svcPlumbing: "Plumbing", svcHaccp: "HACCP / hygiene", svcCleaning: "Cleaning",
      svcPestControl: "Pest control", svcFridgeRepair: "Refrigeration repair", svcKitchenMaintenance: "Kitchen maintenance",
      svcAccounting: "Accounting", svcTraining: "Training", svcOther: "Other",
      modalityOnSite: "On site", modalityRemote: "Remote", modalityBoth: "Both",
      dashboard: {
        welcome: "Provider space", subtitle: "Your services business on Grubano",
        noProfileTitle: "No provider profile", noProfileBody: "Register your company to offer your services to restaurants.",
        registerCta: "Become a provider",
        statusPendingTitle: "Application under review", statusPendingBody: "Your company is being verified. You'll be notified as soon as it's activated.",
        statusPending: "Pending", statusActive: "Active", statusSuspended: "Suspended", statusRejected: "Rejected",
        comingSoonTitle: "Coming soon", comingSoonBody: "The tools for your services business are on the way.",
        soonServices: "Services", soonQuotes: "Quotes", soonMissions: "Missions", soonCalendar: "Calendar", soonReviews: "Reviews", soonInvoicing: "Invoicing",
        labelServices: "Services", labelCoverageZones: "Coverage areas", labelModality: "Modality", labelRate: "Indicative rate",
        emptyValue: "Not provided", editProfileCta: "Edit my profile",
      },
    },
    businessStart: { prestataireTitle: "Provider", prestataireDesc: "Sell your services to restaurants (electricity, HACCP, cleaning…)." },
    addActivity: { prestataireTitle: "Provider", prestataireDesc: "Offer your services to restaurants in the network." },
    roleSwitcher: { spacePrestataire: "Provider space" },
  },
  es: {
    prestataire: {
      registerTitle: "Conviértete en proveedor de servicios",
      registerSubtitle: "Ofrece tus servicios a los restaurantes de la red Grubano.",
      fieldCompanyName: "Nombre de la empresa", fieldContactName: "Nombre del contacto",
      fieldSiren: "SIREN o SIRET", fieldSirenHint: "9 o 14 dígitos — verificado en el registro oficial.",
      fieldSirenError: "Se requiere SIREN (9 dígitos) o SIRET (14 dígitos)", fieldEmail: "Correo electrónico",
      fieldPhone: "Teléfono", fieldCity: "Ciudad",
      fieldServices: "Servicios ofrecidos", fieldModality: "Modalidad de intervención",
      fieldCoverageZones: "Zonas cubiertas", fieldCoverageZonesHint: "Ciudades o códigos postales, separados por comas.",
      fieldIndicativeRate: "Tarifa indicativa (opcional)", fieldIndicativeRatePlaceholder: "ej. según presupuesto, desde 80 €/h",
      fieldIndicativeRateHint: "Solo indicativa — cada misión se presupuestará (próximamente).",
      consentLabel: "Acepto los términos y la política de privacidad de Grubano.",
      submit: "Enviar mi solicitud", submitting: "Enviando…", back: "Volver", backToLogin: "Volver a iniciar sesión",
      errorGeneric: "Algo salió mal, inténtalo de nuevo.",
      successTitle: "Solicitud recibida", successBody: "Estamos verificando tu empresa. Te avisaremos en cuanto se active tu espacio de proveedor.",
      successTitleActive: "Espacio de proveedor activado", successBodyActive: "Tu empresa está verificada. Inicia sesión para acceder a tu espacio.",
      successCtaActive: "Iniciar sesión",
      successTitleRejected: "Solicitud no completada", successBodyRejected: "No pudimos verificar este SIREN en el registro oficial. Comprueba el número e inténtalo de nuevo.",
      svcElectricity: "Electricidad", svcPlumbing: "Fontanería", svcHaccp: "APPCC / higiene", svcCleaning: "Limpieza",
      svcPestControl: "Control de plagas", svcFridgeRepair: "Reparación de frío", svcKitchenMaintenance: "Mantenimiento de cocina",
      svcAccounting: "Contabilidad", svcTraining: "Formación", svcOther: "Otro",
      modalityOnSite: "Presencial", modalityRemote: "A distancia", modalityBoth: "Ambas",
      dashboard: {
        welcome: "Espacio de proveedor", subtitle: "Tu actividad de servicios en Grubano",
        noProfileTitle: "Sin perfil de proveedor", noProfileBody: "Registra tu empresa para ofrecer tus servicios a los restaurantes.",
        registerCta: "Ser proveedor",
        statusPendingTitle: "Solicitud en revisión", statusPendingBody: "Tu empresa se está verificando. Te avisaremos en cuanto se active.",
        statusPending: "Pendiente", statusActive: "Activo", statusSuspended: "Suspendido", statusRejected: "Rechazado",
        comingSoonTitle: "Próximamente", comingSoonBody: "Las herramientas de tu actividad de servicios están en camino.",
        soonServices: "Servicios", soonQuotes: "Presupuestos", soonMissions: "Misiones", soonCalendar: "Calendario", soonReviews: "Reseñas", soonInvoicing: "Facturación",
        labelServices: "Servicios", labelCoverageZones: "Zonas cubiertas", labelModality: "Modalidad", labelRate: "Tarifa indicativa",
        emptyValue: "No indicado", editProfileCta: "Editar mi perfil",
      },
    },
    businessStart: { prestataireTitle: "Proveedor", prestataireDesc: "Vende tus servicios a los restaurantes (electricidad, APPCC, limpieza…)." },
    addActivity: { prestataireTitle: "Proveedor", prestataireDesc: "Ofrece tus servicios a los restaurantes de la red." },
    roleSwitcher: { spacePrestataire: "Espacio de proveedor" },
  },
  it: {
    prestataire: {
      registerTitle: "Diventa un fornitore di servizi",
      registerSubtitle: "Offri i tuoi servizi ai ristoranti della rete Grubano.",
      fieldCompanyName: "Nome dell’azienda", fieldContactName: "Nome del contatto",
      fieldSiren: "SIREN o SIRET", fieldSirenHint: "9 o 14 cifre — verificato nel registro ufficiale.",
      fieldSirenError: "SIREN (9 cifre) o SIRET (14 cifre) richiesto", fieldEmail: "E-mail",
      fieldPhone: "Telefono", fieldCity: "Città",
      fieldServices: "Servizi offerti", fieldModality: "Modalità di intervento",
      fieldCoverageZones: "Zone coperte", fieldCoverageZonesHint: "Città o codici postali, separati da virgole.",
      fieldIndicativeRate: "Tariffa indicativa (facoltativa)", fieldIndicativeRatePlaceholder: "es. su preventivo, da 80 €/h",
      fieldIndicativeRateHint: "Solo indicativa — ogni missione sarà preventivata (prossimamente).",
      consentLabel: "Accetto i termini e l’informativa sulla privacy di Grubano.",
      submit: "Invia la mia richiesta", submitting: "Invio…", back: "Indietro", backToLogin: "Torna all’accesso",
      errorGeneric: "Si è verificato un errore, riprova.",
      successTitle: "Richiesta ricevuta", successBody: "Stiamo verificando la tua azienda. Ti avviseremo non appena il tuo spazio fornitore sarà attivato.",
      successTitleActive: "Spazio fornitore attivato", successBodyActive: "La tua azienda è verificata. Accedi per entrare nel tuo spazio.",
      successCtaActive: "Accedi",
      successTitleRejected: "Richiesta non completata", successBodyRejected: "Non siamo riusciti a verificare questo SIREN nel registro ufficiale. Controlla il numero e riprova.",
      svcElectricity: "Elettricità", svcPlumbing: "Idraulica", svcHaccp: "HACCP / igiene", svcCleaning: "Pulizie",
      svcPestControl: "Disinfestazione", svcFridgeRepair: "Riparazione frigo", svcKitchenMaintenance: "Manutenzione cucina",
      svcAccounting: "Contabilità", svcTraining: "Formazione", svcOther: "Altro",
      modalityOnSite: "In loco", modalityRemote: "A distanza", modalityBoth: "Entrambe",
      dashboard: {
        welcome: "Spazio fornitore", subtitle: "La tua attività di servizi su Grubano",
        noProfileTitle: "Nessun profilo fornitore", noProfileBody: "Registra la tua azienda per offrire i tuoi servizi ai ristoranti.",
        registerCta: "Diventa fornitore",
        statusPendingTitle: "Richiesta in revisione", statusPendingBody: "La tua azienda è in verifica. Ti avviseremo non appena sarà attivata.",
        statusPending: "In attesa", statusActive: "Attivo", statusSuspended: "Sospeso", statusRejected: "Rifiutato",
        comingSoonTitle: "Presto disponibile", comingSoonBody: "Gli strumenti per la tua attività di servizi stanno arrivando.",
        soonServices: "Servizi", soonQuotes: "Preventivi", soonMissions: "Missioni", soonCalendar: "Calendario", soonReviews: "Recensioni", soonInvoicing: "Fatturazione",
        labelServices: "Servizi", labelCoverageZones: "Zone coperte", labelModality: "Modalità", labelRate: "Tariffa indicativa",
        emptyValue: "Non indicato", editProfileCta: "Modifica il mio profilo",
      },
    },
    businessStart: { prestataireTitle: "Fornitore di servizi", prestataireDesc: "Vendi i tuoi servizi ai ristoranti (elettricità, HACCP, pulizie…)." },
    addActivity: { prestataireTitle: "Fornitore di servizi", prestataireDesc: "Offri i tuoi servizi ai ristoranti della rete." },
    roleSwitcher: { spacePrestataire: "Spazio fornitore di servizi" },
  },
  ar: {
    prestataire: {
      registerTitle: "كن مقدّم خدمات",
      registerSubtitle: "قدّم خدماتك لمطاعم شبكة Grubano.",
      fieldCompanyName: "اسم الشركة", fieldContactName: "اسم جهة الاتصال",
      fieldSiren: "SIREN أو SIRET", fieldSirenHint: "9 أو 14 رقمًا — يتم التحقق منه في السجل الرسمي.",
      fieldSirenError: "مطلوب SIREN (9 أرقام) أو SIRET (14 رقمًا)", fieldEmail: "البريد الإلكتروني",
      fieldPhone: "الهاتف", fieldCity: "المدينة",
      fieldServices: "الخدمات المقدَّمة", fieldModality: "طريقة التدخل",
      fieldCoverageZones: "المناطق المغطّاة", fieldCoverageZonesHint: "مدن أو رموز بريدية، مفصولة بفواصل.",
      fieldIndicativeRate: "سعر استرشادي (اختياري)", fieldIndicativeRatePlaceholder: "مثال: حسب عرض السعر، من 80 €/س",
      fieldIndicativeRateHint: "استرشادي فقط — ستحصل كل مهمة على عرض سعر (قريبًا).",
      consentLabel: "أوافق على شروط Grubano وسياسة الخصوصية.",
      submit: "إرسال طلبي", submitting: "جارٍ الإرسال…", back: "رجوع", backToLogin: "العودة إلى تسجيل الدخول",
      errorGeneric: "حدث خطأ ما، حاول مرة أخرى.",
      successTitle: "تم استلام الطلب", successBody: "نتحقق من شركتك. سنُعلِمك فور تفعيل مساحة مقدّم الخدمات الخاصة بك.",
      successTitleActive: "تم تفعيل مساحة مقدّم الخدمات", successBodyActive: "تم التحقق من شركتك. سجّل الدخول للوصول إلى مساحتك.",
      successCtaActive: "تسجيل الدخول",
      successTitleRejected: "لم يكتمل الطلب", successBodyRejected: "تعذّر التحقق من رقم SIREN هذا في السجل الرسمي. تحقّق من الرقم وحاول مجددًا.",
      svcElectricity: "كهرباء", svcPlumbing: "سباكة", svcHaccp: "HACCP / النظافة", svcCleaning: "تنظيف",
      svcPestControl: "مكافحة الآفات", svcFridgeRepair: "إصلاح التبريد", svcKitchenMaintenance: "صيانة المطبخ",
      svcAccounting: "محاسبة", svcTraining: "تدريب", svcOther: "أخرى",
      modalityOnSite: "في الموقع", modalityRemote: "عن بُعد", modalityBoth: "كلاهما",
      dashboard: {
        welcome: "مساحة مقدّم الخدمات", subtitle: "نشاط خدماتك على Grubano",
        noProfileTitle: "لا يوجد ملف مقدّم خدمات", noProfileBody: "سجّل شركتك لتقديم خدماتك للمطاعم.",
        registerCta: "كن مقدّم خدمات",
        statusPendingTitle: "الطلب قيد المراجعة", statusPendingBody: "يتم التحقق من شركتك. سنُعلِمك فور التفعيل.",
        statusPending: "قيد الانتظار", statusActive: "نشط", statusSuspended: "موقوف", statusRejected: "مرفوض",
        comingSoonTitle: "قريبًا", comingSoonBody: "أدوات نشاط خدماتك في الطريق.",
        soonServices: "الخدمات", soonQuotes: "عروض الأسعار", soonMissions: "المهام", soonCalendar: "التقويم", soonReviews: "التقييمات", soonInvoicing: "الفوترة",
        labelServices: "الخدمات", labelCoverageZones: "المناطق المغطّاة", labelModality: "الطريقة", labelRate: "السعر الاسترشادي",
        emptyValue: "غير محدّد", editProfileCta: "تعديل ملفي",
      },
    },
    businessStart: { prestataireTitle: "مقدّم خدمات", prestataireDesc: "بِع خدماتك للمطاعم (كهرباء، HACCP، تنظيف…)." },
    addActivity: { prestataireTitle: "مقدّم خدمات", prestataireDesc: "قدّم خدماتك لمطاعم الشبكة." },
    roleSwitcher: { spacePrestataire: "مساحة مقدّم الخدمات" },
  },
}

let changed = 0
for (const loc of Object.keys(ADD)) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  const a = ADD[loc]
  // prestataire.* (with nested dashboard.*)
  json.prestataire = json.prestataire || {}
  const { dashboard, ...flat } = a.prestataire
  Object.assign(json.prestataire, flat)
  json.prestataire.dashboard = json.prestataire.dashboard || {}
  Object.assign(json.prestataire.dashboard, dashboard)
  // business.start card
  json.business = json.business || {}
  json.business.start = json.business.start || {}
  Object.assign(json.business.start, a.businessStart)
  // addActivity card
  json.addActivity = json.addActivity || {}
  Object.assign(json.addActivity, a.addActivity)
  // roleSwitcher label
  json.roleSwitcher = json.roleSwitcher || {}
  Object.assign(json.roleSwitcher, a.roleSwitcher)
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
  console.log(`✓ ${loc}: prestataire.* (+dashboard) + business.start + addActivity + roleSwitcher`)
}
console.log(`Done — ${changed} locale files updated.`)
