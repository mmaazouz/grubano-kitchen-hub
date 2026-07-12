// Seed i18n — EMAILS v2 / FIX 3 : reset mot de passe (Agent 13).
// Namespace auth.reset.* (page /eat/reset-password + panneaux « mot de passe
// oublié » des 2 espaces).
//
// Usage: node scripts/seed-emails-v2-i18n.js   puis   npm run check:i18n

const fs = require('fs')
const path = require('path')

const KEYS = {
  fr: {
    forgotTitle:    'Mot de passe oublié',
    forgotBody:     'Saisissez votre email — si un compte existe, vous recevrez un lien de réinitialisation (valable 1 h).',
    forgotEmailPh:  'votre@email.com',
    forgotSend:     'Envoyer le lien',
    forgotSending:  'Envoi…',
    forgotSent:     'Si un compte existe pour cet email, le lien de réinitialisation vient d’être envoyé. Pensez au dossier spam.',
    forgotClose:    'Fermer',
    resetTitle:     'Nouveau mot de passe',
    resetBody:      'Choisissez votre nouveau mot de passe (8 caractères minimum).',
    resetPwLabel:   'Nouveau mot de passe',
    resetPw2Label:  'Confirmez le mot de passe',
    resetSubmit:    'Changer mon mot de passe',
    resetSubmitting:'Changement…',
    resetMismatch:  'Les deux mots de passe ne correspondent pas.',
    resetTooShort:  '8 caractères minimum.',
    resetInvalid:   'Lien invalide ou expiré — refaites une demande depuis la page de connexion.',
    resetErrGeneric:'Impossible de changer le mot de passe — réessayez.',
    resetDoneTitle: 'Mot de passe changé ✓',
    resetDoneBody:  'Vous pouvez maintenant vous connecter avec votre nouveau mot de passe. Un email de confirmation vous a été envoyé.',
    resetGoLogin:   'Se connecter',
  },
  en: {
    forgotTitle:    'Forgot password',
    forgotBody:     'Enter your email — if an account exists, you will receive a reset link (valid for 1 h).',
    forgotEmailPh:  'your@email.com',
    forgotSend:     'Send the link',
    forgotSending:  'Sending…',
    forgotSent:     'If an account exists for this email, the reset link was just sent. Check your spam folder too.',
    forgotClose:    'Close',
    resetTitle:     'New password',
    resetBody:      'Choose your new password (8 characters minimum).',
    resetPwLabel:   'New password',
    resetPw2Label:  'Confirm the password',
    resetSubmit:    'Change my password',
    resetSubmitting:'Changing…',
    resetMismatch:  'The two passwords do not match.',
    resetTooShort:  '8 characters minimum.',
    resetInvalid:   'Invalid or expired link — request a new one from the sign-in page.',
    resetErrGeneric:'Could not change the password — please retry.',
    resetDoneTitle: 'Password changed ✓',
    resetDoneBody:  'You can now sign in with your new password. A confirmation email is on its way.',
    resetGoLogin:   'Sign in',
  },
  es: {
    forgotTitle:    'Contraseña olvidada',
    forgotBody:     'Introduce tu email — si existe una cuenta, recibirás un enlace de restablecimiento (válido 1 h).',
    forgotEmailPh:  'tu@email.com',
    forgotSend:     'Enviar el enlace',
    forgotSending:  'Enviando…',
    forgotSent:     'Si existe una cuenta para este email, el enlace acaba de enviarse. Revisa también el spam.',
    forgotClose:    'Cerrar',
    resetTitle:     'Nueva contraseña',
    resetBody:      'Elige tu nueva contraseña (mínimo 8 caracteres).',
    resetPwLabel:   'Nueva contraseña',
    resetPw2Label:  'Confirma la contraseña',
    resetSubmit:    'Cambiar mi contraseña',
    resetSubmitting:'Cambiando…',
    resetMismatch:  'Las dos contraseñas no coinciden.',
    resetTooShort:  'Mínimo 8 caracteres.',
    resetInvalid:   'Enlace no válido o caducado — solicita uno nuevo desde la página de inicio de sesión.',
    resetErrGeneric:'No se pudo cambiar la contraseña — reinténtalo.',
    resetDoneTitle: 'Contraseña cambiada ✓',
    resetDoneBody:  'Ya puedes iniciar sesión con tu nueva contraseña. Te hemos enviado un email de confirmación.',
    resetGoLogin:   'Iniciar sesión',
  },
  it: {
    forgotTitle:    'Password dimenticata',
    forgotBody:     'Inserisci la tua email — se esiste un account, riceverai un link di reimpostazione (valido 1 h).',
    forgotEmailPh:  'tua@email.com',
    forgotSend:     'Invia il link',
    forgotSending:  'Invio…',
    forgotSent:     'Se esiste un account per questa email, il link è appena stato inviato. Controlla anche lo spam.',
    forgotClose:    'Chiudi',
    resetTitle:     'Nuova password',
    resetBody:      'Scegli la tua nuova password (minimo 8 caratteri).',
    resetPwLabel:   'Nuova password',
    resetPw2Label:  'Conferma la password',
    resetSubmit:    'Cambia la mia password',
    resetSubmitting:'Modifica…',
    resetMismatch:  'Le due password non coincidono.',
    resetTooShort:  'Minimo 8 caratteri.',
    resetInvalid:   'Link non valido o scaduto — richiedine uno nuovo dalla pagina di accesso.',
    resetErrGeneric:'Impossibile cambiare la password — riprova.',
    resetDoneTitle: 'Password cambiata ✓',
    resetDoneBody:  'Ora puoi accedere con la tua nuova password. Ti abbiamo inviato un’email di conferma.',
    resetGoLogin:   'Accedi',
  },
  ar: {
    forgotTitle:    'نسيت كلمة المرور',
    forgotBody:     'أدخل بريدك الإلكتروني — إذا كان هناك حساب، ستتلقى رابط إعادة التعيين (صالح لمدة ساعة).',
    forgotEmailPh:  'you@email.com',
    forgotSend:     'إرسال الرابط',
    forgotSending:  'جارٍ الإرسال…',
    forgotSent:     'إذا كان هناك حساب بهذا البريد، فقد أُرسل رابط إعادة التعيين للتو. تحقق أيضًا من مجلد البريد العشوائي.',
    forgotClose:    'إغلاق',
    resetTitle:     'كلمة مرور جديدة',
    resetBody:      'اختر كلمة مرورك الجديدة (8 أحرف على الأقل).',
    resetPwLabel:   'كلمة المرور الجديدة',
    resetPw2Label:  'تأكيد كلمة المرور',
    resetSubmit:    'تغيير كلمة المرور',
    resetSubmitting:'جارٍ التغيير…',
    resetMismatch:  'كلمتا المرور غير متطابقتين.',
    resetTooShort:  '8 أحرف على الأقل.',
    resetInvalid:   'رابط غير صالح أو منتهي — اطلب رابطًا جديدًا من صفحة تسجيل الدخول.',
    resetErrGeneric:'تعذّر تغيير كلمة المرور — أعد المحاولة.',
    resetDoneTitle: 'تم تغيير كلمة المرور ✓',
    resetDoneBody:  'يمكنك الآن تسجيل الدخول بكلمة مرورك الجديدة. أرسلنا لك بريدًا للتأكيد.',
    resetGoLogin:   'تسجيل الدخول',
  },
}

for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!m.auth) m.auth = {}
  if (!m.auth.reset) m.auth.reset = {}
  Object.assign(m.auth.reset, KEYS[loc])
  fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`[seed-emails-v2-i18n] ${loc}.json OK`)
}
console.log('[seed-emails-v2-i18n] Done — run: npm run check:i18n')
