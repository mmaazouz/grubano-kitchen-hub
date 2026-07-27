// scripts/seed-photo-ui-i18n.js
// /menu — photo UI: affichage + warnings + upload Manuel (Agent 13).
// Additive ONLY: Object.assign's the keys below into each locale, never
// removes anything. Source of truth = fr.json; all locales must stay complete
// (npm run check:i18n). Dedicated seed — NOT translate-messages.js.
//
// Adds (per locale) under menu.photo.*:
//   alt                → <img> alt fallback (with {name})
//   change             → button "Changer la photo"
//   pick               → button "Choisir une photo"
//   uploading          → state during upload
//   replaceHint        → caption next to the picker on edit
//   warningsTitle      → soft-warnings banner header
//   warningsDismiss    → close button aria
//   warningsItemAlt    → bullet hint when reason has no copy
//   err422             → moderation refusal (uses server `reason` when present)
//   err400             → bad request (type/size)
//   err503             → temporary upstream failure
//   err500             → generic server failure
//   errNetwork         → fetch failed
//
// Run:  node scripts/seed-photo-ui-i18n.js   then   npm run check:i18n

const fs = require('fs')
const path = require('path')

const T = {
  fr: {
    alt:               'Photo de {name}',
    change:            'Changer la photo',
    pick:              'Ajouter une photo',
    uploading:         'Envoi…',
    replaceHint:       'Remplacez la photo (JPG, PNG ou WebP — 8 Mo max)',
    warningsTitle:     'Conseils pour améliorer la photo',
    warningsDismiss:   'Fermer les conseils',
    warningsItemAlt:   'Conseil de l’IA',
    err422:            'Photo refusée. {reason}',
    err400:            'Photo invalide (format ou taille). Acceptés : JPG, PNG, WebP — 8 Mo max.',
    err503:            'Service photo temporairement indisponible. Réessayez dans un instant.',
    err500:            'Échec de l’envoi de la photo.',
    errNetwork:        'Impossible d’envoyer la photo — vérifiez votre connexion.',
  },
  en: {
    alt:               'Photo of {name}',
    change:            'Change photo',
    pick:              'Add a photo',
    uploading:         'Uploading…',
    replaceHint:       'Replace the photo (JPG, PNG or WebP — 8 MB max)',
    warningsTitle:     'Tips to improve the photo',
    warningsDismiss:   'Dismiss tips',
    warningsItemAlt:   'AI tip',
    err422:            'Photo refused. {reason}',
    err400:            'Invalid photo (format or size). Accepted: JPG, PNG, WebP — 8 MB max.',
    err503:            'Photo service temporarily unavailable. Please retry shortly.',
    err500:            'Photo upload failed.',
    errNetwork:        'Could not upload the photo — check your connection.',
  },
  es: {
    alt:               'Foto de {name}',
    change:            'Cambiar foto',
    pick:              'Añadir foto',
    uploading:         'Enviando…',
    replaceHint:       'Reemplazar la foto (JPG, PNG o WebP — 8 MB máx)',
    warningsTitle:     'Consejos para mejorar la foto',
    warningsDismiss:   'Cerrar consejos',
    warningsItemAlt:   'Consejo de la IA',
    err422:            'Foto rechazada. {reason}',
    err400:            'Foto inválida (formato o tamaño). Aceptados: JPG, PNG, WebP — 8 MB máx.',
    err503:            'Servicio de fotos no disponible. Inténtalo de nuevo en un momento.',
    err500:            'Error al subir la foto.',
    errNetwork:        'No se pudo enviar la foto — comprueba tu conexión.',
  },
  it: {
    alt:               'Foto di {name}',
    change:            'Cambia foto',
    pick:              'Aggiungi una foto',
    uploading:         'Caricamento…',
    replaceHint:       'Sostituisci la foto (JPG, PNG o WebP — 8 MB max)',
    warningsTitle:     'Consigli per migliorare la foto',
    warningsDismiss:   'Chiudi i consigli',
    warningsItemAlt:   'Consiglio dell’IA',
    err422:            'Foto rifiutata. {reason}',
    err400:            'Foto non valida (formato o dimensione). Accettati: JPG, PNG, WebP — 8 MB max.',
    err503:            'Servizio foto temporaneamente non disponibile. Riprova tra poco.',
    err500:            'Caricamento foto fallito.',
    errNetwork:        'Impossibile inviare la foto — verifica la connessione.',
  },
  ar: {
    alt:               'صورة {name}',
    change:            'تغيير الصورة',
    pick:              'إضافة صورة',
    uploading:         'جارٍ الإرسال…',
    replaceHint:       'استبدل الصورة (JPG، PNG أو WebP — 8 ميغابايت كحد أقصى)',
    warningsTitle:     'نصائح لتحسين الصورة',
    warningsDismiss:   'إغلاق النصائح',
    warningsItemAlt:   'نصيحة الذكاء الاصطناعي',
    err422:            'تم رفض الصورة. {reason}',
    err400:            'صورة غير صالحة (تنسيق أو حجم). المقبول: JPG، PNG، WebP — 8 ميغابايت كحد أقصى.',
    err503:            'خدمة الصور غير متاحة مؤقتًا. حاول مجددًا بعد قليل.',
    err500:            'فشل إرسال الصورة.',
    errNetwork:        'تعذر إرسال الصورة — تحقق من اتصالك.',
  },
}

for (const [loc, kv] of Object.entries(T)) {
  const p = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(p, 'utf8'))

  if (!m.menu) m.menu = {}
  if (!m.menu.photo) m.menu.photo = {}
  Object.assign(m.menu.photo, kv)

  fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`${loc}: +menu.photo.* (${Object.keys(kv).length} keys)`)
}
