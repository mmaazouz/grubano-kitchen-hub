/* eslint-disable */
// ── P3 Chantier 1 — VOUVOIEMENT (FR only) (Agent 19) ──────────────────────────
// Rewrites the FR VALUES of business.auth / business.verified / business.onboarding /
// business.franchiseSoon / creators.apply from « tu » to « vous » (the convention of
// the recent FR surfaces: business.landing, business.logistics, supplier — all VOUS).
// VALUES ONLY — no key added/removed (parity untouched). es/it stay informal and ar
// stays direct-2nd-person because the app's reference recent surfaces (business.landing,
// business.logistics) are ALSO informal in es/it/ar — converting them would make these
// namespaces INCONSISTENT with the rest of the app. So this script touches fr.json only.
// Idempotent: re-running just re-sets the same values. Guards: never CREATES a key.
// Run: node scripts/p3-tone-vous-fr-i18n.js
const fs = require('fs')
const path = require('path')

// dot-path (under the namespace) -> new FR value (vouvoiement). Keys ONLY rewritten,
// never created. Placeholders ({year} etc.) preserved (none of these carry one).
const FR = {
  'business.auth': {
    heroTitle:      'Rejoignez le réseau Grubano',
    heroSubtitle:   'Connectez votre restaurant à des milliers de gourmands près de chez vous.',
    registerFailed: 'Inscription impossible. Vérifiez vos informations.',
    rateLimited:    'Trop de tentatives, réessayez dans une heure.',
    networkError:   'Erreur réseau, réessayez.',
    legalNote:      'En créant un compte, vous confirmez être autorisé à représenter votre établissement.',
  },
  'business.verified': {
    successBody: 'Votre compte partenaire est en cours de validation par notre équipe avant la mise en ligne. Vous recevrez un email dès qu’il sera activé.',
    expiredBody: 'Ce lien de vérification a expiré. Reconnectez-vous pour demander un nouvel email.',
    usedBody:    'Ce lien a déjà été utilisé. Votre email est sans doute déjà vérifié — connectez-vous pour le confirmer.',
    invalidBody: 'Ce lien n’est pas reconnu. Vérifiez que vous avez bien cliqué sur le dernier email reçu.',
    errorBody:   'Impossible de vérifier votre email pour le moment. Réessayez dans quelques instants.',
    helpHint:    'Si le problème persiste, contactez le support à contact@grubano.com.',
  },
  'business.onboarding': {
    brandTitle:             'Créez votre marque',
    brandSubtitle:          'Le nom sous lequel vos plats apparaîtront sur Grubano.',
    restoTitle:             'Votre restaurant',
    fulfilmentLabel:        'Comment servez-vous vos clients ?',
    reviewNotice:           'Votre restaurant sera créé en mode invisible. Notre équipe vérifie votre dossier avant la mise en ligne sur l’app Grubano.',
    doneTitle:              'Votre espace est créé ✅',
    doneBody:               'Votre restaurant est en cours de validation par notre équipe avant la mise en ligne. Vous pouvez déjà préparer votre menu depuis le tableau de bord — il deviendra visible dès l’approbation.',
    errBrandFailed:         'Impossible de créer la marque. Réessayez.',
    errAtLeastOneFulfilment:'Activez au moins la livraison ou le retrait.',
    errRestaurantFailed:    'Impossible de créer le restaurant. Vérifiez vos informations.',
    errNetwork:             'Erreur réseau, réessayez.',
    restoCuisineHint:       'C’est la catégorie sous laquelle les clients vous trouveront sur Grubano.',
    logoPlaceholder:        'https://… lien vers votre logo',
    coverPlaceholder:       'https://… lien vers votre bannière',
    imageHint:              'Collez un lien d’image. Si vide, un visuel par défaut selon votre cuisine est utilisé.',
    errAddressInvalid:      'Adresse invalide — saisissez une adresse complète (numéro et rue).',
  },
  'business.franchiseSoon': {
    body:            'Le déploiement de votre enseigne sur plusieurs villes arrive très bientôt. Notre équipe vous accompagne personnellement à chaque étape.',
    dedicatedSupport:'Accompagnement dédié — on vous recontacte',
  },
  'creators.apply': {
    verifyDesc:               'Collez ce code dans la description de votre chaîne YouTube (onglet « À propos »), publiez, puis cliquez sur Vérifier.',
    verifyCodeLabel:          'Votre code de vérification',
    verifyApprovedTitle:      '🎉 Vous êtes vérifié !',
    verifyApprovedDesc:       'Votre profil est en ligne.',
    verifyFlaggedDesc:        'Notre équipe valide votre compte sous peu.',
    verifyRejectedDesc:       'Votre candidature n’a pas été retenue pour le moment.',
    verifyCodeNotFound:       'Code pas encore détecté. Vérifiez que votre description est publiée, attendez ~1 min, puis réessayez.',
    verifyChannelError:       'Chaîne YouTube introuvable — vérifiez le lien renseigné dans votre candidature.',
    verifyChannelNotFound:    'Chaîne YouTube introuvable — vérifiez le lien (ex. youtube.com/@VotreChaine ou @VotreChaine).',
    verifyChannelUnavailable: 'YouTube est momentanément indisponible (ou vos abonnés sont masqués). Réessayez dans un instant.',
    verifyChannelConfig:      'La vérification YouTube n’est pas disponible pour le moment. Réessayez plus tard.',
    youtubePlaceholder:       'youtube.com/@VotreChaine ou @VotreChaine',
  },
}

const file = path.join(__dirname, '..', 'messages', 'fr.json')
const json = JSON.parse(fs.readFileSync(file, 'utf8'))
let changed = 0, missing = 0
for (const [ns, kv] of Object.entries(FR)) {
  const obj = ns.split('.').reduce((o, k) => (o && o[k] != null ? o[k] : null), json)
  if (!obj) { console.warn(`  ⚠ namespace absent: ${ns}`); missing++; continue }
  for (const [k, v] of Object.entries(kv)) {
    if (!(k in obj)) { console.warn(`  ⚠ clé absente (ignorée, jamais créée): ${ns}.${k}`); missing++; continue }
    obj[k] = v
    changed++
  }
}
fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
console.log(`[p3-tone-vous-fr] fr.json — ${changed} valeurs réécrites en vouvoiement, ${missing} ignorées.`)
