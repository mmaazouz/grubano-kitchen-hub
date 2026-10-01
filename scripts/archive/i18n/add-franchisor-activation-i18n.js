// scripts/add-franchisor-activation-i18n.js — Franchisor onboarding steps (Agent 105).
// Adds activation.steps.franchisor{Account,Company,Franchise,Payout} — the franchisor checklist
// labels read by OnboardingGuide via useTranslations('activation'). FR vouvoiement, real Arabic
// (RTL). NO royalty rate/amount in any string (money-adjacent role — the guide cites no figure).
// NO blocked key (the company step is a non-locking Grubano-side 'current' without a CTA).
// Idempotent; 2-space JSON. Run: node scripts/add-franchisor-activation-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

const STEPS = {
  fr: {
    franchisorAccount:  { title: 'Compte créé', desc: 'Votre compte franchiseur est actif et vous êtes connecté.' },
    franchisorCompany:  { title: 'Vérifiez votre entreprise', descReview: 'Nous vérifions votre entreprise (SIREN) auprès du registre officiel. Vous n’avez rien à faire — nous revenons vers vous.', descVerified: 'Votre entreprise a été vérifiée.' },
    franchisorFranchise:{ title: 'Configurez votre franchise', descTodo: 'Ouvrez une marque à la franchise : définissez votre modèle et vos standards pour accueillir des franchisés.', descDone: 'Votre franchise est configurée.', cta: 'Configurer ma franchise' },
    franchisorPayout:   { title: 'Pour recevoir vos royalties : identité et banque', descReady: 'Votre identité et votre banque sont vérifiées : vous pouvez recevoir vos royalties.', descTodo: 'Pour recevoir vos royalties, vérifiez votre identité et votre banque. À faire quand vous voulez — cela ne bloque pas votre réseau.', cta: 'Configurer mes paiements' },
  },
  en: {
    franchisorAccount:  { title: 'Account created', desc: 'Your franchisor account is active and you are signed in.' },
    franchisorCompany:  { title: 'Verify your company', descReview: 'We are verifying your company (SIREN) against the official registry. Nothing to do — we will get back to you.', descVerified: 'Your company has been verified.' },
    franchisorFranchise:{ title: 'Set up your franchise', descTodo: 'Open a brand to franchising: define your model and standards to welcome franchisees.', descDone: 'Your franchise is set up.', cta: 'Set up my franchise' },
    franchisorPayout:   { title: 'To receive your royalties: identity and bank', descReady: 'Your identity and bank are verified: you can receive your royalties.', descTodo: 'To receive your royalties, verify your identity and bank. Do it whenever you like — it never blocks your network.', cta: 'Set up my payments' },
  },
  es: {
    franchisorAccount:  { title: 'Cuenta creada', desc: 'Su cuenta de franquiciador está activa y ha iniciado sesión.' },
    franchisorCompany:  { title: 'Verifique su empresa', descReview: 'Estamos verificando su empresa (SIREN) en el registro oficial. No tiene que hacer nada: nos pondremos en contacto con usted.', descVerified: 'Su empresa ha sido verificada.' },
    franchisorFranchise:{ title: 'Configure su franquicia', descTodo: 'Abra una marca a la franquicia: defina su modelo y sus estándares para acoger a franquiciados.', descDone: 'Su franquicia está configurada.', cta: 'Configurar mi franquicia' },
    franchisorPayout:   { title: 'Para recibir sus regalías: identidad y banco', descReady: 'Su identidad y su banco están verificados: ya puede recibir sus regalías.', descTodo: 'Para recibir sus regalías, verifique su identidad y su banco. Hágalo cuando quiera: no bloquea su red.', cta: 'Configurar mis pagos' },
  },
  it: {
    franchisorAccount:  { title: 'Account creato', desc: 'Il suo account franchisor è attivo ed è connesso.' },
    franchisorCompany:  { title: 'Verifichi la sua azienda', descReview: 'Stiamo verificando la sua azienda (SIREN) presso il registro ufficiale. Non deve fare nulla: la ricontatteremo.', descVerified: 'La sua azienda è stata verificata.' },
    franchisorFranchise:{ title: 'Configuri la sua franchigia', descTodo: 'Apra un marchio al franchising: definisca il suo modello e i suoi standard per accogliere affiliati.', descDone: 'La sua franchigia è configurata.', cta: 'Configurare la mia franchigia' },
    franchisorPayout:   { title: 'Per ricevere le sue royalty: identità e banca', descReady: 'La sua identità e la sua banca sono verificate: può ricevere le sue royalty.', descTodo: 'Per ricevere le sue royalty, verifichi la sua identità e la sua banca. Lo faccia quando vuole: non blocca la sua rete.', cta: 'Configurare i miei pagamenti' },
  },
  ar: {
    franchisorAccount:  { title: 'تم إنشاء الحساب', desc: 'حساب المانح الامتياز الخاص بك مفعّل وأنت متصل.' },
    franchisorCompany:  { title: 'وثّق شركتك', descReview: 'نتحقّق من شركتك (SIREN) لدى السجلّ الرسمي. لا يلزمك فعل شيء — سنعود إليك.', descVerified: 'تم التحقق من شركتك.' },
    franchisorFranchise:{ title: 'اضبط امتيازك', descTodo: 'افتح علامة تجارية للامتياز: حدّد نموذجك ومعاييرك لاستقبال أصحاب الامتياز.', descDone: 'تم ضبط امتيازك.', cta: 'ضبط امتيازي' },
    franchisorPayout:   { title: 'لاستلام إتاواتك: الهوية والبنك', descReady: 'تم التحقق من هويتك وبنكك: يمكنك استلام إتاواتك.', descTodo: 'لاستلام إتاواتك، تحقّق من هويتك وبنكك. يمكنك ذلك متى شئت — فهو لا يوقف شبكتك.', cta: 'إعداد مدفوعاتي' },
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
  console.log(`✓ ${loc}: activation.steps.franchisor*`)
}
console.log(`Done — ${changed} locale files updated.`)
