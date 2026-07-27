// scripts/add-influencer-upgrade-i18n.js — Influencer onboarding upgrade volet (Agent 99).
// Adds affiliate.upgrade* (the OPTIONAL "become an influencer" upgrade strip on the affiliate
// onboarding surface). FR vouvoiement, real Arabic (RTL). NO money figure (the rate stays the
// Agent 90 display). Idempotent; 2-space JSON. Run: node scripts/add-influencer-upgrade-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

const ADD = {
  fr: {
    upgradeTitle: 'Devenez influenceur',
    upgradeBody: 'Faites vérifier votre audience pour débloquer le meilleur taux. C’est facultatif : votre compte affilié reste complet sans cela.',
    upgradeCta: 'Faire vérifier mon audience',
    upgradePendingTitle: 'Vérification en cours',
    upgradePendingBody: 'Votre demande de vérification d’audience est en cours d’examen par notre équipe.',
    upgradeVerifiedTitle: 'Audience vérifiée',
    upgradeVerifiedBody: 'Vous êtes influenceur vérifié : vous bénéficiez du meilleur taux, affiché sur votre tableau de bord.',
  },
  en: {
    upgradeTitle: 'Become an influencer',
    upgradeBody: 'Get your audience verified to unlock the best rate. It’s optional — your affiliate account stays complete without it.',
    upgradeCta: 'Verify my audience',
    upgradePendingTitle: 'Verification in progress',
    upgradePendingBody: 'Your audience-verification request is being reviewed by our team.',
    upgradeVerifiedTitle: 'Audience verified',
    upgradeVerifiedBody: 'You are a verified influencer: you get the best rate, shown on your dashboard.',
  },
  es: {
    upgradeTitle: 'Conviértase en influencer',
    upgradeBody: 'Verifique su audiencia para desbloquear la mejor tarifa. Es opcional: su cuenta de afiliado sigue estando completa sin ello.',
    upgradeCta: 'Verificar mi audiencia',
    upgradePendingTitle: 'Verificación en curso',
    upgradePendingBody: 'Nuestro equipo está revisando su solicitud de verificación de audiencia.',
    upgradeVerifiedTitle: 'Audiencia verificada',
    upgradeVerifiedBody: 'Es usted influencer verificado: disfruta de la mejor tarifa, mostrada en su panel.',
  },
  it: {
    upgradeTitle: 'Diventi influencer',
    upgradeBody: 'Faccia verificare il suo pubblico per sbloccare la tariffa migliore. È facoltativo: il suo account affiliato resta completo anche senza.',
    upgradeCta: 'Verificare il mio pubblico',
    upgradePendingTitle: 'Verifica in corso',
    upgradePendingBody: 'La sua richiesta di verifica del pubblico è in fase di esame da parte del nostro team.',
    upgradeVerifiedTitle: 'Pubblico verificato',
    upgradeVerifiedBody: 'È un influencer verificato: beneficia della tariffa migliore, mostrata sulla sua dashboard.',
  },
  ar: {
    upgradeTitle: 'كن مؤثّرًا',
    upgradeBody: 'وثّق جمهورك لفتح أفضل نسبة. هذا اختياري: يبقى حساب الإحالة الخاص بك مكتملًا من دونه.',
    upgradeCta: 'توثيق جمهوري',
    upgradePendingTitle: 'التوثيق قيد المعالجة',
    upgradePendingBody: 'يقوم فريقنا بمراجعة طلب توثيق جمهورك.',
    upgradeVerifiedTitle: 'تم توثيق الجمهور',
    upgradeVerifiedBody: 'أنت مؤثّر موثَّق: تحصل على أفضل نسبة، معروضة في لوحة التحكم الخاصة بك.',
  },
}

let changed = 0
for (const loc of Object.keys(ADD)) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))
  json.affiliate = Object.assign({}, json.affiliate, ADD[loc])
  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
  console.log(`✓ ${loc}: affiliate.upgrade*`)
}
console.log(`Done — ${changed} locale files updated.`)
