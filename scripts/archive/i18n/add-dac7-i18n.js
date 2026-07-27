// Adds the `dac7` namespace (P4.4-C) to all 5 locales with parity. Idempotent.
// Order: [fr, en, es, it, ar]. Run: node scripts/add-dac7-i18n.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

// Partner self-declaration form (on /more)
const FORM = {
  title:            ['Informations fiscales DAC7', 'DAC7 tax information', 'Información fiscal DAC7', 'Informazioni fiscali DAC7', 'معلومات DAC7 الضريبية'],
  subtitle:         ['Requises pour la déclaration des opérateurs de plateforme (UE).', 'Required for the EU platform-operator report.', 'Requeridas para la declaración de operadores de plataforma (UE).', 'Richieste per la dichiarazione degli operatori di piattaforma (UE).', 'مطلوبة لإقرار مشغّلي المنصات (الاتحاد الأوروبي).'],
  sellerType:       ['Type de vendeur', 'Seller type', 'Tipo de vendedor', 'Tipo di venditore', 'نوع البائع'],
  entity:           ['Société', 'Entity', 'Sociedad', 'Società', 'شركة'],
  individual:       ['Particulier', 'Individual', 'Particular', 'Privato', 'فرد'],
  unspecified:      ['Non spécifié', 'Unspecified', 'No especificado', 'Non specificato', 'غير محدد'],
  registeredAddress:['Adresse du siège', 'Registered address', 'Domicilio social', 'Indirizzo della sede', 'العنوان المسجل'],
  taxId:            ['Numéro d\'identification fiscale (TIN)', 'Tax identification number (TIN)', 'Número de identificación fiscal (NIF)', 'Codice fiscale (TIN)', 'رقم التعريف الضريبي (TIN)'],
  taxIdCountry:     ['Pays émetteur du TIN (code ISO)', 'TIN issuing country (ISO code)', 'País emisor del NIF (código ISO)', 'Paese di rilascio del TIN (codice ISO)', 'بلد إصدار TIN (رمز ISO)'],
  dateOfBirth:      ['Date de naissance (particuliers)', 'Date of birth (individuals)', 'Fecha de nacimiento (particulares)', 'Data di nascita (privati)', 'تاريخ الميلاد (للأفراد)'],
  save:             ['Enregistrer', 'Save', 'Guardar', 'Salva', 'حفظ'],
  saved:            ['Informations fiscales enregistrées.', 'Tax information saved.', 'Información fiscal guardada.', 'Informazioni fiscali salvate.', 'تم حفظ المعلومات الضريبية.'],
  error:            ['Une erreur est survenue. Réessayez.', 'Something went wrong. Please try again.', 'Se produjo un error. Inténtelo de nuevo.', 'Si è verificato un errore. Riprovi.', 'حدث خطأ. حاول مرة أخرى.'],
}

// Admin export console (/admin/dac7) — nested under dac7.admin
const ADMIN = {
  title:      ['Export DAC7', 'DAC7 export', 'Exportación DAC7', 'Esportazione DAC7', 'تصدير DAC7'],
  subtitle:   ['Rapport annuel des revenus vendeurs (déclaration plateforme). Réservé aux administrateurs.', 'Annual seller-revenue report (platform reporting). Administrators only.', 'Informe anual de ingresos de vendedores (declaración de plataforma). Solo administradores.', 'Rapporto annuale sui ricavi dei venditori (dichiarazione piattaforma). Solo amministratori.', 'تقرير سنوي بإيرادات البائعين (إقرار المنصة). للمسؤولين فقط.'],
  yearLabel:  ['Année', 'Year', 'Año', 'Anno', 'السنة'],
  exportCsv:  ['Exporter en CSV', 'Export CSV', 'Exportar CSV', 'Esporta CSV', 'تصدير CSV'],
  exportJson: ['Exporter en JSON', 'Export JSON', 'Exportar JSON', 'Esporta JSON', 'تصدير JSON'],
  note:       ['Mécanique uniquement — classification, vendeurs déclarables, seuils et format officiel (XML DGFiP) à valider par le comptable/juriste.', 'Mechanics only — classification, reportable sellers, thresholds and the official format (DGFiP XML) to be validated by the accountant/lawyer.', 'Solo mecánica — clasificación, vendedores declarables, umbrales y formato oficial a validar por el contable/jurista.', 'Solo meccanica — classificazione, venditori dichiarabili, soglie e formato ufficiale da validare dal commercialista/legale.', 'الآلية فقط — التصنيف والبائعون المشمولون والحدود والصيغة الرسمية يجب أن يعتمدها المحاسب/القانوني.'],
}

LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.dac7 = json.dac7 || {}
  json.dac7.admin = json.dac7.admin || {}
  for (const k of Object.keys(FORM)) json.dac7[k] = FORM[k][i]
  for (const k of Object.keys(ADMIN)) json.dac7.admin[k] = ADMIN[k][i]
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`  ✓ ${loc}.json — dac7 (+${Object.keys(FORM).length + Object.keys(ADMIN).length})`)
})
