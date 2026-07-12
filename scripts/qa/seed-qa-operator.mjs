#!/usr/bin/env node
/**
 * seed-qa-operator.mjs — idempotent STAGING-ONLY seed for the operator visual-QA robot.
 *
 * Creates (or refreshes) ONE real test operator + a minimal, self-consistent data set
 * (restaurant / brand / menu / stock / loyalty customer) so the auth-gated operator
 * screens render with real content when the robot logs in as this account.
 *
 * ⚠️ TOOLING ONLY — this NEVER touches app code, routes, money, auth or the schema.
 *    It only writes ordinary rows through Prisma, exactly like a normal signup would.
 *
 * ⚠️⚠️ HARD PROD-GUARD — see requireStaging(). This refuses to run unless it is
 *    EXPLICITLY confirmed for staging, and it prints the target DB host + database +
 *    QA_EMAIL before writing so a human can eyeball the target.
 *
 * Usage (STAGING ONLY):
 *   DATABASE_URL=$DATABASE_URL_STAGING \
 *   QA_EMAIL='qa+op@grubano.test' QA_PASSWORD='<pick-a-strong-one>' \
 *   QA_SEED_CONFIRM=STAGING_ONLY \
 *   node scripts/qa/seed-qa-operator.mjs --confirm-staging
 */
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

/* ── parse the DB target out of DATABASE_URL for the pre-flight print ──────────── */
function describeDb(url) {
  try {
    // mysql://user:pass@host:port/dbname?params — mask the password.
    const u = new URL(url)
    return { host: u.hostname || '(none)', db: (u.pathname || '').replace(/^\//, '') || '(none)' }
  } catch {
    return { host: '(unparseable)', db: '(unparseable)' }
  }
}

/* ── HARD PROD-GUARD — must be impossible to run against prod by accident ──────── */
function requireStaging() {
  const email = process.env.QA_EMAIL || ''
  const password = process.env.QA_PASSWORD || ''
  const dbUrl = process.env.DATABASE_URL || ''
  const confirmFlag = process.argv.includes('--confirm-staging')
  const confirmEnv = process.env.QA_SEED_CONFIRM === 'STAGING_ONLY'
  const nextauthUrl = process.env.NEXTAUTH_URL || ''
  const force = process.env.FORCE === '1'

  // 1) BOTH explicit confirmations are required.
  if (!confirmFlag || !confirmEnv) {
    console.error('❌ Refused: pass BOTH --confirm-staging AND QA_SEED_CONFIRM=STAGING_ONLY.')
    process.exit(1)
  }
  // 2) Required inputs must be present.
  if (!dbUrl) {
    console.error('❌ Refused: DATABASE_URL is empty.')
    process.exit(1)
  }
  if (!email || !password) {
    console.error('❌ Refused: QA_EMAIL and QA_PASSWORD must both be set.')
    process.exit(1)
  }
  // 3) The email MUST look test-ish — reject a plain real-looking address.
  const testish = email.includes('+qa') || email.endsWith('.test') || email.endsWith('.qa')
  if (!testish) {
    console.error(`❌ Refused: QA_EMAIL "${email}" is not test-ish. Require a '+qa' tag, or a '.test' / '.qa' TLD.`)
    process.exit(1)
  }
  // 4) Never the known prod URL (unless the operator opts in via FORCE=1 — documented as dangerous).
  if (nextauthUrl === 'https://grubano.com' && !force) {
    console.error('❌ Refused: NEXTAUTH_URL is the PROD url (https://grubano.com). Set FORCE=1 only if you REALLY mean it (dangerous).')
    process.exit(1)
  }

  const { host, db } = describeDb(dbUrl)
  console.log('── QA seed pre-flight ─────────────────────────────────────────')
  console.log(`   target DB host : ${host}`)
  console.log(`   target database: ${db}`)
  console.log(`   QA_EMAIL       : ${email}`)
  console.log(`   NEXTAUTH_URL   : ${nextauthUrl || '(unset)'}`)
  console.log('   guard          : --confirm-staging ✓  QA_SEED_CONFIRM=STAGING_ONLY ✓')
  console.log('───────────────────────────────────────────────────────────────')
  return { email, password }
}

/* ── find-or-create helpers (no unique key on Restaurant/Brand/MenuItem/StockItem) ─ */
async function findOrCreate(model, where, create) {
  const existing = await model.findFirst({ where })
  if (existing) return { row: existing, created: false }
  return { row: await model.create({ data: create }), created: true }
}

async function main() {
  const { email, password } = requireStaging()
  const prisma = new PrismaClient()

  try {
    const passwordHash = await bcrypt.hash(password, 12) // cost 12 (project rule)

    // 1) Operator — keyed on the unique email. status 'active' so it can sign in
    //    (lib/auth refuses 'pending' / 'suspended'). role 'restaurant' → /dashboard.
    console.log('· upsert Operator …')
    const operator = await prisma.operator.upsert({
      where: { email },
      update: {
        name: 'QA Operator',
        password: passwordHash,
        role: 'restaurant',
        status: 'active',
        siren: '900123456',
        officialName: 'QA Test SARL',
        legalForm: 'sarl',
        kybStatus: 'verified',
        kybVerifiedAt: new Date(),
        vatNumber: 'FR00900123456',
        country: 'FR',
      },
      create: {
        name: 'QA Operator',
        email,
        password: passwordHash,
        role: 'restaurant',
        status: 'active',
        siren: '900123456',
        officialName: 'QA Test SARL',
        legalForm: 'sarl',
        kybStatus: 'verified',
        kybVerifiedAt: new Date(),
        vatNumber: 'FR00900123456',
        country: 'FR',
      },
    })
    console.log(`  → operator ${operator.id} (${operator.email})`)

    // 2) Restaurant — find-or-create by (operatorId, name).
    console.log('· find-or-create Restaurant …')
    const { row: restaurant, created: rNew } = await findOrCreate(
      prisma.restaurant,
      { operatorId: operator.id, name: 'QA Bistro' },
      {
        operatorId: operator.id,
        name: 'QA Bistro',
        city: 'Paris',
        address: '12 rue de la Paix',
        cuisine: ['italian'],
        isActive: true,
        deliveryFee: 2.9,
        minOrder: 15,
      },
    )
    console.log(`  → restaurant ${restaurant.id} (${rNew ? 'created' : 'existing'})`)

    // 3) Brand — find-or-create by (operatorId, restaurantId, name).
    console.log('· find-or-create Brand …')
    const { row: brand, created: bNew } = await findOrCreate(
      prisma.brand,
      { operatorId: operator.id, restaurantId: restaurant.id, name: 'QA Trattoria' },
      {
        operatorId: operator.id,
        restaurantId: restaurant.id,
        name: 'QA Trattoria',
        emoji: '🍝',
        cuisineType: 'italian',
      },
    )
    console.log(`  → brand ${brand.id} (${bNew ? 'created' : 'existing'})`)

    // 4) MenuItem ×3 — find-or-create by (brandId, name). price is in EUROS (Float).
    console.log('· find-or-create 3 MenuItems …')
    const dishes = [
      { name: 'Tagliatelles à la truffe', price: 18.0 },
      { name: 'Cacio e pepe', price: 15.0 },
      { name: 'Tiramisu maison', price: 8.0 },
    ]
    for (const d of dishes) {
      const { created } = await findOrCreate(
        prisma.menuItem,
        { brandId: brand.id, name: d.name },
        { brandId: brand.id, name: d.name, price: d.price, category: 'Plats', available: true },
      )
      console.log(`  → menu "${d.name}" (${created ? 'created' : 'existing'})`)
    }

    // 5) StockItem ×2 — find-or-create by (brandId, name).
    console.log('· find-or-create 2 StockItems …')
    const stocks = [
      { name: 'Farine 00', quantity: 12, minThreshold: 5 },
      { name: 'Parmesan', quantity: 3, minThreshold: 4 },
    ]
    for (const s of stocks) {
      const { created } = await findOrCreate(
        prisma.stockItem,
        { brandId: brand.id, name: s.name },
        { brandId: brand.id, name: s.name, quantity: s.quantity, unit: 'kg', minThreshold: s.minThreshold },
      )
      console.log(`  → stock "${s.name}" (${created ? 'created' : 'existing'})`)
    }

    // 6) LoyaltyCustomer — keyed on the unique email.
    console.log('· upsert LoyaltyCustomer …')
    const loyalCustomer = await prisma.loyaltyCustomer.upsert({
      where: { email: 'qa-loyal@grubano.test' },
      update: { name: 'QA Loyal', pointsBalance: 120, tier: 'gold' },
      create: { name: 'QA Loyal', email: 'qa-loyal@grubano.test', pointsBalance: 120, tier: 'gold' },
    })
    console.log(`  → loyaltyCustomer ${loyalCustomer.id}`)

    // 7) Marketplace (B2B supply) — SupplierProfile + catalogue + 2 SupplyOrders ────
    //    Populates the ⚠️🔒 money screens (Boutique fournisseur + Commandes fournisseurs)
    //    with REAL rows so the baseline captures them NON-empty. The supplier is left
    //    WITHOUT Stripe Connect KYB (payoutStatus 'none', no stripeAccountId) → the /pay
    //    flow stays HONESTLY gated (403 "Paiement indisponible"), never a fake charge.
    console.log('· upsert SupplierProfile (marketplace) …')
    const supplierData = {
      companyName: 'QA Metro Fournisseur', contactName: 'QA Supplier', city: 'Paris',
      categories: ['fresh', 'grocery'], deliveryZones: ['Paris', '75011'],
      minimumOrderCents: 15000, leadTimeDays: 1,
      status: 'active', marketplaceCoherencePending: false, payoutStatus: 'none',
    }
    const supplier = await prisma.supplierProfile.upsert({
      where: { email: 'qa-supplier@grubano.test' },
      update: supplierData,
      create: { email: 'qa-supplier@grubano.test', ...supplierData },
    })
    console.log(`  → supplierProfile ${supplier.id} (active, no KYB → /pay honestly gated)`)

    // Catalogue (prices in CENTS) — find-or-create by (supplierProfileId, name).
    console.log('· find-or-create 4 SupplierCatalogItems …')
    const catalog = [
      { name: 'Mozzarella di Bufala',        priceCents: 1800, unit: 'piece', packSize: 'Carton de 6×250g',  category: 'fresh' },
      { name: 'Burrata',                     priceCents: 4200, unit: 'piece', packSize: 'Carton de 12×200g', category: 'fresh' },
      { name: 'Farine 00',                   priceCents: 3200, unit: 'kg',    packSize: 'Sac 25 kg',         category: 'grocery' },
      { name: "Huile d'olive extra vierge",  priceCents: 3800, unit: 'L',     packSize: 'Bidon 5 L',         category: 'grocery' },
    ]
    const catId = {}
    for (const c of catalog) {
      const { row, created } = await findOrCreate(
        prisma.supplierCatalogItem,
        { supplierProfileId: supplier.id, name: c.name },
        { supplierProfileId: supplier.id, name: c.name, priceCents: c.priceCents, unit: c.unit, packSize: c.packSize, category: c.category, available: true },
      )
      catId[c.name] = row.id
      console.log(`  → catalogue "${c.name}" ${c.priceCents}c (${created ? 'created' : 'existing'})`)
    }

    // Two SupplyOrders — find-or-create by a stable `notes` marker (SupplyOrder has no unique key).
    //   A: confirmed + unpaid  → shows the "Payer" CTA (→ gated 403, honest, no KYB).
    //   B: delivered + paid    → shows in the "Livrées" tab with real economics (margin 1%).
    console.log('· find-or-create 2 SupplyOrders …')
    const orders = [
      { marker: 'QA-SEED-ORDER-A', status: 'confirmed', paymentStatus: 'unpaid',
        lines: [
          { name: 'Mozzarella di Bufala', unit: 'piece', qty: 4, unitPriceCents: 1800 },
          { name: 'Farine 00',            unit: 'kg',    qty: 3, unitPriceCents: 3200 },
        ] },
      { marker: 'QA-SEED-ORDER-B', status: 'delivered', paymentStatus: 'paid',
        lines: [ { name: 'Burrata', unit: 'piece', qty: 3, unitPriceCents: 4200 } ] },
    ]
    for (const o of orders) {
      const exists = await prisma.supplyOrder.findFirst({ where: { operatorId: operator.id, supplierProfileId: supplier.id, notes: o.marker } })
      if (exists) { console.log(`  → order ${o.marker} (existing)`); continue }
      const lineData = o.lines.map((l) => ({
        catalogItemId: catId[l.name] || null,
        nameSnapshot: l.name, unitSnapshot: l.unit,
        quantity: l.qty, unitPriceCents: l.unitPriceCents, lineTotalCents: l.qty * l.unitPriceCents,
      }))
      const totalCents = lineData.reduce((s, l) => s + l.lineTotalCents, 0)
      const paid = o.paymentStatus === 'paid'
      const margin = paid ? Math.round(totalCents * 0.01) : 0 // mirrors the 1% default supply economics
      await prisma.supplyOrder.create({
        data: {
          operatorId: operator.id, supplierProfileId: supplier.id,
          status: o.status, paymentStatus: o.paymentStatus, notes: o.marker, totalCents,
          chargedCents: paid ? totalCents : 0,
          grubanoMarginCents: margin,
          supplierPayoutCents: paid ? totalCents - margin : 0,
          paidAt: paid ? new Date() : null,
          lines: { create: lineData },
        },
      })
      console.log(`  → order ${o.marker} ${o.status}/${o.paymentStatus} total ${totalCents}c (created)`)
    }

    // ── Print the ids the robot needs for the dynamic [id] routes ────────────────
    console.log('\n✓ QA operator seed complete.')
    console.log('──────────────────────────────────────────────────────────────')
    console.log(`  QA_EMAIL         = ${operator.email}`)
    console.log(`  QA_RESTAURANT_ID = ${restaurant.id}`)
    console.log(`  QA_BRAND_ID      = ${brand.id}`)
    console.log(`  QA_SUPPLIER_ID   = ${supplier.id}`)
    console.log('──────────────────────────────────────────────────────────────')
    console.log('  → pass QA_RESTAURANT_ID / QA_BRAND_ID / QA_SUPPLIER_ID to operator-visual-qa.mjs')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error('seed-qa-operator failed:', e?.message || e)
  process.exit(1)
})
