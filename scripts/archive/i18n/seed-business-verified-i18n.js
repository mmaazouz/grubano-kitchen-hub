// One-off i18n seeder for business.metadata.* (page title) + business.verified.*
// (friendly confirmation/error states). Safe to re-run.

const fs = require('fs')
const path = require('path')

const TRANSLATIONS = {
  fr: {
    metadata: {
      title: 'Grubano Partenaires',
      description: 'Espace partenaire de la plateforme Grubano.',
    },
    verified: {
      successTitle: 'Email vérifié ✅',
      successBody:
        'Ton compte partenaire est en cours de validation par notre équipe avant la mise en ligne. Tu recevras un email dès qu’il sera activé.',
      successCta: 'Aller à la connexion',
      expiredTitle: 'Lien expiré',
      expiredBody:
        'Ce lien de vérification a expiré. Reconnecte-toi pour demander un nouvel email.',
      usedTitle: 'Lien déjà utilisé',
      usedBody:
        'Ce lien a déjà été utilisé. Ton email est sans doute déjà vérifié — connecte-toi pour le confirmer.',
      invalidTitle: 'Lien invalide',
      invalidBody:
        'Ce lien n’est pas reconnu. Vérifie que tu as bien cliqué le dernier email reçu.',
      errorTitle: 'Une erreur est survenue',
      errorBody:
        'Impossible de vérifier ton email pour le moment. Réessaie dans quelques instants.',
      errorCta: 'Revenir à la connexion',
      helpHint:
        'Si le problème persiste, contacte le support à contact@grubano.com.',
    },
  },
  en: {
    metadata: {
      title: 'Grubano Partners',
      description: 'Partner area of the Grubano platform.',
    },
    verified: {
      successTitle: 'Email verified ✅',
      successBody:
        'Your partner account is being reviewed by our team before going live. We’ll email you as soon as it is activated.',
      successCta: 'Go to sign-in',
      expiredTitle: 'Link expired',
      expiredBody:
        'This verification link has expired. Sign in again to request a new email.',
      usedTitle: 'Link already used',
      usedBody:
        'This link has already been used. Your email is probably verified — sign in to confirm.',
      invalidTitle: 'Invalid link',
      invalidBody:
        'This link is not recognised. Make sure you clicked the latest email you received.',
      errorTitle: 'Something went wrong',
      errorBody:
        'We couldn’t verify your email right now. Please try again in a moment.',
      errorCta: 'Back to sign-in',
      helpHint:
        'If the problem persists, contact support at contact@grubano.com.',
    },
  },
  es: {
    metadata: {
      title: 'Grubano Socios',
      description: 'Espacio para socios de la plataforma Grubano.',
    },
    verified: {
      successTitle: 'Email verificado ✅',
      successBody:
        'Tu cuenta de socio está siendo revisada por nuestro equipo antes de activarse. Te avisaremos por email en cuanto esté lista.',
      successCta: 'Ir al inicio de sesión',
      expiredTitle: 'Enlace caducado',
      expiredBody:
        'Este enlace de verificación ha caducado. Vuelve a iniciar sesión para solicitar un nuevo email.',
      usedTitle: 'Enlace ya utilizado',
      usedBody:
        'Este enlace ya se ha utilizado. Tu email probablemente está verificado — inicia sesión para comprobarlo.',
      invalidTitle: 'Enlace no válido',
      invalidBody:
        'No reconocemos este enlace. Asegúrate de haber pulsado el último email recibido.',
      errorTitle: 'Algo ha fallado',
      errorBody:
        'No hemos podido verificar tu email en este momento. Inténtalo de nuevo en unos instantes.',
      errorCta: 'Volver al inicio de sesión',
      helpHint:
        'Si el problema persiste, contacta con soporte en contact@grubano.com.',
    },
  },
  it: {
    metadata: {
      title: 'Grubano Partner',
      description: 'Area partner della piattaforma Grubano.',
    },
    verified: {
      successTitle: 'Email verificata ✅',
      successBody:
        'Il tuo account partner è in fase di revisione da parte del nostro team prima dell’attivazione. Ti scriveremo non appena sarà attivo.',
      successCta: 'Vai all’accesso',
      expiredTitle: 'Link scaduto',
      expiredBody:
        'Questo link di verifica è scaduto. Accedi di nuovo per richiedere un nuovo email.',
      usedTitle: 'Link già utilizzato',
      usedBody:
        'Questo link è già stato utilizzato. La tua email è probabilmente già verificata — accedi per confermarlo.',
      invalidTitle: 'Link non valido',
      invalidBody:
        'Non riconosciamo questo link. Assicurati di aver cliccato l’ultimo email ricevuto.',
      errorTitle: 'Qualcosa è andato storto',
      errorBody:
        'Non siamo riusciti a verificare la tua email in questo momento. Riprova tra qualche istante.',
      errorCta: 'Torna all’accesso',
      helpHint:
        'Se il problema persiste, contatta il supporto a contact@grubano.com.',
    },
  },
  ar: {
    metadata: {
      title: 'Grubano للشركاء',
      description: 'فضاء الشركاء على منصة Grubano.',
    },
    verified: {
      successTitle: 'تم التحقق من البريد ✅',
      successBody:
        'حسابك كشريك قيد المراجعة من قبل فريقنا قبل تفعيله. سنُعلمك عبر البريد فور تنشيطه.',
      successCta: 'الذهاب إلى تسجيل الدخول',
      expiredTitle: 'انتهت صلاحية الرابط',
      expiredBody:
        'انتهت صلاحية رابط التحقق هذا. سجّل الدخول من جديد لطلب رابط جديد.',
      usedTitle: 'تم استخدام الرابط مسبقاً',
      usedBody:
        'تم استخدام هذا الرابط من قبل. على الأرجح أن بريدك مُحقَّق بالفعل — سجّل الدخول للتأكد.',
      invalidTitle: 'رابط غير صالح',
      invalidBody:
        'لا يمكننا التعرف على هذا الرابط. تأكد من أنك ضغطت على آخر بريد استلمته.',
      errorTitle: 'حدث خطأ',
      errorBody:
        'لم نتمكن من التحقق من بريدك في الوقت الحالي. حاول مجدداً بعد قليل.',
      errorCta: 'العودة إلى تسجيل الدخول',
      helpHint:
        'إذا استمرت المشكلة، تواصل مع الدعم على contact@grubano.com.',
    },
  },
}

for (const [loc, sections] of Object.entries(TRANSLATIONS)) {
  const p = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(p, 'utf8'))
  if (!m.business) m.business = {}
  if (!m.business.metadata) m.business.metadata = {}
  if (!m.business.verified) m.business.verified = {}
  Object.assign(m.business.metadata, sections.metadata)
  Object.assign(m.business.verified, sections.verified)
  fs.writeFileSync(p, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(
    `${loc}: business.metadata=${Object.keys(m.business.metadata).length}, business.verified=${Object.keys(m.business.verified).length}`,
  )
}
