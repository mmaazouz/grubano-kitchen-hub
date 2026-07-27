// Seed i18n — MISSION 4 CREATOR STUDIO : marketplace vivante + ⭐ Étoiles Grubano.
//   menu.adopt.*     → conditions lues config + état offre waitlist (resto)
//   creators.stars.* → badge + carte studio de progression
//   creators.editor.* (additif) → accordéon adopteurs analytique
//
// Usage: node scripts/seed-marketplace-stars-i18n.js   puis   npm run check:i18n

const fs = require('fs')
const path = require('path')

const KEYS = {
  fr: {
    adopt: {
      commitmentDays:      'Engagement {days} jours',
      commitmentNoteDays:  'Engagement minimum {days} jours · tu peux retirer librement une recette qui ne décolle pas.',
      offerAvailable:      'Exclusivité disponible — expire dans {hours} h',
      offerAccept:         'Adopter',
      offerDecline:        'Refuser',
      offerDeclined:       'Offre refusée',
      declinedToast:       'Offre refusée — elle passe au restaurant suivant.',
    },
    stars: {
      legend:        'Étoiles Grubano — performance mesurée sur les ventes réelles',
      aria:          '{count, plural, =1 {1 étoile} other {# étoiles}} Grubano',
      studioTitle:   'Vos étoiles Grubano',
      none:          'Aucune étoile',
      firstStar:     'Votre première étoile arrive dès votre première adoption active.',
      maxReached:    'Niveau maximum atteint — bravo !',
      progressBoth:  'Encore {restos, plural, =1 {1 restaurant} other {# restaurants}} et {sales, plural, =1 {1 vente} other {# ventes}} pour le niveau suivant.',
      progressRestos:'Encore {restos, plural, =1 {1 restaurant} other {# restaurants}} pour le niveau suivant.',
      progressSales: 'Encore {sales, plural, =1 {1 vente} other {# ventes}} pour le niveau suivant.',
      progressAlmost:'Plus très loin du niveau suivant !',
    },
    editor: {
      adoptersToggle:  '{count, plural, =1 {1 adopteur} other {# adopteurs}}',
      adopterSince:    'depuis le {date}',
      adopterSales:    '{count, plural, =1 {1 vente} other {# ventes}}',
      adopterRevenue:  'CA',
      adopterEarnings: 'Gains',
    },
  },
  en: {
    adopt: {
      commitmentDays:      '{days}-day commitment',
      commitmentNoteDays:  'Minimum {days}-day commitment · you can freely drop a recipe that doesn’t take off.',
      offerAvailable:      'Exclusivity available — expires in {hours} h',
      offerAccept:         'Adopt',
      offerDecline:        'Decline',
      offerDeclined:       'Offer declined',
      declinedToast:       'Offer declined — it moves to the next restaurant.',
    },
    stars: {
      legend:        'Grubano Stars — performance measured on real sales',
      aria:          '{count, plural, =1 {1 star} other {# stars}} Grubano',
      studioTitle:   'Your Grubano stars',
      none:          'No star yet',
      firstStar:     'Your first star arrives with your first active adoption.',
      maxReached:    'Top level reached — well done!',
      progressBoth:  '{restos, plural, =1 {1 more restaurant} other {# more restaurants}} and {sales, plural, =1 {1 more sale} other {# more sales}} for the next level.',
      progressRestos:'{restos, plural, =1 {1 more restaurant} other {# more restaurants}} for the next level.',
      progressSales: '{sales, plural, =1 {1 more sale} other {# more sales}} for the next level.',
      progressAlmost:'Almost at the next level!',
    },
    editor: {
      adoptersToggle:  '{count, plural, =1 {1 adopter} other {# adopters}}',
      adopterSince:    'since {date}',
      adopterSales:    '{count, plural, =1 {1 sale} other {# sales}}',
      adopterRevenue:  'Revenue',
      adopterEarnings: 'Earnings',
    },
  },
  es: {
    adopt: {
      commitmentDays:      'Compromiso de {days} días',
      commitmentNoteDays:  'Compromiso mínimo de {days} días · puedes retirar libremente una receta que no despega.',
      offerAvailable:      'Exclusividad disponible — caduca en {hours} h',
      offerAccept:         'Adoptar',
      offerDecline:        'Rechazar',
      offerDeclined:       'Oferta rechazada',
      declinedToast:       'Oferta rechazada — pasa al siguiente restaurante.',
    },
    stars: {
      legend:        'Estrellas Grubano — rendimiento medido en ventas reales',
      aria:          '{count, plural, =1 {1 estrella} other {# estrellas}} Grubano',
      studioTitle:   'Tus estrellas Grubano',
      none:          'Sin estrellas',
      firstStar:     'Tu primera estrella llega con tu primera adopción activa.',
      maxReached:    'Nivel máximo alcanzado — ¡enhorabuena!',
      progressBoth:  '{restos, plural, =1 {1 restaurante más} other {# restaurantes más}} y {sales, plural, =1 {1 venta más} other {# ventas más}} para el siguiente nivel.',
      progressRestos:'{restos, plural, =1 {1 restaurante más} other {# restaurantes más}} para el siguiente nivel.',
      progressSales: '{sales, plural, =1 {1 venta más} other {# ventas más}} para el siguiente nivel.',
      progressAlmost:'¡Casi en el siguiente nivel!',
    },
    editor: {
      adoptersToggle:  '{count, plural, =1 {1 adoptante} other {# adoptantes}}',
      adopterSince:    'desde el {date}',
      adopterSales:    '{count, plural, =1 {1 venta} other {# ventas}}',
      adopterRevenue:  'Ingresos',
      adopterEarnings: 'Ganancias',
    },
  },
  it: {
    adopt: {
      commitmentDays:      'Impegno di {days} giorni',
      commitmentNoteDays:  'Impegno minimo di {days} giorni · puoi ritirare liberamente una ricetta che non decolla.',
      offerAvailable:      'Esclusiva disponibile — scade tra {hours} h',
      offerAccept:         'Adottare',
      offerDecline:        'Rifiutare',
      offerDeclined:       'Offerta rifiutata',
      declinedToast:       'Offerta rifiutata — passa al ristorante successivo.',
    },
    stars: {
      legend:        'Stelle Grubano — performance misurata sulle vendite reali',
      aria:          '{count, plural, =1 {1 stella} other {# stelle}} Grubano',
      studioTitle:   'Le tue stelle Grubano',
      none:          'Nessuna stella',
      firstStar:     'La tua prima stella arriva con la tua prima adozione attiva.',
      maxReached:    'Livello massimo raggiunto — bravo!',
      progressBoth:  'Ancora {restos, plural, =1 {1 ristorante} other {# ristoranti}} e {sales, plural, =1 {1 vendita} other {# vendite}} per il livello successivo.',
      progressRestos:'Ancora {restos, plural, =1 {1 ristorante} other {# ristoranti}} per il livello successivo.',
      progressSales: 'Ancora {sales, plural, =1 {1 vendita} other {# vendite}} per il livello successivo.',
      progressAlmost:'Quasi al livello successivo!',
    },
    editor: {
      adoptersToggle:  '{count, plural, =1 {1 adottante} other {# adottanti}}',
      adopterSince:    'dal {date}',
      adopterSales:    '{count, plural, =1 {1 vendita} other {# vendite}}',
      adopterRevenue:  'Fatturato',
      adopterEarnings: 'Guadagni',
    },
  },
  ar: {
    adopt: {
      commitmentDays:      'التزام {days} يومًا',
      commitmentNoteDays:  'التزام بحد أدنى {days} يومًا · يمكنك سحب وصفة لا تنجح بحرية.',
      offerAvailable:      'حصرية متاحة — تنتهي خلال {hours} ساعة',
      offerAccept:         'تبنّي',
      offerDecline:        'رفض',
      offerDeclined:       'تم رفض العرض',
      declinedToast:       'تم رفض العرض — ينتقل إلى المطعم التالي.',
    },
    stars: {
      legend:        'نجوم غروبانو — أداء يُقاس على المبيعات الحقيقية',
      aria:          '{count, plural, =1 {نجمة واحدة} other {# نجوم}} غروبانو',
      studioTitle:   'نجومك في غروبانو',
      none:          'لا نجوم بعد',
      firstStar:     'تصلك نجمتك الأولى مع أول تبنٍّ نشط.',
      maxReached:    'بلغت أعلى مستوى — أحسنت!',
      progressBoth:  'تبقّى {restos, plural, =1 {مطعم واحد} other {# مطاعم}} و{sales, plural, =1 {بيع واحد} other {# مبيعات}} للمستوى التالي.',
      progressRestos:'تبقّى {restos, plural, =1 {مطعم واحد} other {# مطاعم}} للمستوى التالي.',
      progressSales: 'تبقّى {sales, plural, =1 {بيع واحد} other {# مبيعات}} للمستوى التالي.',
      progressAlmost:'اقتربت من المستوى التالي!',
    },
    editor: {
      adoptersToggle:  '{count, plural, =1 {متبنٍّ واحد} other {# متبنّين}}',
      adopterSince:    'منذ {date}',
      adopterSales:    '{count, plural, =1 {بيع واحد} other {# مبيعات}}',
      adopterRevenue:  'الإيرادات',
      adopterEarnings: 'الأرباح',
    },
  },
}

for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(file, 'utf8'))

  if (!m.menu) m.menu = {}
  if (!m.menu.adopt) m.menu.adopt = {}
  Object.assign(m.menu.adopt, KEYS[loc].adopt)

  if (!m.creators) m.creators = {}
  if (!m.creators.stars) m.creators.stars = {}
  Object.assign(m.creators.stars, KEYS[loc].stars)
  if (!m.creators.editor) m.creators.editor = {}
  Object.assign(m.creators.editor, KEYS[loc].editor)

  fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`[seed-marketplace-stars-i18n] ${loc}.json OK`)
}
console.log('[seed-marketplace-stars-i18n] Done — run: npm run check:i18n')
