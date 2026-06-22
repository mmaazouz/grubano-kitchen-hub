// scripts/add-supplier-activation-i18n.js — Supplier onboarding steps (Agent 103).
// Adds activation.steps.supplier{Account,Company,Catalogue,Payout} + activation.blocked.
// supplierVerifyCompanyFirst (the supplier checklist labels read by OnboardingGuide via
// useTranslations('activation')). FR vouvoiement, real Arabic (RTL). NO money figure.
// Idempotent; 2-space JSON. Run: node scripts/add-supplier-activation-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

const STEPS = {
  fr: {
    supplierAccount:   { title: 'Compte créé', desc: 'Votre compte fournisseur est actif et vous êtes connecté.' },
    supplierCompany:   { title: 'Vérifiez votre entreprise', desc: 'Renseignez votre SIREN : nous vérifions votre entreprise auprès du registre officiel.', cta: 'Vérifier mon entreprise' },
    supplierCatalogue: { title: 'Créez votre catalogue', desc: 'Ajoutez au moins un produit pour que les restaurateurs puissent commander.', cta: 'Ajouter un produit' },
    supplierPayout:    { title: 'Pour être payé : identité et banque', descReady: 'Votre identité et votre banque sont vérifiées : vous pouvez être payé.', descTodo: 'Pour recevoir vos paiements, vérifiez votre identité et votre banque. À faire quand vous voulez — cela ne bloque pas vos ventes.', cta: 'Configurer mes paiements' },
  },
  en: {
    supplierAccount:   { title: 'Account created', desc: 'Your supplier account is active and you are signed in.' },
    supplierCompany:   { title: 'Verify your company', desc: 'Enter your SIREN: we verify your company against the official registry.', cta: 'Verify my company' },
    supplierCatalogue: { title: 'Build your catalogue', desc: 'Add at least one product so restaurateurs can order.', cta: 'Add a product' },
    supplierPayout:    { title: 'To get paid: identity and bank', descReady: 'Your identity and bank are verified: you can be paid.', descTodo: 'To receive your payments, verify your identity and bank. Do it whenever you like — it never blocks your sales.', cta: 'Set up my payments' },
  },
  es: {
    supplierAccount:   { title: 'Cuenta creada', desc: 'Su cuenta de proveedor está activa y ha iniciado sesión.' },
    supplierCompany:   { title: 'Verifique su empresa', desc: 'Indique su SIREN: verificamos su empresa en el registro oficial.', cta: 'Verificar mi empresa' },
    supplierCatalogue: { title: 'Cree su catálogo', desc: 'Añada al menos un producto para que los restauradores puedan pedir.', cta: 'Añadir un producto' },
    supplierPayout:    { title: 'Para cobrar: identidad y banco', descReady: 'Su identidad y su banco están verificados: ya puede cobrar.', descTodo: 'Para recibir sus pagos, verifique su identidad y su banco. Hágalo cuando quiera: no bloquea sus ventas.', cta: 'Configurar mis pagos' },
  },
  it: {
    supplierAccount:   { title: 'Account creato', desc: 'Il suo account fornitore è attivo ed è connesso.' },
    supplierCompany:   { title: 'Verifichi la sua azienda', desc: 'Indichi il suo SIREN: verifichiamo la sua azienda presso il registro ufficiale.', cta: 'Verificare la mia azienda' },
    supplierCatalogue: { title: 'Crei il suo catalogo', desc: 'Aggiunga almeno un prodotto affinché i ristoratori possano ordinare.', cta: 'Aggiungere un prodotto' },
    supplierPayout:    { title: 'Per essere pagato: identità e banca', descReady: 'La sua identità e la sua banca sono verificate: può essere pagato.', descTodo: 'Per ricevere i suoi pagamenti, verifichi la sua identità e la sua banca. Lo faccia quando vuole: non blocca le sue vendite.', cta: 'Configurare i miei pagamenti' },
  },
  ar: {
    supplierAccount:   { title: 'تم إنشاء الحساب', desc: 'حساب المورّد الخاص بك مفعّل وأنت متصل.' },
    supplierCompany:   { title: 'وثّق شركتك', desc: 'أدخِل رقم SIREN: نتحقّق من شركتك لدى السجلّ الرسمي.', cta: 'توثيق شركتي' },
    supplierCatalogue: { title: 'أنشئ كتالوجك', desc: 'أضِف منتجًا واحدًا على الأقل حتى يتمكّن أصحاب المطاعم من الطلب.', cta: 'إضافة منتج' },
    supplierPayout:    { title: 'لتتقاضى أجرك: الهوية والبنك', descReady: 'تم التحقق من هويتك وبنكك: يمكنك تلقّي أجرك.', descTodo: 'لتلقّي مدفوعاتك، تحقّق من هويتك وبنكك. يمكنك ذلك متى شئت — فهو لا يوقف مبيعاتك.', cta: 'إعداد مدفوعاتي' },
  },
}

const BLOCKED = {
  fr: 'Vérifiez d’abord votre entreprise.',
  en: 'Verify your company first.',
  es: 'Verifique antes su empresa.',
  it: 'Verifichi prima la sua azienda.',
  ar: 'وثّق شركتك أولًا.',
}

let changed = 0
for (const loc of Object.keys(STEPS)) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.activation = json.activation || {}
  json.activation.steps = Object.assign({}, json.activation.steps, STEPS[loc])
  json.activation.blocked = Object.assign({}, json.activation.blocked, { supplierVerifyCompanyFirst: BLOCKED[loc] })
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
  console.log(`✓ ${loc}: activation.steps.supplier* + blocked.supplierVerifyCompanyFirst`)
}
console.log(`Done — ${changed} locale files updated.`)
