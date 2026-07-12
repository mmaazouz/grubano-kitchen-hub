// scripts/add-nudge-generic-i18n.js — Role-generic nudge copy for affiliate+creator (Agent 102).
// Adds onboardingNudge.generic.{subject,title,body,resumeCta} — role-AGNOSTIC reminder copy
// (no "restaurant" wording, NO money figure). The existing restaurant keys (onboardingNudge.*)
// are UNTOUCHED; greeting/unsubPrefix/unsubLink are reused for all roles. FR vouvoiement, real
// Arabic (RTL), ICU plural on {steps}. Idempotent; 2-space JSON.
// Run: node scripts/add-nudge-generic-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

const GENERIC = {
  fr: {
    subject: "Il vous reste {steps, plural, one {# étape} other {# étapes}} pour finaliser votre inscription",
    title: "Vous y êtes presque",
    body: "Il vous reste {steps, plural, one {# étape} other {# étapes}} pour finaliser votre inscription sur Grubano. Reprenez là où vous vous êtes arrêté.",
    resumeCta: "Reprendre mon inscription",
  },
  en: {
    subject: "You have {steps, plural, one {# step} other {# steps}} left to finish your sign-up",
    title: "You’re almost there",
    body: "You have {steps, plural, one {# step} other {# steps}} left to finish your sign-up on Grubano. Pick up where you left off.",
    resumeCta: "Resume my sign-up",
  },
  es: {
    subject: "Le quedan {steps, plural, one {# paso} other {# pasos}} para completar su registro",
    title: "Ya casi está",
    body: "Le quedan {steps, plural, one {# paso} other {# pasos}} para completar su registro en Grubano. Continúe donde lo dejó.",
    resumeCta: "Reanudar mi registro",
  },
  it: {
    subject: "Le restano {steps, plural, one {# passaggio} other {# passaggi}} per completare la registrazione",
    title: "Ci siamo quasi",
    body: "Le restano {steps, plural, one {# passaggio} other {# passaggi}} per completare la registrazione su Grubano. Riprenda da dove si era fermato.",
    resumeCta: "Riprendere la registrazione",
  },
  ar: {
    subject: "تبقّى لك {steps, plural, one {خطوة واحدة} other {# خطوات}} لإكمال تسجيلك",
    title: "أوشكت على الانتهاء",
    body: "تبقّى لك {steps, plural, one {خطوة واحدة} other {# خطوات}} لإكمال تسجيلك على Grubano. تابِع من حيث توقّفت.",
    resumeCta: "متابعة تسجيلي",
  },
}

let changed = 0
for (const loc of Object.keys(GENERIC)) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.onboardingNudge = json.onboardingNudge || {}
  json.onboardingNudge.generic = Object.assign({}, json.onboardingNudge.generic, GENERIC[loc])
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
  console.log(`✓ ${loc}: onboardingNudge.generic.*`)
}
console.log(`Done — ${changed} locale files updated.`)
