// scripts/add-creator-activation-i18n.js — Creator onboarding steps (Agent 100).
// Adds activation.steps.creatorAccount / creatorProfile / creatorPayout (the creator checklist
// labels read by OnboardingGuide via useTranslations('activation')). FR vouvoiement, real Arabic
// (RTL). Idempotent; 2-space JSON. NO money figure. Run: node scripts/add-creator-activation-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

const STEPS = {
  fr: {
    creatorAccount: {
      title: 'Compte créé',
      desc: 'Votre compte créateur est actif et vous êtes connecté.',
    },
    creatorProfile: {
      title: 'Complétez votre profil public',
      desc: 'Renseignez votre nom et votre bio : c’est ce que verra votre audience.',
      cta: 'Compléter mon profil',
    },
    creatorPayout: {
      title: 'Pour être payé : identité et banque',
      descReady: 'Votre identité et votre banque sont vérifiées : vous pouvez être payé.',
      descTodo: 'Pour recevoir vos gains, vérifiez votre identité et votre banque. À faire quand vous voulez — cela ne bloque pas votre activité.',
      cta: 'Configurer mes paiements',
    },
  },
  en: {
    creatorAccount: {
      title: 'Account created',
      desc: 'Your creator account is active and you are signed in.',
    },
    creatorProfile: {
      title: 'Complete your public profile',
      desc: 'Add your name and bio — this is what your audience will see.',
      cta: 'Complete my profile',
    },
    creatorPayout: {
      title: 'To get paid: identity and bank',
      descReady: 'Your identity and bank are verified: you can be paid.',
      descTodo: 'To receive your earnings, verify your identity and bank. Do it whenever you like — it never blocks your activity.',
      cta: 'Set up my payments',
    },
  },
  es: {
    creatorAccount: {
      title: 'Cuenta creada',
      desc: 'Su cuenta de creador está activa y ha iniciado sesión.',
    },
    creatorProfile: {
      title: 'Complete su perfil público',
      desc: 'Indique su nombre y su biografía: es lo que verá su audiencia.',
      cta: 'Completar mi perfil',
    },
    creatorPayout: {
      title: 'Para cobrar: identidad y banco',
      descReady: 'Su identidad y su banco están verificados: ya puede cobrar.',
      descTodo: 'Para recibir sus ganancias, verifique su identidad y su banco. Hágalo cuando quiera: no bloquea su actividad.',
      cta: 'Configurar mis pagos',
    },
  },
  it: {
    creatorAccount: {
      title: 'Account creato',
      desc: 'Il suo account creator è attivo ed è connesso.',
    },
    creatorProfile: {
      title: 'Completi il suo profilo pubblico',
      desc: 'Indichi il suo nome e la sua bio: è ciò che vedrà il suo pubblico.',
      cta: 'Completare il mio profilo',
    },
    creatorPayout: {
      title: 'Per essere pagato: identità e banca',
      descReady: 'La sua identità e la sua banca sono verificate: può essere pagato.',
      descTodo: 'Per ricevere i suoi guadagni, verifichi la sua identità e la sua banca. Lo faccia quando vuole: non blocca la sua attività.',
      cta: 'Configurare i miei pagamenti',
    },
  },
  ar: {
    creatorAccount: {
      title: 'تم إنشاء الحساب',
      desc: 'حساب المنشئ الخاص بك مفعّل وأنت متصل.',
    },
    creatorProfile: {
      title: 'أكمِل ملفك العام',
      desc: 'أدخِل اسمك ونبذتك: هذا ما سيراه جمهورك.',
      cta: 'إكمال ملفي',
    },
    creatorPayout: {
      title: 'لتتقاضى أجرك: الهوية والبنك',
      descReady: 'تم التحقق من هويتك وبنكك: يمكنك تلقّي أجرك.',
      descTodo: 'لتلقّي أرباحك، تحقّق من هويتك وبنكك. يمكنك ذلك متى شئت — فهو لا يوقف نشاطك.',
      cta: 'إعداد مدفوعاتي',
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
  console.log(`✓ ${loc}: activation.steps.creator*`)
}
console.log(`Done — ${changed} locale files updated.`)
