'use strict'

// scripts/seed-influencer-i18n.js — Mission 14 (Agent 14), idempotent injector.
//
// Adds the keys for:
//   A) the distinct YouTube-resolution error messages + the @-friendly placeholder
//      (creators.apply.*)
//   B) the role-aware PUBLIC influencer profile (chef.influencer*)
// across all five locales. Re-running it is a no-op (sets the canonical value).
//
//   node scripts/seed-influencer-i18n.js
//
// Then `npm run check:i18n` must stay green (fr.json is the reference).

const fs   = require('fs')
const path = require('path')

const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

// locale → { "<dot.section.path>": { key: value } }
const T = {
  fr: {
    'creators.apply': {
      verifyChannelNotFound:    "Chaîne YouTube introuvable — vérifie le lien (ex. youtube.com/@TaChaine ou @TaChaine).",
      verifyChannelUnavailable: "YouTube est momentanément indisponible (ou tes abonnés sont masqués). Réessaie dans un instant.",
      verifyChannelConfig:      "La vérification YouTube n'est pas disponible pour le moment. Réessaie plus tard.",
      youtubePlaceholder:       "youtube.com/@TaChaine ou @TaChaine",
    },
    chef: {
      influencerTagline:          "Ambassadeur Grubano",
      influencerPitchTitle:       "Découvre mes restaurants préférés",
      influencerPitchBody:        "Je partage mes bonnes adresses food sur Grubano. Explore les restaurants et régale-toi.",
      influencerCtaBtn:           "Découvrir les restaurants",
      influencerMetaTitle:        "{name} — Ambassadeur Grubano",
      influencerMetaFallbackDesc: "Découvrez les restaurants recommandés par {name} sur Grubano.",
    },
  },
  en: {
    'creators.apply': {
      verifyChannelNotFound:    "YouTube channel not found — check the link (e.g. youtube.com/@YourChannel or @YourChannel).",
      verifyChannelUnavailable: "YouTube is temporarily unavailable (or your subscriber count is hidden). Try again shortly.",
      verifyChannelConfig:      "YouTube verification is unavailable right now. Please try again later.",
      youtubePlaceholder:       "youtube.com/@YourChannel or @YourChannel",
    },
    chef: {
      influencerTagline:          "Grubano ambassador",
      influencerPitchTitle:       "Discover my favorite restaurants",
      influencerPitchBody:        "I share my favorite food spots on Grubano. Explore the restaurants and enjoy.",
      influencerCtaBtn:           "Discover restaurants",
      influencerMetaTitle:        "{name} — Grubano ambassador",
      influencerMetaFallbackDesc: "Discover the restaurants recommended by {name} on Grubano.",
    },
  },
  es: {
    'creators.apply': {
      verifyChannelNotFound:    "Canal de YouTube no encontrado — revisa el enlace (p. ej. youtube.com/@TuCanal o @TuCanal).",
      verifyChannelUnavailable: "YouTube no está disponible por el momento (o tus suscriptores están ocultos). Inténtalo de nuevo en un momento.",
      verifyChannelConfig:      "La verificación de YouTube no está disponible ahora mismo. Inténtalo más tarde.",
      youtubePlaceholder:       "youtube.com/@TuCanal o @TuCanal",
    },
    chef: {
      influencerTagline:          "Embajador Grubano",
      influencerPitchTitle:       "Descubre mis restaurantes favoritos",
      influencerPitchBody:        "Comparto mis mejores sitios de comida en Grubano. Explora los restaurantes y disfruta.",
      influencerCtaBtn:           "Descubrir restaurantes",
      influencerMetaTitle:        "{name} — Embajador Grubano",
      influencerMetaFallbackDesc: "Descubre los restaurantes recomendados por {name} en Grubano.",
    },
  },
  it: {
    'creators.apply': {
      verifyChannelNotFound:    "Canale YouTube non trovato — controlla il link (es. youtube.com/@TuoCanale o @TuoCanale).",
      verifyChannelUnavailable: "YouTube è momentaneamente non disponibile (o i tuoi iscritti sono nascosti). Riprova tra poco.",
      verifyChannelConfig:      "La verifica YouTube non è disponibile al momento. Riprova più tardi.",
      youtubePlaceholder:       "youtube.com/@TuoCanale o @TuoCanale",
    },
    chef: {
      influencerTagline:          "Ambasciatore Grubano",
      influencerPitchTitle:       "Scopri i miei ristoranti preferiti",
      influencerPitchBody:        "Condivido i miei indirizzi food preferiti su Grubano. Esplora i ristoranti e goditeli.",
      influencerCtaBtn:           "Scopri i ristoranti",
      influencerMetaTitle:        "{name} — Ambasciatore Grubano",
      influencerMetaFallbackDesc: "Scopri i ristoranti consigliati da {name} su Grubano.",
    },
  },
  ar: {
    'creators.apply': {
      verifyChannelNotFound:    "لم يتم العثور على قناة YouTube — تحقّق من الرابط (مثل youtube.com/@قناتك أو @قناتك).",
      verifyChannelUnavailable: "YouTube غير متاح مؤقتًا (أو عدد المشتركين مخفي). أعد المحاولة بعد قليل.",
      verifyChannelConfig:      "التحقّق عبر YouTube غير متاح حاليًا. يُرجى المحاولة لاحقًا.",
      youtubePlaceholder:       "youtube.com/@قناتك أو @قناتك",
    },
    chef: {
      influencerTagline:          "سفير Grubano",
      influencerPitchTitle:       "اكتشف مطاعمي المفضّلة",
      influencerPitchBody:        "أشارك أفضل وجهات الطعام لديّ على Grubano. استكشف المطاعم واستمتع.",
      influencerCtaBtn:           "اكتشف المطاعم",
      influencerMetaTitle:        "{name} — سفير Grubano",
      influencerMetaFallbackDesc: "اكتشف المطاعم التي يوصي بها {name} على Grubano.",
    },
  },
}

function setDeep(root, sectionPath, key, value) {
  let cur = root
  for (const p of sectionPath.split('.')) {
    if (typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {}
    cur = cur[p]
  }
  const isNew = !(key in cur)
  cur[key] = value
  return isNew
}

let added = 0
for (const loc of LOCALES) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  for (const [sectionPath, keys] of Object.entries(T[loc])) {
    for (const [key, value] of Object.entries(keys)) {
      if (setDeep(json, sectionPath, key, value)) added++
    }
  }
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`✓ ${loc}.json updated`)
}
console.log(`Done — ${added} key(s) added (idempotent; 0 on re-run).`)
