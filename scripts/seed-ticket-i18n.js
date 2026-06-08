// scripts/seed-ticket-i18n.js
// Dedicated seed for the "tickets" (table addition, brique 1) i18n namespace.
// Idempotent: adds any missing keys to messages/{fr,en,es,it,ar}.json WITHOUT
// overwriting existing translations. NOT translate-messages.js.
'use strict'

const fs   = require('fs')
const path = require('path')

const NS = 'tickets'

const T = {
  fr: {
    noTable: 'Aucune table — ajoutez-en une dans Config.',
    selectTable: 'Table',
    open: 'Ouvrir une addition',
    statusOpen: 'Ouverte',
    statusPaid: 'Payée',
    statusVoid: 'Annulée',
    total: 'Total',
    emptyLines: 'Aucune ligne pour le moment.',
    searchPlaceholder: 'Rechercher un plat…',
    menuEmpty: 'Aucun plat trouvé.',
    freeTitle: 'Ligne libre',
    freeNamePh: 'Libellé',
    freePricePh: 'Prix €',
    addBtn: 'Ajouter',
    paidNote: 'Le paiement par QR arrivera bientôt.',
    voidBtn: "Annuler l'addition",
    voidConfirm: 'Annuler cette addition ?',
    voidYes: 'Oui, annuler',
    voidNo: 'Non',
    error: 'Une erreur est survenue, réessayez.',
  },
  en: {
    noTable: 'No table — add one in Config.',
    selectTable: 'Table',
    open: 'Open a bill',
    statusOpen: 'Open',
    statusPaid: 'Paid',
    statusVoid: 'Voided',
    total: 'Total',
    emptyLines: 'No items yet.',
    searchPlaceholder: 'Search a dish…',
    menuEmpty: 'No dish found.',
    freeTitle: 'Free line',
    freeNamePh: 'Label',
    freePricePh: 'Price €',
    addBtn: 'Add',
    paidNote: 'QR payment is coming soon.',
    voidBtn: 'Void the bill',
    voidConfirm: 'Void this bill?',
    voidYes: 'Yes, void',
    voidNo: 'No',
    error: 'Something went wrong, try again.',
  },
  es: {
    noTable: 'Sin mesa — añade una en Config.',
    selectTable: 'Mesa',
    open: 'Abrir una cuenta',
    statusOpen: 'Abierta',
    statusPaid: 'Pagada',
    statusVoid: 'Anulada',
    total: 'Total',
    emptyLines: 'Sin líneas todavía.',
    searchPlaceholder: 'Buscar un plato…',
    menuEmpty: 'Ningún plato encontrado.',
    freeTitle: 'Línea libre',
    freeNamePh: 'Etiqueta',
    freePricePh: 'Precio €',
    addBtn: 'Añadir',
    paidNote: 'El pago por QR llegará pronto.',
    voidBtn: 'Anular la cuenta',
    voidConfirm: '¿Anular esta cuenta?',
    voidYes: 'Sí, anular',
    voidNo: 'No',
    error: 'Algo salió mal, inténtalo de nuevo.',
  },
  it: {
    noTable: 'Nessun tavolo — aggiungine uno in Config.',
    selectTable: 'Tavolo',
    open: 'Apri un conto',
    statusOpen: 'Aperto',
    statusPaid: 'Pagato',
    statusVoid: 'Annullato',
    total: 'Totale',
    emptyLines: 'Ancora nessuna riga.',
    searchPlaceholder: 'Cerca un piatto…',
    menuEmpty: 'Nessun piatto trovato.',
    freeTitle: 'Riga libera',
    freeNamePh: 'Etichetta',
    freePricePh: 'Prezzo €',
    addBtn: 'Aggiungi',
    paidNote: 'Il pagamento con QR arriverà presto.',
    voidBtn: 'Annulla il conto',
    voidConfirm: 'Annullare questo conto?',
    voidYes: 'Sì, annulla',
    voidNo: 'No',
    error: 'Qualcosa è andato storto, riprova.',
  },
  ar: {
    noTable: 'لا توجد طاولة — أضف واحدة في الإعدادات.',
    selectTable: 'الطاولة',
    open: 'فتح حساب',
    statusOpen: 'مفتوح',
    statusPaid: 'مدفوع',
    statusVoid: 'ملغى',
    total: 'الإجمالي',
    emptyLines: 'لا توجد أصناف بعد.',
    searchPlaceholder: 'ابحث عن طبق…',
    menuEmpty: 'لم يُعثر على طبق.',
    freeTitle: 'سطر حر',
    freeNamePh: 'التسمية',
    freePricePh: 'السعر €',
    addBtn: 'إضافة',
    paidNote: 'الدفع عبر QR قريبًا.',
    voidBtn: 'إلغاء الحساب',
    voidConfirm: 'إلغاء هذا الحساب؟',
    voidYes: 'نعم، إلغاء',
    voidNo: 'لا',
    error: 'حدث خطأ، حاول مرة أخرى.',
  },
}

const dir = path.join(__dirname, '..', 'messages')
let touched = 0
for (const locale of Object.keys(T)) {
  const file = path.join(dir, `${locale}.json`)
  if (!fs.existsSync(file)) { console.error(`[seed-ticket-i18n] missing ${file}`); process.exit(1) }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  // Merge: keep existing values, add missing keys only (idempotent).
  data[NS] = { ...T[locale], ...(data[NS] || {}) }
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8')
  touched++
  console.log(`[seed-ticket-i18n] ${locale}: ${Object.keys(data[NS]).length} keys in "${NS}"`)
}
console.log(`[seed-ticket-i18n] done — ${touched} locale files.`)
