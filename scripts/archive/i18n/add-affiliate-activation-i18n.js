// scripts/add-affiliate-activation-i18n.js — Affiliate onboarding steps (Agent 98).
// Adds activation.steps.affiliateAccount / affiliateLink / affiliateWithdraw (the affiliate
// checklist labels read by OnboardingGuide via useTranslations('activation')). FR vouvoiement,
// real Arabic (RTL). Idempotent; 2-space JSON. NO money figure in any copy.
// Run: node scripts/add-affiliate-activation-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

const STEPS = {
  fr: {
    affiliateAccount: {
      title: 'Compte créé',
      desc: 'Votre compte affilié est actif et vous êtes connecté.',
    },
    affiliateLink: {
      title: 'Votre lien d’affiliation est actif',
      desc: 'Partagez votre lien dès maintenant : vos gains sont comptabilisés immédiatement.',
      cta: 'Voir mon lien',
    },
    affiliateWithdraw: {
      title: 'Préparez vos retraits',
      descReady: 'Votre identité et votre banque sont vérifiées : vous pouvez retirer vos gains.',
      descTodo: 'Pour retirer vos gains, vérifiez votre identité et votre banque. À faire quand vous voulez — cela ne bloque pas vos gains.',
      cta: 'Configurer mes retraits',
    },
  },
  en: {
    affiliateAccount: {
      title: 'Account created',
      desc: 'Your affiliate account is active and you are signed in.',
    },
    affiliateLink: {
      title: 'Your affiliate link is live',
      desc: 'Share your link right away — your earnings are counted immediately.',
      cta: 'View my link',
    },
    affiliateWithdraw: {
      title: 'Set up your withdrawals',
      descReady: 'Your identity and bank are verified: you can withdraw your earnings.',
      descTodo: 'To withdraw your earnings, verify your identity and bank. Do it whenever you like — it never blocks your earnings.',
      cta: 'Set up withdrawals',
    },
  },
  es: {
    affiliateAccount: {
      title: 'Cuenta creada',
      desc: 'Su cuenta de afiliado está activa y ha iniciado sesión.',
    },
    affiliateLink: {
      title: 'Su enlace de afiliado está activo',
      desc: 'Comparta su enlace ahora mismo: sus ganancias se contabilizan de inmediato.',
      cta: 'Ver mi enlace',
    },
    affiliateWithdraw: {
      title: 'Prepare sus retiros',
      descReady: 'Su identidad y su banco están verificados: ya puede retirar sus ganancias.',
      descTodo: 'Para retirar sus ganancias, verifique su identidad y su banco. Hágalo cuando quiera: no bloquea sus ganancias.',
      cta: 'Configurar mis retiros',
    },
  },
  it: {
    affiliateAccount: {
      title: 'Account creato',
      desc: 'Il suo account affiliato è attivo ed è connesso.',
    },
    affiliateLink: {
      title: 'Il suo link di affiliazione è attivo',
      desc: 'Condivida subito il suo link: i suoi guadagni vengono conteggiati immediatamente.',
      cta: 'Vedi il mio link',
    },
    affiliateWithdraw: {
      title: 'Prepari i suoi prelievi',
      descReady: 'La sua identità e la sua banca sono verificate: può prelevare i suoi guadagni.',
      descTodo: 'Per prelevare i suoi guadagni, verifichi la sua identità e la sua banca. Lo faccia quando vuole: non blocca i suoi guadagni.',
      cta: 'Configurare i prelievi',
    },
  },
  ar: {
    affiliateAccount: {
      title: 'تم إنشاء الحساب',
      desc: 'حساب الإحالة الخاص بك مفعّل وأنت متصل.',
    },
    affiliateLink: {
      title: 'رابط الإحالة الخاص بك مفعّل',
      desc: 'شارِك رابطك الآن: تُحتسب أرباحك على الفور.',
      cta: 'عرض رابطي',
    },
    affiliateWithdraw: {
      title: 'جهّز عمليات السحب',
      descReady: 'تم التحقق من هويتك وبنكك: يمكنك سحب أرباحك.',
      descTodo: 'لسحب أرباحك، تحقّق من هويتك وبنكك. يمكنك ذلك متى شئت — فهو لا يوقف أرباحك.',
      cta: 'إعداد عمليات السحب',
    },
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
  console.log(`✓ ${loc}: activation.steps.affiliate*`)
}
console.log(`Done — ${changed} locale files updated.`)
