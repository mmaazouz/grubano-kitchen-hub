// Seed i18n — CHANTIER PROMOS P2 : les surfaces client.
//   eat.restaurant.* → bandeau fiche + pills plats ciblés
//   eat.cart.*       → incitation minOrder
//   eat.checkout.*   → ligne promo nommée (réponse serveur)
//   eat.promos.*     → la vitrine réelle (+ PURGE des clés de fausses promos C3)
//   eat.home.*       → bannière réelle (+ PURGE des bannières statiques mortes)
//
// Usage: node scripts/seed-promos-client-i18n.js   puis   npm run check:i18n

const fs = require('fs')
const path = require('path')

// Dead keys (0 references after P2) — the fake-offer leftovers DIE everywhere.
const PURGE = {
  'eat.home': [
    'bannerWeekendTag', 'bannerWeekendTitle', 'bannerNewTag', 'bannerNewTitle',
    'bannerFreeTag', 'bannerFreeTitle',
  ],
  'eat.promos': [
    'heroWeekendTag', 'heroWeekendTitle', 'heroNewTag', 'heroNewTitle',
    'heroFreeTag', 'heroFreeTitle', 'upTo', 'promoCodes',
    'code1Desc', 'code1Sub', 'code2Desc', 'code2Sub', 'code3Desc', 'code3Sub',
    'copiedToast', 'footerHint', 'badgePromo', 'badgeFreeDelivery', 'badgeNew',
    'badgeTrending', 'badgeDiscount', 'soonTitle', 'soonBody',
  ],
}

const KEYS = {
  fr: {
    restaurant: {
      promoPercentAll: '🏷️ −{pct} % sur toute la carte',
      promoPercentMin: '🏷️ −{pct} % dès {min} € de commande',
      promoFixedAll:   '🏷️ −{eur} € sur votre commande',
      promoFixedMin:   '🏷️ −{eur} € dès {min} € de commande',
      promoPill:       '−{pct} %',
      promoPillFixed:  '−{eur} €',
    },
    cart:     { promoIncentive: 'Encore {amount} € pour profiter de « {name} »' },
    checkout: { promoLine: 'Promo {name}' },
    promos: {
      emptyTitle:      'Pas d’offres en ce moment',
      emptyBody:       'Les restaurants n’ont pas de promotion active aujourd’hui — revenez vite !',
      offerPercent:    '−{pct} % sur la carte',
      offerPercentMin: '−{pct} % dès {min} €',
      offerFixed:      '−{eur} € sur la commande',
      offerFixedMin:   '−{eur} € dès {min} €',
      moreOffers:      '+{count, plural, =1 {1 offre} other {# offres}}',
    },
    home: {
      bannerRealTag:   'Offres en cours',
      bannerRealTitle: '{count, plural, =1 {1 vraie offre près de chez vous} other {# vraies offres près de chez vous}}',
    },
  },
  en: {
    restaurant: {
      promoPercentAll: '🏷️ −{pct}% on the whole menu',
      promoPercentMin: '🏷️ −{pct}% from €{min}',
      promoFixedAll:   '🏷️ −€{eur} on your order',
      promoFixedMin:   '🏷️ −€{eur} from €{min}',
      promoPill:       '−{pct}%',
      promoPillFixed:  '−€{eur}',
    },
    cart:     { promoIncentive: '€{amount} away from “{name}”' },
    checkout: { promoLine: 'Promo {name}' },
    promos: {
      emptyTitle:      'No offers right now',
      emptyBody:       'No restaurant has an active promotion today — check back soon!',
      offerPercent:    '−{pct}% on the menu',
      offerPercentMin: '−{pct}% from €{min}',
      offerFixed:      '−€{eur} on the order',
      offerFixedMin:   '−€{eur} from €{min}',
      moreOffers:      '+{count, plural, =1 {1 offer} other {# offers}}',
    },
    home: {
      bannerRealTag:   'Live offers',
      bannerRealTitle: '{count, plural, =1 {1 real offer near you} other {# real offers near you}}',
    },
  },
  es: {
    restaurant: {
      promoPercentAll: '🏷️ −{pct} % en toda la carta',
      promoPercentMin: '🏷️ −{pct} % desde {min} €',
      promoFixedAll:   '🏷️ −{eur} € en tu pedido',
      promoFixedMin:   '🏷️ −{eur} € desde {min} €',
      promoPill:       '−{pct} %',
      promoPillFixed:  '−{eur} €',
    },
    cart:     { promoIncentive: 'Te faltan {amount} € para disfrutar de «{name}»' },
    checkout: { promoLine: 'Promo {name}' },
    promos: {
      emptyTitle:      'Sin ofertas por ahora',
      emptyBody:       'Ningún restaurante tiene una promoción activa hoy — ¡vuelve pronto!',
      offerPercent:    '−{pct} % en la carta',
      offerPercentMin: '−{pct} % desde {min} €',
      offerFixed:      '−{eur} € en el pedido',
      offerFixedMin:   '−{eur} € desde {min} €',
      moreOffers:      '+{count, plural, =1 {1 oferta} other {# ofertas}}',
    },
    home: {
      bannerRealTag:   'Ofertas activas',
      bannerRealTitle: '{count, plural, =1 {1 oferta real cerca de ti} other {# ofertas reales cerca de ti}}',
    },
  },
  it: {
    restaurant: {
      promoPercentAll: '🏷️ −{pct} % su tutto il menu',
      promoPercentMin: '🏷️ −{pct} % da {min} €',
      promoFixedAll:   '🏷️ −{eur} € sul tuo ordine',
      promoFixedMin:   '🏷️ −{eur} € da {min} €',
      promoPill:       '−{pct} %',
      promoPillFixed:  '−{eur} €',
    },
    cart:     { promoIncentive: 'Ancora {amount} € per approfittare di «{name}»' },
    checkout: { promoLine: 'Promo {name}' },
    promos: {
      emptyTitle:      'Nessuna offerta al momento',
      emptyBody:       'Nessun ristorante ha una promozione attiva oggi — torna presto!',
      offerPercent:    '−{pct} % sul menu',
      offerPercentMin: '−{pct} % da {min} €',
      offerFixed:      '−{eur} € sull’ordine',
      offerFixedMin:   '−{eur} € da {min} €',
      moreOffers:      '+{count, plural, =1 {1 offerta} other {# offerte}}',
    },
    home: {
      bannerRealTag:   'Offerte in corso',
      bannerRealTitle: '{count, plural, =1 {1 offerta vera vicino a te} other {# offerte vere vicino a te}}',
    },
  },
  ar: {
    restaurant: {
      promoPercentAll: '🏷️ خصم {pct}٪ على كامل القائمة',
      promoPercentMin: '🏷️ خصم {pct}٪ ابتداءً من {min} €',
      promoFixedAll:   '🏷️ خصم {eur} € على طلبك',
      promoFixedMin:   '🏷️ خصم {eur} € ابتداءً من {min} €',
      promoPill:       '−{pct}٪',
      promoPillFixed:  '−{eur} €',
    },
    cart:     { promoIncentive: 'تبقّى {amount} € للاستفادة من «{name}»' },
    checkout: { promoLine: 'عرض {name}' },
    promos: {
      emptyTitle:      'لا عروض حاليًا',
      emptyBody:       'لا يوجد مطعم لديه عرض نشط اليوم — عد قريبًا!',
      offerPercent:    'خصم {pct}٪ على القائمة',
      offerPercentMin: 'خصم {pct}٪ ابتداءً من {min} €',
      offerFixed:      'خصم {eur} € على الطلب',
      offerFixedMin:   'خصم {eur} € ابتداءً من {min} €',
      moreOffers:      '+{count, plural, =1 {عرض واحد} other {# عروض}}',
    },
    home: {
      bannerRealTag:   'عروض جارية',
      bannerRealTitle: '{count, plural, =1 {عرض حقيقي واحد بالقرب منك} other {# عروض حقيقية بالقرب منك}}',
    },
  },
}

for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!m.eat) m.eat = {}

  for (const ns of ['restaurant', 'cart', 'checkout', 'promos', 'home']) {
    if (!m.eat[ns]) m.eat[ns] = {}
    Object.assign(m.eat[ns], KEYS[loc][ns])
  }
  for (const [nsPath, keys] of Object.entries(PURGE)) {
    const ns = nsPath.split('.')[1]
    if (!m.eat[ns]) continue
    for (const k of keys) delete m.eat[ns][k]
  }

  fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`[seed-promos-client-i18n] ${loc}.json OK`)
}
console.log('[seed-promos-client-i18n] Done — run: npm run check:i18n')
