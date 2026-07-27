/* eslint-disable */
// ── P5b — creator/influencer "Profil & paramètres" i18n (Agent 22) ────────────
// Adds creators.settings.* (the editable settings screen chrome + locked-field
// labels) + creators.nav.settings (sidebar link). The editable FIELD labels +
// role titles are REUSED from the existing creators.apply.* namespace
// (labelName/labelBio/labelInstagram/labelTiktok/labelYoutube/roleChefTitle/
// roleInfluencerTitle/bioPlaceholder). x5 locales, parity, idempotent.
// FR vouvoiement; es/it informal (P3 convention); ar RTL.
// Run: node scripts/add-creator-settings-i18n.js
const fs = require('fs')
const path = require('path')
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

// creators.settings.* — [fr, en, es, it, ar]
const S = {
  navLink:   ['Profil & paramètres', 'Profile & settings', 'Perfil y ajustes', 'Profilo e impostazioni', 'الملف والإعدادات'],
  title:     ['Profil & paramètres', 'Profile & settings', 'Perfil y ajustes', 'Profilo e impostazioni', 'الملف والإعدادات'],
  subtitle:  ['Mettez à jour votre profil public.', 'Update your public profile.', 'Actualiza tu perfil público.', 'Aggiorna il tuo profilo pubblico.', 'حدّث ملفك العام.'],
  socialsTitle: ['Réseaux sociaux', 'Social networks', 'Redes sociales', 'Social network', 'الشبكات الاجتماعية'],
  save:      ['Enregistrer', 'Save', 'Guardar', 'Salva', 'حفظ'],
  saving:    ['Enregistrement…', 'Saving…', 'Guardando…', 'Salvataggio…', 'جارٍ الحفظ…'],
  savedTitle:['Profil mis à jour ✅', 'Profile updated ✅', 'Perfil actualizado ✅', 'Profilo aggiornato ✅', 'تم تحديث الملف ✅'],
  savedBody: ['Vos informations ont été enregistrées.', 'Your information has been saved.', 'Tu información se ha guardado.', 'Le tue informazioni sono state salvate.', 'تم حفظ معلوماتك.'],
  errorGeneric: ['Une erreur est survenue. Réessayez.', 'Something went wrong. Please try again.', 'Se produjo un error. Inténtalo de nuevo.', 'Si è verificato un errore. Riprova.', 'حدث خطأ. حاول مرة أخرى.'],
  loadError: ['Impossible de charger votre profil.', 'Could not load your profile.', 'No se pudo cargar tu perfil.', 'Impossibile caricare il tuo profilo.', 'تعذّر تحميل ملفك.'],
  lockedTitle: ['Informations vérifiées', 'Verified information', 'Información verificada', 'Informazioni verificate', 'معلومات مُتحقَّق منها'],
  lockedNote: [
    'Non modifiable — votre chaîne vérifiée et vos rôles relèvent d’une nouvelle candidature.',
    'Not editable — your verified channel and roles require a new application to change.',
    'No editable: tu canal verificado y tus roles requieren una nueva candidatura.',
    'Non modificabile — il tuo canale verificato e i tuoi ruoli richiedono una nuova candidatura.',
    'غير قابل للتعديل — قناتك المُوثّقة وأدوارك تتطلّب طلبًا جديدًا.',
  ],
  lockedYoutube: ['Chaîne YouTube vérifiée', 'Verified YouTube channel', 'Canal de YouTube verificado', 'Canale YouTube verificato', 'قناة يوتيوب موثّقة'],
  lockedVerification: ['Vérification', 'Verification', 'Verificación', 'Verifica', 'التحقق'],
  lockedRoles: ['Vos rôles', 'Your roles', 'Tus roles', 'I tuoi ruoli', 'أدوارك'],
  verifVerified: ['Vérifié', 'Verified', 'Verificado', 'Verificato', 'مُتحقَّق منه'],
  verifPending:  ['Non vérifié', 'Not verified', 'No verificado', 'Non verificato', 'غير مُتحقَّق منه'],
  none:          ['—', '—', '—', '—', '—'],
}

LOCALES.forEach((loc, i) => {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.creators = json.creators || {}
  json.creators.settings = json.creators.settings || {}
  for (const k of Object.keys(S)) json.creators.settings[k] = S[k][i]
  json.creators.nav = json.creators.nav || {}
  json.creators.nav.settings = S.navLink[i]
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`  ✓ ${loc}.json — creators.settings (+${Object.keys(S).length}) + creators.nav.settings`)
})
console.log('[add-creator-settings-i18n] done.')
