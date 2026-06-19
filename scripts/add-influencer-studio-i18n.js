// scripts/add-influencer-studio-i18n.js — INF-2 (Agent 67).
// Mirrors the creator studio keys into the affiliate.* namespace (vouvoiement FR, ES/IT
// informal to match affiliate.*, real Arabic) so the reused AffiliateStudio can render with
// tNamespace='affiliate'. Adds the verified-only "locked" hint too. copied/copy/verifiedBadge
// already exist in affiliate.* (not re-added). Idempotent; 2-space JSON + newline.
// Run: node scripts/add-influencer-studio-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

const ADD = {
  fr: {
    studioTitle: 'Studio de contenu', studioDesc: 'Choisissez une cible, générez des légendes prêtes à poster + une carte partageable.',
    studioPickResto: 'Choisir un restaurant…', studioDishAll: 'Tout le restaurant',
    studioGenerate: 'Générer', studioGenerating: 'Génération…',
    studioErr: 'Génération indisponible, réessayez.', studioRateLimited: 'Limite atteinte — réessayez plus tard.',
    studioCaptionsTitle: 'Légendes', studioCardTitle: 'Carte partageable', studioCardCta: 'Commandez sur Grubano 🍽️', copyCaption: 'Copier',
    toneEnthusiastic: 'Enthousiaste', tonePunchy: 'Court & punchy', toneStorytelling: 'Storytelling',
    studioLockedTitle: 'Studio de contenu', studioLockedBody: 'Faites vérifier votre audience pour débloquer le studio de contenu IA.',
  },
  en: {
    studioTitle: 'Content studio', studioDesc: 'Pick a target, generate ready-to-post captions + a shareable card.',
    studioPickResto: 'Choose a restaurant…', studioDishAll: 'Whole restaurant',
    studioGenerate: 'Generate', studioGenerating: 'Generating…',
    studioErr: 'Generation unavailable, try again.', studioRateLimited: 'Limit reached — try again later.',
    studioCaptionsTitle: 'Captions', studioCardTitle: 'Shareable card', studioCardCta: 'Order on Grubano 🍽️', copyCaption: 'Copy',
    toneEnthusiastic: 'Enthusiastic', tonePunchy: 'Short & punchy', toneStorytelling: 'Storytelling',
    studioLockedTitle: 'Content studio', studioLockedBody: 'Get your audience verified to unlock the AI content studio.',
  },
  es: {
    studioTitle: 'Estudio de contenido', studioDesc: 'Elige un objetivo, genera leyendas listas para publicar + una tarjeta para compartir.',
    studioPickResto: 'Elegir un restaurante…', studioDishAll: 'Todo el restaurante',
    studioGenerate: 'Generar', studioGenerating: 'Generando…',
    studioErr: 'Generación no disponible, inténtalo de nuevo.', studioRateLimited: 'Límite alcanzado — inténtalo más tarde.',
    studioCaptionsTitle: 'Leyendas', studioCardTitle: 'Tarjeta para compartir', studioCardCta: 'Pide en Grubano 🍽️', copyCaption: 'Copiar',
    toneEnthusiastic: 'Entusiasta', tonePunchy: 'Corto y directo', toneStorytelling: 'Storytelling',
    studioLockedTitle: 'Estudio de contenido', studioLockedBody: 'Verifica tu audiencia para desbloquear el estudio de contenido IA.',
  },
  it: {
    studioTitle: 'Studio contenuti', studioDesc: 'Scegli un obiettivo, genera didascalie pronte da pubblicare + una card condivisibile.',
    studioPickResto: 'Scegli un ristorante…', studioDishAll: 'Tutto il ristorante',
    studioGenerate: 'Genera', studioGenerating: 'Generazione…',
    studioErr: 'Generazione non disponibile, riprova.', studioRateLimited: 'Limite raggiunto — riprova più tardi.',
    studioCaptionsTitle: 'Didascalie', studioCardTitle: 'Card condivisibile', studioCardCta: 'Ordina su Grubano 🍽️', copyCaption: 'Copia',
    toneEnthusiastic: 'Entusiasta', tonePunchy: 'Breve e diretto', toneStorytelling: 'Storytelling',
    studioLockedTitle: 'Studio contenuti', studioLockedBody: 'Fai verificare il tuo pubblico per sbloccare lo studio contenuti IA.',
  },
  ar: {
    studioTitle: 'استوديو المحتوى', studioDesc: 'اختر هدفًا، ولّد تسميات جاهزة للنشر + بطاقة قابلة للمشاركة.',
    studioPickResto: 'اختر مطعمًا…', studioDishAll: 'المطعم بالكامل',
    studioGenerate: 'توليد', studioGenerating: 'جارٍ التوليد…',
    studioErr: 'التوليد غير متاح، حاول مجددًا.', studioRateLimited: 'تم بلوغ الحد — حاول لاحقًا.',
    studioCaptionsTitle: 'التسميات', studioCardTitle: 'بطاقة للمشاركة', studioCardCta: 'اطلب عبر Grubano 🍽️', copyCaption: 'نسخ',
    toneEnthusiastic: 'متحمّس', tonePunchy: 'قصير ومباشر', toneStorytelling: 'سرد قصصي',
    studioLockedTitle: 'استوديو المحتوى', studioLockedBody: 'تحقّق من جمهورك لفتح استوديو المحتوى بالذكاء الاصطناعي.',
  },
}

let changed = 0
for (const loc of Object.keys(ADD)) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.affiliate = json.affiliate || {}
  Object.assign(json.affiliate, ADD[loc])
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
  console.log(`✓ ${loc}: +${Object.keys(ADD[loc]).length} affiliate.studio* keys`)
}
console.log(`Done — ${changed} locale files updated.`)
