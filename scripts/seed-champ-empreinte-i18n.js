// scripts/seed-champ-empreinte-i18n.js
// /tables Setup — single "Acompte / empreinte de garantie" field wired to
// Restaurant.defaultDepositAmount (Agent 14 bc99eaf). Replaces the dead
// two-slider "Protection no-show" card.
//
// Additive ONLY: Object.assign's the keys below into each locale, never
// removes anything. Source of truth = fr.json; all locales must stay complete
// (npm run check:i18n). Dedicated seed — NOT translate-messages.js.
//
// Adds (per locale) under tables.noShow.*:
//   sectionTitle       → card header
//   intro              → sober one-liner about how the deposit works
//   depositLabel       → input label "Acompte / empreinte de garantie (€)"
//   depositHint        → "Montant bloqué sur la carte … 0 = aucune empreinte"
//   penaltyNote        → "Pénalité no-show = 100% de l'empreinte"
//   customerSeesPrefix → "Le client voit : {amount}€ bloqués sur sa carte…"
//   customerSeesNone   → "Le client voit : aucune empreinte demandée."
//   disabledLabel      → "Empreinte désactivée" pill when amount = 0
//   savedShort         → success pill (reuses durationSavedShort idiom)
//   saveError          → sober error message
//
// Run:  node scripts/seed-champ-empreinte-i18n.js   then   npm run check:i18n

const fs = require('fs')
const path = require('path')

const T = {
  fr: {
    sectionTitle:       'Protection no-show',
    intro:              'Pré-autorisation carte bancaire à la réservation.',
    depositLabel:       'Acompte / empreinte de garantie (€)',
    depositHint:        'Montant bloqué sur la carte du client à la réservation. Rien n’est débité s’il vient. 0 = aucune empreinte demandée.',
    penaltyNote:        'Pénalité no-show = 100% de l’empreinte.',
    customerSeesPrefix: 'Le client voit : {amount}€ bloqués sur sa carte. Rien n’est débité s’il vient.',
    customerSeesNone:   'Le client voit : aucune empreinte demandée.',
    disabledLabel:      'Empreinte désactivée',
    savedShort:         'Enregistré',
    saveError:          'Impossible d’enregistrer l’empreinte.',
  },
  en: {
    sectionTitle:       'No-show protection',
    intro:              'Card pre-authorisation at booking time.',
    depositLabel:       'Hold / guarantee (€)',
    depositHint:        'Amount placed on hold on the guest\'s card at booking. Nothing is charged if they show up. 0 = no hold required.',
    penaltyNote:        'No-show penalty = 100% of the hold.',
    customerSeesPrefix: 'Guests see: {amount}€ held on their card. Nothing is charged if they come.',
    customerSeesNone:   'Guests see: no hold required.',
    disabledLabel:      'Hold disabled',
    savedShort:         'Saved',
    saveError:          'Could not save the hold amount.',
  },
  es: {
    sectionTitle:       'Protección no-show',
    intro:              'Pre-autorización de tarjeta en el momento de la reserva.',
    depositLabel:       'Garantía / huella (€)',
    depositHint:        'Importe retenido en la tarjeta del cliente al reservar. No se cobra nada si acude. 0 = sin huella.',
    penaltyNote:        'Penalización por no-show = 100% de la huella.',
    customerSeesPrefix: 'El cliente ve: {amount}€ retenidos en su tarjeta. No se cobra nada si acude.',
    customerSeesNone:   'El cliente ve: sin huella requerida.',
    disabledLabel:      'Huella desactivada',
    savedShort:         'Guardado',
    saveError:          'No se pudo guardar el importe de la huella.',
  },
  it: {
    sectionTitle:       'Protezione no-show',
    intro:              'Pre-autorizzazione della carta al momento della prenotazione.',
    depositLabel:       'Caparra / impronta (€)',
    depositHint:        'Importo bloccato sulla carta del cliente alla prenotazione. Nulla viene addebitato se viene. 0 = nessuna impronta.',
    penaltyNote:        'Penale no-show = 100% dell’impronta.',
    customerSeesPrefix: 'Il cliente vede: {amount}€ bloccati sulla sua carta. Nulla viene addebitato se viene.',
    customerSeesNone:   'Il cliente vede: nessuna impronta richiesta.',
    disabledLabel:      'Impronta disattivata',
    savedShort:         'Salvato',
    saveError:          'Impossibile salvare l’importo dell’impronta.',
  },
  ar: {
    sectionTitle:       'الحماية من عدم الحضور',
    intro:              'مصادقة مسبقة على البطاقة عند الحجز.',
    depositLabel:       'مبلغ الضمان (€)',
    depositHint:        'مبلغ يُحجز على بطاقة العميل عند الحجز. لا يُخصم شيء إذا حضر. 0 = لا ضمان مطلوب.',
    penaltyNote:        'غرامة عدم الحضور = 100% من الضمان.',
    customerSeesPrefix: 'يرى العميل: {amount}€ محجوزة على بطاقته. لا يُخصم شيء إذا حضر.',
    customerSeesNone:   'يرى العميل: لا ضمان مطلوب.',
    disabledLabel:      'الضمان غير مفعّل',
    savedShort:         'تم الحفظ',
    saveError:          'تعذر حفظ مبلغ الضمان.',
  },
}

for (const [loc, kv] of Object.entries(T)) {
  const p = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(p, 'utf8'))

  if (!m.tables) m.tables = {}
  if (!m.tables.noShow) m.tables.noShow = {}
  Object.assign(m.tables.noShow, kv)

  fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`${loc}: +tables.noShow.* (${Object.keys(kv).length} keys)`)
}
