// scripts/seed-tables-ui-i18n.js
// /tables UI — sélecteur établissement + champs durée (Config + modale) +
// blocage date passée (Agent 13).
// Additive ONLY: Object.assign's the keys below into each locale, never
// removes anything. Source of truth = fr.json; all locales must stay complete
// (npm run check:i18n). Dedicated seed — NOT translate-messages.js.
//
// Adds (per locale) under tables.*:
//   noEstabTitle / noEstabDesc        → empty-state when the operator has no establishment
//   noTablesTitle / noTablesDesc      → empty-state when this establishment has no table
//   noTablesGoSetup                   → CTA to the Setup tab
//   durationTitle / durationDesc      → Config card title + helper
//   durationHint                      → "Pré-rempli automatiquement dans le formulaire"
//   durationLabel                     → modal input label
//   durationUnit / minutes            → "min"
//   pastSlotError                     → form-level "slot already past" message
//   durationSaved / durationSaveError → toast-ish micro-messages on Save
//   durationSavedShort                → short "Enregistré" pill
//   durationPresets.{60,90,120}       → preset chips for Config
//
// Run:  node scripts/seed-tables-ui-i18n.js   then   npm run check:i18n

const fs = require('fs')
const path = require('path')

const T = {
  fr: {
    noEstabTitle:        'Aucun établissement',
    noEstabDesc:         'Créez un établissement pour gérer ses tables et réservations.',
    noTablesTitle:       'Aucune table',
    noTablesDesc:        'Ajoutez votre première table dans Config pour pouvoir prendre des réservations.',
    noTablesGoSetup:     'Aller à Config',
    durationTitle:       'Durée par défaut d’une réservation',
    durationDesc:        'Combien de temps une table reste réservée par défaut.',
    durationHint:        'Pré-rempli automatiquement dans le formulaire de réservation.',
    durationLabel:       'Durée (min)',
    durationUnit:        'min',
    minutes:             'minutes',
    pastSlotError:       'Créneau déjà passé — choisissez un horaire à venir.',
    durationSaved:       'Durée par défaut enregistrée',
    durationSaveError:   'Impossible d’enregistrer la durée',
    durationSavedShort:  'Enregistré',
    preset60:            '1 h',
    preset90:            '1 h 30',
    preset120:           '2 h',
  },
  en: {
    noEstabTitle:        'No establishment',
    noEstabDesc:         'Create an establishment to manage its tables and reservations.',
    noTablesTitle:       'No table yet',
    noTablesDesc:        'Add your first table in Setup to start taking reservations.',
    noTablesGoSetup:     'Go to Setup',
    durationTitle:       'Default reservation duration',
    durationDesc:        'How long a table stays reserved by default.',
    durationHint:        'Pre-filled in the reservation form.',
    durationLabel:       'Duration (min)',
    durationUnit:        'min',
    minutes:             'minutes',
    pastSlotError:       'Slot already past — pick a future time.',
    durationSaved:       'Default duration saved',
    durationSaveError:   'Could not save the duration',
    durationSavedShort:  'Saved',
    preset60:            '1 h',
    preset90:            '1 h 30',
    preset120:           '2 h',
  },
  es: {
    noEstabTitle:        'Ningún establecimiento',
    noEstabDesc:         'Crea un establecimiento para gestionar sus mesas y reservas.',
    noTablesTitle:       'Aún no hay mesas',
    noTablesDesc:        'Añade tu primera mesa en Config para empezar a tomar reservas.',
    noTablesGoSetup:     'Ir a Config',
    durationTitle:       'Duración por defecto de una reserva',
    durationDesc:        'Cuánto tiempo permanece reservada una mesa por defecto.',
    durationHint:        'Se rellena automáticamente en el formulario de reserva.',
    durationLabel:       'Duración (min)',
    durationUnit:        'min',
    minutes:             'minutos',
    pastSlotError:       'Franja ya pasada — elige un horario futuro.',
    durationSaved:       'Duración por defecto guardada',
    durationSaveError:   'No se pudo guardar la duración',
    durationSavedShort:  'Guardado',
    preset60:            '1 h',
    preset90:            '1 h 30',
    preset120:           '2 h',
  },
  it: {
    noEstabTitle:        'Nessuna struttura',
    noEstabDesc:         'Crea una struttura per gestire i suoi tavoli e le sue prenotazioni.',
    noTablesTitle:       'Nessun tavolo',
    noTablesDesc:        'Aggiungi il tuo primo tavolo in Config per iniziare ad accettare prenotazioni.',
    noTablesGoSetup:     'Vai a Config',
    durationTitle:       'Durata predefinita di una prenotazione',
    durationDesc:        'Per quanto tempo un tavolo resta prenotato per impostazione predefinita.',
    durationHint:        'Precompilata nel modulo di prenotazione.',
    durationLabel:       'Durata (min)',
    durationUnit:        'min',
    minutes:             'minuti',
    pastSlotError:       'Orario già passato — scegli un orario futuro.',
    durationSaved:       'Durata predefinita salvata',
    durationSaveError:   'Impossibile salvare la durata',
    durationSavedShort:  'Salvato',
    preset60:            '1 h',
    preset90:            '1 h 30',
    preset120:           '2 h',
  },
  ar: {
    noEstabTitle:        'لا منشأة',
    noEstabDesc:         'أنشئ منشأة لإدارة طاولاتها وحجوزاتها.',
    noTablesTitle:       'لا توجد طاولة بعد',
    noTablesDesc:        'أضف طاولتك الأولى في الإعدادات لبدء قبول الحجوزات.',
    noTablesGoSetup:     'الانتقال إلى الإعدادات',
    durationTitle:       'المدة الافتراضية للحجز',
    durationDesc:        'كم من الوقت تبقى الطاولة محجوزة افتراضيًا.',
    durationHint:        'يتم تعبئته تلقائيًا في نموذج الحجز.',
    durationLabel:       'المدة (دقيقة)',
    durationUnit:        'د',
    minutes:             'دقيقة',
    pastSlotError:       'موعد منقضٍ — اختر وقتًا مستقبليًا.',
    durationSaved:       'تم حفظ المدة الافتراضية',
    durationSaveError:   'تعذر حفظ المدة',
    durationSavedShort:  'تم الحفظ',
    preset60:            '١ س',
    preset90:            '١ س ٣٠',
    preset120:           '٢ س',
  },
}

for (const [loc, kv] of Object.entries(T)) {
  const p = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(p, 'utf8'))

  if (!m.tables) m.tables = {}
  Object.assign(m.tables, kv)

  fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`${loc}: +tables.* (${Object.keys(kv).length} keys)`)
}
