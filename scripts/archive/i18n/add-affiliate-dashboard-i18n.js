// scripts/add-affiliate-dashboard-i18n.js — Brique C (Agent 60).
// Idempotent injector for the top-level `affiliate.*` dashboard keys (real
// dashboard: earnings/balance, click→conversion funnel, gamification) across
// the 5 locales, AND a symmetric purge of three now-orphaned key groups:
//   • affiliate.earningsSoonTitle / earningsSoonBody  (Brique A placeholder,
//     replaced by the real AffiliateDashboardClient)
//   • creators.nav.affiliateHub                       (legacy /audience nav
//     entry collapsed into the single 'affiliation' entry → /affiliate)
//   • creators.affiliation.*                          (the whole legacy
//     /audience namespace; the page now redirects to /creators/dashboard/affiliate)
//
// Tone matches the EXISTING affiliate.* namespace: FR vouvoiement, ES/IT
// informal (consumer register), real Arabic. Same merge-friendly pattern as
// seed-affiliate-i18n.js (reads disk, adds these keys, 2-space JSON + newline).
// Run: node scripts/add-affiliate-dashboard-i18n.js
'use strict'
const fs = require('fs')
const path = require('path')

const ADD = {
  fr: {
    statsTitle: 'Vos gains',
    balancePending: 'À venir', balanceMatured: 'Acquis', balanceAvailable: 'Disponible',
    commissionLine: 'Vous touchez {pct} % de la commission Grubano (sur la marge nette).',
    clicksTitle: 'Performance', clicks: 'Clics', conversions: 'Commandes', convRate: 'Taux de conversion',
    tierTitle: 'Palier', tierNext: 'Prochain palier : {tier}',
    streakValue: "{weeks, plural, one {# semaine d’affilée} other {# semaines d’affilée}}",
    badgesTitle: 'Badges',
    leaderboardTitle: 'Classement', leaderboardYou: 'Vous', myRank: 'Votre rang : {rank} / {total}',
    statsLoadError: 'Impossible de charger vos statistiques.',
    tier_bronze: 'Bronze', tier_silver: 'Argent', tier_gold: 'Or', tier_platinum: 'Platine',
    badge_firstSale: '1re vente', badge_tenCustomers: '10 clients', badge_hundredEuros: '100 € gagnés', badge_fiveHundredEuros: '500 € gagnés',
  },
  en: {
    statsTitle: 'Your earnings',
    balancePending: 'Upcoming', balanceMatured: 'Earned', balanceAvailable: 'Available',
    commissionLine: 'You earn {pct}% of the Grubano commission (on the net margin).',
    clicksTitle: 'Performance', clicks: 'Clicks', conversions: 'Orders', convRate: 'Conversion rate',
    tierTitle: 'Tier', tierNext: 'Next tier: {tier}',
    streakValue: '{weeks, plural, one {# week in a row} other {# weeks in a row}}',
    badgesTitle: 'Badges',
    leaderboardTitle: 'Leaderboard', leaderboardYou: 'You', myRank: 'Your rank: {rank} / {total}',
    statsLoadError: 'Could not load your statistics.',
    tier_bronze: 'Bronze', tier_silver: 'Silver', tier_gold: 'Gold', tier_platinum: 'Platinum',
    badge_firstSale: 'First sale', badge_tenCustomers: '10 customers', badge_hundredEuros: '€100 earned', badge_fiveHundredEuros: '€500 earned',
  },
  es: {
    statsTitle: 'Tus ganancias',
    balancePending: 'Próximo', balanceMatured: 'Ganado', balanceAvailable: 'Disponible',
    commissionLine: 'Recibes el {pct}% de la comisión de Grubano (sobre el margen neto).',
    clicksTitle: 'Rendimiento', clicks: 'Clics', conversions: 'Pedidos', convRate: 'Tasa de conversión',
    tierTitle: 'Nivel', tierNext: 'Siguiente nivel: {tier}',
    streakValue: '{weeks, plural, one {# semana seguida} other {# semanas seguidas}}',
    badgesTitle: 'Insignias',
    leaderboardTitle: 'Clasificación', leaderboardYou: 'Tú', myRank: 'Tu posición: {rank} / {total}',
    statsLoadError: 'No se pudieron cargar tus estadísticas.',
    tier_bronze: 'Bronce', tier_silver: 'Plata', tier_gold: 'Oro', tier_platinum: 'Platino',
    badge_firstSale: 'Primera venta', badge_tenCustomers: '10 clientes', badge_hundredEuros: '100 € ganados', badge_fiveHundredEuros: '500 € ganados',
  },
  it: {
    statsTitle: 'I tuoi guadagni',
    balancePending: 'In arrivo', balanceMatured: 'Maturato', balanceAvailable: 'Disponibile',
    commissionLine: 'Ricevi il {pct}% della commissione Grubano (sul margine netto).',
    clicksTitle: 'Performance', clicks: 'Clic', conversions: 'Ordini', convRate: 'Tasso di conversione',
    tierTitle: 'Livello', tierNext: 'Livello successivo: {tier}',
    streakValue: '{weeks, plural, one {# settimana di fila} other {# settimane di fila}}',
    badgesTitle: 'Badge',
    leaderboardTitle: 'Classifica', leaderboardYou: 'Tu', myRank: 'La tua posizione: {rank} / {total}',
    statsLoadError: 'Impossibile caricare le tue statistiche.',
    tier_bronze: 'Bronzo', tier_silver: 'Argento', tier_gold: 'Oro', tier_platinum: 'Platino',
    badge_firstSale: 'Prima vendita', badge_tenCustomers: '10 clienti', badge_hundredEuros: '100 € guadagnati', badge_fiveHundredEuros: '500 € guadagnati',
  },
  ar: {
    statsTitle: 'أرباحك',
    balancePending: 'قادم', balanceMatured: 'مكتسب', balanceAvailable: 'متاح',
    commissionLine: 'تحصل على {pct}٪ من عمولة Grubano (على الهامش الصافي).',
    clicksTitle: 'الأداء', clicks: 'النقرات', conversions: 'الطلبات', convRate: 'معدّل التحويل',
    tierTitle: 'المستوى', tierNext: 'المستوى التالي: {tier}',
    streakValue: '{weeks, plural, one {أسبوع متتالٍ} other {# أسابيع متتالية}}',
    badgesTitle: 'الشارات',
    leaderboardTitle: 'الترتيب', leaderboardYou: 'أنت', myRank: 'ترتيبك: {rank} / {total}',
    statsLoadError: 'تعذّر تحميل إحصاءاتك.',
    tier_bronze: 'برونزي', tier_silver: 'فضي', tier_gold: 'ذهبي', tier_platinum: 'بلاتيني',
    badge_firstSale: 'أول عملية بيع', badge_tenCustomers: '10 عملاء', badge_hundredEuros: '100 € مكتسبة', badge_fiveHundredEuros: '500 € مكتسبة',
  },
}

let changed = 0
for (const loc of Object.keys(ADD)) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8'))

  // ── ADD: top-level affiliate.* dashboard keys ───────────────────────────────
  json.affiliate = json.affiliate || {}
  Object.assign(json.affiliate, ADD[loc])

  // ── PURGE: now-orphaned keys (verified: no live code references) ─────────────
  delete json.affiliate.earningsSoonTitle
  delete json.affiliate.earningsSoonBody
  if (json.creators) {
    if (json.creators.nav) delete json.creators.nav.affiliateHub
    delete json.creators.affiliation
  }

  fs.writeFileSync(file, JSON.stringify(json, null, 2) + '\n', 'utf8')
  changed++
  console.log(`✓ ${loc}: +${Object.keys(ADD[loc]).length} affiliate.* keys; purged earningsSoon×2, nav.affiliateHub, creators.affiliation`)
}
console.log(`Done — ${changed} locale files updated.`)
