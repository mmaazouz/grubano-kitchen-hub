// scripts/add-influencer-rate-i18n.js — Influencer-rate display (Agent 90, finitions).
// Adds affiliate.influencerBadge + affiliate.influencerCommissionLine ×5 so a VERIFIED
// affiliate sees their higher commission rate on the dashboard (DISPLAY ONLY — no money).
// FR vouvoiement, real Arabic (RTL). Idempotent; 2-space JSON.
// Run: node scripts/add-influencer-rate-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

const ADD = {
  fr: {
    influencerBadge: "Influenceur vérifié",
    influencerCommissionLine: "En tant qu’influenceur vérifié, vous touchez {pct} % de la commission Grubano (sur la marge nette).",
  },
  en: {
    influencerBadge: "Verified influencer",
    influencerCommissionLine: "As a verified influencer, you earn {pct} % of Grubano’s commission (on the net margin).",
  },
  es: {
    influencerBadge: "Influencer verificado",
    influencerCommissionLine: "Como influencer verificado, usted recibe el {pct} % de la comisión de Grubano (sobre el margen neto).",
  },
  it: {
    influencerBadge: "Influencer verificato",
    influencerCommissionLine: "In quanto influencer verificato, lei riceve il {pct} % della commissione Grubano (sul margine netto).",
  },
  ar: {
    influencerBadge: "مؤثّر موثَّق",
    influencerCommissionLine: "بصفتك مؤثّرًا موثَّقًا، تحصل على {pct} % من عمولة Grubano (على الهامش الصافي).",
  },
}

let changed = 0
for (const loc of Object.keys(ADD)) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.affiliate = json.affiliate || {}
  json.affiliate = Object.assign({}, json.affiliate, ADD[loc])
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
  console.log(`✓ ${loc}: affiliate.influencerBadge + affiliate.influencerCommissionLine`)
}
console.log(`Done — ${changed} locale files updated.`)
