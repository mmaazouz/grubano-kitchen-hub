// scripts/add-onboarding-chat-i18n.js — Constrained AI onboarding help chat (Agent 97).
// Adds onboardingChat.* (the self-gating "how-to" chat widget chrome + a governance
// disclaimer). FR vouvoiement, real Arabic (RTL). Idempotent; 2-space JSON.
// Run: node scripts/add-onboarding-chat-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

const ADD = {
  fr: {
    title: "Une question ? L’assistant vous aide",
    subtitle: "Aide à l’inscription — comment faire, où cliquer.",
    greeting: "Posez votre question sur l’inscription : « comment ajouter un plat ? », « à quoi sert cette étape ? »…",
    placeholder: "Votre question sur l’inscription…",
    send: "Envoyer",
    thinking: "L’assistant réfléchit…",
    disclaimer: "Assistant d’aide à l’inscription. Il ne donne pas de conseil juridique, fiscal ni financier — pour cela, consultez un professionnel ou la page concernée.",
    errorGeneric: "Une erreur est survenue. Réessayez.",
    errorQuota: "Limite d’assistance atteinte, réessayez plus tard.",
    errorDisabled: "Assistant momentanément indisponible.",
    errorEmpty: "Je n’ai pas de réponse pour cela. Reformulez ou consultez la page concernée.",
  },
  en: {
    title: "A question? The assistant can help",
    subtitle: "Onboarding help — how to do it, where to click.",
    greeting: "Ask about your onboarding: “how do I add a dish?”, “what is this step for?”…",
    placeholder: "Your onboarding question…",
    send: "Send",
    thinking: "The assistant is thinking…",
    disclaimer: "Onboarding help assistant. It does not give legal, tax or financial advice — for that, consult a professional or the relevant page.",
    errorGeneric: "Something went wrong. Please try again.",
    errorQuota: "Assistance limit reached, please try again later.",
    errorDisabled: "Assistant temporarily unavailable.",
    errorEmpty: "I don’t have an answer for that. Try rephrasing or check the relevant page.",
  },
  es: {
    title: "¿Una pregunta? El asistente le ayuda",
    subtitle: "Ayuda con el alta — cómo hacerlo, dónde hacer clic.",
    greeting: "Pregunte sobre su alta: «¿cómo añado un plato?», «¿para qué sirve este paso?»…",
    placeholder: "Su pregunta sobre el alta…",
    send: "Enviar",
    thinking: "El asistente está pensando…",
    disclaimer: "Asistente de ayuda con el alta. No ofrece asesoramiento jurídico, fiscal ni financiero; para ello, consulte a un profesional o la página correspondiente.",
    errorGeneric: "Se ha producido un error. Inténtelo de nuevo.",
    errorQuota: "Límite de asistencia alcanzado, inténtelo más tarde.",
    errorDisabled: "Asistente no disponible por el momento.",
    errorEmpty: "No tengo una respuesta para eso. Reformule o consulte la página correspondiente.",
  },
  it: {
    title: "Una domanda? L’assistente la aiuta",
    subtitle: "Aiuto per l’iscrizione — come fare, dove cliccare.",
    greeting: "Chieda informazioni sull’iscrizione: «come aggiungo un piatto?», «a cosa serve questo passaggio?»…",
    placeholder: "La sua domanda sull’iscrizione…",
    send: "Invia",
    thinking: "L’assistente sta pensando…",
    disclaimer: "Assistente di aiuto all’iscrizione. Non fornisce consulenza legale, fiscale o finanziaria — per questo si rivolga a un professionista o alla pagina dedicata.",
    errorGeneric: "Si è verificato un errore. Riprovi.",
    errorQuota: "Limite di assistenza raggiunto, riprovi più tardi.",
    errorDisabled: "Assistente momentaneamente non disponibile.",
    errorEmpty: "Non ho una risposta per questo. Riformuli o consulti la pagina dedicata.",
  },
  ar: {
    title: "لديك سؤال؟ المساعد يساعدك",
    subtitle: "مساعدة في التسجيل — كيفية القيام بذلك وأين تنقر.",
    greeting: "اطرح سؤالك حول التسجيل: «كيف أضيف طبقًا؟»، «ما الغرض من هذه الخطوة؟»…",
    placeholder: "سؤالك حول التسجيل…",
    send: "إرسال",
    thinking: "المساعد يفكّر…",
    disclaimer: "مساعد للمساعدة في التسجيل. لا يقدّم استشارة قانونية أو ضريبية أو مالية — لذلك استشر مختصًّا أو راجع الصفحة المعنية.",
    errorGeneric: "حدث خطأ ما. حاول مرة أخرى.",
    errorQuota: "تم بلوغ حدّ المساعدة، حاول لاحقًا.",
    errorDisabled: "المساعد غير متوفّر مؤقّتًا.",
    errorEmpty: "ليس لديّ إجابة عن ذلك. أعد الصياغة أو راجع الصفحة المعنية.",
  },
}

let changed = 0
for (const loc of Object.keys(ADD)) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.onboardingChat = Object.assign({}, json.onboardingChat, ADD[loc])
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
  console.log(`✓ ${loc}: onboardingChat.*`)
}
console.log(`Done — ${changed} locale files updated.`)
