#!/usr/bin/env node
/**
 * seed-qa-mock-parity.mjs — idempotent LOCAL/STAGING-ONLY parity seed for the
 * operator visual-QA baseline (mission « baseline propre », decision ❸).
 *
 * PRINCIPLE (dossier rule): les maquettes Claude Design sont la SOURCE — the QA
 * data follows them, never the other way round. Every row below is extracted
 * VERBATIM from the op-*.html mocks (see scratchpad mock-data-spec.json for the
 * per-value file:line provenance; the mocks themselves are the authority).
 *
 * ⚠️ TOOLING ONLY — ordinary Prisma rows, no app code, no schema change.
 * ⚠️ MONEY GUARD — the Finances screen is NEVER seeded (LedgerEntry/Payout come
 *    from real Stripe flows only); reservations keep depositStatus 'none' and
 *    no Stripe id (depositPaid is a display boolean, no rail is touched).
 * ⚠️ Same HARD guard as seed-qa-operator.mjs: --confirm-staging +
 *    QA_SEED_CONFIRM=STAGING_ONLY + test-ish QA_EMAIL + non-prod NEXTAUTH_URL.
 *
 * Scoped deletions (idempotency): only rows OWNED by the QA account are
 * realigned — menu items of the QA brand not in the mock's 30, stock rows not
 * in the mock's 8, and rows carrying the 'qa-parity' marker. Nothing outside
 * the QA operator's data is ever touched.
 *
 * Usage:
 *   QA_EMAIL='qa+op@grubano.test' QA_SEED_CONFIRM=STAGING_ONLY \
 *   node scripts/qa/seed-qa-mock-parity.mjs --confirm-staging
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const DATA = {
 "restaurant": {
  "name": "Mama Trattoria",
  "city": "Paris",
  "cuisine": [
   "italian"
  ],
  "isActive": true
 },
 "brandName": "Mama Trattoria",
 "customCategories": [
  "Pizzas"
 ],
 "menuItems": [
  {
   "name": "Burrata & tomates confites",
   "price": 12,
   "category": "Entrées",
   "description": "Burrata crémeuse, tomates confites, basilic",
   "available": true
  },
  {
   "name": "Bruschette al Pomodoro",
   "price": 8.5,
   "category": "Entrées",
   "description": "Pain grillé, tomates, ail, huile d'olive",
   "available": true
  },
  {
   "name": "Carpaccio de bœuf",
   "price": 14,
   "category": "Entrées",
   "description": "Fines tranches, roquette, copeaux de parmesan",
   "available": true
  },
  {
   "name": "Vitello Tonnato",
   "price": 13.5,
   "category": "Entrées",
   "description": "Veau froid, sauce thon-câpres",
   "available": false
  },
  {
   "name": "Truffle Tagliatelle",
   "price": 18,
   "category": "Plats",
   "description": "Egg pasta, black truffle, parmesan cream",
   "available": true
  },
  {
   "name": "Cacio e Pepe",
   "price": 15,
   "category": "Plats",
   "description": "Tonnarelli, pecorino, cracked pepper",
   "available": true
  },
  {
   "name": "Lasagne della Nonna",
   "price": 19,
   "category": "Plats",
   "description": "Slow ragù, béchamel, 24-month parmesan",
   "available": true
  },
  {
   "name": "Gnocchi Sorrentina",
   "price": 16,
   "category": "Plats",
   "description": "Potato gnocchi, tomato, basil, mozzarella",
   "available": false
  },
  {
   "name": "Risotto ai Funghi",
   "price": 17.5,
   "category": "Plats",
   "description": "Arborio rice, wild mushrooms, parmesan",
   "available": true
  },
  {
   "name": "Osso Buco",
   "price": 24,
   "category": "Plats",
   "description": "Braised veal shank, saffron risotto",
   "available": true
  },
  {
   "name": "Saltimbocca alla Romana",
   "price": 22,
   "category": "Plats",
   "description": "Veal, prosciutto, sage, white wine",
   "available": true
  },
  {
   "name": "Melanzane alla Parmigiana",
   "price": 15.5,
   "category": "Plats",
   "description": "Layered eggplant, tomato, mozzarella",
   "available": true
  },
  {
   "name": "Margherita DOP",
   "price": 14,
   "category": "Pizzas",
   "description": "Tomate San Marzano, mozzarella di bufala, basilic",
   "available": true
  },
  {
   "name": "Diavola",
   "price": 15.5,
   "category": "Pizzas",
   "description": "Tomate, mozzarella, salami piquant",
   "available": true
  },
  {
   "name": "Quattro Formaggi",
   "price": 16,
   "category": "Pizzas",
   "description": "Mozzarella, gorgonzola, fontina, parmesan",
   "available": true
  },
  {
   "name": "Prosciutto e Funghi",
   "price": 16.5,
   "category": "Pizzas",
   "description": "Jambon cru, champignons, mozzarella",
   "available": true
  },
  {
   "name": "Marinara",
   "price": 11,
   "category": "Pizzas",
   "description": "Tomate, ail, origan, huile d'olive",
   "available": true
  },
  {
   "name": "Tartufo",
   "price": 19,
   "category": "Pizzas",
   "description": "Crème de truffe, mozzarella, champignons",
   "available": false
  },
  {
   "name": "Tiramisu maison",
   "price": 8,
   "category": "Desserts",
   "description": "Mascarpone, café, cacao",
   "available": true
  },
  {
   "name": "Panna Cotta",
   "price": 7.5,
   "category": "Desserts",
   "description": "Vanille, coulis de fruits rouges",
   "available": true
  },
  {
   "name": "Cannoli Siciliani",
   "price": 8.5,
   "category": "Desserts",
   "description": "Ricotta sucrée, pistaches, chocolat",
   "available": true
  },
  {
   "name": "Affogato",
   "price": 6.5,
   "category": "Desserts",
   "description": "Glace vanille, espresso chaud",
   "available": true
  },
  {
   "name": "Torta Caprese",
   "price": 8,
   "category": "Desserts",
   "description": "Gâteau au chocolat sans farine, amandes",
   "available": true
  },
  {
   "name": "Chianti Classico (verre)",
   "price": 7,
   "category": "Boissons",
   "description": "Vin rouge toscan",
   "available": true
  },
  {
   "name": "Pinot Grigio (verre)",
   "price": 6.5,
   "category": "Boissons",
   "description": "Vin blanc frais",
   "available": true
  },
  {
   "name": "Eau plate / gazeuse",
   "price": 4,
   "category": "Boissons",
   "description": "75 cl",
   "available": true
  },
  {
   "name": "San Pellegrino",
   "price": 3.5,
   "category": "Boissons",
   "description": "33 cl",
   "available": true
  },
  {
   "name": "Espresso",
   "price": 2.5,
   "category": "Boissons",
   "description": "Café italien",
   "available": true
  },
  {
   "name": "Limonata",
   "price": 4.5,
   "category": "Boissons",
   "description": "Citron pressé maison",
   "available": true
  },
  {
   "name": "Amaro Digestivo",
   "price": 6,
   "category": "Boissons",
   "description": "Digestif italien",
   "available": false
  }
 ],
 "consumers": [
  {
   "name": "Sophie Martin",
   "email": "qa-sophie.martin@grubano.test"
  },
  {
   "name": "Julie Roussel",
   "email": "qa-julie.roussel@grubano.test"
  },
  {
   "name": "Karim Belhadj",
   "email": "qa-karim.belhadj@grubano.test"
  },
  {
   "name": "Marc Dubois",
   "email": "qa-marc.dubois@grubano.test"
  },
  {
   "name": "Amine Lahlou",
   "email": "qa-amine.lahlou@grubano.test"
  }
 ],
 "orders": [
  {
   "customer": "Sophie Martin",
   "items": [
    {
     "name": "Truffle Tagliatelle",
     "qty": 1
    },
    {
     "name": "Tiramisu",
     "qty": 1
    }
   ],
   "totalEUR": 28.4,
   "dayOffset": 0,
   "minBefore": 1,
   "status": "received",
   "fulfillment": "delivery",
   "address": "12 rue des Lilas, 75011"
  },
  {
   "customer": "Julie Roussel",
   "items": [
    {
     "name": "Lasagne della Nonna",
     "qty": 1
    },
    {
     "name": "Cacio e Pepe",
     "qty": 2
    },
    {
     "name": "Burrata",
     "qty": 1
    }
   ],
   "totalEUR": 41.5,
   "dayOffset": 0,
   "minBefore": 8,
   "status": "received",
   "fulfillment": "delivery",
   "address": "12 rue des Lilas, Apt 4B — 75011 Paris"
  },
  {
   "customer": "Karim Belhadj",
   "items": [
    {
     "name": "Diavola",
     "qty": 1
    },
    {
     "name": "Quattro Formaggi",
     "qty": 1
    },
    {
     "name": "Tiramisu",
     "qty": 1
    }
   ],
   "totalEUR": 22,
   "dayOffset": 0,
   "minBefore": 12,
   "status": "preparing",
   "fulfillment": "pickup",
   "address": null
  },
  {
   "customer": "Marc Dubois",
   "items": [
    {
     "name": "Osso Buco",
     "qty": 1
    },
    {
     "name": "Panna Cotta",
     "qty": 1
    }
   ],
   "totalEUR": 19.9,
   "dayOffset": 0,
   "minBefore": 22,
   "status": "ready",
   "fulfillment": "delivery",
   "address": "8 av. Foch, 75016"
  },
  {
   "customer": "Amine Lahlou",
   "items": [
    {
     "name": "Gnocchi Sorrentina",
     "qty": 2
    }
   ],
   "totalEUR": 19.9,
   "dayOffset": 0,
   "minBefore": 55,
   "status": "picked_up",
   "fulfillment": "pickup",
   "address": null
  },
  {
   "customer": "Amine Lahlou",
   "items": [],
   "totalEUR": null,
   "dayOffset": 0,
   "minBefore": null,
   "status": "picked_up",
   "fulfillment": "delivery",
   "address": "45 rue de Rivoli, 75004"
  },
  {
   "customer": "Julie Roussel",
   "items": [],
   "totalEUR": null,
   "dayOffset": 0,
   "minBefore": null,
   "status": "preparing",
   "fulfillment": "delivery",
   "address": "3 rue Oberkampf, 75011"
  }
 ],
 "loyalty": [
  {
   "name": "Sophie Martin",
   "tier": "platinum",
   "points": 4820,
   "phone": "06 12 34 56 78",
   "email": "sophie.martin@email.com",
   "createdAt": "2024-03-01",
   "ordersCount": 86,
   "totalSpentEUR": 2340,
   "lastVisitOffset": 1
  },
  {
   "name": "Karim Belhadj",
   "tier": "gold",
   "points": 2910,
   "phone": "06 45 67 89 10",
   "email": "karim.belhadj@email.com",
   "createdAt": "2023-06-01",
   "ordersCount": 54,
   "totalSpentEUR": 1480,
   "lastVisitOffset": 2
  },
  {
   "name": "Julie Roussel",
   "tier": "gold",
   "points": 2340,
   "phone": "06 78 90 12 34",
   "email": "julie.roussel@email.com",
   "createdAt": "2024-01-01",
   "ordersCount": 47,
   "totalSpentEUR": 1205,
   "lastVisitOffset": 7
  },
  {
   "name": "Marc Dubois",
   "tier": "silver",
   "points": 1120,
   "phone": "06 23 45 67 89",
   "email": "marc.dubois@email.com",
   "createdAt": "2024-09-01",
   "ordersCount": 22,
   "totalSpentEUR": 560,
   "lastVisitOffset": 15
  },
  {
   "name": "Amine Lahlou",
   "tier": "silver",
   "points": 820,
   "phone": "06 34 56 78 90",
   "email": "amine.lahlou@email.com",
   "createdAt": "2025-02-01",
   "ordersCount": 18,
   "totalSpentEUR": 410,
   "lastVisitOffset": 17
  },
  {
   "name": "Léa Fontaine",
   "tier": "bronze",
   "points": 280,
   "phone": "06 56 78 90 12",
   "email": "lea.fontaine@email.com",
   "createdAt": "2025-05-01",
   "ordersCount": 6,
   "totalSpentEUR": 142,
   "lastVisitOffset": 33
  },
  {
   "name": "Thomas Petit",
   "tier": "bronze",
   "points": 130,
   "phone": "06 67 89 01 23",
   "email": "thomas.petit@email.com",
   "createdAt": "2025-04-01",
   "ordersCount": 3,
   "totalSpentEUR": 68,
   "lastVisitOffset": 48
  }
 ],
 "tables": [
  {
   "name": "T1",
   "seats": 2
  },
  {
   "name": "T2",
   "seats": 2
  },
  {
   "name": "T3",
   "seats": 4
  },
  {
   "name": "T4",
   "seats": 4
  },
  {
   "name": "T5",
   "seats": 2
  },
  {
   "name": "T6",
   "seats": 2
  },
  {
   "name": "T7",
   "seats": 4
  },
  {
   "name": "T8",
   "seats": 4
  },
  {
   "name": "T9",
   "seats": 2
  },
  {
   "name": "T10",
   "seats": 6
  },
  {
   "name": "T11",
   "seats": 2
  },
  {
   "name": "T12",
   "seats": 6
  },
  {
   "name": "T13",
   "seats": 4
  },
  {
   "name": "T14",
   "seats": 4
  },
  {
   "name": "T15",
   "seats": 4
  },
  {
   "name": "T16",
   "seats": 2
  }
 ],
 "reservations": [
  {
   "customer": "Sophie Martin",
   "time": "12:00",
   "guests": 2,
   "table": "T4",
   "status": "confirmed",
   "phone": "06 12 34 56 78",
   "deposit": 0,
   "depositPaid": false
  },
  {
   "customer": "Karim Belhadj",
   "time": "12:30",
   "guests": 4,
   "table": "T7",
   "status": "arrived",
   "phone": null,
   "deposit": 0,
   "depositPaid": false
  },
  {
   "customer": "Anniversaire — Julie R.",
   "time": "13:00",
   "guests": 6,
   "table": "T12",
   "status": "pending",
   "phone": null,
   "deposit": 0,
   "depositPaid": false
  },
  {
   "customer": "Marc Dubois",
   "time": "19:30",
   "guests": 2,
   "table": "T2",
   "status": "confirmed",
   "phone": null,
   "deposit": 0,
   "depositPaid": false
  },
  {
   "customer": "Groupe entreprise — TechCo",
   "time": "20:00",
   "guests": 8,
   "table": "T14+T15",
   "status": "confirmed",
   "phone": null,
   "deposit": 20,
   "depositPaid": true
  }
 ],
 "stock": [
  {
   "name": "Mozzarella di Bufala",
   "quantity": 3.5,
   "unit": "kg",
   "minThreshold": 5
  },
  {
   "name": "Burrata",
   "quantity": 0,
   "unit": "kg",
   "minThreshold": 3
  },
  {
   "name": "Basilic frais",
   "quantity": 0.8,
   "unit": "kg",
   "minThreshold": 1
  },
  {
   "name": "Eau plate 1L",
   "quantity": 6,
   "unit": "pcs",
   "minThreshold": 24
  },
  {
   "name": "Farine 00",
   "quantity": 42,
   "unit": "kg",
   "minThreshold": 10
  },
  {
   "name": "Tomates San Marzano (boîte)",
   "quantity": 68,
   "unit": "pcs",
   "minThreshold": 20
  },
  {
   "name": "Chianti Classico (bouteille)",
   "quantity": 24,
   "unit": "pcs",
   "minThreshold": 12
  },
  {
   "name": "Boîtes à emporter (M)",
   "quantity": 340,
   "unit": "pcs",
   "minThreshold": 100
  }
 ],
 "reviews": [
  {
   "author": "Sophie Martin",
   "rating": 5,
   "dayOffset": 3,
   "text": "Un vrai coup de cœur ! Le tiramisu est juste parfait et le service était très attentionné. On reviendra sans hésiter."
  },
  {
   "author": "Karim Belhadj",
   "rating": 3,
   "dayOffset": 5,
   "text": "Plats bons mais l'attente était longue un mercredi soir pourtant calme. Dommage."
  },
  {
   "author": "Julie Roussel",
   "rating": 5,
   "dayOffset": 7,
   "text": "Soirée d'anniversaire parfaite, l'équipe a même préparé une petite surprise pour ma fille. Merci !"
  },
  {
   "author": "Marc Dubois",
   "rating": 4,
   "dayOffset": 11,
   "text": "Très bon rapport qualité-prix, cadre agréable. Le parking à proximité est un vrai plus."
  },
  {
   "author": "Amine Lahlou",
   "rating": 4,
   "dayOffset": 13,
   "text": "Belle découverte, les pâtes fraîches maison valent le détour. Un peu bruyant en soirée."
  }
 ],
 "shopSupplier": {
  "companyName": "Metro Paris 11e",
  "city": "Paris",
  "categories": [
   "frais",
   "sec"
  ],
  "deliveryZones": [
   "Paris & petite couronne"
  ],
  "minimumOrderCents": 15000,
  "leadTimeDays": 1,
  "status": "active",
  "marketplaceCoherencePending": false,
  "payoutStatus": "none"
 },
 "catalogItems": [
  {
   "name": "Mozzarella di Bufala",
   "priceCents": 1800,
   "unit": "unité",
   "packSize": "Carton de 6×250g",
   "category": "frais"
  },
  {
   "name": "Burrata",
   "priceCents": 4200,
   "unit": "unité",
   "packSize": "Carton de 12×200g",
   "category": "frais"
  },
  {
   "name": "Basilic frais",
   "priceCents": 650,
   "unit": "unité",
   "packSize": "Cagette 500 g",
   "category": "frais"
  },
  {
   "name": "Tomates San Marzano",
   "priceCents": 2880,
   "unit": "unité",
   "packSize": "Carton de 24 boîtes",
   "category": "frais"
  },
  {
   "name": "Farine 00",
   "priceCents": 3200,
   "unit": "unité",
   "packSize": "Sac 25 kg",
   "category": "sec"
  },
  {
   "name": "Riz Arborio",
   "priceCents": 2450,
   "unit": "unité",
   "packSize": "Sac 10 kg",
   "category": "sec"
  },
  {
   "name": "Huile d'olive extra vierge",
   "priceCents": 3800,
   "unit": "unité",
   "packSize": "Bidon 5 L",
   "category": "sec"
  },
  {
   "name": "Eau plate 1 L",
   "priceCents": 480,
   "unit": "unité",
   "packSize": "Carton de 12",
   "category": "boissons"
  },
  {
   "name": "Eau gazeuse 1 L",
   "priceCents": 520,
   "unit": "unité",
   "packSize": "Carton de 12",
   "category": "boissons"
  },
  {
   "name": "Boîtes à emporter (M)",
   "priceCents": 4500,
   "unit": "unité",
   "packSize": "Carton de 200",
   "category": "emballages"
  },
  {
   "name": "Serviettes en papier",
   "priceCents": 2200,
   "unit": "unité",
   "packSize": "Carton de 2000",
   "category": "emballages"
  }
 ],
 "otherSuppliers": [
  {
   "companyName": "Grossiste Boissons IDF",
   "city": "Paris",
   "categories": [
    "sec"
   ]
  },
  {
   "companyName": "Emballages Pro",
   "city": "Paris",
   "categories": [
    "sec"
   ]
  },
  {
   "companyName": "Marché Fermier Rungis",
   "city": "Paris",
   "categories": [
    "sec"
   ]
  },
  {
   "companyName": "Boucherie Grossiste Paris",
   "city": "Paris",
   "categories": [
    "sec"
   ]
  }
 ],
 "supplyOrders": [
  {
   "marker": "#F-2052",
   "supplier": "Grossiste Boissons IDF",
   "dayOffset": 1,
   "totalCents": 21050,
   "status": "confirmed",
   "paymentStatus": "unpaid",
   "lines": [
    {
     "name": "Chianti Classico",
     "qty": 3,
     "unitPriceCents": null,
     "packSize": "Carton de 6"
    },
    {
     "name": "Eau plate 1 L",
     "qty": 5,
     "unitPriceCents": null,
     "packSize": "Carton de 12"
    },
    {
     "name": "Eau gazeuse 1 L",
     "qty": 2,
     "unitPriceCents": null,
     "packSize": "Carton de 12"
    }
   ]
  },
  {
   "marker": "#F-2058",
   "supplier": "Emballages Pro",
   "dayOffset": 0,
   "totalCents": 9500,
   "status": "preparing",
   "paymentStatus": "paid",
   "lines": []
  },
  {
   "marker": "#F-2033",
   "supplier": "Marché Fermier Rungis",
   "dayOffset": 7,
   "totalCents": 18000,
   "status": "shipped",
   "paymentStatus": "paid",
   "lines": []
  },
  {
   "marker": "#F-2041",
   "supplier": "Metro Paris 11e",
   "dayOffset": 3,
   "totalCents": 34000,
   "status": "delivered",
   "paymentStatus": "paid",
   "lines": []
  },
  {
   "marker": "#F-2019",
   "supplier": "Metro Paris 11e",
   "dayOffset": 16,
   "totalCents": 26540,
   "status": "delivered",
   "paymentStatus": "paid",
   "lines": []
  },
  {
   "marker": "#F-1998",
   "supplier": "Boucherie Grossiste Paris",
   "dayOffset": 26,
   "totalCents": 8800,
   "status": "cancelled",
   "paymentStatus": "unpaid",
   "lines": []
  }
 ]
}

/* ── HARD GUARD — mirrors seed-qa-operator.mjs ────────────────────────────────── */
function requireStaging() {
  const email = process.env.QA_EMAIL || ''
  const confirmFlag = process.argv.includes('--confirm-staging')
  const confirmEnv = process.env.QA_SEED_CONFIRM === 'STAGING_ONLY'
  const nextauthUrl = process.env.NEXTAUTH_URL || ''
  if (!confirmFlag || !confirmEnv) {
    console.error('❌ Refused: pass BOTH --confirm-staging AND QA_SEED_CONFIRM=STAGING_ONLY.')
    process.exit(1)
  }
  if (!process.env.DATABASE_URL) { console.error('❌ Refused: DATABASE_URL is empty.'); process.exit(1) }
  const testish = email.includes('+qa') || email.includes('qa+') || email.endsWith('.test') || email.endsWith('.qa')
  if (!testish) { console.error(`❌ Refused: QA_EMAIL "${email}" is not test-ish.`); process.exit(1) }
  if (nextauthUrl === 'https://grubano.com' && process.env.FORCE !== '1') {
    console.error('❌ Refused: NEXTAUTH_URL is the PROD url.')
    process.exit(1)
  }
  const host = (() => { try { return new URL(process.env.DATABASE_URL).hostname } catch { return '?' } })()
  console.log(`── parity seed pre-flight ── DB host: ${host} · QA_EMAIL: ${email}`)
  return email
}

const day = 24 * 60 * 60 * 1000
const at = (dayOffset, minutesBefore = 0) => new Date(Date.now() - dayOffset * day - (minutesBefore || 0) * 60 * 1000)
const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

async function main() {
  const email = requireStaging()
  const prisma = new PrismaClient()
  try {
    const operator = await prisma.operator.findUnique({ where: { email } })
    if (!operator) throw new Error(`operator ${email} introuvable — lancer seed-qa-operator.mjs d'abord`)
    const restaurant = await prisma.restaurant.findFirst({ where: { operatorId: operator.id } })
    const brand = await prisma.brand.findFirst({ where: { operatorId: operator.id } })
    if (!restaurant || !brand) throw new Error('restaurant/brand QA introuvables')

    // 1) Identité — le mock nomme l'établissement Mama Trattoria (op-menus:391,
    //    op-reviews:463, op-analytics:617).
    await prisma.restaurant.update({ where: { id: restaurant.id }, data: { name: DATA.restaurant.name, city: DATA.restaurant.city, cuisine: DATA.restaurant.cuisine, isActive: true } })
    await prisma.brand.update({ where: { id: brand.id }, data: { name: DATA.brandName } })
    console.log(`· identité → ${DATA.restaurant.name}`)

    // 2) Catégorie custom (Pizzas) — les 4 autres sont des constantes front.
    for (const [i, name] of DATA.customCategories.entries()) {
      const found = await prisma.category.findFirst({ where: { brandId: brand.id, name } })
      if (!found) await prisma.category.create({ data: { brandId: brand.id, name, position: 2 + i } })
    }

    // 3) Carte — les 30 plats du mock, upsert par nom ; les plats QA hors-mock
    //    sont retirés (lignes possédées par la brand QA uniquement).
    const menuNames = DATA.menuItems.map((m) => m.name)
    await prisma.menuItem.deleteMany({ where: { brandId: brand.id, name: { notIn: menuNames } } })
    const priceByName = {}
    for (const m of DATA.menuItems) {
      priceByName[m.name] = m.price
      const found = await prisma.menuItem.findFirst({ where: { brandId: brand.id, name: m.name } })
      if (found) await prisma.menuItem.update({ where: { id: found.id }, data: { price: m.price, category: m.category, description: m.description, available: m.available } })
      else await prisma.menuItem.create({ data: { brandId: brand.id, name: m.name, price: m.price, category: m.category, description: m.description, available: m.available } })
    }
    console.log(`· carte → ${DATA.menuItems.length} plats (hors-mock retirés)`)

    // 4) Clients consommateurs nommés (comptes de test .test).
    const consumerByName = {}
    const hash = await bcrypt.hash('LocalQA-2026!', 12)
    for (const c of DATA.consumers) {
      const row = await prisma.operator.upsert({
        where: { email: c.email },
        update: { name: c.name, role: 'consumer', status: 'active' },
        create: { email: c.email, name: c.name, role: 'consumer', status: 'active', password: hash },
      })
      consumerByName[c.name] = row.id
    }

    // 5) Commandes du mock (marqueur qa-parity dans items[0] pour l'idempotence).
    const oldOrders = await prisma.order.findMany({ where: { restaurantId: restaurant.id }, select: { id: true, items: true } })
    const parityOrderIds = oldOrders.filter((o) => Array.isArray(o.items) && o.items[0] && o.items[0].qaParity).map((o) => o.id)
    if (parityOrderIds.length) await prisma.order.deleteMany({ where: { id: { in: parityOrderIds } } })
    for (const o of DATA.orders) {
      const consumerId = consumerByName[o.customer]
      if (!consumerId) continue
      const items = o.items.map((it, i) => ({
        ...(i === 0 ? { qaParity: true } : {}),
        itemId: null, name: it.name, qty: it.qty, price: priceByName[it.name] ?? 0,
      }))
      const total = o.totalEUR ?? items.reduce((s, it) => s + it.price * it.qty, 0)
      await prisma.order.create({ data: {
        consumerId, restaurantId: restaurant.id, items,
        subtotal: total, deliveryFee: 0, total,
        status: o.status, fulfillmentType: o.fulfillment,
        deliveryAddress: o.address || '12 rue de la Roquette, 75011 Paris',
        paymentMethod: 'card', paymentStatus: 'paid',
        pointsEarned: 0, estimatedTime: 25,
        createdAt: at(o.dayOffset, o.minBefore ?? 0),
      } })
    }
    // Historique léger pour les écrans clients/analytics (1 commande delivered
    // par client, J-2 à J-17) — structure et noms du mock, jamais ses agrégats.
    for (const [i, c] of DATA.consumers.entries()) {
      const dish = DATA.menuItems[(i * 5) % DATA.menuItems.length]
      await prisma.order.create({ data: {
        consumerId: consumerByName[c.name], restaurantId: restaurant.id,
        items: [{ qaParity: true, itemId: null, name: dish.name, qty: 1, price: dish.price }],
        subtotal: dish.price, deliveryFee: 0, total: dish.price,
        status: 'delivered', fulfillmentType: 'delivery',
        deliveryAddress: '12 rue de la Roquette, 75011 Paris',
        paymentMethod: 'card', paymentStatus: 'paid',
        pointsEarned: 0, estimatedTime: 25, createdAt: at(2 + i * 3),
      } })
    }
    console.log(`· commandes → ${DATA.orders.length} du mock + ${DATA.consumers.length} historiques`)

    // 6) Fidélité — 7 clients (paliers/points/anciennetés du mock) + leur
    //    historique LoyaltyOrder. Sans cet historique l'écran Clients est VIDE :
    //    la clôture lib/customer-scope.ts ne retient un LoyaltyCustomer que par
    //    chemin A (LoyaltyOrder.brandId → operatorId) ou chemin B (email d'un
    //    compte /eat ayant commandé). Les emails fidélité sont des données de la
    //    maquette (op-customers:418-472) — on ne les aligne PAS sur les comptes
    //    qa-*.test : chemin A seul, les colonnes Commandes/Total restent exactes.
    const loyaltyIdByEmail = {}
    for (const l of DATA.loyalty) {
      const row = await prisma.loyaltyCustomer.upsert({
        where: { email: l.email },
        update: { name: l.name, tier: l.tier, pointsBalance: l.points, phone: l.phone },
        create: { name: l.name, email: l.email, phone: l.phone, tier: l.tier, pointsBalance: l.points, referralCode: `QA-${slug(l.name)}`, createdAt: new Date(l.createdAt) },
      })
      loyaltyIdByEmail[l.email] = row.id
    }
    // Historique : N = colonne « Commandes », somme = colonne « Total dépensé »
    // répartie en centimes égaux (reste d'arrondi sur les premières commandes),
    // dates uniformes entre l'ancienneté du client et sa dernière visite
    // (offsets dérivés — voir seed-qa-mock-parity.provenance.json). Idempotence :
    // marqueur uberOrderNumber QA-PARITY-*, suppression scopée à la brand QA.
    await prisma.loyaltyOrder.deleteMany({ where: { brandId: brand.id, uberOrderNumber: { startsWith: 'QA-PARITY-' } } })
    let loyOrderCount = 0
    for (const l of DATA.loyalty) {
      const totalCents = Math.round(l.totalSpentEUR * 100)
      const base = Math.floor(totalCents / l.ordersCount)
      const rest = totalCents - base * l.ordersCount
      const last = at(l.lastVisitOffset)
      const since = new Date(l.createdAt)
      const step = l.ordersCount > 1 ? (last.getTime() - since.getTime()) / (l.ordersCount - 1) : 0
      const rows = []
      for (let i = 0; i < l.ordersCount; i++) {
        const cents = base + (i < rest ? 1 : 0)
        rows.push({
          customerId: loyaltyIdByEmail[l.email], brandId: brand.id,
          uberOrderNumber: `QA-PARITY-${slug(l.name)}-${String(i + 1).padStart(3, '0')}`,
          amount: cents / 100, pointsEarned: Math.floor(cents / 100),
          validatedAt: new Date(last.getTime() - i * step),
        })
      }
      await prisma.loyaltyOrder.createMany({ data: rows })
      loyOrderCount += rows.length
    }
    console.log(`· fidélité → ${DATA.loyalty.length} clients · historique → ${loyOrderCount} commandes (chemin A)`)

    // 7) Tables + réservations du jour (source qa-parity ; depositStatus JAMAIS
    //    touché — 'none', aucun identifiant Stripe).
    const tableByName = {}
    for (const [i, t] of DATA.tables.entries()) {
      let row = await prisma.restaurantTable.findFirst({ where: { restaurantId: restaurant.id, name: t.name } })
      if (!row) row = await prisma.restaurantTable.create({ data: { restaurantId: restaurant.id, name: t.name, seats: t.seats, x: (i % 4) * 130, y: Math.floor(i / 4) * 120, active: true } })
      else await prisma.restaurantTable.update({ where: { id: row.id }, data: { seats: t.seats } })
      tableByName[t.name] = row.id
    }
    await prisma.reservation.deleteMany({ where: { restaurantId: restaurant.id, source: 'qa-parity' } })
    for (const r of DATA.reservations) {
      const firstTable = (r.table || '').split('+')[0].trim()
      const tableId = tableByName[firstTable]
      if (!tableId) continue
      const [h, m] = r.time.split(':').map(Number)
      const start = new Date(); start.setHours(h, m || 0, 0, 0)
      const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
      await prisma.reservation.create({ data: {
        tableId, restaurantId: restaurant.id, source: 'qa-parity',
        customerName: r.customer, phone: r.phone, guests: r.guests,
        date: start, endTime: end, type: 'dinner', status: r.status,
        allergies: [], preOrder: [],
        depositAmount: r.deposit || 0, depositPaid: !!r.depositPaid,
        noShowPenalty: 0, depositStatus: 'none', depositCurrency: 'eur',
      } })
    }
    console.log(`· tables → ${DATA.tables.length} · réservations → ${DATA.reservations.length}`)

    // 8) Stock — les 8 lignes du mock ; lignes QA hors-mock retirées.
    const stockNames = DATA.stock.map((s) => s.name)
    await prisma.stockItem.deleteMany({ where: { brandId: brand.id, name: { notIn: stockNames } } })
    for (const s of DATA.stock) {
      const found = await prisma.stockItem.findFirst({ where: { brandId: brand.id, name: s.name } })
      if (found) await prisma.stockItem.update({ where: { id: found.id }, data: { quantity: s.quantity, unit: s.unit, minThreshold: s.minThreshold } })
      else await prisma.stockItem.create({ data: { brandId: brand.id, name: s.name, quantity: s.quantity, unit: s.unit, minThreshold: s.minThreshold } })
    }

    // 9) Avis — 5 auteurs du mock (Review.userId = leur compte consommateur).
    await prisma.review.deleteMany({ where: { restaurantId: restaurant.id, userId: { in: Object.values(consumerByName) } } })
    for (const rv of DATA.reviews) {
      const userId = consumerByName[rv.author]
      if (!userId) continue
      await prisma.review.create({ data: {
        restaurantId: restaurant.id, userId, rating: rv.rating, text: rv.text,
        tags: [], status: 'published', createdAt: at(rv.dayOffset),
      } })
    }
    console.log(`· stock → ${DATA.stock.length} · avis → ${DATA.reviews.length}`)

    // 10) Marketplace — boutique renommée + 11 articles + 4 fournisseurs
    //     supplémentaires + 6 commandes fournisseur (totaux VERBATIM mock ;
    //     payoutStatus 'none' partout, aucun rail Stripe).
    const shop = await prisma.supplierProfile.findFirst({ where: { supplyOrders: { some: { operatorId: operator.id } } } }) ||
                 await prisma.supplierProfile.findFirst({ where: { email: { contains: 'grubano.test' } } })
    const supplierByName = {}
    if (shop) {
      await prisma.supplierProfile.update({ where: { id: shop.id }, data: { companyName: DATA.shopSupplier.companyName, city: DATA.shopSupplier.city, categories: DATA.shopSupplier.categories, minimumOrderCents: DATA.shopSupplier.minimumOrderCents, leadTimeDays: DATA.shopSupplier.leadTimeDays } })
      supplierByName[DATA.shopSupplier.companyName] = shop.id
      for (const ci of DATA.catalogItems) {
        const found = await prisma.supplierCatalogItem.findFirst({ where: { supplierProfileId: shop.id, name: ci.name } })
        if (found) await prisma.supplierCatalogItem.update({ where: { id: found.id }, data: { priceCents: ci.priceCents, unit: ci.unit, packSize: ci.packSize, category: ci.category, available: true } })
        else await prisma.supplierCatalogItem.create({ data: { supplierProfileId: shop.id, name: ci.name, priceCents: ci.priceCents, unit: ci.unit, packSize: ci.packSize, category: ci.category, available: true, allergens: [] } })
      }
    }
    for (const sp of DATA.otherSuppliers) {
      const mail = `qa-supplier-${slug(sp.companyName)}@grubano.test`
      const row = await prisma.supplierProfile.upsert({
        where: { email: mail },
        update: { companyName: sp.companyName, city: sp.city },
        create: { email: mail, companyName: sp.companyName, contactName: 'QA Parity', city: sp.city, categories: sp.categories, deliveryZones: ['Paris'], minimumOrderCents: 0, leadTimeDays: 2, status: 'active', payoutStatus: 'none' },
      })
      supplierByName[sp.companyName] = row.id
    }
    await prisma.supplyOrder.deleteMany({ where: { operatorId: operator.id, notes: { startsWith: 'QA-PARITY-' } } })
    for (const so of DATA.supplyOrders) {
      const supplierProfileId = supplierByName[so.supplier] || (shop && shop.id)
      if (!supplierProfileId) continue
      await prisma.supplyOrder.create({ data: {
        operatorId: operator.id, supplierProfileId,
        status: so.status, paymentStatus: so.paymentStatus, totalCents: so.totalCents,
        notes: `QA-PARITY-${so.marker}`, createdAt: at(so.dayOffset),
        lines: { create: so.lines.map((l) => ({
          nameSnapshot: l.name, unitSnapshot: l.packSize || 'unité',
          quantity: l.qty, unitPriceCents: l.unitPriceCents ?? 0,
          lineTotalCents: (l.unitPriceCents ?? 0) * l.qty,
        })) },
      } })
    }
    console.log(`· marketplace → ${DATA.catalogItems.length} articles · ${DATA.otherSuppliers.length} fournisseurs+ · ${DATA.supplyOrders.length} commandes`)

    console.log('\n✓ parity seed complete — les maquettes sont la source, le seed les suit.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error('parity seed failed:', e?.message || e); process.exit(1) })
