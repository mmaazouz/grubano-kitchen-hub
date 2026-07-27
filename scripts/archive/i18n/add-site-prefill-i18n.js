// scripts/add-site-prefill-i18n.js — AI profile prefill from a website (onboarding
// copilot brique 2, Agent 91). Adds restaurant.siteImport.* (paste URL → editable
// non-legal draft → confirm). FR vouvoiement, real Arabic (RTL). Idempotent; 2-space JSON.
// Run: node scripts/add-site-prefill-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

const ADD = {
  fr: {
    title: "Pré-remplir depuis mon site web",
    subtitle: "Collez l’adresse de votre site : l’IA vous propose une présentation que vous relisez, corrigez et confirmez. Rien n’est enregistré avant votre confirmation. Vos informations légales (SIREN, raison sociale) ne sont jamais reprises du site.",
    urlLabel: "Adresse de votre site", import: "Analyser mon site", extracting: "Lecture de votre site…",
    reviewTitle: "Proposition — relisez et corrigez", reviewHint: "Aucune information n’est enregistrée tant que vous n’avez pas confirmé.",
    fieldName: "Nom affiché", fieldDescription: "Description", fieldCuisine: "Types de cuisine",
    fieldCuisineHint: "Séparez par des virgules (ex. italien, pizza)",
    confirm: "Confirmer et mettre à jour", confirming: "Mise à jour…", restart: "Recommencer", saved: "Profil mis à jour.",
    errorUrl: "Adresse inaccessible. Vérifiez l’URL de votre site public.",
    errorTimeout: "Le site n’a pas répondu à temps. Réessayez.",
    errorQuota: "Limite IA atteinte. Réessayez plus tard.",
    errorEmpty: "Aucun champ à enregistrer.", errorGeneric: "L’analyse a échoué. Réessayez.",
  },
  en: {
    title: "Prefill from my website",
    subtitle: "Paste your website address: the AI suggests a presentation you review, correct and confirm. Nothing is saved before you confirm. Your legal details (company number, legal name) are never taken from the site.",
    urlLabel: "Your website address", import: "Analyse my site", extracting: "Reading your site…",
    reviewTitle: "Suggestion — review and correct", reviewHint: "No information is saved until you confirm.",
    fieldName: "Display name", fieldDescription: "Description", fieldCuisine: "Cuisine types",
    fieldCuisineHint: "Separate with commas (e.g. italian, pizza)",
    confirm: "Confirm and update", confirming: "Updating…", restart: "Start over", saved: "Profile updated.",
    errorUrl: "Address unreachable. Check your public website URL.",
    errorTimeout: "The site did not respond in time. Try again.",
    errorQuota: "AI limit reached. Try again later.",
    errorEmpty: "No field to save.", errorGeneric: "Analysis failed. Please try again.",
  },
  es: {
    title: "Rellenar desde mi sitio web",
    subtitle: "Pegue la dirección de su sitio: la IA le propone una presentación que usted revisa, corrige y confirma. No se guarda nada antes de su confirmación. Sus datos legales (NIF, razón social) nunca se toman del sitio.",
    urlLabel: "Dirección de su sitio", import: "Analizar mi sitio", extracting: "Leyendo su sitio…",
    reviewTitle: "Propuesta — revise y corrija", reviewHint: "No se guarda ninguna información hasta que usted confirme.",
    fieldName: "Nombre mostrado", fieldDescription: "Descripción", fieldCuisine: "Tipos de cocina",
    fieldCuisineHint: "Separe con comas (p. ej. italiano, pizza)",
    confirm: "Confirmar y actualizar", confirming: "Actualizando…", restart: "Empezar de nuevo", saved: "Perfil actualizado.",
    errorUrl: "Dirección inaccesible. Compruebe la URL de su sitio público.",
    errorTimeout: "El sitio no respondió a tiempo. Inténtelo de nuevo.",
    errorQuota: "Límite de IA alcanzado. Inténtelo más tarde.",
    errorEmpty: "Ningún campo que guardar.", errorGeneric: "El análisis ha fallado. Inténtelo de nuevo.",
  },
  it: {
    title: "Precompilare dal mio sito web",
    subtitle: "Incolli l’indirizzo del suo sito: l’IA le propone una presentazione che lei rilegge, corregge e conferma. Nulla viene salvato prima della conferma. I suoi dati legali (partita IVA, ragione sociale) non vengono mai presi dal sito.",
    urlLabel: "Indirizzo del suo sito", import: "Analizzare il mio sito", extracting: "Lettura del suo sito…",
    reviewTitle: "Proposta — rilegga e corregga", reviewHint: "Nessuna informazione viene salvata finché non conferma.",
    fieldName: "Nome visualizzato", fieldDescription: "Descrizione", fieldCuisine: "Tipi di cucina",
    fieldCuisineHint: "Separi con virgole (es. italiano, pizza)",
    confirm: "Confermare e aggiornare", confirming: "Aggiornamento…", restart: "Ricominciare", saved: "Profilo aggiornato.",
    errorUrl: "Indirizzo non raggiungibile. Verifichi l’URL del suo sito pubblico.",
    errorTimeout: "Il sito non ha risposto in tempo. Riprovi.",
    errorQuota: "Limite IA raggiunto. Riprovi più tardi.",
    errorEmpty: "Nessun campo da salvare.", errorGeneric: "Analisi non riuscita. Riprovi.",
  },
  ar: {
    title: "التعبئة المسبقة من موقعي الإلكتروني",
    subtitle: "الصق عنوان موقعك: يقترح الذكاء الاصطناعي تقديمًا تراجِعه وتصحّحه وتؤكّده. لا يُحفظ شيء قبل تأكيدك. لا تُؤخذ بياناتك القانونية (السجل التجاري، الاسم القانوني) من الموقع أبدًا.",
    urlLabel: "عنوان موقعك", import: "تحليل موقعي", extracting: "جارٍ قراءة موقعك…",
    reviewTitle: "اقتراح — راجِع وصحّح", reviewHint: "لا تُحفظ أي معلومة حتى تؤكّد.",
    fieldName: "الاسم المعروض", fieldDescription: "الوصف", fieldCuisine: "أنواع المطبخ",
    fieldCuisineHint: "افصل بفواصل (مثل: إيطالي، بيتزا)",
    confirm: "تأكيد وتحديث", confirming: "جارٍ التحديث…", restart: "إعادة البدء", saved: "تم تحديث الملف.",
    errorUrl: "العنوان غير قابل للوصول. تحقّق من رابط موقعك العام.",
    errorTimeout: "لم يستجب الموقع في الوقت المناسب. حاول مجدّدًا.",
    errorQuota: "بلغت حدّ الذكاء الاصطناعي. حاول لاحقًا.",
    errorEmpty: "لا يوجد حقل للحفظ.", errorGeneric: "فشل التحليل. حاول مجدّدًا.",
  },
}

let changed = 0
for (const loc of Object.keys(ADD)) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.restaurant = json.restaurant || {}
  json.restaurant.siteImport = Object.assign({}, json.restaurant.siteImport, ADD[loc])
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
  console.log(`✓ ${loc}: restaurant.siteImport.*`)
}
console.log(`Done — ${changed} locale files updated.`)
