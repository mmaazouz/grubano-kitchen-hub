/* eslint-disable */
// ── P5c — franchise "Profil & paramètres" i18n (Agent 23) ─────────────────────
// Adds franchise.settings.* (editable account contact/display fields + chrome +
// locked-field labels) + franchise.nav.settings (sidebar link). The franchise has
// no dedicated profile model → the editable surface is the Operator ACCOUNT's
// name/phone/city; email + account status are shown read-only. x5 locales, parity,
// idempotent. FR vouvoiement; es/it informal (P3); ar RTL.
// Run: node scripts/add-franchise-settings-i18n.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

// franchise.settings.* — [fr, en, es, it, ar]
const S = {
  navLink:    ['Profil & paramètres', 'Profile & settings', 'Perfil y ajustes', 'Profilo e impostazioni', 'الملف والإعدادات'],
  title:      ['Profil & paramètres', 'Profile & settings', 'Perfil y ajustes', 'Profilo e impostazioni', 'الملف والإعدادات'],
  subtitle:   ['Mettez à jour vos coordonnées.', 'Update your contact details.', 'Actualiza tus datos de contacto.', 'Aggiorna i tuoi recapiti.', 'حدّث بيانات الاتصال الخاصة بك.'],
  fieldName:  ['Nom', 'Name', 'Nombre', 'Nome', 'الاسم'],
  fieldPhone: ['Téléphone', 'Phone', 'Teléfono', 'Telefono', 'الهاتف'],
  fieldCity:  ['Ville', 'City', 'Ciudad', 'Città', 'المدينة'],
  save:       ['Enregistrer', 'Save', 'Guardar', 'Salva', 'حفظ'],
  saving:     ['Enregistrement…', 'Saving…', 'Guardando…', 'Salvataggio…', 'جارٍ الحفظ…'],
  savedTitle: ['Profil mis à jour ✅', 'Profile updated ✅', 'Perfil actualizado ✅', 'Profilo aggiornato ✅', 'تم تحديث الملف ✅'],
  savedBody:  ['Vos informations ont été enregistrées.', 'Your information has been saved.', 'Tu información se ha guardado.', 'Le tue informazioni sono state salvate.', 'تم حفظ معلوماتك.'],
  errorGeneric: ['Une erreur est survenue. Réessayez.', 'Something went wrong. Please try again.', 'Se produjo un error. Inténtalo de nuevo.', 'Si è verificato un errore. Riprova.', 'حدث خطأ. حاول مرة أخرى.'],
  loadError:  ['Impossible de charger votre profil.', 'Could not load your profile.', 'No se pudo cargar tu perfil.', 'Impossibile caricare il tuo profilo.', 'تعذّر تحميل ملفك.'],
  lockedTitle:['Informations du compte', 'Account information', 'Información de la cuenta', 'Informazioni dell’account', 'معلومات الحساب'],
  lockedNote: [
    'Non modifiable — votre e-mail de connexion et le statut du compte sont gérés par Grubano. Les finances et les établissements se gèrent dans leurs onglets dédiés.',
    'Not editable — your login e-mail and account status are managed by Grubano. Finances and locations are managed in their own tabs.',
    'No editable: tu correo de acceso y el estado de la cuenta los gestiona Grubano. Las finanzas y los establecimientos se gestionan en sus pestañas.',
    'Non modificabile — la tua email di accesso e lo stato dell’account sono gestiti da Grubano. Finanze e sedi si gestiscono nelle rispettive schede.',
    'غير قابل للتعديل — يُدير Grubano بريد الدخول وحالة الحساب. تُدار الماليات والمنشآت في علاماتها المخصّصة.',
  ],
  lockedEmail:  ['Email de connexion', 'Login e-mail', 'Correo de acceso', 'Email di accesso', 'بريد الدخول'],
  lockedStatus: ['Statut du compte', 'Account status', 'Estado de la cuenta', 'Stato dell’account', 'حالة الحساب'],
  statusActive:    ['Actif', 'Active', 'Activo', 'Attivo', 'نشط'],
  statusPending:   ['En attente', 'Pending', 'Pendiente', 'In attesa', 'قيد الانتظار'],
  statusSuspended: ['Suspendu', 'Suspended', 'Suspendido', 'Sospeso', 'موقوف'],
}

LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.franchise = json.franchise || {}
  json.franchise.settings = json.franchise.settings || {}
  for (const k of Object.keys(S)) json.franchise.settings[k] = S[k][i]
  json.franchise.nav = json.franchise.nav || {}
  json.franchise.nav.settings = S.navLink[i]
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`  ✓ ${loc}.json — franchise.settings (+${Object.keys(S).length}) + franchise.nav.settings`)
})
console.log('[add-franchise-settings-i18n] done.')
