// Seed i18n — retrait de la fausse promo FRENCH10 (Agent 13, décision fondateur
// post-audit C3-fix §4).
// - SUPPRIME les 5 clés eat.cart du bloc promo retiré (dont le placeholder
//   « essayez FRENCH10 ») — usage unique vérifié par grep.
// - AJOUTE eat.promos.soonTitle/soonBody pour la vitrine neutralisée (les
//   autres clés eat.promos restent : suppression risquée sans audit des accès
//   dynamiques — purge à un ménage futur).
//
// Usage: node scripts/seed-retrait-promo-i18n.js   puis   npm run check:i18n

const fs = require('fs')
const path = require('path')

const DELETE_CART_KEYS = ['promoPlaceholder', 'apply', 'toastPromoApplied', 'toastPromoInvalid', 'discount']

const NEW_PROMOS = {
  fr: {
    soonTitle: 'Les promotions arrivent bientôt',
    soonBody:  'Les restaurants pourront bientôt vous proposer de vraies offres ici. En attendant, votre remise de bienvenue s’applique automatiquement au paiement.',
  },
  en: {
    soonTitle: 'Promotions are coming soon',
    soonBody:  'Restaurants will soon offer real deals here. Meanwhile, your welcome discount is applied automatically at checkout.',
  },
  es: {
    soonTitle: 'Las promociones llegan pronto',
    soonBody:  'Los restaurantes pronto podrán ofrecerte ofertas reales aquí. Mientras tanto, tu descuento de bienvenida se aplica automáticamente al pagar.',
  },
  it: {
    soonTitle: 'Le promozioni arrivano presto',
    soonBody:  'I ristoranti potranno presto proporti vere offerte qui. Nel frattempo, il tuo sconto di benvenuto si applica automaticamente al pagamento.',
  },
  ar: {
    soonTitle: 'العروض قادمة قريبًا',
    soonBody:  'ستتمكن المطاعم قريبًا من تقديم عروض حقيقية هنا. في الأثناء، يُطبَّق خصم الترحيب تلقائيًا عند الدفع.',
  },
}

for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (m.eat?.cart) for (const k of DELETE_CART_KEYS) delete m.eat.cart[k]
  if (!m.eat) m.eat = {}
  if (!m.eat.promos) m.eat.promos = {}
  Object.assign(m.eat.promos, NEW_PROMOS[loc])
  fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`[seed-retrait-promo-i18n] ${loc}.json OK`)
}
console.log('[seed-retrait-promo-i18n] Done — run: npm run check:i18n')
