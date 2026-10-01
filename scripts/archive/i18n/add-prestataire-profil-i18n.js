// scripts/add-prestataire-profil-i18n.js — Prestataire profil-page chrome keys (Agent 104).
// Adds the prestataire.* keys used by /prestataire/dashboard/profil (the editable profile page,
// faithful calque of /supplier/dashboard/profil). Field labels (fieldCompanyName/fieldServices/
// fieldCoverageZones/fieldModality/svc*/modality*/fieldIndicativeRate*/fieldSiren), errorGeneric
// and the account-status labels (reused via dashboard.statusActive/…) ALREADY exist — only the
// page chrome + locked-block + verification labels are added here. FR vouvoiement, real Arabic
// (RTL). NO money figure. Idempotent; 2-space JSON. Run: node scripts/add-prestataire-profil-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

const KEYS = {
  fr: {
    profileTitle:        'Mon profil',
    profileBack:         'Retour au tableau de bord',
    profileSubtitle:     'Mettez à jour les informations de votre activité. Votre SIREN et la vérification de votre entreprise restent en lecture seule.',
    profileSavedTitle:   'Profil enregistré',
    profileSavedBody:    'Vos modifications ont bien été enregistrées.',
    profileLoadError:    'Impossible de charger votre profil. Réessayez plus tard.',
    profileSave:         'Enregistrer',
    profileSaving:       'Enregistrement…',
    profileLockedTitle:  'Informations vérifiées',
    profileLockedNote:   'Ces informations sont définies lors de votre inscription et ne sont pas modifiables ici.',
    lockedSiren:         'SIREN',
    lockedOfficialName:  'Raison sociale',
    lockedVerification:  'Vérification',
    lockedAccountStatus: 'Statut du compte',
    verifVerified:       'Vérifiée',
    verifReview:         'En cours de vérification',
    verifRejected:       'Refusée',
    verifNone:           '—',
  },
  en: {
    profileTitle:        'My profile',
    profileBack:         'Back to dashboard',
    profileSubtitle:     'Update your business information. Your SIREN and company verification remain read-only.',
    profileSavedTitle:   'Profile saved',
    profileSavedBody:    'Your changes have been saved.',
    profileLoadError:    'Could not load your profile. Please try again later.',
    profileSave:         'Save',
    profileSaving:       'Saving…',
    profileLockedTitle:  'Verified information',
    profileLockedNote:   'This information is set when you register and cannot be edited here.',
    lockedSiren:         'SIREN',
    lockedOfficialName:  'Legal name',
    lockedVerification:  'Verification',
    lockedAccountStatus: 'Account status',
    verifVerified:       'Verified',
    verifReview:         'Under review',
    verifRejected:       'Rejected',
    verifNone:           '—',
  },
  es: {
    profileTitle:        'Mi perfil',
    profileBack:         'Volver al panel',
    profileSubtitle:     'Actualice la información de su actividad. Su SIREN y la verificación de su empresa permanecen en solo lectura.',
    profileSavedTitle:   'Perfil guardado',
    profileSavedBody:    'Sus cambios se han guardado.',
    profileLoadError:    'No se pudo cargar su perfil. Inténtelo de nuevo más tarde.',
    profileSave:         'Guardar',
    profileSaving:       'Guardando…',
    profileLockedTitle:  'Información verificada',
    profileLockedNote:   'Esta información se define al registrarse y no se puede editar aquí.',
    lockedSiren:         'SIREN',
    lockedOfficialName:  'Razón social',
    lockedVerification:  'Verificación',
    lockedAccountStatus: 'Estado de la cuenta',
    verifVerified:       'Verificada',
    verifReview:         'En verificación',
    verifRejected:       'Rechazada',
    verifNone:           '—',
  },
  it: {
    profileTitle:        'Il mio profilo',
    profileBack:         'Torna al pannello',
    profileSubtitle:     'Aggiorni le informazioni della sua attività. Il suo SIREN e la verifica della sua azienda restano in sola lettura.',
    profileSavedTitle:   'Profilo salvato',
    profileSavedBody:    'Le sue modifiche sono state salvate.',
    profileLoadError:    'Impossibile caricare il suo profilo. Riprovi più tardi.',
    profileSave:         'Salva',
    profileSaving:       'Salvataggio…',
    profileLockedTitle:  'Informazioni verificate',
    profileLockedNote:   'Queste informazioni vengono definite al momento della registrazione e non sono modificabili qui.',
    lockedSiren:         'SIREN',
    lockedOfficialName:  'Ragione sociale',
    lockedVerification:  'Verifica',
    lockedAccountStatus: 'Stato dell’account',
    verifVerified:       'Verificata',
    verifReview:         'In verifica',
    verifRejected:       'Rifiutata',
    verifNone:           '—',
  },
  ar: {
    profileTitle:        'ملفّي',
    profileBack:         'العودة إلى لوحة التحكّم',
    profileSubtitle:     'حدّث معلومات نشاطك. يبقى رقم SIREN والتحقّق من شركتك للقراءة فقط.',
    profileSavedTitle:   'تم حفظ الملف',
    profileSavedBody:    'تم حفظ تعديلاتك.',
    profileLoadError:    'تعذّر تحميل ملفك. أعِد المحاولة لاحقًا.',
    profileSave:         'حفظ',
    profileSaving:       'جارٍ الحفظ…',
    profileLockedTitle:  'معلومات مُوثّقة',
    profileLockedNote:   'تُحدَّد هذه المعلومات عند التسجيل ولا يمكن تعديلها هنا.',
    lockedSiren:         'SIREN',
    lockedOfficialName:  'الاسم القانوني',
    lockedVerification:  'التحقّق',
    lockedAccountStatus: 'حالة الحساب',
    verifVerified:       'مُوثّقة',
    verifReview:         'قيد التحقّق',
    verifRejected:       'مرفوضة',
    verifNone:           '—',
  },
}

let changed = 0
for (const loc of Object.keys(KEYS)) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.prestataire = Object.assign({}, json.prestataire, KEYS[loc])
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
  console.log(`✓ ${loc}: prestataire.profile* chrome keys`)
}
console.log(`Done — ${changed} locale files updated.`)
