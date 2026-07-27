// Seed i18n — PROMO V2 Slice 1 : types intelligents + anti-gaspi.
//   promotions.*     → formulaire resto (nouveaux types) + encart anti-gaspi
//   eat.restaurant.* → bandeau/pills fiche conso (2e article, palier, flash)
//   eat.cart.*       → incitation palier « Ajoutez X€ pour … »
//
// Usage: node scripts/seed-promo-v2-i18n.js   puis   npm run check:i18n

const fs = require('fs')
const path = require('path')

const KEYS = {
  fr: {
    promotions: {
      typeSecondItem:    '2e article',
      typeThreshold:     'Palier',
      fieldValueSecondItem: 'Remise sur le 2e article (%)',
      fieldThreshold:    'Seuil du palier (€)',
      rewardPercent:     'Remise %',
      rewardFreeItem:    'Article offert',
      fieldRewardPct:    'Remise au palier (%)',
      fieldFreeItems:    'Article(s) pouvant être offert(s)',
      fieldFreeItemsHint:'Le moins cher de cette sélection présent au panier sera offert.',
      valueSecondItem:   '2e à −{value}%',
      valueThreshold:    'dès {amount}',
      agBtn:             'Anti-gaspi',
      agTitle:           'Stock à écouler',
      agIntro:           'Sélectionnez les articles proches de péremption : on prépare une promo flash pré-remplie, vous lancez en un clic.',
      agItems:           'Articles à écouler',
      agExpiry:          'À écouler avant',
      agPctLabel:        'Remise (%)',
      agSuggestHint:     'Suggestion : −{pct}% jusqu’à la péremption. Ajustez si besoin.',
      agLaunch:          'Lancer la flash',
      agLaunchedOk:      'Promo anti-gaspi lancée ✓',
      agName:            'Anti-gaspi — stock à écouler',
    },
    restaurant: {
      promoSecondItem:   '🏷️ 2e article à −{pct}%',
      promoThresholdFree:'🏷️ Un article offert dès {min} €',
      promoThresholdPct: '🏷️ −{pct}% dès {min} €',
      promoFlashUntil:   'jusqu’à {time}',
      promoPillSecond:   '2e à −{pct}%',
    },
    cart: {
      thresholdIncentive:'Ajoutez {amount} € pour {reward}',
      rewardFreeItemShort:'un article offert',
      rewardPctShort:    '−{pct}%',
    },
  },
  en: {
    promotions: {
      typeSecondItem:    '2nd item',
      typeThreshold:     'Threshold',
      fieldValueSecondItem: 'Discount on the 2nd item (%)',
      fieldThreshold:    'Threshold amount (€)',
      rewardPercent:     '% off',
      rewardFreeItem:    'Free item',
      fieldRewardPct:    'Reward discount (%)',
      fieldFreeItems:    'Item(s) eligible to be offered',
      fieldFreeItemsHint:'The cheapest of this selection present in the cart will be free.',
      valueSecondItem:   '2nd at −{value}%',
      valueThreshold:    'from {amount}',
      agBtn:             'Anti-waste',
      agTitle:           'Stock to clear',
      agIntro:           'Select the items nearing expiry: we prepare a pre-filled flash promo, you launch it in one click.',
      agItems:           'Items to clear',
      agExpiry:          'Clear before',
      agPctLabel:        'Discount (%)',
      agSuggestHint:     'Suggestion: −{pct}% until expiry. Adjust if needed.',
      agLaunch:          'Launch the flash',
      agLaunchedOk:      'Anti-waste promo launched ✓',
      agName:            'Anti-waste — stock to clear',
    },
    restaurant: {
      promoSecondItem:   '🏷️ 2nd item at −{pct}%',
      promoThresholdFree:'🏷️ A free item from €{min}',
      promoThresholdPct: '🏷️ −{pct}% from €{min}',
      promoFlashUntil:   'until {time}',
      promoPillSecond:   '2nd at −{pct}%',
    },
    cart: {
      thresholdIncentive:'Add €{amount} for {reward}',
      rewardFreeItemShort:'a free item',
      rewardPctShort:    '−{pct}%',
    },
  },
  es: {
    promotions: {
      typeSecondItem:    '2º artículo',
      typeThreshold:     'Umbral',
      fieldValueSecondItem: 'Descuento en el 2º artículo (%)',
      fieldThreshold:    'Importe del umbral (€)',
      rewardPercent:     '% dto.',
      rewardFreeItem:    'Artículo gratis',
      fieldRewardPct:    'Descuento del umbral (%)',
      fieldFreeItems:    'Artículo(s) que se pueden regalar',
      fieldFreeItemsHint:'El más barato de esta selección presente en el carrito será gratis.',
      valueSecondItem:   '2º a −{value}%',
      valueThreshold:    'desde {amount}',
      agBtn:             'Antidesperdicio',
      agTitle:           'Stock a liquidar',
      agIntro:           'Selecciona los artículos próximos a caducar: preparamos una promo flash precargada y la lanzas en un clic.',
      agItems:           'Artículos a liquidar',
      agExpiry:          'Liquidar antes de',
      agPctLabel:        'Descuento (%)',
      agSuggestHint:     'Sugerencia: −{pct}% hasta la caducidad. Ajústalo si quieres.',
      agLaunch:          'Lanzar la flash',
      agLaunchedOk:      'Promo antidesperdicio lanzada ✓',
      agName:            'Antidesperdicio — stock a liquidar',
    },
    restaurant: {
      promoSecondItem:   '🏷️ 2º artículo a −{pct}%',
      promoThresholdFree:'🏷️ Un artículo gratis desde {min} €',
      promoThresholdPct: '🏷️ −{pct}% desde {min} €',
      promoFlashUntil:   'hasta las {time}',
      promoPillSecond:   '2º a −{pct}%',
    },
    cart: {
      thresholdIncentive:'Añade {amount} € para {reward}',
      rewardFreeItemShort:'un artículo gratis',
      rewardPctShort:    '−{pct}%',
    },
  },
  it: {
    promotions: {
      typeSecondItem:    '2º articolo',
      typeThreshold:     'Soglia',
      fieldValueSecondItem: 'Sconto sul 2º articolo (%)',
      fieldThreshold:    'Importo della soglia (€)',
      rewardPercent:     '% sconto',
      rewardFreeItem:    'Articolo omaggio',
      fieldRewardPct:    'Sconto alla soglia (%)',
      fieldFreeItems:    'Articolo/i che possono essere offerti',
      fieldFreeItemsHint:'Il più economico di questa selezione presente nel carrello sarà offerto.',
      valueSecondItem:   '2º a −{value}%',
      valueThreshold:    'da {amount}',
      agBtn:             'Anti-spreco',
      agTitle:           'Stock da smaltire',
      agIntro:           'Seleziona gli articoli in scadenza: prepariamo una promo flash precompilata, la lanci in un clic.',
      agItems:           'Articoli da smaltire',
      agExpiry:          'Smaltire entro',
      agPctLabel:        'Sconto (%)',
      agSuggestHint:     'Suggerimento: −{pct}% fino alla scadenza. Modifica se serve.',
      agLaunch:          'Lancia la flash',
      agLaunchedOk:      'Promo anti-spreco lanciata ✓',
      agName:            'Anti-spreco — stock da smaltire',
    },
    restaurant: {
      promoSecondItem:   '🏷️ 2º articolo a −{pct}%',
      promoThresholdFree:'🏷️ Un articolo omaggio da {min} €',
      promoThresholdPct: '🏷️ −{pct}% da {min} €',
      promoFlashUntil:   'fino alle {time}',
      promoPillSecond:   '2º a −{pct}%',
    },
    cart: {
      thresholdIncentive:'Aggiungi {amount} € per {reward}',
      rewardFreeItemShort:'un articolo omaggio',
      rewardPctShort:    '−{pct}%',
    },
  },
  ar: {
    promotions: {
      typeSecondItem:    'الصنف الثاني',
      typeThreshold:     'عتبة',
      fieldValueSecondItem: 'خصم على الصنف الثاني (%)',
      fieldThreshold:    'قيمة العتبة (€)',
      rewardPercent:     'خصم %',
      rewardFreeItem:    'صنف مجاني',
      fieldRewardPct:    'خصم العتبة (%)',
      fieldFreeItems:    'الأصناف التي يمكن تقديمها مجانًا',
      fieldFreeItemsHint:'الأرخص من هذا التحديد الموجود في السلة سيكون مجانيًا.',
      valueSecondItem:   'الثاني بـ −{value}%',
      valueThreshold:    'من {amount}',
      agBtn:             'مكافحة الهدر',
      agTitle:           'مخزون للتصريف',
      agIntro:           'اختر الأصناف القريبة من انتهاء الصلاحية: نجهّز عرضًا سريعًا معبأً مسبقًا، تطلقه بنقرة واحدة.',
      agItems:           'الأصناف للتصريف',
      agExpiry:          'التصريف قبل',
      agPctLabel:        'الخصم (%)',
      agSuggestHint:     'اقتراح: −{pct}% حتى انتهاء الصلاحية. عدّل إن لزم.',
      agLaunch:          'إطلاق العرض السريع',
      agLaunchedOk:      'تم إطلاق عرض مكافحة الهدر ✓',
      agName:            'مكافحة الهدر — مخزون للتصريف',
    },
    restaurant: {
      promoSecondItem:   '🏷️ الصنف الثاني بـ −{pct}%',
      promoThresholdFree:'🏷️ صنف مجاني ابتداءً من {min} €',
      promoThresholdPct: '🏷️ −{pct}% ابتداءً من {min} €',
      promoFlashUntil:   'حتى {time}',
      promoPillSecond:   'الثاني بـ −{pct}%',
    },
    cart: {
      thresholdIncentive:'أضف {amount} € للحصول على {reward}',
      rewardFreeItemShort:'صنف مجاني',
      rewardPctShort:    '−{pct}%',
    },
  },
}

for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!m.promotions) m.promotions = {}
  Object.assign(m.promotions, KEYS[loc].promotions)
  if (!m.eat) m.eat = {}
  if (!m.eat.restaurant) m.eat.restaurant = {}
  Object.assign(m.eat.restaurant, KEYS[loc].restaurant)
  if (!m.eat.cart) m.eat.cart = {}
  Object.assign(m.eat.cart, KEYS[loc].cart)
  fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`[seed-promo-v2-i18n] ${loc}.json OK`)
}
console.log('[seed-promo-v2-i18n] Done — run: npm run check:i18n')
