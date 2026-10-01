// Seeds the 4A establishment-enrichment keys under business.onboarding.*

const fs = require('fs')
const path = require('path')

const T = {
  fr: {
    restoCuisineHint: 'C’est la catégorie sous laquelle les clients te trouveront sur Grubano.',
    logoLabel: 'Logo (optionnel)',
    logoPlaceholder: 'https://… lien vers ton logo',
    coverLabel: 'Photo de couverture (optionnel)',
    coverPlaceholder: 'https://… lien vers ta bannière',
    imageHint: 'Colle un lien d’image. Si vide, un visuel par défaut selon ta cuisine est utilisé.',
    errInvalidUrl: 'Lien d’image invalide (doit commencer par http).',
  },
  en: {
    restoCuisineHint: 'This is the category customers will find you under on Grubano.',
    logoLabel: 'Logo (optional)',
    logoPlaceholder: 'https://… link to your logo',
    coverLabel: 'Cover photo (optional)',
    coverPlaceholder: 'https://… link to your banner',
    imageHint: 'Paste an image link. If empty, a default visual based on your cuisine is used.',
    errInvalidUrl: 'Invalid image link (must start with http).',
  },
  es: {
    restoCuisineHint: 'Es la categoría con la que los clientes te encontrarán en Grubano.',
    logoLabel: 'Logo (opcional)',
    logoPlaceholder: 'https://… enlace a tu logo',
    coverLabel: 'Foto de portada (opcional)',
    coverPlaceholder: 'https://… enlace a tu banner',
    imageHint: 'Pega un enlace de imagen. Si está vacío, se usa un visual por defecto según tu cocina.',
    errInvalidUrl: 'Enlace de imagen no válido (debe empezar por http).',
  },
  it: {
    restoCuisineHint: 'È la categoria con cui i clienti ti troveranno su Grubano.',
    logoLabel: 'Logo (opzionale)',
    logoPlaceholder: 'https://… link al tuo logo',
    coverLabel: 'Foto di copertina (opzionale)',
    coverPlaceholder: 'https://… link al tuo banner',
    imageHint: 'Incolla un link immagine. Se vuoto, viene usato un visual predefinito in base alla cucina.',
    errInvalidUrl: 'Link immagine non valido (deve iniziare con http).',
  },
  ar: {
    restoCuisineHint: 'هذه هي الفئة التي سيجدك بها العملاء على Grubano.',
    logoLabel: 'الشعار (اختياري)',
    logoPlaceholder: 'https://… رابط شعارك',
    coverLabel: 'صورة الغلاف (اختياري)',
    coverPlaceholder: 'https://… رابط لافتتك',
    imageHint: 'الصق رابط صورة. إذا تُرك فارغاً، يُستخدم تصميم افتراضي حسب نوع مطبخك.',
    errInvalidUrl: 'رابط الصورة غير صالح (يجب أن يبدأ بـ http).',
  },
}

for (const [loc, kv] of Object.entries(T)) {
  const p = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(p, 'utf8'))
  if (!m.business) m.business = {}
  if (!m.business.onboarding) m.business.onboarding = {}
  Object.assign(m.business.onboarding, kv)
  fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`${loc}: business.onboarding = ${Object.keys(m.business.onboarding).length} keys`)
}
