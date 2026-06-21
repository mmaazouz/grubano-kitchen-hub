// scripts/add-onboarding-guide-i18n.js — Onboarding anti-abandon guide (Agent 93).
// Adds onboardingGuide.* (compact progress guide chrome). Step titles are REUSED from the
// existing `activation` namespace — only the guide's own chrome is added here.
// FR vouvoiement, real Arabic (RTL). Idempotent; 2-space JSON.
// Run: node scripts/add-onboarding-guide-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

const ADD = {
  fr: {
    title: "Vous y êtes presque",
    subtitle: "Terminez votre installation pour passer en ligne.",
    progress: "{done} étape(s) sur {total}",
    resume: "Reprendre : {step}",
  },
  en: {
    title: "You're almost there",
    subtitle: "Finish setting up to go live.",
    progress: "{done} of {total} step(s)",
    resume: "Resume: {step}",
  },
  es: {
    title: "Ya casi está",
    subtitle: "Termine la configuración para publicarse.",
    progress: "{done} de {total} paso(s)",
    resume: "Reanudar: {step}",
  },
  it: {
    title: "Ci siamo quasi",
    subtitle: "Completi la configurazione per andare online.",
    progress: "{done} passaggio/i su {total}",
    resume: "Riprendere: {step}",
  },
  ar: {
    title: "أوشكت على الانتهاء",
    subtitle: "أكمِل الإعداد لتصبح متاحًا على المنصّة.",
    progress: "{done} من {total} خطوة",
    resume: "المتابعة: {step}",
  },
}

let changed = 0
for (const loc of Object.keys(ADD)) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.onboardingGuide = Object.assign({}, json.onboardingGuide, ADD[loc])
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
  console.log(`✓ ${loc}: onboardingGuide.*`)
}
console.log(`Done — ${changed} locale files updated.`)
