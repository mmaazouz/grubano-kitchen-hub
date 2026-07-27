// scripts/add-prestataire-reviews-i18n.js — Prestataire P5 (Agent 78).
// Adds the REVIEWS copy:
//   - marketplace.prestataireMissions.review*  → the « Laisser un avis » button + modal (resto)
//   - marketplace.prestataires.reviews*        → the fiche reviews display (title + count)
// FR vouvoiement, real Arabic (RTL). Idempotent; 2-space JSON. Run:
//   node scripts/add-prestataire-reviews-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

const ADD = {
  fr: {
    missions: {
      reviewCta: "Laisser un avis", reviewed: "Avis déposé", reviewTitle: "Laisser un avis",
      reviewRatingLabel: "Note", reviewCommentLabel: "Commentaire (facultatif)",
      reviewCommentPlaceholder: "Décrivez votre expérience…",
      reviewSend: "Publier l’avis", reviewSending: "Publication…", reviewCancel: "Annuler",
      reviewErr: "Impossible de publier, réessayez.", reviewRatingRequired: "Choisissez une note",
    },
    prestataires: { reviewsTitle: "Avis", reviewsCount: "{count} avis" },
  },
  en: {
    missions: {
      reviewCta: "Leave a review", reviewed: "Reviewed", reviewTitle: "Leave a review",
      reviewRatingLabel: "Rating", reviewCommentLabel: "Comment (optional)",
      reviewCommentPlaceholder: "Describe your experience…",
      reviewSend: "Publish review", reviewSending: "Publishing…", reviewCancel: "Cancel",
      reviewErr: "Couldn't publish, please try again.", reviewRatingRequired: "Choose a rating",
    },
    prestataires: { reviewsTitle: "Reviews", reviewsCount: "{count} reviews" },
  },
  es: {
    missions: {
      reviewCta: "Dejar una opinión", reviewed: "Opinión enviada", reviewTitle: "Dejar una opinión",
      reviewRatingLabel: "Valoración", reviewCommentLabel: "Comentario (opcional)",
      reviewCommentPlaceholder: "Describa su experiencia…",
      reviewSend: "Publicar opinión", reviewSending: "Publicando…", reviewCancel: "Cancelar",
      reviewErr: "No se pudo publicar, inténtelo de nuevo.", reviewRatingRequired: "Elija una valoración",
    },
    prestataires: { reviewsTitle: "Opiniones", reviewsCount: "{count} opiniones" },
  },
  it: {
    missions: {
      reviewCta: "Lascia una recensione", reviewed: "Recensione inviata", reviewTitle: "Lascia una recensione",
      reviewRatingLabel: "Valutazione", reviewCommentLabel: "Commento (facoltativo)",
      reviewCommentPlaceholder: "Descrivete la vostra esperienza…",
      reviewSend: "Pubblica recensione", reviewSending: "Pubblicazione…", reviewCancel: "Annulla",
      reviewErr: "Impossibile pubblicare, riprovate.", reviewRatingRequired: "Scegliete una valutazione",
    },
    prestataires: { reviewsTitle: "Recensioni", reviewsCount: "{count} recensioni" },
  },
  ar: {
    missions: {
      reviewCta: "اترك تقييمًا", reviewed: "تمّ التقييم", reviewTitle: "اترك تقييمًا",
      reviewRatingLabel: "التقييم", reviewCommentLabel: "تعليق (اختياري)",
      reviewCommentPlaceholder: "صِف تجربتك…",
      reviewSend: "نشر التقييم", reviewSending: "جارٍ النشر…", reviewCancel: "إلغاء",
      reviewErr: "تعذّر النشر، حاول مجدّدًا.", reviewRatingRequired: "اختر تقييمًا",
    },
    prestataires: { reviewsTitle: "التقييمات", reviewsCount: "{count} تقييمات" },
  },
}

let changed = 0
for (const loc of Object.keys(ADD)) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  const a = ADD[loc]
  json.marketplace = json.marketplace || {}
  json.marketplace.prestataireMissions = json.marketplace.prestataireMissions || {}
  Object.assign(json.marketplace.prestataireMissions, a.missions)
  json.marketplace.prestataires = json.marketplace.prestataires || {}
  Object.assign(json.marketplace.prestataires, a.prestataires)
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
  console.log(`✓ ${loc}: marketplace.prestataireMissions.review* + marketplace.prestataires.reviews*`)
}
console.log(`Done — ${changed} locale files updated.`)
