// scripts/add-ai-menu-prefill-i18n.js — AI menu prefill (onboarding copilot, Agent 89).
// Adds menu.aiCard.* (import photo/PDF → editable draft → confirm). FR vouvoiement,
// real Arabic (RTL). Idempotent; 2-space JSON. Run: node scripts/add-ai-menu-prefill-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

const ADD = {
  fr: {
    title: "Importer ma carte (photo ou PDF)",
    subtitle: "L’IA lit votre carte et vous propose une liste de plats. Vous relisez, corrigez et confirmez — rien n’est enregistré avant votre confirmation.",
    choose: "Choisir un fichier", extracting: "Analyse de la carte…",
    reviewTitle: "Plats proposés — relisez et corrigez", reviewHint: "Aucun plat n’est ajouté tant que vous n’avez pas confirmé.",
    colName: "Nom", colPrice: "Prix (€)", colDesc: "Description", remove: "Retirer",
    confirm: "Confirmer et ajouter à la carte", confirming: "Ajout…",
    empty: "Aucun plat détecté. Essayez une photo plus nette, ou ajoutez vos plats manuellement.",
    added: "{count} plat(s) ajouté(s) à votre carte.", partial: "{ok} ajouté(s), {failed} à vérifier (prix manquant ?).",
    errorFile: "Format non pris en charge. Utilisez une image (JPG, PNG, WEBP) ou un PDF.",
    errorTooLarge: "Fichier trop volumineux (8 Mo maximum).", errorQuota: "Limite IA atteinte. Réessayez plus tard.",
    errorGeneric: "L’analyse a échoué. Réessayez.", restart: "Importer une autre carte",
  },
  en: {
    title: "Import my menu (photo or PDF)",
    subtitle: "The AI reads your menu and suggests a dish list. You review, correct and confirm — nothing is saved before you confirm.",
    choose: "Choose a file", extracting: "Reading the menu…",
    reviewTitle: "Suggested dishes — review and correct", reviewHint: "No dish is added until you confirm.",
    colName: "Name", colPrice: "Price (€)", colDesc: "Description", remove: "Remove",
    confirm: "Confirm and add to the menu", confirming: "Adding…",
    empty: "No dish detected. Try a sharper photo, or add your dishes manually.",
    added: "{count} dish(es) added to your menu.", partial: "{ok} added, {failed} to check (missing price?).",
    errorFile: "Unsupported format. Use an image (JPG, PNG, WEBP) or a PDF.",
    errorTooLarge: "File too large (8 MB maximum).", errorQuota: "AI limit reached. Try again later.",
    errorGeneric: "Analysis failed. Please try again.", restart: "Import another menu",
  },
  es: {
    title: "Importar mi carta (foto o PDF)",
    subtitle: "La IA lee su carta y le propone una lista de platos. Usted revisa, corrige y confirma — no se guarda nada antes de su confirmación.",
    choose: "Elegir un archivo", extracting: "Leyendo la carta…",
    reviewTitle: "Platos propuestos — revise y corrija", reviewHint: "No se añade ningún plato hasta que usted confirme.",
    colName: "Nombre", colPrice: "Precio (€)", colDesc: "Descripción", remove: "Quitar",
    confirm: "Confirmar y añadir a la carta", confirming: "Añadiendo…",
    empty: "No se detectó ningún plato. Pruebe una foto más nítida o añada sus platos manualmente.",
    added: "{count} plato(s) añadido(s) a su carta.", partial: "{ok} añadido(s), {failed} por revisar (¿falta el precio?).",
    errorFile: "Formato no admitido. Use una imagen (JPG, PNG, WEBP) o un PDF.",
    errorTooLarge: "Archivo demasiado grande (8 MB máximo).", errorQuota: "Límite de IA alcanzado. Inténtelo más tarde.",
    errorGeneric: "El análisis ha fallado. Inténtelo de nuevo.", restart: "Importar otra carta",
  },
  it: {
    title: "Importare il mio menù (foto o PDF)",
    subtitle: "L’IA legge il suo menù e le propone un elenco di piatti. Lei rilegge, corregge e conferma — nulla viene salvato prima della conferma.",
    choose: "Scegliere un file", extracting: "Lettura del menù…",
    reviewTitle: "Piatti proposti — rilegga e corregga", reviewHint: "Nessun piatto viene aggiunto finché non conferma.",
    colName: "Nome", colPrice: "Prezzo (€)", colDesc: "Descrizione", remove: "Rimuovere",
    confirm: "Confermare e aggiungere al menù", confirming: "Aggiunta…",
    empty: "Nessun piatto rilevato. Provi una foto più nitida o aggiunga i piatti manualmente.",
    added: "{count} piatto/i aggiunto/i al suo menù.", partial: "{ok} aggiunto/i, {failed} da verificare (prezzo mancante?).",
    errorFile: "Formato non supportato. Usi un’immagine (JPG, PNG, WEBP) o un PDF.",
    errorTooLarge: "File troppo grande (8 MB massimo).", errorQuota: "Limite IA raggiunto. Riprovi più tardi.",
    errorGeneric: "Analisi non riuscita. Riprovi.", restart: "Importare un altro menù",
  },
  ar: {
    title: "استيراد قائمتي (صورة أو PDF)",
    subtitle: "يقرأ الذكاء الاصطناعي قائمتك ويقترح عليك لائحة أطباق. تراجِعها وتصحّحها وتؤكّدها — لا يُحفظ شيء قبل تأكيدك.",
    choose: "اختيار ملف", extracting: "جارٍ قراءة القائمة…",
    reviewTitle: "الأطباق المقترحة — راجِع وصحّح", reviewHint: "لا يُضاف أي طبق حتى تؤكّد.",
    colName: "الاسم", colPrice: "السعر (€)", colDesc: "الوصف", remove: "إزالة",
    confirm: "تأكيد وإضافة إلى القائمة", confirming: "جارٍ الإضافة…",
    empty: "لم يُكتشف أي طبق. جرّب صورة أوضح أو أضِف أطباقك يدويًا.",
    added: "تمت إضافة {count} طبق إلى قائمتك.", partial: "تمت إضافة {ok}، و{failed} بحاجة إلى مراجعة (سعر مفقود؟).",
    errorFile: "صيغة غير مدعومة. استخدم صورة (JPG أو PNG أو WEBP) أو PDF.",
    errorTooLarge: "الملف كبير جدًا (8 ميغابايت كحدّ أقصى).", errorQuota: "بلغت حدّ الذكاء الاصطناعي. حاول لاحقًا.",
    errorGeneric: "فشل التحليل. حاول مجدّدًا.", restart: "استيراد قائمة أخرى",
  },
}

let changed = 0
for (const loc of Object.keys(ADD)) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.menu = json.menu || {}
  json.menu.aiCard = Object.assign({}, json.menu.aiCard, ADD[loc])
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
  console.log(`✓ ${loc}: menu.aiCard.*`)
}
console.log(`Done — ${changed} locale files updated.`)
