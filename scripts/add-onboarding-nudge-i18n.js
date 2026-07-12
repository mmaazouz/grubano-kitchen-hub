// scripts/add-onboarding-nudge-i18n.js — Anti-abandon nudge emails (Agent 95).
// Adds onboardingNudge.* (nudge email subject/body + unsubscribe confirmation). FR
// vouvoiement, real Arabic (RTL). ICU plural for {steps}. Idempotent; 2-space JSON.
// Run: node scripts/add-onboarding-nudge-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

const ADD = {
  fr: {
    subject: "Il vous reste {steps, plural, one {# étape} other {# étapes}} pour activer votre restaurant",
    title: "Votre restaurant est presque prêt",
    greeting: "Bonjour {name},",
    body: "Il vous reste {steps, plural, one {# étape} other {# étapes}} pour finaliser votre installation et passer en ligne sur Grubano. Reprenez là où vous vous êtes arrêté.",
    resumeCta: "Reprendre mon installation",
    unsubPrefix: "Vous ne souhaitez plus recevoir ces rappels ?",
    unsubLink: "Se désabonner",
    unsubDoneTitle: "Désabonnement confirmé",
    unsubDoneBody: "Vous ne recevrez plus de rappels d’installation. Vous pouvez fermer cette page.",
  },
  en: {
    subject: "You have {steps, plural, one {# step} other {# steps}} left to activate your restaurant",
    title: "Your restaurant is almost ready",
    greeting: "Hello {name},",
    body: "You have {steps, plural, one {# step} other {# steps}} left to finish your setup and go live on Grubano. Pick up where you left off.",
    resumeCta: "Resume my setup",
    unsubPrefix: "No longer want these reminders?",
    unsubLink: "Unsubscribe",
    unsubDoneTitle: "Unsubscribe confirmed",
    unsubDoneBody: "You will no longer receive setup reminders. You can close this page.",
  },
  es: {
    subject: "Le quedan {steps, plural, one {# paso} other {# pasos}} para activar su restaurante",
    title: "Su restaurante ya casi está listo",
    greeting: "Hola {name}:",
    body: "Le quedan {steps, plural, one {# paso} other {# pasos}} para completar la configuración y publicarse en Grubano. Continúe donde lo dejó.",
    resumeCta: "Reanudar mi configuración",
    unsubPrefix: "¿Ya no desea recibir estos recordatorios?",
    unsubLink: "Darse de baja",
    unsubDoneTitle: "Baja confirmada",
    unsubDoneBody: "Ya no recibirá recordatorios de configuración. Puede cerrar esta página.",
  },
  it: {
    subject: "Le restano {steps, plural, one {# passaggio} other {# passaggi}} per attivare il suo ristorante",
    title: "Il suo ristorante è quasi pronto",
    greeting: "Buongiorno {name},",
    body: "Le restano {steps, plural, one {# passaggio} other {# passaggi}} per completare la configurazione e andare online su Grubano. Riprenda da dove si era fermato.",
    resumeCta: "Riprendere la configurazione",
    unsubPrefix: "Non desidera più ricevere questi promemoria?",
    unsubLink: "Annullare l’iscrizione",
    unsubDoneTitle: "Disiscrizione confermata",
    unsubDoneBody: "Non riceverà più promemoria di configurazione. Può chiudere questa pagina.",
  },
  ar: {
    subject: "تبقّى لك {steps, plural, one {خطوة واحدة} other {# خطوات}} لتفعيل مطعمك",
    title: "مطعمك شبه جاهز",
    greeting: "مرحبًا {name}،",
    body: "تبقّى لك {steps, plural, one {خطوة واحدة} other {# خطوات}} لإكمال الإعداد والظهور على Grubano. تابِع من حيث توقّفت.",
    resumeCta: "متابعة الإعداد",
    unsubPrefix: "لم تعد ترغب في تلقّي هذه التذكيرات؟",
    unsubLink: "إلغاء الاشتراك",
    unsubDoneTitle: "تم تأكيد إلغاء الاشتراك",
    unsubDoneBody: "لن تتلقّى بعد الآن تذكيرات الإعداد. يمكنك إغلاق هذه الصفحة.",
  },
}

let changed = 0
for (const loc of Object.keys(ADD)) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.onboardingNudge = Object.assign({}, json.onboardingNudge, ADD[loc])
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
  console.log(`✓ ${loc}: onboardingNudge.*`)
}
console.log(`Done — ${changed} locale files updated.`)
