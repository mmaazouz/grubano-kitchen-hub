// scripts/diag-creator-inventory.js
// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY diagnostic — CREATOR STUDIO inventory (pivot créateur/influenceur,
// 12 juin). Dumps everything the pivot planning needs to know about the real
// data: creators, dishes, adoptions (with CITY — the exclusivity key), sales,
// referral orders, configs, waitlist, applications.
//
//   ⚠️  SELECT ONLY. This script NEVER writes: no create / update / delete,
//       no upsert, no $executeRaw. It only reads (count / findMany / groupBy /
//       aggregate) and logs. Fully idempotent, zero side effects.
//
// Usage (cPanel Terminal on STAGING, from the app root — or locally if your
// .env.local DATABASE_URL points at a DB you can reach):
//   node scripts/diag-creator-inventory.js
// ─────────────────────────────────────────────────────────────────────────────

'use strict'

const fs   = require('fs')
const path = require('path')

// ── Load DATABASE_URL from .env.local if not already in env (shared loader) ───
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
  console.error('[diag-creator-inventory] DATABASE_URL not set (checked env + .env.local). Aborting.')
  process.exit(1)
}

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const hr = (title) => console.log(`\n──────── ${title} ────────`)
const eur = (n) => `${(n ?? 0).toFixed(2)} €`

async function main() {
  console.log('CREATOR STUDIO — INVENTAIRE DONNÉES (read-only)')
  console.log('DB host:', (process.env.DATABASE_URL.match(/@([^:/]+)/) || [])[1] || '?')

  // ── Creator ─────────────────────────────────────────────────────────────────
  hr('Creator')
  const creators = await prisma.creator.findMany({
    select: { id: true, name: true, email: true, referralCode: true, referralLinkSlug: true, verified: true, followers: true },
    orderBy: { createdAt: 'asc' },
  })
  console.log('count:', creators.length)
  for (const c of creators) {
    console.log(` - ${c.id} | ${c.name} | slug=${c.referralLinkSlug ?? '∅'} | code=${c.referralCode ?? '∅'} | verified=${c.verified} | followers=${c.followers}`)
  }

  // ── CreatorDish ─────────────────────────────────────────────────────────────
  hr('CreatorDish')
  const dishByStatus = await prisma.creatorDish.groupBy({ by: ['status'], _count: { _all: true } })
  console.log('par statut:', dishByStatus.map((g) => `${g.status}=${g._count._all}`).join(' · ') || '(vide)')
  const dishes = await prisma.creatorDish.findMany({
    select: { id: true, name: true, suggestedPrice: true, photo: true, status: true, cuisineType: true, creator: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
  })
  for (const d of dishes) {
    console.log(` - ${d.name} (${d.creator?.name ?? '?'}) | ${d.status} | ${eur(d.suggestedPrice)} | photo=${d.photo ? 'OUI' : 'null'} | ${d.cuisineType}`)
  }

  // ── DishAdoption ────────────────────────────────────────────────────────────
  hr('DishAdoption')
  const adoptByStatus = await prisma.dishAdoption.groupBy({ by: ['status'], _count: { _all: true } })
  console.log('par statut:', adoptByStatus.map((g) => `${g.status}=${g._count._all}`).join(' · ') || '(vide)')
  const actives = await prisma.dishAdoption.findMany({
    where: { status: 'active' },
    select: {
      id: true, adoptedAt: true, sellingPrice: true,
      creatorDish: { select: { name: true } },
      brand: { select: { name: true, restaurant: { select: { name: true, city: true, lat: true, lng: true } } } },
    },
    orderBy: { adoptedAt: 'asc' },
  })
  for (const a of actives) {
    const r = a.brand?.restaurant
    console.log(` - ACTIVE ${a.creatorDish?.name} → marque ${a.brand?.name ?? '?'} | resto ${r?.name ?? '?'} | VILLE ${r?.city ?? '∅'} | geo=${r?.lat != null && r?.lng != null ? 'lat/lng OK' : 'ABSENTE'} | ${eur(a.sellingPrice)} | adoptedAt ${a.adoptedAt.toISOString().slice(0, 10)}`)
  }

  // ── DishSale ────────────────────────────────────────────────────────────────
  hr('DishSale')
  const saleAgg = await prisma.dishSale.aggregate({ _count: { _all: true }, _sum: { amount: true, creatorEarning: true } })
  console.log(`count: ${saleAgg._count._all} | Σ amount: ${eur(saleAgg._sum.amount)} | Σ creatorEarning: ${eur(saleAgg._sum.creatorEarning)}`)
  const saleByStatus = await prisma.dishSale.groupBy({ by: ['status'], _count: { _all: true }, _sum: { creatorEarning: true } })
  for (const g of saleByStatus) console.log(` - ${g.status}: ${g._count._all} lignes | Σ earning ${eur(g._sum.creatorEarning)}`)
  const rates = await prisma.dishSale.groupBy({ by: ['rateApplied'], _count: { _all: true } })
  console.log('rateApplied distincts:', rates.map((g) => `${g.rateApplied ?? 'null'}×${g._count._all}`).join(' · ') || '(vide)')

  // ── ReferralOrder ───────────────────────────────────────────────────────────
  hr('ReferralOrder')
  const roAgg = await prisma.referralOrder.aggregate({ _count: { _all: true }, _sum: { creatorEarning: true, grubanoFee: true, newCustomerBonus: true } })
  console.log(`count: ${roAgg._count._all} | Σ creatorEarning: ${eur(roAgg._sum.creatorEarning)} | Σ grubanoFee: ${eur(roAgg._sum.grubanoFee)} | Σ bonus: ${eur(roAgg._sum.newCustomerBonus)}`)
  const roByStatus = await prisma.referralOrder.groupBy({ by: ['status'], _count: { _all: true }, _sum: { creatorEarning: true } })
  for (const g of roByStatus) console.log(` - ${g.status}: ${g._count._all} lignes | Σ earning ${eur(g._sum.creatorEarning)}`)

  // ── Configs ─────────────────────────────────────────────────────────────────
  hr('AdoptionConfig (toutes les rows)')
  const aCfgs = await prisma.adoptionConfig.findMany()
  for (const c of aCfgs) {
    console.log(` - id=${c.id} active=${c.active} | minCommitmentDays=${c.minCommitmentDays} | successThresholdEur=${c.successThresholdEur} | LEGACY creatorCommissionPct=${c.creatorCommissionPct} | referred=${c.creatorCommissionPctReferred} | organic=${c.creatorCommissionPctOrganic} | grubanoCutPct=${c.grubanoCutPct}`)
  }
  hr('ReferralConfig (toutes les rows)')
  const rCfgs = await prisma.referralConfig.findMany()
  for (const c of rCfgs) {
    console.log(` - id=${c.id} active=${c.active} | commissionPctOfGrubanoFee=${c.commissionPctOfGrubanoFee} | durationDays=${c.durationDays} | customerDiscountPct=${c.customerDiscountPct} | customerDiscountCap=${c.customerDiscountCap ?? '?'} | newCustomerBonusAmount=${c.newCustomerBonusAmount}`)
  }

  // ── AdoptionWaitlist + CreatorApplication ───────────────────────────────────
  hr('AdoptionWaitlist')
  const wlByStatus = await prisma.adoptionWaitlist.groupBy({ by: ['status'], _count: { _all: true } })
  console.log('par statut:', wlByStatus.map((g) => `${g.status}=${g._count._all}`).join(' · ') || '(vide)')
  hr('CreatorApplication')
  const appByStatus = await prisma.creatorApplication.groupBy({ by: ['status'], _count: { _all: true } })
  console.log('par statut:', appByStatus.map((g) => `${g.status}=${g._count._all}`).join(' · ') || '(vide)')

  console.log('\n[diag-creator-inventory] Done — zero write performed.')
}

main()
  .catch((e) => { console.error('[diag-creator-inventory] FAILED:', e.message); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
