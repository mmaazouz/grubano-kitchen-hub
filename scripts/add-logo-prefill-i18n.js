// scripts/add-logo-prefill-i18n.js — AI logo prefill from a website (onboarding copilot
// brique 3, Agent 92). Adds restaurant.logoImport.* (paste URL → preview detected logo →
// confirm → upload to our storage). FR vouvoiement, real Arabic (RTL). Idempotent; 2-space JSON.
// Run: node scripts/add-logo-prefill-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

const ADD = {
  fr: {
    title: "Récupérer mon logo depuis mon site",
    subtitle: "Collez l’adresse de votre site : nous détectons votre logo et vous le montrons en aperçu. Rien n’est appliqué avant votre confirmation. L’image est téléchargée chez nous (pas de lien externe).",
    urlLabel: "Adresse de votre site", detect: "Détecter mon logo", detecting: "Recherche du logo…",
    reviewTitle: "Logo détecté — validez l’aperçu", reviewHint: "Le logo n’est enregistré qu’après votre confirmation.",
    previewAlt: "Aperçu du logo détecté",
    confirm: "Confirmer ce logo", applying: "Enregistrement…", restart: "Recommencer", saved: "Logo enregistré.",
    notFound: "Aucun logo détecté sur ce site. Vous pouvez en ajouter un manuellement.",
    errorUrl: "Adresse inaccessible. Vérifiez l’URL de votre site public.",
    errorTimeout: "Le site n’a pas répondu à temps. Réessayez.",
    errorTooLarge: "Image trop volumineuse.", errorGeneric: "L’opération a échoué. Réessayez.",
  },
  en: {
    title: "Fetch my logo from my website",
    subtitle: "Paste your website address: we detect your logo and show you a preview. Nothing is applied before you confirm. The image is downloaded to our storage (no external link).",
    urlLabel: "Your website address", detect: "Detect my logo", detecting: "Looking for the logo…",
    reviewTitle: "Detected logo — review the preview", reviewHint: "The logo is saved only after you confirm.",
    previewAlt: "Preview of the detected logo",
    confirm: "Confirm this logo", applying: "Saving…", restart: "Start over", saved: "Logo saved.",
    notFound: "No logo detected on this site. You can add one manually.",
    errorUrl: "Address unreachable. Check your public website URL.",
    errorTimeout: "The site did not respond in time. Try again.",
    errorTooLarge: "Image too large.", errorGeneric: "The operation failed. Please try again.",
  },
  es: {
    title: "Obtener mi logo desde mi sitio web",
    subtitle: "Pegue la dirección de su sitio: detectamos su logo y se lo mostramos en vista previa. No se aplica nada antes de su confirmación. La imagen se descarga en nuestro almacenamiento (sin enlace externo).",
    urlLabel: "Dirección de su sitio", detect: "Detectar mi logo", detecting: "Buscando el logo…",
    reviewTitle: "Logo detectado — revise la vista previa", reviewHint: "El logo solo se guarda tras su confirmación.",
    previewAlt: "Vista previa del logo detectado",
    confirm: "Confirmar este logo", applying: "Guardando…", restart: "Empezar de nuevo", saved: "Logo guardado.",
    notFound: "No se detectó ningún logo en este sitio. Puede añadir uno manualmente.",
    errorUrl: "Dirección inaccesible. Compruebe la URL de su sitio público.",
    errorTimeout: "El sitio no respondió a tiempo. Inténtelo de nuevo.",
    errorTooLarge: "Imagen demasiado grande.", errorGeneric: "La operación ha fallado. Inténtelo de nuevo.",
  },
  it: {
    title: "Recuperare il mio logo dal mio sito",
    subtitle: "Incolli l’indirizzo del suo sito: rileviamo il suo logo e glielo mostriamo in anteprima. Nulla viene applicato prima della conferma. L’immagine viene scaricata sul nostro spazio (nessun link esterno).",
    urlLabel: "Indirizzo del suo sito", detect: "Rilevare il mio logo", detecting: "Ricerca del logo…",
    reviewTitle: "Logo rilevato — verifichi l’anteprima", reviewHint: "Il logo viene salvato solo dopo la conferma.",
    previewAlt: "Anteprima del logo rilevato",
    confirm: "Confermare questo logo", applying: "Salvataggio…", restart: "Ricominciare", saved: "Logo salvato.",
    notFound: "Nessun logo rilevato su questo sito. Può aggiungerne uno manualmente.",
    errorUrl: "Indirizzo non raggiungibile. Verifichi l’URL del suo sito pubblico.",
    errorTimeout: "Il sito non ha risposto in tempo. Riprovi.",
    errorTooLarge: "Immagine troppo grande.", errorGeneric: "Operazione non riuscita. Riprovi.",
  },
  ar: {
    title: "جلب شعاري من موقعي الإلكتروني",
    subtitle: "الصق عنوان موقعك: نكتشف شعارك ونعرضه لك كمعاينة. لا يُطبَّق شيء قبل تأكيدك. تُنزَّل الصورة على مساحتنا (دون رابط خارجي).",
    urlLabel: "عنوان موقعك", detect: "اكتشاف شعاري", detecting: "جارٍ البحث عن الشعار…",
    reviewTitle: "تم اكتشاف الشعار — راجِع المعاينة", reviewHint: "لا يُحفظ الشعار إلا بعد تأكيدك.",
    previewAlt: "معاينة الشعار المكتشف",
    confirm: "تأكيد هذا الشعار", applying: "جارٍ الحفظ…", restart: "إعادة البدء", saved: "تم حفظ الشعار.",
    notFound: "لم يُكتشف أي شعار على هذا الموقع. يمكنك إضافة واحد يدويًا.",
    errorUrl: "العنوان غير قابل للوصول. تحقّق من رابط موقعك العام.",
    errorTimeout: "لم يستجب الموقع في الوقت المناسب. حاول مجدّدًا.",
    errorTooLarge: "الصورة كبيرة جدًا.", errorGeneric: "فشلت العملية. حاول مجدّدًا.",
  },
}

let changed = 0
for (const loc of Object.keys(ADD)) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.restaurant = json.restaurant || {}
  json.restaurant.logoImport = Object.assign({}, json.restaurant.logoImport, ADD[loc])
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
  console.log(`✓ ${loc}: restaurant.logoImport.*`)
}
console.log(`Done — ${changed} locale files updated.`)
