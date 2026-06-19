// Adds the `fiscal` namespace (P4.4-A — operator VAT-number settings) to all 5 locales
// with parity. Idempotent. Order: [fr, en, es, it, ar]. Run: node scripts/add-fiscal-i18n.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

const FISCAL = {
  title:       ['Informations fiscales', 'Tax information', 'Información fiscal', 'Informazioni fiscali', 'المعلومات الضريبية'],
  subtitle:    ['Votre n° de TVA apparaîtra sur les factures de commission Grubano.', 'Your VAT number will appear on your Grubano commission invoices.', 'Su número de IVA aparecerá en sus facturas de comisión de Grubano.', 'La sua partita IVA apparirà sulle fatture di commissione Grubano.', 'سيظهر رقم ضريبة القيمة المضافة على فواتير عمولة Grubano.'],
  vatLabel:    ['N° de TVA intracommunautaire', 'Intra-community VAT number', 'Número de IVA intracomunitario', 'Partita IVA intracomunitaria', 'رقم ضريبة القيمة المضافة'],
  vatPlaceholder: ['FR 12 345 678 901', 'FR 12 345 678 901', 'ES X1234567X', 'IT 12345678901', 'FR 12 345 678 901'],
  save:        ['Enregistrer', 'Save', 'Guardar', 'Salva', 'حفظ'],
  saving:      ['Enregistrement…', 'Saving…', 'Guardando…', 'Salvataggio…', 'جارٍ الحفظ…'],
  saved:       ['N° de TVA enregistré.', 'VAT number saved.', 'Número de IVA guardado.', 'Partita IVA salvata.', 'تم حفظ رقم ضريبة القيمة المضافة.'],
  cleared:     ['N° de TVA effacé.', 'VAT number cleared.', 'Número de IVA borrado.', 'Partita IVA cancellata.', 'تم مسح رقم ضريبة القيمة المضافة.'],
  error:       ['Une erreur est survenue. Réessayez.', 'Something went wrong. Please try again.', 'Se produjo un error. Inténtelo de nuevo.', 'Si è verificato un errore. Riprovi.', 'حدث خطأ. حاول مرة أخرى.'],
}

LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.fiscal = json.fiscal || {}
  for (const k of Object.keys(FISCAL)) json.fiscal[k] = FISCAL[k][i]
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`  ✓ ${loc}.json — fiscal (+${Object.keys(FISCAL).length})`)
})
