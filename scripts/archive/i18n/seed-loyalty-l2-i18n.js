// Seed i18n — CHANTIER FIDÉLITÉ L2 : surfaces client.
//   eat.account.*  → équivalent crédit € + section « Mes points » (historique)
//   eat.cart.*     → crédit € du solde + message D3 (toggle grisé sous promo)
//   eat.checkout.* → ligne « Crédit fidélité » distincte de la promo
//
// Usage: node scripts/seed-loyalty-l2-i18n.js   puis   npm run check:i18n

const fs = require('fs')
const path = require('path')

const KEYS = {
  fr: {
    account: {
      creditEquivalent:  '= {amount} € de crédit',
      pointsHistoryTitle:'Mes points',
      histEarn:          'Points gagnés',
      histEarnOrder:     'Points gagnés — commande {ref}',
      histRedeem:        'Crédit utilisé',
      histRedeemOrder:   'Crédit utilisé — commande {ref}',
      histRefund:        'Points re-crédités',
      histRefundOrder:   'Remboursement — commande {ref}',
      ptsShort:          'pts',
      seeMore:           'Voir plus',
    },
    cart: {
      loyaltyBalanceEur:   '{amount} € de crédit',
      loyaltyPromoBlocked: 'Une promotion est déjà active — tes points restent disponibles pour une prochaine commande.',
    },
    checkout: {
      loyaltyLine:       'Crédit fidélité',
      loyaltyLinePoints: 'Crédit fidélité ({points} pts)',
    },
  },
  en: {
    account: {
      creditEquivalent:  '= {amount} € credit',
      pointsHistoryTitle:'My points',
      histEarn:          'Points earned',
      histEarnOrder:     'Points earned — order {ref}',
      histRedeem:        'Credit used',
      histRedeemOrder:   'Credit used — order {ref}',
      histRefund:        'Points re-credited',
      histRefundOrder:   'Refund — order {ref}',
      ptsShort:          'pts',
      seeMore:           'See more',
    },
    cart: {
      loyaltyBalanceEur:   '{amount} € credit',
      loyaltyPromoBlocked: 'A promotion is already active — your points stay available for a next order.',
    },
    checkout: {
      loyaltyLine:       'Loyalty credit',
      loyaltyLinePoints: 'Loyalty credit ({points} pts)',
    },
  },
  es: {
    account: {
      creditEquivalent:  '= {amount} € de crédito',
      pointsHistoryTitle:'Mis puntos',
      histEarn:          'Puntos ganados',
      histEarnOrder:     'Puntos ganados — pedido {ref}',
      histRedeem:        'Crédito utilizado',
      histRedeemOrder:   'Crédito utilizado — pedido {ref}',
      histRefund:        'Puntos reacreditados',
      histRefundOrder:   'Reembolso — pedido {ref}',
      ptsShort:          'pts',
      seeMore:           'Ver más',
    },
    cart: {
      loyaltyBalanceEur:   '{amount} € de crédito',
      loyaltyPromoBlocked: 'Ya hay una promoción activa — tus puntos siguen disponibles para un próximo pedido.',
    },
    checkout: {
      loyaltyLine:       'Crédito de fidelidad',
      loyaltyLinePoints: 'Crédito de fidelidad ({points} pts)',
    },
  },
  it: {
    account: {
      creditEquivalent:  '= {amount} € di credito',
      pointsHistoryTitle:'I miei punti',
      histEarn:          'Punti guadagnati',
      histEarnOrder:     'Punti guadagnati — ordine {ref}',
      histRedeem:        'Credito utilizzato',
      histRedeemOrder:   'Credito utilizzato — ordine {ref}',
      histRefund:        'Punti riaccreditati',
      histRefundOrder:   'Rimborso — ordine {ref}',
      ptsShort:          'pts',
      seeMore:           'Vedi altro',
    },
    cart: {
      loyaltyBalanceEur:   '{amount} € di credito',
      loyaltyPromoBlocked: 'Una promozione è già attiva — i tuoi punti restano disponibili per un prossimo ordine.',
    },
    checkout: {
      loyaltyLine:       'Credito fedeltà',
      loyaltyLinePoints: 'Credito fedeltà ({points} pts)',
    },
  },
  ar: {
    account: {
      creditEquivalent:  '= رصيد {amount} €',
      pointsHistoryTitle:'نقاطي',
      histEarn:          'نقاط مكتسبة',
      histEarnOrder:     'نقاط مكتسبة — الطلب {ref}',
      histRedeem:        'تم استخدام الرصيد',
      histRedeemOrder:   'تم استخدام الرصيد — الطلب {ref}',
      histRefund:        'إعادة احتساب النقاط',
      histRefundOrder:   'استرداد — الطلب {ref}',
      ptsShort:          'نقطة',
      seeMore:           'عرض المزيد',
    },
    cart: {
      loyaltyBalanceEur:   'رصيد {amount} €',
      loyaltyPromoBlocked: 'يوجد عرض ترويجي نشط بالفعل — تبقى نقاطك متاحة لطلب قادم.',
    },
    checkout: {
      loyaltyLine:       'رصيد الولاء',
      loyaltyLinePoints: 'رصيد الولاء ({points} نقطة)',
    },
  },
}

for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!m.eat) m.eat = {}
  for (const ns of ['account', 'cart', 'checkout']) {
    if (!m.eat[ns]) m.eat[ns] = {}
    Object.assign(m.eat[ns], KEYS[loc][ns])
  }
  fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`[seed-loyalty-l2-i18n] ${loc}.json OK`)
}
console.log('[seed-loyalty-l2-i18n] Done — run: npm run check:i18n')
