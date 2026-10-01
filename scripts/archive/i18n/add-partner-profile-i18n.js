/* eslint-disable */
// ── P5a — editable Profile/Settings i18n (Agent 21) ───────────────────────────
// Adds the chrome + locked-field labels for the supplier & logistics "Profil &
// paramètres" editors. The EDITABLE field labels + option labels (cat*, mission*,
// vehicle*, partnerType*, fieldCompanyName, fieldMinimumOrder, …) already exist and
// are REUSED — this only adds form-chrome (title/save/saved/error) + locked-field
// labels. x5 locales, parity, idempotent. FR vouvoiement; es/it informal; ar RTL.
// Run: node scripts/add-partner-profile-i18n.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

// supplier.* (flat namespace) — [fr, en, es, it, ar]
const SUP = {
  editProfileCta:    ['Modifier le profil', 'Edit profile', 'Editar perfil', 'Modifica profilo', 'تعديل الملف'],
  profileTitle:      ['Profil & paramètres', 'Profile & settings', 'Perfil y ajustes', 'Profilo e impostazioni', 'الملف والإعدادات'],
  profileSubtitle:   ['Mettez à jour vos informations professionnelles.', 'Update your business information.', 'Actualiza tu información profesional.', 'Aggiorna le tue informazioni professionali.', 'حدّث معلومات عملك.'],
  profileSavedTitle: ['Profil mis à jour ✅', 'Profile updated ✅', 'Perfil actualizado ✅', 'Profilo aggiornato ✅', 'تم تحديث الملف ✅'],
  profileSavedBody:  ['Vos informations ont été enregistrées.', 'Your information has been saved.', 'Tu información se ha guardado.', 'Le tue informazioni sono state salvate.', 'تم حفظ معلوماتك.'],
  profileLockedTitle:['Informations vérifiées', 'Verified information', 'Información verificada', 'Informazioni verificate', 'معلومات مُتحقَّق منها'],
  profileLockedNote: [
    'Non modifiable — ces données d’identité sont vérifiées au registre officiel.',
    'Not editable — this identity data is verified against the official registry.',
    'No editable: estos datos de identidad están verificados en el registro oficial.',
    'Non modificabile — questi dati identificativi sono verificati nel registro ufficiale.',
    'غير قابل للتعديل — هذه بيانات هوية مُتحقَّق منها في السجل الرسمي.',
  ],
  profileBack:       ['Retour au tableau de bord', 'Back to dashboard', 'Volver al panel', 'Torna alla dashboard', 'العودة إلى لوحة التحكم'],
  profileLoadError:  ['Impossible de charger votre profil.', 'Could not load your profile.', 'No se pudo cargar tu perfil.', 'Impossibile caricare il tuo profilo.', 'تعذّر تحميل ملفك.'],
  lockedSiren:       ['SIREN / SIRET', 'SIREN / SIRET', 'SIREN / SIRET', 'SIREN / SIRET', 'SIREN / SIRET'],
  lockedOfficialName:['Nom officiel', 'Official name', 'Nombre oficial', 'Nome ufficiale', 'الاسم الرسمي'],
  lockedVerification:['Vérification', 'Verification', 'Verificación', 'Verifica', 'التحقق'],
  lockedAccountStatus:['Statut du compte', 'Account status', 'Estado de la cuenta', 'Stato dell’account', 'حالة الحساب'],
  verifVerified:     ['Vérifié', 'Verified', 'Verificado', 'Verificato', 'مُتحقَّق منه'],
  verifReview:       ['En revue', 'Under review', 'En revisión', 'In revisione', 'قيد المراجعة'],
  verifRejected:     ['Non vérifié', 'Not verified', 'No verificado', 'Non verificato', 'غير مُتحقَّق منه'],
  verifNone:         ['—', '—', '—', '—', '—'],
  statusRejected:    ['Non retenu', 'Not accepted', 'No aceptado', 'Non accettato', 'غير مقبول'],
}

// business.logistics.dashboard.* — [fr, en, es, it, ar]
const LOG = {
  editProfileCta: ['Modifier le profil', 'Edit profile', 'Editar perfil', 'Modifica profilo', 'تعديل الملف'],
  editTitle:      ['Profil & paramètres', 'Profile & settings', 'Perfil y ajustes', 'Profilo e impostazioni', 'الملف والإعدادات'],
  editSubtitle:   ['Mettez à jour vos informations.', 'Update your information.', 'Actualiza tu información.', 'Aggiorna le tue informazioni.', 'حدّث معلوماتك.'],
  savedTitle:     ['Profil mis à jour ✅', 'Profile updated ✅', 'Perfil actualizado ✅', 'Profilo aggiornato ✅', 'تم تحديث الملف ✅'],
  savedBody:      ['Vos informations ont été enregistrées.', 'Your information has been saved.', 'Tu información se ha guardado.', 'Le tue informazioni sono state salvate.', 'تم حفظ معلوماتك.'],
  lockedTitle:    ['Informations vérifiées', 'Verified information', 'Información verificada', 'Informazioni verificate', 'معلومات مُتحقَّق منها'],
  lockedNote: [
    'Non modifiable — données d’identité vérifiées au registre officiel.',
    'Not editable — identity data verified against the official registry.',
    'No editable: datos de identidad verificados en el registro oficial.',
    'Non modificabile — dati identificativi verificati nel registro ufficiale.',
    'غير قابل للتعديل — بيانات هوية مُتحقَّق منها في السجل الرسمي.',
  ],
  back:           ['Retour au tableau de bord', 'Back to dashboard', 'Volver al panel', 'Torna alla dashboard', 'العودة إلى لوحة التحكم'],
  save:           ['Enregistrer', 'Save', 'Guardar', 'Salva', 'حفظ'],
  saving:         ['Enregistrement…', 'Saving…', 'Guardando…', 'Salvataggio…', 'جارٍ الحفظ…'],
  errorGeneric:   ['Une erreur est survenue. Réessayez.', 'Something went wrong. Please try again.', 'Se produjo un error. Inténtalo de nuevo.', 'Si è verificato un errore. Riprova.', 'حدث خطأ. حاول مرة أخرى.'],
  loadError:      ['Impossible de charger votre profil.', 'Could not load your profile.', 'No se pudo cargar tu perfil.', 'Impossibile caricare il tuo profilo.', 'تعذّر تحميل ملفك.'],
  labelOfficialName: ['Nom officiel', 'Official name', 'Nombre oficial', 'Nome ufficiale', 'الاسم الرسمي'],
  labelVerification: ['Vérification', 'Verification', 'Verificación', 'Verifica', 'التحقق'],
  labelAccountStatus:['Statut du compte', 'Account status', 'Estado de la cuenta', 'Stato dell’account', 'حالة الحساب'],
  verifVerified:  ['Vérifié', 'Verified', 'Verificado', 'Verificato', 'مُتحقَّق منه'],
  verifReview:    ['En revue', 'Under review', 'En revisión', 'In revisione', 'قيد المراجعة'],
  verifRejected:  ['Non vérifié', 'Not verified', 'No verificado', 'Non verificato', 'غير مُتحقَّق منه'],
  verifNone:      ['—', '—', '—', '—', '—'],
}

LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.supplier = json.supplier || {}
  for (const k of Object.keys(SUP)) json.supplier[k] = SUP[k][i]
  json.business = json.business || {}
  json.business.logistics = json.business.logistics || {}
  json.business.logistics.dashboard = json.business.logistics.dashboard || {}
  for (const k of Object.keys(LOG)) json.business.logistics.dashboard[k] = LOG[k][i]
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`  ✓ ${loc}.json — supplier (+${Object.keys(SUP).length}) + business.logistics.dashboard (+${Object.keys(LOG).length})`)
})
console.log('[add-partner-profile-i18n] done.')
