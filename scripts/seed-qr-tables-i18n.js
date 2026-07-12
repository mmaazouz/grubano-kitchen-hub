// scripts/seed-qr-tables-i18n.js
// /tables Setup — QR par table + planche imprimable (Agent 13).
// Additive ONLY: Object.assign's the keys below into each locale, never
// removes anything. Source of truth = fr.json; all locales must stay complete
// (npm run check:i18n). Dedicated seed — NOT translate-messages.js.
//
// Adds (per locale) under tables.qr.*:
//   title             → Setup section header
//   subtitle          → sober helper line
//   downloadPng       → per-table PNG download button label
//   downloadAria      → aria-label (with {name})
//   downloadFilename  → filename pattern when saving the PNG ({establishment}-{table})
//   printButton       → "Imprimer les QR codes" button label
//   printAria         → aria-label
//   sheetTitle        → header on the printable A4 sheet (with {establishment})
//   sheetCaption      → footer line on each printable card ("Scannez avec votre téléphone")
//   sheetBrandLine    → small Grubano wordmark line on the printable card
//   noTables          → empty-state caption when there are zero tables
//
// Run:  node scripts/seed-qr-tables-i18n.js   then   npm run check:i18n

const fs = require('fs')
const path = require('path')

const T = {
  fr: {
    title:            'QR codes des tables',
    subtitle:         'Un QR par table pour la commande à table. La page « Votre addition arrive bientôt » est déjà en ligne.',
    downloadPng:      'PNG',
    downloadAria:     'Télécharger le QR de {name} en PNG',
    downloadFilename: 'grubano-{establishment}-{table}.png',
    printButton:      'Imprimer les QR codes',
    printAria:        'Imprimer la planche des QR codes',
    sheetTitle:       'QR codes — {establishment}',
    sheetCaption:     'Scannez avec votre téléphone',
    sheetBrandLine:   'grubano.com',
    noTables:         'Ajoutez une table pour générer son QR code.',
  },
  en: {
    title:            'Table QR codes',
    subtitle:         'One QR per table for at-table ordering. The "Your bill is on the way" page is already live.',
    downloadPng:      'PNG',
    downloadAria:     'Download the QR of {name} as PNG',
    downloadFilename: 'grubano-{establishment}-{table}.png',
    printButton:      'Print QR codes',
    printAria:        'Print the QR-codes sheet',
    sheetTitle:       'QR codes — {establishment}',
    sheetCaption:     'Scan with your phone',
    sheetBrandLine:   'grubano.com',
    noTables:         'Add a table to generate its QR code.',
  },
  es: {
    title:            'Códigos QR de las mesas',
    subtitle:         'Un QR por mesa para pedir en la mesa. La página «Tu cuenta llega pronto» ya está activa.',
    downloadPng:      'PNG',
    downloadAria:     'Descargar el QR de {name} en PNG',
    downloadFilename: 'grubano-{establishment}-{table}.png',
    printButton:      'Imprimir los QR',
    printAria:        'Imprimir la hoja de QR',
    sheetTitle:       'Códigos QR — {establishment}',
    sheetCaption:     'Escanea con tu teléfono',
    sheetBrandLine:   'grubano.com',
    noTables:         'Añade una mesa para generar su QR.',
  },
  it: {
    title:            'QR code dei tavoli',
    subtitle:         'Un QR per tavolo per ordinare al tavolo. La pagina «Il tuo conto sta arrivando» è già online.',
    downloadPng:      'PNG',
    downloadAria:     'Scarica il QR di {name} in PNG',
    downloadFilename: 'grubano-{establishment}-{table}.png',
    printButton:      'Stampa i QR code',
    printAria:        'Stampa la pagina dei QR code',
    sheetTitle:       'QR code — {establishment}',
    sheetCaption:     'Scansiona con il tuo telefono',
    sheetBrandLine:   'grubano.com',
    noTables:         'Aggiungi un tavolo per generare il suo QR code.',
  },
  ar: {
    title:            'رموز QR للطاولات',
    subtitle:         'رمز QR لكل طاولة لطلب الطعام مباشرة. صفحة «فاتورتك قادمة قريبًا» متاحة الآن.',
    downloadPng:      'PNG',
    downloadAria:     'تنزيل رمز QR للطاولة {name} بصيغة PNG',
    downloadFilename: 'grubano-{establishment}-{table}.png',
    printButton:      'طباعة رموز QR',
    printAria:        'طباعة صفحة رموز QR',
    sheetTitle:       'رموز QR — {establishment}',
    sheetCaption:     'امسح بهاتفك',
    sheetBrandLine:   'grubano.com',
    noTables:         'أضف طاولة لإنشاء رمز QR الخاص بها.',
  },
}

for (const [loc, kv] of Object.entries(T)) {
  const p = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(p, 'utf8'))

  if (!m.tables) m.tables = {}
  if (!m.tables.qr) m.tables.qr = {}
  Object.assign(m.tables.qr, kv)

  fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`${loc}: +tables.qr.* (${Object.keys(kv).length} keys)`)
}
