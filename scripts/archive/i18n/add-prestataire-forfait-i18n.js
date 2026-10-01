// scripts/add-prestataire-forfait-i18n.js — Prestataire P8b (Agent 82).
// Adds the FORFAIT (fixed-price, paid upfront) copy:
//   - prestataire.services.fForfait* + forfaitBadge  → the offering form + card (prestataire)
//   - marketplace.prestataires.forfaitLabel/orderForfaitCta/orderForfaitErr → the fiche (resto)
// FR vouvoiement, real Arabic (RTL). Idempotent; 2-space JSON. ⚠️ REAL money (TEST) — the amount
// is server-derived. Run: node scripts/add-prestataire-forfait-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

const ADD = {
  fr: {
    services: {
      fForfait: "Forfait (prix fixe)", fForfaitPlaceholder: "ex. 150",
      fForfaitHint: "Laissez vide pour « sur devis ». Si renseigné, le restaurant peut commander et payer ce service d’avance.",
      forfaitBadge: "Forfait {price}",
    },
    prestataires: { forfaitLabel: "forfait", orderForfaitCta: "Commander (prix fixe)", orderForfaitErr: "La commande n’a pas pu démarrer. Réessayez." },
  },
  en: {
    services: {
      fForfait: "Fixed-price package", fForfaitPlaceholder: "e.g. 150",
      fForfaitHint: "Leave empty for « on quote ». If set, the restaurant can order and pay for this service upfront.",
      forfaitBadge: "Package {price}",
    },
    prestataires: { forfaitLabel: "package", orderForfaitCta: "Order (fixed price)", orderForfaitErr: "Couldn’t start the order. Please try again." },
  },
  es: {
    services: {
      fForfait: "Tarifa fija (forfait)", fForfaitPlaceholder: "p. ej. 150",
      fForfaitHint: "Déjelo vacío para « presupuesto ». Si lo indica, el restaurante puede pedir y pagar este servicio por adelantado.",
      forfaitBadge: "Forfait {price}",
    },
    prestataires: { forfaitLabel: "forfait", orderForfaitCta: "Pedir (precio fijo)", orderForfaitErr: "No se pudo iniciar el pedido. Inténtelo de nuevo." },
  },
  it: {
    services: {
      fForfait: "Forfait (prezzo fisso)", fForfaitPlaceholder: "es. 150",
      fForfaitHint: "Lasciate vuoto per « su preventivo ». Se indicato, il ristorante può ordinare e pagare questo servizio in anticipo.",
      forfaitBadge: "Forfait {price}",
    },
    prestataires: { forfaitLabel: "forfait", orderForfaitCta: "Ordina (prezzo fisso)", orderForfaitErr: "Impossibile avviare l’ordine. Riprovate." },
  },
  ar: {
    services: {
      fForfait: "سعر ثابت (forfait)", fForfaitPlaceholder: "مثال 150",
      fForfaitHint: "اتركه فارغًا لـ « حسب التسعيرة ». إذا حُدِّد، يمكن للمطعم طلب هذه الخدمة ودفعها مسبقًا.",
      forfaitBadge: "سعر ثابت {price}",
    },
    prestataires: { forfaitLabel: "سعر ثابت", orderForfaitCta: "اطلب (سعر ثابت)", orderForfaitErr: "تعذّر بدء الطلب. حاول مجدّدًا." },
  },
}

let changed = 0
for (const loc of Object.keys(ADD)) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  const a = ADD[loc]
  json.prestataire = json.prestataire || {}
  json.prestataire.services = Object.assign({}, json.prestataire.services, a.services)
  json.marketplace = json.marketplace || {}
  json.marketplace.prestataires = Object.assign({}, json.marketplace.prestataires, a.prestataires)
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
  console.log(`✓ ${loc}: prestataire.services.fForfait* + marketplace.prestataires.forfait/order*`)
}
console.log(`Done — ${changed} locale files updated.`)
