// scripts/add-prestataire-services-i18n.js — Prestataire P2 (Agent 75).
// Adds the SERVICES + DISCOVERY copy:
//   - prestataire.services.*          → « Mes services » management page
//   - prestataire.dashboard.manage*   → the dashboard « Mes services » card
//   - marketplace.prestataires.*      → discovery list + detail fiche + landing card
// FR vouvoiement, real Arabic (RTL). Idempotent; 2-space JSON. Run:
//   node scripts/add-prestataire-services-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

const ADD = {
  fr: {
    services: {
      title: "Mes services", subtitle: "Les services que vous proposez aux restaurants.",
      back: "Tableau de bord", add: "Ajouter un service", addFirst: "Ajouter mon premier service",
      emptyTitle: "Aucun service", emptyDesc: "Ajoutez les services que vous proposez pour apparaître dans la découverte des restaurants.",
      edit: "Modifier", delete: "Supprimer", cancel: "Annuler", save: "Enregistrer", saving: "Enregistrement…",
      addTitle: "Nouveau service", editTitle: "Modifier le service",
      fTitle: "Intitulé du service", fTitlePlaceholder: "ex. Dépannage frigorifique 24/7",
      fCategory: "Catégorie", fModality: "Modalité", fDescription: "Description",
      fRate: "Tarif indicatif (facultatif)", fRatePlaceholder: "ex. sur devis, dès 80 €/h",
      fRateHint: "Indicatif uniquement — chaque mission fera l’objet d’un devis (à venir).",
      fActive: "Visible dans la découverte", hidden: "Masqué", onQuote: "Sur devis",
      errLoad: "Impossible de charger vos services.", errSave: "Impossible d’enregistrer, réessayez.",
      confirmDelete: "Supprimer « {title} » ?",
    },
    dashboard: { manageServicesTitle: "Mes services", manageServicesBody: "Gérez les services que vous proposez aux restaurants." },
    marketplace: {
      title: "Prestataires de services", subtitle: "Trouvez un prestataire par métier et par zone.",
      allTrades: "Tous les métiers", zonePlaceholder: "Ville ou code postal",
      empty: "Aucun prestataire pour le moment.", noMatch: "Aucun prestataire ne correspond à votre recherche.",
      servicesCount: "{count} services", errLoad: "Impossible de charger les prestataires.",
      backToList: "Retour à la liste", notFound: "Prestataire introuvable.",
      servicesTitle: "Services proposés", coverageLabel: "Zones couvertes",
      quoteSoonTitle: "Demande de devis bientôt disponible", quoteSoonBody: "La prise de contact et le devis en ligne arriveront prochainement.",
      onQuote: "Sur devis",
      discoverCardTitle: "Prestataires de services", discoverCardDesc: "Électricité, HACCP, nettoyage, dépannage… trouvez un prestataire.",
    },
  },
  en: {
    services: {
      title: "My services", subtitle: "The services you offer to restaurants.",
      back: "Dashboard", add: "Add a service", addFirst: "Add my first service",
      emptyTitle: "No services yet", emptyDesc: "Add the services you offer to appear in restaurant discovery.",
      edit: "Edit", delete: "Delete", cancel: "Cancel", save: "Save", saving: "Saving…",
      addTitle: "New service", editTitle: "Edit service",
      fTitle: "Service title", fTitlePlaceholder: "e.g. 24/7 refrigeration repair",
      fCategory: "Category", fModality: "Modality", fDescription: "Description",
      fRate: "Indicative rate (optional)", fRatePlaceholder: "e.g. on quote, from €80/h",
      fRateHint: "Indicative only — each mission will be quoted (coming soon).",
      fActive: "Visible in discovery", hidden: "Hidden", onQuote: "On quote",
      errLoad: "Couldn't load your services.", errSave: "Couldn't save, please try again.",
      confirmDelete: "Delete “{title}”?",
    },
    dashboard: { manageServicesTitle: "My services", manageServicesBody: "Manage the services you offer to restaurants." },
    marketplace: {
      title: "Service providers", subtitle: "Find a provider by trade and area.",
      allTrades: "All trades", zonePlaceholder: "City or postal code",
      empty: "No providers yet.", noMatch: "No provider matches your search.",
      servicesCount: "{count} services", errLoad: "Couldn't load providers.",
      backToList: "Back to list", notFound: "Provider not found.",
      servicesTitle: "Services offered", coverageLabel: "Coverage areas",
      quoteSoonTitle: "Quote request coming soon", quoteSoonBody: "Online contact and quoting will arrive shortly.",
      onQuote: "On quote",
      discoverCardTitle: "Service providers", discoverCardDesc: "Electricity, HACCP, cleaning, repairs… find a provider.",
    },
  },
  es: {
    services: {
      title: "Mis servicios", subtitle: "Los servicios que ofrece a los restaurantes.",
      back: "Panel", add: "Añadir un servicio", addFirst: "Añadir mi primer servicio",
      emptyTitle: "Aún no hay servicios", emptyDesc: "Añada los servicios que ofrece para aparecer en la búsqueda de los restaurantes.",
      edit: "Editar", delete: "Eliminar", cancel: "Cancelar", save: "Guardar", saving: "Guardando…",
      addTitle: "Nuevo servicio", editTitle: "Editar servicio",
      fTitle: "Título del servicio", fTitlePlaceholder: "ej. Reparación frigorífica 24/7",
      fCategory: "Categoría", fModality: "Modalidad", fDescription: "Descripción",
      fRate: "Tarifa indicativa (opcional)", fRatePlaceholder: "ej. a presupuesto, desde 80 €/h",
      fRateHint: "Solo indicativo — cada misión se presupuestará (próximamente).",
      fActive: "Visible en la búsqueda", hidden: "Oculto", onQuote: "A presupuesto",
      errLoad: "No se pudieron cargar sus servicios.", errSave: "No se pudo guardar, inténtelo de nuevo.",
      confirmDelete: "¿Eliminar «{title}»?",
    },
    dashboard: { manageServicesTitle: "Mis servicios", manageServicesBody: "Gestione los servicios que ofrece a los restaurantes." },
    marketplace: {
      title: "Proveedores de servicios", subtitle: "Encuentre un proveedor por oficio y zona.",
      allTrades: "Todos los oficios", zonePlaceholder: "Ciudad o código postal",
      empty: "Aún no hay proveedores.", noMatch: "Ningún proveedor coincide con su búsqueda.",
      servicesCount: "{count} servicios", errLoad: "No se pudieron cargar los proveedores.",
      backToList: "Volver a la lista", notFound: "Proveedor no encontrado.",
      servicesTitle: "Servicios ofrecidos", coverageLabel: "Zonas cubiertas",
      quoteSoonTitle: "Solicitud de presupuesto próximamente", quoteSoonBody: "El contacto y el presupuesto en línea llegarán pronto.",
      onQuote: "A presupuesto",
      discoverCardTitle: "Proveedores de servicios", discoverCardDesc: "Electricidad, HACCP, limpieza, reparaciones… encuentre un proveedor.",
    },
  },
  it: {
    services: {
      title: "I miei servizi", subtitle: "I servizi che offrite ai ristoranti.",
      back: "Pannello", add: "Aggiungi un servizio", addFirst: "Aggiungi il mio primo servizio",
      emptyTitle: "Nessun servizio", emptyDesc: "Aggiungete i servizi che offrite per apparire nella ricerca dei ristoranti.",
      edit: "Modifica", delete: "Elimina", cancel: "Annulla", save: "Salva", saving: "Salvataggio…",
      addTitle: "Nuovo servizio", editTitle: "Modifica servizio",
      fTitle: "Titolo del servizio", fTitlePlaceholder: "es. Riparazione frigorifera 24/7",
      fCategory: "Categoria", fModality: "Modalità", fDescription: "Descrizione",
      fRate: "Tariffa indicativa (facoltativa)", fRatePlaceholder: "es. su preventivo, da 80 €/h",
      fRateHint: "Solo indicativa — ogni intervento sarà preventivato (prossimamente).",
      fActive: "Visibile nella ricerca", hidden: "Nascosto", onQuote: "Su preventivo",
      errLoad: "Impossibile caricare i vostri servizi.", errSave: "Impossibile salvare, riprovate.",
      confirmDelete: "Eliminare «{title}»?",
    },
    dashboard: { manageServicesTitle: "I miei servizi", manageServicesBody: "Gestite i servizi che offrite ai ristoranti." },
    marketplace: {
      title: "Prestatori di servizi", subtitle: "Trovate un prestatore per mestiere e zona.",
      allTrades: "Tutti i mestieri", zonePlaceholder: "Città o CAP",
      empty: "Nessun prestatore per ora.", noMatch: "Nessun prestatore corrisponde alla ricerca.",
      servicesCount: "{count} servizi", errLoad: "Impossibile caricare i prestatori.",
      backToList: "Torna alla lista", notFound: "Prestatore non trovato.",
      servicesTitle: "Servizi offerti", coverageLabel: "Zone coperte",
      quoteSoonTitle: "Richiesta di preventivo presto disponibile", quoteSoonBody: "Il contatto e il preventivo online arriveranno a breve.",
      onQuote: "Su preventivo",
      discoverCardTitle: "Prestatori di servizi", discoverCardDesc: "Elettricità, HACCP, pulizie, riparazioni… trovate un prestatore.",
    },
  },
  ar: {
    services: {
      title: "خدماتي", subtitle: "الخدمات التي تقدّمها للمطاعم.",
      back: "لوحة التحكم", add: "إضافة خدمة", addFirst: "إضافة أوّل خدمة",
      emptyTitle: "لا توجد خدمات", emptyDesc: "أضِف الخدمات التي تقدّمها لتظهر في بحث المطاعم.",
      edit: "تعديل", delete: "حذف", cancel: "إلغاء", save: "حفظ", saving: "جارٍ الحفظ…",
      addTitle: "خدمة جديدة", editTitle: "تعديل الخدمة",
      fTitle: "عنوان الخدمة", fTitlePlaceholder: "مثال: إصلاح التبريد على مدار الساعة",
      fCategory: "الفئة", fModality: "طريقة التقديم", fDescription: "الوصف",
      fRate: "السعر الاسترشادي (اختياري)", fRatePlaceholder: "مثال: حسب عرض السعر، من 80 €/س",
      fRateHint: "استرشادي فقط — كل مهمة ستكون محلّ عرض سعر (قريبًا).",
      fActive: "مرئي في البحث", hidden: "مخفي", onQuote: "حسب عرض السعر",
      errLoad: "تعذّر تحميل خدماتك.", errSave: "تعذّر الحفظ، حاول مجدّدًا.",
      confirmDelete: "حذف «{title}»؟",
    },
    dashboard: { manageServicesTitle: "خدماتي", manageServicesBody: "أدِر الخدمات التي تقدّمها للمطاعم." },
    marketplace: {
      title: "مقدّمو الخدمات", subtitle: "ابحث عن مقدّم خدمة حسب المهنة والمنطقة.",
      allTrades: "كل المهن", zonePlaceholder: "المدينة أو الرمز البريدي",
      empty: "لا يوجد مقدّمو خدمات بعد.", noMatch: "لا يوجد مقدّم خدمة يطابق بحثك.",
      servicesCount: "{count} خدمات", errLoad: "تعذّر تحميل مقدّمي الخدمات.",
      backToList: "العودة إلى القائمة", notFound: "مقدّم الخدمة غير موجود.",
      servicesTitle: "الخدمات المقدّمة", coverageLabel: "المناطق المغطّاة",
      quoteSoonTitle: "طلب عرض السعر قريبًا", quoteSoonBody: "سيتوفّر التواصل وطلب عرض السعر عبر الإنترنت قريبًا.",
      onQuote: "حسب عرض السعر",
      discoverCardTitle: "مقدّمو الخدمات", discoverCardDesc: "كهرباء، HACCP، تنظيف، إصلاح… ابحث عن مقدّم خدمة.",
    },
  },
}

let changed = 0
for (const loc of Object.keys(ADD)) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  const a = ADD[loc]
  // prestataire.services.* (nested)
  json.prestataire = json.prestataire || {}
  json.prestataire.services = json.prestataire.services || {}
  Object.assign(json.prestataire.services, a.services)
  // prestataire.dashboard.manage* (merge into existing dashboard)
  json.prestataire.dashboard = json.prestataire.dashboard || {}
  Object.assign(json.prestataire.dashboard, a.dashboard)
  // marketplace.prestataires.* (nested)
  json.marketplace = json.marketplace || {}
  json.marketplace.prestataires = json.marketplace.prestataires || {}
  Object.assign(json.marketplace.prestataires, a.marketplace)
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
  console.log(`✓ ${loc}: prestataire.services + prestataire.dashboard.manage* + marketplace.prestataires`)
}
console.log(`Done — ${changed} locale files updated.`)
