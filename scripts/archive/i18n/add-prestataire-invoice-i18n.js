// scripts/add-prestataire-invoice-i18n.js — Prestataire P6 (Agent 79).
// Adds the INVOICE copy:
//   - prestataire.invoice.*                       → the shared invoice modal (ServiceInvoiceModal)
//   - prestataire.missions.invoiceCta             → the « Facture » button (prestataire view)
//   - marketplace.prestataireMissions.invoiceCta  → the « Facture » button (resto view)
// FR vouvoiement, real Arabic (RTL). Idempotent; 2-space JSON. NO money — invoice document only.
// Run: node scripts/add-prestataire-invoice-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

const ADD = {
  fr: {
    invoice: {
      title: "Facture", close: "Fermer", number: "Numéro", issuedAt: "Émise le", amount: "Montant",
      commission: "Commission Grubano ({pct} %)", net: "Net prestataire",
      noPaymentNote: "Aucun paiement n’est encore prélevé. Ce document fige le montant convenu et la répartition ; le règlement interviendra plus tard.",
      errLoad: "Impossible de charger la facture.", download: "Télécharger le PDF",
    },
    missionsCta: "Facture", restoCta: "Facture",
  },
  en: {
    invoice: {
      title: "Invoice", close: "Close", number: "Number", issuedAt: "Issued on", amount: "Amount",
      commission: "Grubano commission ({pct}%)", net: "Provider net",
      noPaymentNote: "No payment has been taken yet. This document records the agreed amount and the split; settlement happens later.",
      errLoad: "Couldn’t load the invoice.", download: "Download the PDF",
    },
    missionsCta: "Invoice", restoCta: "Invoice",
  },
  es: {
    invoice: {
      title: "Factura", close: "Cerrar", number: "Número", issuedAt: "Emitida el", amount: "Importe",
      commission: "Comisión Grubano ({pct} %)", net: "Neto del prestador",
      noPaymentNote: "Aún no se ha cobrado ningún pago. Este documento fija el importe acordado y el reparto; la liquidación se realizará más adelante.",
      errLoad: "No se pudo cargar la factura.", download: "Descargar el PDF",
    },
    missionsCta: "Factura", restoCta: "Factura",
  },
  it: {
    invoice: {
      title: "Fattura", close: "Chiudi", number: "Numero", issuedAt: "Emessa il", amount: "Importo",
      commission: "Commissione Grubano ({pct} %)", net: "Netto prestatore",
      noPaymentNote: "Nessun pagamento è ancora stato prelevato. Questo documento fissa l’importo concordato e la ripartizione; il saldo avverrà in seguito.",
      errLoad: "Impossibile caricare la fattura.", download: "Scarica il PDF",
    },
    missionsCta: "Fattura", restoCta: "Fattura",
  },
  ar: {
    invoice: {
      title: "فاتورة", close: "إغلاق", number: "الرقم", issuedAt: "صدرت في", amount: "المبلغ",
      commission: "عمولة Grubano ({pct}%)", net: "صافي مزوّد الخدمة",
      noPaymentNote: "لم يُخصم أي مبلغ بعد. تُثبّت هذه الوثيقة المبلغ المتّفق عليه والتوزيع؛ وتتم التسوية لاحقًا.",
      errLoad: "تعذّر تحميل الفاتورة.", download: "تنزيل ملف PDF",
    },
    missionsCta: "فاتورة", restoCta: "فاتورة",
  },
}

let changed = 0
for (const loc of Object.keys(ADD)) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  const a = ADD[loc]

  json.prestataire = json.prestataire || {}
  json.prestataire.invoice = Object.assign({}, json.prestataire.invoice, a.invoice)
  json.prestataire.missions = json.prestataire.missions || {}
  json.prestataire.missions.invoiceCta = a.missionsCta

  json.marketplace = json.marketplace || {}
  json.marketplace.prestataireMissions = json.marketplace.prestataireMissions || {}
  json.marketplace.prestataireMissions.invoiceCta = a.restoCta

  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
  console.log(`✓ ${loc}: prestataire.invoice.* + prestataire.missions.invoiceCta + marketplace.prestataireMissions.invoiceCta`)
}
console.log(`Done — ${changed} locale files updated.`)
