// scripts/add-prestataire-activation-i18n.js — Prestataire onboarding steps (Agent 104).
// Adds activation.steps.prestataire{Account,Profile,Company,Payout} — the prestataire checklist
// labels read by OnboardingGuide via useTranslations('activation'). FR vouvoiement, real Arabic
// (RTL). NO money figure. NO blocked key (the company step is a non-locking 'todo', not 'locked').
// Idempotent; 2-space JSON. Run: node scripts/add-prestataire-activation-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

const STEPS = {
  fr: {
    prestataireAccount: { title: 'Compte créé', desc: 'Votre compte prestataire est actif et vous êtes connecté.' },
    prestataireProfile: { title: 'Complétez votre profil de service', desc: 'Choisissez au moins une catégorie de service pour que les restaurateurs vous trouvent.', cta: 'Compléter mon profil' },
    prestataireCompany: { title: 'Vérifiez votre entreprise', desc: 'Renseignez votre SIREN : nous vérifions votre entreprise auprès du registre officiel.', cta: 'Vérifier mon entreprise' },
    prestatairePayout:  { title: 'Pour être payé : identité et banque', descReady: 'Votre identité et votre banque sont vérifiées : vous pouvez être payé.', descTodo: 'Pour recevoir vos paiements, vérifiez votre identité et votre banque. À faire quand vous voulez — cela ne bloque pas vos missions.', cta: 'Configurer mes paiements' },
  },
  en: {
    prestataireAccount: { title: 'Account created', desc: 'Your provider account is active and you are signed in.' },
    prestataireProfile: { title: 'Complete your service profile', desc: 'Pick at least one service category so restaurateurs can find you.', cta: 'Complete my profile' },
    prestataireCompany: { title: 'Verify your company', desc: 'Enter your SIREN: we verify your company against the official registry.', cta: 'Verify my company' },
    prestatairePayout:  { title: 'To get paid: identity and bank', descReady: 'Your identity and bank are verified: you can be paid.', descTodo: 'To receive your payments, verify your identity and bank. Do it whenever you like — it never blocks your jobs.', cta: 'Set up my payments' },
  },
  es: {
    prestataireAccount: { title: 'Cuenta creada', desc: 'Su cuenta de proveedor de servicios está activa y ha iniciado sesión.' },
    prestataireProfile: { title: 'Complete su perfil de servicio', desc: 'Elija al menos una categoría de servicio para que los restauradores le encuentren.', cta: 'Completar mi perfil' },
    prestataireCompany: { title: 'Verifique su empresa', desc: 'Indique su SIREN: verificamos su empresa en el registro oficial.', cta: 'Verificar mi empresa' },
    prestatairePayout:  { title: 'Para cobrar: identidad y banco', descReady: 'Su identidad y su banco están verificados: ya puede cobrar.', descTodo: 'Para recibir sus pagos, verifique su identidad y su banco. Hágalo cuando quiera: no bloquea sus misiones.', cta: 'Configurar mis pagos' },
  },
  it: {
    prestataireAccount: { title: 'Account creato', desc: 'Il suo account prestatore è attivo ed è connesso.' },
    prestataireProfile: { title: 'Completi il suo profilo di servizio', desc: 'Scelga almeno una categoria di servizio affinché i ristoratori possano trovarla.', cta: 'Completare il mio profilo' },
    prestataireCompany: { title: 'Verifichi la sua azienda', desc: 'Indichi il suo SIREN: verifichiamo la sua azienda presso il registro ufficiale.', cta: 'Verificare la mia azienda' },
    prestatairePayout:  { title: 'Per essere pagato: identità e banca', descReady: 'La sua identità e la sua banca sono verificate: può essere pagato.', descTodo: 'Per ricevere i suoi pagamenti, verifichi la sua identità e la sua banca. Lo faccia quando vuole: non blocca le sue missioni.', cta: 'Configurare i miei pagamenti' },
  },
  ar: {
    prestataireAccount: { title: 'تم إنشاء الحساب', desc: 'حساب مزوّد الخدمة الخاص بك مفعّل وأنت متصل.' },
    prestataireProfile: { title: 'أكمِل ملفّك الخدمي', desc: 'اختر فئة خدمة واحدة على الأقل حتى يتمكّن أصحاب المطاعم من العثور عليك.', cta: 'إكمال ملفّي' },
    prestataireCompany: { title: 'وثّق شركتك', desc: 'أدخِل رقم SIREN: نتحقّق من شركتك لدى السجلّ الرسمي.', cta: 'توثيق شركتي' },
    prestatairePayout:  { title: 'لتتقاضى أجرك: الهوية والبنك', descReady: 'تم التحقق من هويتك وبنكك: يمكنك تلقّي أجرك.', descTodo: 'لتلقّي مدفوعاتك، تحقّق من هويتك وبنكك. يمكنك ذلك متى شئت — فهو لا يوقف مهامك.', cta: 'إعداد مدفوعاتي' },
  },
}

let changed = 0
for (const loc of Object.keys(STEPS)) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.activation = json.activation || {}
  json.activation.steps = Object.assign({}, json.activation.steps, STEPS[loc])
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
  console.log(`✓ ${loc}: activation.steps.prestataire*`)
}
console.log(`Done — ${changed} locale files updated.`)
