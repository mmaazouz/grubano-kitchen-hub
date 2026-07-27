// scripts/add-prestataire-calendar-i18n.js — Prestataire P4 (Agent 77).
// Adds the SIMPLE DECLARATIVE calendar copy:
//   - prestataire.wd*                  → weekday short labels (shared: calendar + fiche)
//   - prestataire.calendar.*           → « Mon calendrier » page (availability + agenda)
//   - prestataire.dashboard.calendar*  → the dashboard « Mon calendrier » card
//   - marketplace.prestataires.availability* → the fiche read-only availability display
// FR vouvoiement, real Arabic (RTL). Idempotent; 2-space JSON. Run:
//   node scripts/add-prestataire-calendar-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

const ADD = {
  fr: {
    weekdays: { wdMon: "Lun", wdTue: "Mar", wdWed: "Mer", wdThu: "Jeu", wdFri: "Ven", wdSat: "Sam", wdSun: "Dim" },
    calendar: {
      title: "Mon calendrier", subtitle: "Vos disponibilités et vos missions planifiées.", back: "Tableau de bord",
      errLoad: "Impossible de charger votre calendrier.", errSave: "Impossible d’enregistrer, réessayez.",
      availabilityTitle: "Mes disponibilités", weekdaysLabel: "Jours travaillés",
      noteLabel: "Note de disponibilité", notePlaceholder: "ex. 8h-18h en semaine, urgences 24/7",
      saveAvailability: "Enregistrer", saving: "Enregistrement…", savedOk: "Disponibilités enregistrées",
      leaveTitle: "Périodes d’indisponibilité", leaveEmpty: "Aucune période déclarée.",
      addLeave: "Ajouter une période", leaveAdding: "Ajout…", leaveStart: "Du", leaveEnd: "Au",
      leaveReason: "Motif (facultatif)", leaveReasonPlaceholder: "ex. congés", leaveDelete: "Supprimer",
      leaveErrDates: "La date de fin doit être après la date de début.",
      missionsTitle: "Missions planifiées",
      missionsHint: "Vos missions acceptées avec une date prévue apparaissent ici (lecture seule).",
      missionsEmpty: "Aucune mission planifiée pour le moment.",
    },
    dashboard: { calendarTitle: "Mon calendrier", calendarBody: "Déclarez vos disponibilités et voyez vos missions planifiées." },
    prestataires: { availabilityTitle: "Disponibilités", availabilityDaysLabel: "Jours travaillés" },
  },
  en: {
    weekdays: { wdMon: "Mon", wdTue: "Tue", wdWed: "Wed", wdThu: "Thu", wdFri: "Fri", wdSat: "Sat", wdSun: "Sun" },
    calendar: {
      title: "My calendar", subtitle: "Your availability and your planned missions.", back: "Dashboard",
      errLoad: "Couldn't load your calendar.", errSave: "Couldn't save, please try again.",
      availabilityTitle: "My availability", weekdaysLabel: "Working days",
      noteLabel: "Availability note", notePlaceholder: "e.g. 8am-6pm on weekdays, emergencies 24/7",
      saveAvailability: "Save", saving: "Saving…", savedOk: "Availability saved",
      leaveTitle: "Time-off periods", leaveEmpty: "No period declared.",
      addLeave: "Add a period", leaveAdding: "Adding…", leaveStart: "From", leaveEnd: "To",
      leaveReason: "Reason (optional)", leaveReasonPlaceholder: "e.g. holidays", leaveDelete: "Delete",
      leaveErrDates: "The end date must be on or after the start date.",
      missionsTitle: "Planned missions",
      missionsHint: "Your accepted missions with a planned date appear here (read-only).",
      missionsEmpty: "No planned mission yet.",
    },
    dashboard: { calendarTitle: "My calendar", calendarBody: "Declare your availability and see your planned missions." },
    prestataires: { availabilityTitle: "Availability", availabilityDaysLabel: "Working days" },
  },
  es: {
    weekdays: { wdMon: "Lun", wdTue: "Mar", wdWed: "Mié", wdThu: "Jue", wdFri: "Vie", wdSat: "Sáb", wdSun: "Dom" },
    calendar: {
      title: "Mi calendario", subtitle: "Su disponibilidad y sus misiones planificadas.", back: "Panel",
      errLoad: "No se pudo cargar su calendario.", errSave: "No se pudo guardar, inténtelo de nuevo.",
      availabilityTitle: "Mi disponibilidad", weekdaysLabel: "Días laborables",
      noteLabel: "Nota de disponibilidad", notePlaceholder: "ej. 8h-18h entre semana, urgencias 24/7",
      saveAvailability: "Guardar", saving: "Guardando…", savedOk: "Disponibilidad guardada",
      leaveTitle: "Períodos de indisponibilidad", leaveEmpty: "Ningún período declarado.",
      addLeave: "Añadir un período", leaveAdding: "Añadiendo…", leaveStart: "Desde", leaveEnd: "Hasta",
      leaveReason: "Motivo (opcional)", leaveReasonPlaceholder: "ej. vacaciones", leaveDelete: "Eliminar",
      leaveErrDates: "La fecha de fin debe ser posterior o igual a la de inicio.",
      missionsTitle: "Misiones planificadas",
      missionsHint: "Sus misiones aceptadas con fecha prevista aparecen aquí (solo lectura).",
      missionsEmpty: "Aún no hay misiones planificadas.",
    },
    dashboard: { calendarTitle: "Mi calendario", calendarBody: "Declare su disponibilidad y vea sus misiones planificadas." },
    prestataires: { availabilityTitle: "Disponibilidad", availabilityDaysLabel: "Días laborables" },
  },
  it: {
    weekdays: { wdMon: "Lun", wdTue: "Mar", wdWed: "Mer", wdThu: "Gio", wdFri: "Ven", wdSat: "Sab", wdSun: "Dom" },
    calendar: {
      title: "Il mio calendario", subtitle: "La vostra disponibilità e le vostre missioni pianificate.", back: "Pannello",
      errLoad: "Impossibile caricare il vostro calendario.", errSave: "Impossibile salvare, riprovate.",
      availabilityTitle: "La mia disponibilità", weekdaysLabel: "Giorni lavorativi",
      noteLabel: "Nota di disponibilità", notePlaceholder: "es. 8-18 nei giorni feriali, urgenze 24/7",
      saveAvailability: "Salva", saving: "Salvataggio…", savedOk: "Disponibilità salvata",
      leaveTitle: "Periodi di indisponibilità", leaveEmpty: "Nessun periodo dichiarato.",
      addLeave: "Aggiungi un periodo", leaveAdding: "Aggiunta…", leaveStart: "Dal", leaveEnd: "Al",
      leaveReason: "Motivo (facoltativo)", leaveReasonPlaceholder: "es. ferie", leaveDelete: "Elimina",
      leaveErrDates: "La data di fine deve essere uguale o successiva a quella di inizio.",
      missionsTitle: "Missioni pianificate",
      missionsHint: "Le vostre missioni accettate con una data prevista appaiono qui (sola lettura).",
      missionsEmpty: "Nessuna missione pianificata per ora.",
    },
    dashboard: { calendarTitle: "Il mio calendario", calendarBody: "Dichiarate la vostra disponibilità e consultate le missioni pianificate." },
    prestataires: { availabilityTitle: "Disponibilità", availabilityDaysLabel: "Giorni lavorativi" },
  },
  ar: {
    weekdays: { wdMon: "الاثنين", wdTue: "الثلاثاء", wdWed: "الأربعاء", wdThu: "الخميس", wdFri: "الجمعة", wdSat: "السبت", wdSun: "الأحد" },
    calendar: {
      title: "تقويمي", subtitle: "توفّرك ومهامك المجدولة.", back: "لوحة التحكم",
      errLoad: "تعذّر تحميل تقويمك.", errSave: "تعذّر الحفظ، حاول مجدّدًا.",
      availabilityTitle: "توفّري", weekdaysLabel: "أيام العمل",
      noteLabel: "ملاحظة التوفّر", notePlaceholder: "مثال: 8ص-6م في أيام الأسبوع، الطوارئ على مدار الساعة",
      saveAvailability: "حفظ", saving: "جارٍ الحفظ…", savedOk: "تم حفظ التوفّر",
      leaveTitle: "فترات عدم التوفّر", leaveEmpty: "لا توجد فترة معلنة.",
      addLeave: "إضافة فترة", leaveAdding: "جارٍ الإضافة…", leaveStart: "من", leaveEnd: "إلى",
      leaveReason: "السبب (اختياري)", leaveReasonPlaceholder: "مثال: إجازة", leaveDelete: "حذف",
      leaveErrDates: "يجب أن يكون تاريخ النهاية في تاريخ البداية أو بعده.",
      missionsTitle: "المهام المجدولة",
      missionsHint: "تظهر هنا مهامك المقبولة ذات التاريخ المحدّد (للقراءة فقط).",
      missionsEmpty: "لا توجد مهام مجدولة بعد.",
    },
    dashboard: { calendarTitle: "تقويمي", calendarBody: "أعلن توفّرك واطّلع على مهامك المجدولة." },
    prestataires: { availabilityTitle: "التوفّر", availabilityDaysLabel: "أيام العمل" },
  },
}

let changed = 0
for (const loc of Object.keys(ADD)) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  const a = ADD[loc]
  json.prestataire = json.prestataire || {}
  Object.assign(json.prestataire, a.weekdays)            // prestataire.wd* (flat)
  json.prestataire.calendar = json.prestataire.calendar || {}
  Object.assign(json.prestataire.calendar, a.calendar)   // prestataire.calendar.*
  json.prestataire.dashboard = json.prestataire.dashboard || {}
  Object.assign(json.prestataire.dashboard, a.dashboard) // prestataire.dashboard.calendar*
  json.marketplace = json.marketplace || {}
  json.marketplace.prestataires = json.marketplace.prestataires || {}
  Object.assign(json.marketplace.prestataires, a.prestataires) // marketplace.prestataires.availability*
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
  console.log(`✓ ${loc}: prestataire.wd* + prestataire.calendar + dashboard.calendar* + marketplace.prestataires.availability*`)
}
console.log(`Done — ${changed} locale files updated.`)
