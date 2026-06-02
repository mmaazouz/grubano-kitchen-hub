// scripts/seed-demo-data.js
// ─────────────────────────────────────────────────────────────────────────────
// STAGING-ONLY demo-data seeder. Populates the database with realistic orders,
// a referral programme, and a franchise multi-location setup so the operator,
// creator and franchise dashboards look alive in a demo instead of empty.
//
//   ⚠️  NEVER run this against production.
//
// Safety design:
//   1. Hard gate: refuses to run unless  SEED_DEMO_CONFIRM=yes  is set.
//   2. Prints the *masked* target database (host + db name, password hidden)
//      BEFORE doing anything, so you can eyeball that it's staging.
//   3. Fully idempotent: every row uses a deterministic `demo-*` id (or a known
//      unique key like email / orderId) and is written with upsert(). Re-running
//      the script refreshes the same rows — it never creates duplicates.
//   4. Purely additive — it only inserts/updates `demo-*` rows and the three
//      named demo accounts. It does not delete anything and does not touch the
//      schema, middleware, pages or components.
//
// Usage (cPanel Terminal on STAGING, from the app root):
//   ./node_modules/.bin/prisma generate          # ensure pinned 5.22.0 client
//   SEED_DEMO_CONFIRM=yes node scripts/seed-demo-data.js
//
// Locally it also works as long as DATABASE_URL in .env.local points at a DB
// you actually want to seed (it cannot reach the o2switch DB from Windows).
// ─────────────────────────────────────────────────────────────────────────────

'use strict'

const fs   = require('fs')
const path = require('path')

// ── 1. Load DATABASE_URL (+ any other vars) from .env.local if not in env ──────
//    Mirrors prisma/seed-test-user.js's loader.
{
  const envFile = path.join(__dirname, '..', '.env.local')
  if (fs.existsSync(envFile)) {
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
      }
    }
  }
}

if (!process.env.DATABASE_URL) {
  console.error('[seed-demo-data] DATABASE_URL not set (checked env + .env.local). Aborting.')
  process.exit(1)
}

// ── 2. Print the masked target DB so the operator can verify it's staging ──────
function maskedTarget(url) {
  try {
    const u = new URL(url)
    const cred = u.username ? `${u.username}:***@` : ''
    return `${u.protocol}//${cred}${u.host}${u.pathname}`
  } catch {
    return '(unparseable DATABASE_URL — masked for safety)'
  }
}

console.log('============================================================')
console.log('  GRUBANO — DEMO DATA SEEDER  (STAGING ONLY)')
console.log('============================================================')
console.log(`  Target database : ${maskedTarget(process.env.DATABASE_URL)}`)
console.log('  ⚠️  Make ABSOLUTELY sure the line above is your STAGING DB.')
console.log('============================================================')

// ── 3. Hard confirmation gate ──────────────────────────────────────────────────
if (process.env.SEED_DEMO_CONFIRM !== 'yes') {
  console.error('')
  console.error('[seed-demo-data] Refusing to run without explicit confirmation.')
  console.error('  Re-run with the guard set, e.g.:')
  console.error('    SEED_DEMO_CONFIRM=yes node scripts/seed-demo-data.js')
  console.error('')
  process.exit(1)
}

const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')

const prisma = new PrismaClient()

// ── Deterministic PRNG (mulberry32) so re-runs produce identical data ───────────
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rand   = mulberry32(0x51ED2C0)
const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min
const pick    = (arr) => arr[Math.floor(rand() * arr.length)]
const round2  = (n) => Math.round(n * 100) / 100

const HOUR = 60 * 60 * 1000
const DAY  = 24 * HOUR
const NOW  = Date.now()

// ── Static demo content pools ──────────────────────────────────────────────────
const DEMO_PASSWORD = 'Demo1234!' // for the franchise + creator demo logins

// Coherent dish catalogue (name, unit price). Used to build order line items.
const DISHES = [
  ['Gnocchi à la truffe',     13.9],
  ['Gnocchi 4 fromages',      12.5],
  ['Risotto champignons',     12.9],
  ['Pasta Carbonara',         11.5],
  ['Bowl healthy poulet',     11.9],
  ['Wrap Rollix poulet',       9.5],
  ['Mac & Cheese gratiné',    10.5],
  ['Riz gourmand curry',      10.9],
  ['Burrata crémeuse',         7.5],
  ['Salade César',             8.9],
  ['Tiramisu maison',          5.5],
  ['Cookie XXL',               3.5],
  ['Limonade artisanale',      3.9],
]

// Delivery addresses around Orange (84 — Vaucluse).
const ADDRESSES = [
  '12 Rue de la République, 84100 Orange',
  "8 Avenue de l'Arc de Triomphe, 84100 Orange",
  '25 Cours Jean Jaurès, 84000 Avignon',
  "3 Place de l'Horloge, 84000 Avignon",
  '14 Boulevard Albin Durand, 84200 Carpentras',
  '7 Route de Châteauneuf, 84350 Courthézon',
]

// Fallback restaurants (only created if staging has zero Restaurant rows).
const DEMO_RESTAURANTS = [
  { key: 1, name: 'Gnocchi Bar',     city: 'Orange',     address: '12 Rue de la République, 84100 Orange',   cuisine: ['Italien', 'Pâtes'] },
  { key: 2, name: 'Le Riz Gourmand', city: 'Avignon',    address: '25 Cours Jean Jaurès, 84000 Avignon',     cuisine: ['Asiatique', 'Riz'] },
  { key: 3, name: 'Pasta Fresca',    city: 'Carpentras', address: '14 Boulevard Albin Durand, 84200 Carpentras', cuisine: ['Italien'] },
  { key: 4, name: 'Rollix',          city: 'Courthézon', address: '7 Route de Châteauneuf, 84350 Courthézon', cuisine: ['Wraps', 'Street food'] },
  { key: 5, name: 'Bowl Healthy',    city: 'Sorgues',    address: "5 Avenue d'Avignon, 84700 Sorgues",        cuisine: ['Healthy', 'Bowls'] },
  { key: 6, name: 'Mac & Cheese Co', city: 'Bollène',    address: '9 Cours de la République, 84500 Bollène',  cuisine: ['Comfort food'] },
]

// Franchise points of sale (cities near Orange).
const DEMO_POS = [
  { id: 'demo-pos-1', name: 'Grubano Orange Centre', address: '12 Rue de la République, 84100 Orange',   city: 'Orange',     brand: 'Gnocchi Bar' },
  { id: 'demo-pos-2', name: 'Grubano Avignon Gare',  address: '25 Cours Jean Jaurès, 84000 Avignon',     city: 'Avignon',    brand: 'Le Riz Gourmand' },
  { id: 'demo-pos-3', name: 'Grubano Carpentras',    address: '14 Boulevard Albin Durand, 84200 Carpentras', city: 'Carpentras', brand: 'Rollix' },
]

// Real restaurateur-franchisors (brique 2A): each is an Operator(role=restaurant)
// that owns one *franchisable* Brand (openToFranchise) plus its inherited
// signature menu. The demo points of sale are then linked to the first brand.
const DEMO_FRANCHISORS = [
  {
    opId: 'demo-franchiseur-1',
    email: 'demo-franchiseur1@grubano.com',
    name: 'Luigi Romano',
    brandId: 'demo-brand-1',
    brand: {
      name: 'Gnocchi Bar',
      emoji: '🥟',
      cuisineType: 'Italien',
      tagline: 'Le gnocchi frais façon trattoria — un concept clé en main.',
      royaltyPct: 0.06,
      setupFee: 15000,
      avgMonthlyRevenue: 9200,
      franchiseZones: ['Orange', 'Avignon', 'Carpentras', 'Marseille', 'Lyon', 'Nîmes'],
    },
    menu: [
      ['Gnocchi à la truffe',   13.9, 'Plats'],
      ['Gnocchi 4 fromages',    12.5, 'Plats'],
      ['Gnocchi pesto maison',  11.9, 'Plats'],
      ['Tiramisu maison',        5.5, 'Desserts'],
    ],
  },
  {
    opId: 'demo-franchiseur-2',
    email: 'demo-franchiseur2@grubano.com',
    name: 'Inès Haddad',
    brandId: 'demo-brand-2',
    brand: {
      name: 'Bowl Healthy',
      emoji: '🥗',
      cuisineType: 'Healthy',
      tagline: 'Des bowls frais et équilibrés, prêts à franchiser.',
      royaltyPct: 0.05,
      setupFee: 12000,
      avgMonthlyRevenue: 7600,
      franchiseZones: ['Avignon', 'Sorgues', 'Montpellier', 'Aix-en-Provence', 'Paris'],
    },
    menu: [
      ['Bowl poke saumon',      13.9, 'Bowls'],
      ['Bowl poulet teriyaki',  12.9, 'Bowls'],
      ['Bowl veggie falafel',   11.5, 'Bowls'],
      ['Smoothie açaï',          5.9, 'Boissons'],
    ],
  },
]

// Creator signature dishes.
const DEMO_DISHES = [
  { id: 'demo-dish-1', name: 'Gnocchi truffe & parmesan', cuisineType: 'Italien',  suggestedPrice: 14.5, ingredients: ['Gnocchi frais', 'Crème de truffe', 'Parmesan 24 mois', 'Huile de truffe'] },
  { id: 'demo-dish-2', name: 'Bowl poke saumon avocat',   cuisineType: 'Healthy',  suggestedPrice: 13.9, ingredients: ['Riz vinaigré', 'Saumon frais', 'Avocat', 'Edamame', 'Sauce soja'] },
  { id: 'demo-dish-3', name: 'Wrap smash poulet croustillant', cuisineType: 'Street food', suggestedPrice: 10.9, ingredients: ['Tortilla', 'Poulet pané', 'Cheddar', 'Sauce maison', 'Salade'] },
]

// ── Builders ────────────────────────────────────────────────────────────────────

// Build 2–4 coherent line items whose subtotal lands in the 15–45 € window.
function buildItems() {
  for (let attempt = 0; attempt < 12; attempt++) {
    const count = randInt(2, 4)
    const used  = new Set()
    const items = []
    let subtotal = 0
    for (let i = 0; i < count; i++) {
      let idx = Math.floor(rand() * DISHES.length)
      // avoid duplicate lines within one order
      let guard = 0
      while (used.has(idx) && guard++ < DISHES.length) idx = (idx + 1) % DISHES.length
      used.add(idx)
      const [name, price] = DISHES[idx]
      const qty = randInt(1, 2)
      items.push({ itemId: `demo-item-${idx + 1}`, name, qty, price })
      subtotal += qty * price
    }
    if (subtotal >= 15 && subtotal <= 45) {
      return { items, subtotal: round2(subtotal) }
    }
  }
  // Fallback: guaranteed in-range simple order.
  const [n1, p1] = DISHES[0]
  const [n2, p2] = DISHES[10]
  return {
    items: [
      { itemId: 'demo-item-1',  name: n1, qty: 1, price: p1 },
      { itemId: 'demo-item-11', name: n2, qty: 1, price: p2 },
    ],
    subtotal: round2(p1 + p2),
  }
}

async function ensureOperator({ id, email, name, role, withPassword }) {
  const password = withPassword ? await bcrypt.hash(DEMO_PASSWORD, 12) : null
  return prisma.operator.upsert({
    where: { email },
    // Never clobber an existing account's password / role: an admin may have
    // configured these accounts already.
    update: { name, status: 'active' },
    create: { id, name, email, role, status: 'active', password },
  })
}

async function main() {
  // ── Referral economics (read the live config, fall back to launch defaults) ──
  const config = await prisma.referralConfig.upsert({
    where:  { id: 'default' },
    create: {
      id: 'default',
      commissionPctOfGrubanoFee: 0.22,
      durationDays: 90,
      customerDiscountPct: 0.10,
      customerDiscountCapEur: 5,
      active: true,
    },
    update: {}, // never overwrite tuned values
  })
  const COMMISSION_PCT = config.commissionPctOfGrubanoFee
  const DURATION_DAYS  = config.durationDays
  const GRUBANO_FEE_PCT = 0.10 // Grubano's commission on a basket (demo assumption)
  console.log(`\n[1/8] ReferralConfig: ${Math.round(COMMISSION_PCT * 100)}% of fee, ${DURATION_DAYS}-day window.`)

  // ── Consumers ────────────────────────────────────────────────────────────────
  // The pre-existing demo login (prisma/seed-test-user.js). Create it if missing
  // so the script is self-sufficient, but keep its real password if it exists.
  const testHash = await bcrypt.hash('Test1234!', 12)
  const testUser = await prisma.operator.upsert({
    where:  { email: 'test@grubano.com' },
    update: { status: 'active' },
    create: { name: 'Compte Démo', email: 'test@grubano.com', role: 'consumer', status: 'active', password: testHash },
  })
  const client1 = await ensureOperator({ id: 'demo-consumer-1', email: 'demo-client1@grubano.com', name: 'Sophie Martin',   role: 'consumer', withPassword: false })
  const client2 = await ensureOperator({ id: 'demo-consumer-2', email: 'demo-client2@grubano.com', name: 'Lucas Bernard',   role: 'consumer', withPassword: false })
  const client3 = await ensureOperator({ id: 'demo-consumer-3', email: 'demo-client3@grubano.com', name: 'Emma Petit',      role: 'consumer', withPassword: false })
  const referredCustomerId = client1.id            // the customer bound to the referral
  const consumerCycle = [testUser.id, client2.id, client3.id]
  console.log(`[2/8] Consumers ready: test@grubano.com + 3 demo clients.`)

  // ── Restaurant pool (prefer real staging restaurants; self-seed if empty) ──────
  let restaurants = await prisma.restaurant.findMany({ orderBy: { createdAt: 'asc' }, take: 6 })
  if (restaurants.length === 0) {
    console.log('      No restaurants found — seeding 6 demo restaurants.')
    for (const r of DEMO_RESTAURANTS) {
      const op = await ensureOperator({
        id: `demo-resto-op-${r.key}`,
        email: `demo-resto-${r.key}@grubano.com`,
        name: r.name,
        role: 'restaurant',
        withPassword: false,
      })
      await prisma.restaurant.upsert({
        where:  { operatorId: op.id },
        update: { name: r.name, city: r.city, address: r.address, cuisine: r.cuisine, isActive: true },
        create: {
          id: `demo-resto-${r.key}`,
          operatorId: op.id,
          name: r.name,
          description: `${r.name} — cuisine ${r.cuisine.join(', ').toLowerCase()} préparée sur place.`,
          cuisine: r.cuisine,
          rating: 4.7,
          reviewCount: 120 + r.key * 7,
          deliveryTime: 25 + r.key,
          city: r.city,
          address: r.address,
          isActive: true,
          deliveryEnabled: true,
          pickupEnabled: true,
        },
      })
    }
    restaurants = await prisma.restaurant.findMany({ orderBy: { createdAt: 'asc' }, take: 6 })
  }
  if (restaurants.length === 0) {
    throw new Error('No restaurants available to attach orders to.')
  }
  console.log(`[3/8] Restaurant pool: ${restaurants.length} restaurant(s).`)

  // ── Real restaurateur-franchisors + franchisable brands (brique 2A) ────────────
  const franchisorBrands = []
  for (const f of DEMO_FRANCHISORS) {
    const op = await ensureOperator({ id: f.opId, email: f.email, name: f.name, role: 'restaurant', withPassword: true })
    const brand = await prisma.brand.upsert({
      where:  { id: f.brandId },
      update: {
        name: f.brand.name, emoji: f.brand.emoji, openToFranchise: true, franchiseStatus: 'open',
        royaltyPct: f.brand.royaltyPct, setupFee: f.brand.setupFee, tagline: f.brand.tagline,
        cuisineType: f.brand.cuisineType, franchiseZones: f.brand.franchiseZones, avgMonthlyRevenue: f.brand.avgMonthlyRevenue,
      },
      create: {
        id: f.brandId, operatorId: op.id, name: f.brand.name, emoji: f.brand.emoji, status: 'active',
        openToFranchise: true, franchiseStatus: 'open',
        royaltyPct: f.brand.royaltyPct, setupFee: f.brand.setupFee, tagline: f.brand.tagline,
        cuisineType: f.brand.cuisineType, franchiseZones: f.brand.franchiseZones, avgMonthlyRevenue: f.brand.avgMonthlyRevenue,
      },
    })
    // Inherited signature menu (idempotent by deterministic id).
    for (let i = 0; i < f.menu.length; i++) {
      const [name, price, category] = f.menu[i]
      const menuId = `demo-menu-${f.brandId}-${i + 1}`
      await prisma.menuItem.upsert({
        where:  { id: menuId },
        update: { name, price, category, available: true },
        create: { id: menuId, brandId: brand.id, name, price, category, available: true, isPopular: i === 0 },
      })
    }
    franchisorBrands.push(brand)
  }
  const primaryBrandId = franchisorBrands[0].id // demo points of sale all link to this brand
  console.log(`[4a/8] Franchisors: ${franchisorBrands.length} (openToFranchise brands + inherited menus).`)

  // ── Franchise operator + points of sale ────────────────────────────────────────
  const franchise = await ensureOperator({
    id: 'demo-franchise-op',
    email: 'franchise@grubano.com',
    name: 'Franchise Démo Vaucluse',
    role: 'franchise',
    withPassword: true,
  })
  const posRows = []
  for (const p of DEMO_POS) {
    const row = await prisma.pointOfSale.upsert({
      where:  { id: p.id },
      // Link to a real franchisable Brand via brandId; keep the legacy `brand`
      // text label too (brique 2A — backward compatible).
      update: { name: p.name, address: p.address, city: p.city, brand: p.brand, brandId: primaryBrandId, isActive: true },
      create: { id: p.id, franchiseId: franchise.id, name: p.name, address: p.address, city: p.city, brand: p.brand, brandId: primaryBrandId, isActive: true },
    })
    posRows.push(row)
  }
  console.log(`[4b/8] Franchise franchise@grubano.com + ${posRows.length} points of sale (linked to brandId ${primaryBrandId}).`)

  // ── Dedicated TEST restaurateur with its OWN adoptable brand ────────────────────
  // A reliable, documented login (resto@grubano.com / Test1234!) that owns
  // demo-brand-test so creator-recipe adoption can be tested end-to-end. The
  // admin/Mohammed account owns no brand of its own, and the demo brands above
  // belong to the franchisors. This account deliberately has NO pre-existing
  // adoption, so Marco's 3 creator recipes all show up as "à adopter" on /menu.
  //
  // Password handling: explicit bcrypt hash of 'Test1234!' at CREATE (same pattern
  // as test@grubano.com) so the login never depends on DEMO_PASSWORD. On UPDATE we
  // never clobber an existing password/role — an admin may have configured it.
  const restoTestHash = await bcrypt.hash('Test1234!', 12)
  const restoTest = await prisma.operator.upsert({
    where:  { email: 'resto@grubano.com' },
    update: { name: 'Resto Test', status: 'active' },
    create: { id: 'demo-resto-test', name: 'Resto Test', email: 'resto@grubano.com', role: 'restaurant', status: 'active', password: restoTestHash },
  })
  await prisma.brand.upsert({
    where:  { id: 'demo-brand-test' },
    update: { name: 'Resto Test', emoji: '🌮', status: 'active', openToFranchise: false, franchiseStatus: 'none', cuisineType: 'Street food' },
    create: {
      id: 'demo-brand-test',
      operatorId: restoTest.id,
      name: 'Resto Test',
      emoji: '🌮',
      status: 'active',
      openToFranchise: false,
      franchiseStatus: 'none',
      cuisineType: 'Street food',
    },
  })
  // Optional minimal Restaurant profile bound to the same operator (1-to-1).
  await prisma.restaurant.upsert({
    where:  { operatorId: restoTest.id },
    update: { name: 'Resto Test', city: 'Orange', isActive: true },
    create: {
      id: 'demo-resto-test-profile',
      operatorId: restoTest.id,
      name: 'Resto Test',
      description: "Compte restaurateur de test — street food, pour tester l'adoption de recettes créateurs.",
      cuisine: ['Street food'],
      rating: 4.8,
      reviewCount: 42,
      deliveryTime: 25,
      city: 'Orange',
      address: '12 Rue de la République, 84100 Orange',
      isActive: true,
      deliveryEnabled: true,
      pickupEnabled: true,
    },
  })
  console.log(`[4c/8] Test restaurateur resto@grubano.com (role restaurant) + own brand demo-brand-test (openToFranchise=false, no adoption).`)

  // ── Creator operator + Creator profile + signature dishes ───────────────────────
  await ensureOperator({
    id: 'demo-creator-op',
    email: 'createur@grubano.com',
    name: 'Marco Influenceur',
    role: 'creator',
    withPassword: true,
  })
  const creator = await prisma.creator.upsert({
    where:  { email: 'createur@grubano.com' },
    update: { referralCode: 'DEMO20', referralLinkSlug: 'demo20', verified: true },
    create: {
      id: 'demo-creator',
      name: 'Marco Influenceur',
      email: 'createur@grubano.com',
      bio: 'Créateur food basé à Avignon — recettes maison et bons plans Grubano.',
      instagram: '@marco.food',
      tiktok: '@marco.food',
      followers: 48200,
      verified: true,
      referralCode: 'DEMO20',
      referralLinkSlug: 'demo20',
    },
  })
  for (const d of DEMO_DISHES) {
    await prisma.creatorDish.upsert({
      where:  { id: d.id },
      update: { status: 'approved', totalSales: randInt(20, 120) },
      create: {
        id: d.id,
        creatorId: creator.id,
        name: d.name,
        description: `${d.name} — recette signature de Marco, adoptée par plusieurs marques Grubano.`,
        ingredients: d.ingredients,
        suggestedPrice: d.suggestedPrice,
        cuisineType: d.cuisineType,
        status: 'approved',
        commission: 0.04,
        totalSales: randInt(20, 120),
      },
    })
  }
  console.log(`[5/8] Creator createur@grubano.com (code DEMO20) + ${DEMO_DISHES.length} dishes.`)

  // ── Referral binding (customer ↔ creator) ───────────────────────────────────────
  const startedAt = new Date(NOW - 26 * DAY)
  const expiresAt = new Date(startedAt.getTime() + DURATION_DAYS * DAY)
  const referral = await prisma.referral.upsert({
    where:  { id: 'demo-referral-1' },
    update: { codeUsed: 'DEMO20', active: true, startedAt, expiresAt, customerId: referredCustomerId },
    create: {
      id: 'demo-referral-1',
      creatorId: creator.id,
      customerId: referredCustomerId,
      codeUsed: 'DEMO20',
      startedAt,
      expiresAt,
      active: true,
    },
  })

  // ── Orders ───────────────────────────────────────────────────────────────────
  // 20 orders spread over the last 30 days. Indices 0–5: "referred" delivered
  // orders by the bound customer (get a ReferralOrder). 6–13: other delivered
  // orders. 14–19: live orders (recent) for the "commandes en cours" panel.
  const REFERRED_COUNT       = 6
  const referredDaysAgo      = [24, 21, 18, 14, 10, 6]
  const otherDeliveredDays   = [30, 28, 26, 23, 19, 16, 11, 5]
  const liveStatuses         = ['preparing', 'preparing', 'ready', 'ready', 'received', 'received']
  const liveHoursAgo         = [2, 4, 8, 11, 0.5, 0.8]

  const orderSpecs = []
  for (let i = 0; i < 20; i++) {
    const isLive     = i >= 14
    const isReferred = i < REFERRED_COUNT
    const restaurant = restaurants[i % restaurants.length]

    let status, createdAt
    if (isLive) {
      status    = liveStatuses[i - 14]
      createdAt = new Date(NOW - liveHoursAgo[i - 14] * HOUR)
    } else {
      status        = 'delivered'
      const daysAgo = isReferred ? referredDaysAgo[i] : otherDeliveredDays[i - REFERRED_COUNT]
      createdAt     = new Date(NOW - daysAgo * DAY - randInt(0, 23) * HOUR)
    }

    const fulfillmentType = i % 3 === 2 ? 'pickup' : 'delivery'
    const deliveryFee     = fulfillmentType === 'pickup' ? 0 : 1.99
    const { items, subtotal } = buildItems()
    const total           = round2(subtotal + deliveryFee)
    const deliveryAddress = fulfillmentType === 'pickup'
      ? `Retrait sur place — ${restaurant.address}`
      : pick(ADDRESSES)
    const consumerId      = isReferred ? referredCustomerId : consumerCycle[i % consumerCycle.length]
    // Attribute 6 delivered orders (indices 8–13) to the franchise POS rows.
    const pointOfSaleId   = (i >= 8 && i <= 13) ? posRows[(i - 8) % posRows.length].id : null
    const referralCode    = isReferred ? 'DEMO20' : null

    orderSpecs.push({
      id: `demo-order-${String(i + 1).padStart(2, '0')}`,
      consumerId,
      restaurantId: restaurant.id,
      items,
      subtotal,
      deliveryFee,
      total,
      status,
      fulfillmentType,
      deliveryAddress,
      paymentMethod: i % 4 === 0 ? 'cash' : 'card',
      pointsEarned: Math.floor(subtotal),
      pointOfSaleId,
      referralCode,
      createdAt,
      isReferred,
    })
  }

  for (const o of orderSpecs) {
    const { isReferred, ...data } = o
    await prisma.order.upsert({
      where:  { id: o.id },
      update: {
        consumerId: data.consumerId, restaurantId: data.restaurantId, items: data.items,
        subtotal: data.subtotal, deliveryFee: data.deliveryFee, total: data.total,
        status: data.status, fulfillmentType: data.fulfillmentType, deliveryAddress: data.deliveryAddress,
        paymentMethod: data.paymentMethod, pointsEarned: data.pointsEarned,
        pointOfSaleId: data.pointOfSaleId, referralCode: data.referralCode, createdAt: data.createdAt,
      },
      create: data,
    })
  }
  console.log(`[6/8] Orders: ${orderSpecs.length} (14 delivered / 6 live), 6 attributed to franchise POS.`)

  // ── ReferralOrders for the 6 referred delivered orders ──────────────────────────
  let totalCreatorEarning = 0
  const referredOrders = orderSpecs.filter(o => o.isReferred)
  for (let i = 0; i < referredOrders.length; i++) {
    const o = referredOrders[i]
    const grubanoFee     = round2(o.subtotal * GRUBANO_FEE_PCT)
    const creatorEarning = round2(grubanoFee * COMMISSION_PCT)
    totalCreatorEarning += creatorEarning
    await prisma.referralOrder.upsert({
      where:  { orderId: o.id },            // orderId is @unique
      update: { referralId: referral.id, grubanoFee, creatorEarning, createdAt: o.createdAt },
      create: {
        id: `demo-reforder-${String(i + 1).padStart(2, '0')}`,
        referralId: referral.id,
        orderId: o.id,
        grubanoFee,
        creatorEarning,
        createdAt: o.createdAt,
      },
    })
  }
  await prisma.creator.update({
    where: { id: creator.id },
    data:  { totalEarnings: round2(totalCreatorEarning) },
  })
  console.log(`[7/8] ReferralOrders: ${referredOrders.length} (creator earnings €${round2(totalCreatorEarning)}).`)

  // ── Creator-recipe adoptions (brique 3A) ────────────────────────────────────────
  // AdoptionConfig holds the commercial parameters (single global row). Per-sale
  // creatorEarning / grubanoCut are FROZEN on each DishSale, never recomputed on
  // read — same freeze-at-write pattern as ReferralOrder.
  const adoptionConfig = await prisma.adoptionConfig.upsert({
    where:  { id: 'default' },
    create: {
      id: 'default',
      minCommitmentDays: 60,
      successThresholdEur: 300,
      creatorCommissionPct: 0.04,           // LEGACY single rate (kept for rétrocompat)
      creatorCommissionPctReferred: 0.04,   // levier 1 — FORT: recipe creator's own traffic
      creatorCommissionPctOrganic: 0.01,    // levier 1 — RÉDUIT: organic / other creator
      grubanoCutPct: 0.20,
      active: true,
    },
    update: {}, // never overwrite tuned values
  })
  const CREATOR_COMMISSION_PCT = adoptionConfig.creatorCommissionPct
  const GRUBANO_CUT_PCT        = adoptionConfig.grubanoCutPct

  // Two adoptions: a Brand puts a creator recipe on its menu. adoption-1 (Gnocchi
  // Bar adopts Marco's truffle gnocchi) WORKS — cumulative sales clear the €300
  // success threshold. adoption-2 (Bowl Healthy adopts the poke bowl) does NOT —
  // only a couple of sales, well under €300.
  const adoptionSpecs = [
    {
      id: 'demo-adoption-1',
      creatorDishId: 'demo-dish-1',                         // Gnocchi truffe & parmesan
      brandId: franchisorBrands[0].id,                      // demo-brand-1 — Gnocchi Bar
      menuItemId: `demo-menu-${franchisorBrands[0].id}-1`,
      sellingPrice: 14.5,
      salesCount: 15,                                       // qty 1/2 → ~€333.5 > €300 (WORKS)
      qtyPattern: (i) => (i % 2 === 0 ? 2 : 1),
    },
    {
      id: 'demo-adoption-2',
      creatorDishId: 'demo-dish-2',                         // Bowl poke saumon avocat
      brandId: franchisorBrands[1].id,                      // demo-brand-2 — Bowl Healthy
      menuItemId: `demo-menu-${franchisorBrands[1].id}-1`,
      sellingPrice: 13.9,
      salesCount: 3,                                        // €41.70 < €300 (DOES NOT WORK)
      qtyPattern: () => 1,
    },
  ]

  const adoptedAt = new Date(NOW - 25 * DAY)
  let adoptionSalesTotal = 0
  for (let a = 0; a < adoptionSpecs.length; a++) {
    const spec = adoptionSpecs[a]
    await prisma.dishAdoption.upsert({
      where:  { id: spec.id },
      update: {
        creatorDishId: spec.creatorDishId, brandId: spec.brandId, menuItemId: spec.menuItemId,
        sellingPrice: spec.sellingPrice, minCommitmentDays: adoptionConfig.minCommitmentDays,
        status: 'active', adoptedAt,
      },
      create: {
        id: spec.id,
        creatorDishId: spec.creatorDishId,
        brandId: spec.brandId,
        menuItemId: spec.menuItemId,
        sellingPrice: spec.sellingPrice,
        minCommitmentDays: adoptionConfig.minCommitmentDays,
        status: 'active',
        adoptedAt,
      },
    })

    // Spread the sales across the window since the adoption started (~24 days →
    // ~1 day ago). DishSale.orderId stays null (a sale can exist without a
    // consumer Order row), keeping this seed decoupled from the orders above.
    const tag = a === 0 ? 'a1' : 'a2'
    let cumulative = 0
    for (let i = 0; i < spec.salesCount; i++) {
      const qty            = spec.qtyPattern(i)
      const amount         = round2(spec.sellingPrice * qty)
      const creatorEarning = round2(amount * CREATOR_COMMISSION_PCT)        // FROZEN
      const grubanoCut     = round2(creatorEarning * GRUBANO_CUT_PCT)       // FROZEN
      cumulative += amount
      const daysAgo   = 24 - i * (23 / Math.max(spec.salesCount - 1, 1))
      const createdAt = new Date(NOW - daysAgo * DAY - randInt(0, 23) * HOUR)
      const saleId    = `demo-sale-${tag}-${String(i + 1).padStart(2, '0')}`
      await prisma.dishSale.upsert({
        where:  { id: saleId },
        update: { adoptionId: spec.id, amount, creatorEarning, grubanoCut, rateApplied: CREATOR_COMMISSION_PCT, createdAt },
        create: { id: saleId, adoptionId: spec.id, amount, creatorEarning, grubanoCut, rateApplied: CREATOR_COMMISSION_PCT, createdAt },
      })
    }
    adoptionSalesTotal += cumulative
    const works = cumulative >= adoptionConfig.successThresholdEur
    console.log(`        ${spec.id}: ${spec.salesCount} sales, €${round2(cumulative)} ${works ? `(WORKS ≥ €${adoptionConfig.successThresholdEur})` : '(below threshold)'}`)
  }
  console.log(`[8/8] Adoptions: 2 (AdoptionConfig + DishSale timestamped over 30d), total €${round2(adoptionSalesTotal)}.`)

  // ── Summary ────────────────────────────────────────────────────────────────────
  console.log('\n============================================================')
  console.log('  ✅ Demo data seeded successfully (idempotent).')
  console.log('------------------------------------------------------------')
  console.log('  Demo logins (password for franchise + creator: Demo1234!):')
  console.log('    Restaurateur : test@grubano.com / Test1234! (consumer)')
  console.log('    Franchise    : franchise@grubano.com / Demo1234!')
  console.log('    Créateur     : createur@grubano.com / Demo1234!  (code DEMO20)')
  console.log("    RESTO DE TEST → resto@grubano.com / Test1234! (role restaurant, marque 'Resto Test')")
  console.log('  Re-running this script refreshes the same demo-* rows — no dupes.')
  console.log('============================================================')
}

main()
  .catch((err) => { console.error('[seed-demo-data] FAILED:', err); process.exit(1) })
  .finally(() => prisma.$disconnect())
