// Seed i18n — MISSION 7 PHASE 2 : purge des taux royalties en dur (« 4% »).
// Les libellés passent à l'interpolation {pct} — le taux RÉEL vient
// d'AdoptionConfig via les API M2/M4 dans chaque composant consommateur.
// creators.dashboard.subtitle (« Commission 4% ») : clé MORTE (0 consommateur,
// l'ancien dashboard a été remplacé en B1/M2) → SUPPRIMÉE ×5.
// + M7 vetting : creators.editor.toastSignature (score signature au toast).
//
// Usage: node scripts/seed-rate-purge-i18n.js   puis   npm run check:i18n

const fs = require('fs')
const path = require('path')

const KEYS = {
  fr: {
    creators: {
      heroSubtitle: 'Soumettez vos recettes · Des restaurants les adoptent · Gagnez {pct}% sur chaque vente',
      how3Title:    'Gagnez {pct}% sur chaque vente',
      how3Desc:     'Recevez automatiquement {pct}% du prix de vente chaque fois qu’un restaurant vend votre plat.',
    },
    recipesSubtitle: 'Crée une recette, un resto l’adopte, tu touches {pct}% sur chaque vente tant qu’elle est à sa carte.',
    adoptBenefit:    'Le créateur touche {pct} %, tu gardes le reste.',
    toastSignature:  'Signature : {score}/100',
  },
  en: {
    creators: {
      heroSubtitle: 'Submit your recipes · Restaurants adopt them · Earn {pct}% on every sale',
      how3Title:    'Earn {pct}% on every sale',
      how3Desc:     'Automatically receive {pct}% of the sale price each time a restaurant sells your dish.',
    },
    recipesSubtitle: 'Create a recipe, a restaurant adopts it, you earn {pct}% on every sale as long as it’s on the menu.',
    adoptBenefit:    'The creator earns {pct}%, you keep the rest.',
    toastSignature:  'Signature: {score}/100',
  },
  es: {
    creators: {
      heroSubtitle: 'Envía tus recetas · Los restaurantes las adoptan · Gana {pct}% en cada venta',
      how3Title:    'Gana {pct}% en cada venta',
      how3Desc:     'Recibe automáticamente el {pct}% del precio de venta cada vez que un restaurante vende tu plato.',
    },
    recipesSubtitle: 'Crea una receta, un restaurante la adopta, ganas el {pct}% en cada venta mientras esté en el menú.',
    adoptBenefit:    'El creador se lleva el {pct} %, tú te quedas con el resto.',
    toastSignature:  'Firma: {score}/100',
  },
  it: {
    creators: {
      heroSubtitle: 'Invia le tue ricette · I ristoranti le adottano · Guadagna il {pct}% su ogni vendita',
      how3Title:    'Guadagna il {pct}% su ogni vendita',
      how3Desc:     'Ricevi automaticamente il {pct}% del prezzo di vendita ogni volta che un ristorante vende il tuo piatto.',
    },
    recipesSubtitle: 'Crea una ricetta, un ristorante la adotta, guadagni il {pct}% su ogni vendita finché è nel menu.',
    adoptBenefit:    'Il creator guadagna il {pct}%, tu tieni il resto.',
    toastSignature:  'Firma: {score}/100',
  },
  ar: {
    creators: {
      heroSubtitle: 'شارك وصفاتك · المطاعم تتبناها · اكسب {pct}% من كل عملية بيع',
      how3Title:    'اكسب {pct}% من كل عملية بيع',
      how3Desc:     'تلقّ تلقائياً {pct}% من سعر البيع في كل مرة يبيع فيها مطعم طبقك.',
    },
    recipesSubtitle: 'أنشئ وصفة، يتبناها مطعم، تكسب {pct}% من كل بيع طالما كانت في القائمة.',
    adoptBenefit:    'يحصل المبدع على {pct}٪، وتحتفظ أنت بالباقي.',
    toastSignature:  'التوقيع: {score}/100',
  },
}

for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
  const file = path.join(__dirname, '..', 'messages', `${loc}.json`)
  const m = JSON.parse(fs.readFileSync(file, 'utf8'))

  Object.assign(m.creators, KEYS[loc].creators)
  m.creators.recipes.subtitle = KEYS[loc].recipesSubtitle
  m.menu.adopt.benefit        = KEYS[loc].adoptBenefit
  m.creators.editor.toastSignature = KEYS[loc].toastSignature
  // Dead key (0 consumers) — purged rather than parameterised.
  if (m.creators.dashboard) delete m.creators.dashboard.subtitle

  fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n', 'utf8')
  console.log(`[seed-rate-purge-i18n] ${loc}.json OK`)
}
console.log('[seed-rate-purge-i18n] Done — run: npm run check:i18n')
