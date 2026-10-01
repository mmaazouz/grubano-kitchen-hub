#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// PURGE DES ARTEFACTS DE TEST (hygiène pré-live, Agent 13).
//
// RÈGLE D'OR : Marco (demo-creator / demo20) et TOUT son historique (recettes,
// adoptions, ventes, parrainages, étoiles) sont INTOUCHABLES — la démo et les
// tests vivent dessus. Une garde codée EXCLUT toute ligne Marco même si un
// motif la matche.
//
// CIBLE : les artefacts « Weyss » UNIQUEMENT —
//   • Creator slugs 'weyssvm3j' (FAUSSEMENT verified — profil public à risque)
//     et 'weyssplmh' (+ tout creator dont slug/email/nom matche /weyss/i),
//     avec leurs dépendances dans l'ordre FK :
//       DishSale → DishAdoption → AdoptionWaitlist → ReferralOrder → Referral
//       → CreatorDish → Creator
//     (les MenuItem créés par leurs adoptions sont DÉSACTIVÉS — available=false
//      — jamais supprimés : des Order historiques peuvent les référencer.)
//   • Leurs CreatorApplication (même email ou nom weyss).
//   • Leurs comptes Operator UNIQUEMENT s'ils sont dédiés aux tests : zéro
//     brand, zéro restaurant, zéro point de vente, zéro commande (consumerId),
//     zéro réservation. AU MOINDRE doute → EXCLU et listé comme tel.
//   • Les CreatorApplication flagged/rejected ORPHELINES (aucun Creator avec
//     le même email).
//
// COMPORTEMENT :
//   node scripts/purge-test-artifacts.js              → DRY-RUN (zéro write)
//   node scripts/purge-test-artifacts.js --execute    → suppression réelle,
//     dans UNE transaction, même listing en sortie.
//
// SERVEUR (pattern connu) :
//   cd ~/app.grubano.com
//   source ~/nodevenv/app.grubano.com/24/bin/activate
//   node scripts/purge-test-artifacts.js
// .env.local du dossier courant est chargé automatiquement si DATABASE_URL
// n'est pas déjà dans l'environnement.
// ─────────────────────────────────────────────────────────────────────────────

'use strict'

const fs = require('fs')
const path = require('path')

// ── Loader .env.local (pattern notion-sync) ────────────────────────────────────
if (!process.env.DATABASE_URL) {
  for (const dir of [process.cwd(), path.join(__dirname, '..')]) {
    const envFile = path.join(dir, '.env.local')
    if (!fs.existsSync(envFile)) continue
    for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^DATABASE_URL=(.+)$/)
      if (m) { process.env.DATABASE_URL = m[1].trim().replace(/^["']|["']$/g, ''); break }
    }
    if (process.env.DATABASE_URL) break
  }
}
if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL manquant (env ou .env.local).')
  process.exit(1)
}

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const EXECUTE = process.argv.includes('--execute')

// ── La règle d'or, codée ────────────────────────────────────────────────────────
const WEYSS_SLUGS = ['weyssvm3j', 'weyssplmh']
const WEYSS_RE    = /weyss/i
const PROTECTED_RE = /demo[-_ ]?creator|demo20|marco/i

function isProtected(c) {
  return PROTECTED_RE.test(c.referralLinkSlug ?? '')
    || PROTECTED_RE.test(c.referralCode ?? '')
    || PROTECTED_RE.test(c.email ?? '')
    || PROTECTED_RE.test(c.name ?? '')
}

const eur = (n) => `${(n ?? 0).toFixed(2)} €`

async function main() {
  console.log('═'.repeat(72))
  console.log(`  PURGE ARTEFACTS DE TEST — ${EXECUTE ? '⚠️  EXÉCUTION RÉELLE' : 'DRY RUN (zéro write)'}`)
  console.log('═'.repeat(72))

  // ── 1. Locate the Weyss creators ─────────────────────────────────────────────
  const candidates = await prisma.creator.findMany({
    where: {
      OR: [
        { referralLinkSlug: { in: WEYSS_SLUGS } },
        { referralCode:     { in: WEYSS_SLUGS.map(s => s.toUpperCase()) } },
        { name:  { contains: 'weyss' } },
        { email: { contains: 'weyss' } },
      ],
    },
    select: {
      id: true, name: true, email: true, verified: true,
      referralLinkSlug: true, referralCode: true, totalEarnings: true,
    },
  })

  const protectedHits = candidates.filter(isProtected)
  const targets       = candidates.filter(c => !isProtected(c) && (
    WEYSS_SLUGS.includes(c.referralLinkSlug ?? '') || WEYSS_RE.test(`${c.name} ${c.email} ${c.referralLinkSlug ?? ''}`)
  ))

  if (protectedHits.length) {
    console.log('\n🛡️  PROTÉGÉS (règle d’or Marco — jamais touchés malgré un match) :')
    for (const c of protectedHits) console.log(`   - ${c.id} ${c.name} <${c.email}> slug=${c.referralLinkSlug}`)
  }
  if (targets.length === 0) {
    console.log('\n✅ Aucun creator Weyss trouvé — rien à purger côté creators.')
  } else {
    console.log(`\n🎯 CREATORS CIBLÉS (${targets.length}) :`)
    for (const c of targets) {
      console.log(`   - ${c.id} ${c.name} <${c.email}> slug=${c.referralLinkSlug} verified=${c.verified}${c.verified ? '  ⚠️ FAUSSEMENT VÉRIFIÉ' : ''} gains=${eur(c.totalEarnings)}`)
    }
  }

  const creatorIds = targets.map(c => c.id)
  const emails     = targets.map(c => c.email).filter(Boolean)

  // ── 2. Walk the REAL FK dependencies (schema-verified) ───────────────────────
  const dishes = creatorIds.length ? await prisma.creatorDish.findMany({
    where:  { creatorId: { in: creatorIds } },
    select: { id: true, name: true, status: true },
  }) : []
  const dishIds = dishes.map(d => d.id)

  const adoptions = dishIds.length ? await prisma.dishAdoption.findMany({
    where:  { creatorDishId: { in: dishIds } },
    select: { id: true, status: true, menuItemId: true, brand: { select: { name: true } } },
  }) : []
  const adoptionIds = adoptions.map(a => a.id)
  const menuItemIds = adoptions.map(a => a.menuItemId).filter(Boolean)

  const sales = adoptionIds.length ? await prisma.dishSale.findMany({
    where:  { adoptionId: { in: adoptionIds } },
    select: { id: true, amount: true, creatorEarning: true, status: true },
  }) : []

  const waitlist = dishIds.length ? await prisma.adoptionWaitlist.findMany({
    where:  { creatorDishId: { in: dishIds } },
    select: { id: true, status: true, city: true },
  }) : []

  const referrals = creatorIds.length ? await prisma.referral.findMany({
    where:   { creatorId: { in: creatorIds } },
    include: { orders: { select: { id: true, creatorEarning: true } } },
  }) : []
  const referralIds      = referrals.map(r => r.id)
  const referralOrderIds = referrals.flatMap(r => r.orders.map(o => o.id))

  const applications = await prisma.creatorApplication.findMany({
    where: {
      OR: [
        ...(emails.length ? [{ email: { in: emails } }] : []),
        { name:  { contains: 'weyss' } },
        { email: { contains: 'weyss' } },
      ],
    },
    select: { id: true, name: true, email: true, status: true },
  })

  // Orphan flagged/rejected applications (no Creator with the same email).
  const orphanApps = []
  const flaggedApps = await prisma.creatorApplication.findMany({
    where:  { status: { in: ['flagged', 'rejected'] } },
    select: { id: true, name: true, email: true, status: true },
  })
  for (const a of flaggedApps) {
    if (applications.find(x => x.id === a.id)) continue // already targeted (weyss)
    const linked = await prisma.creator.findUnique({ where: { email: a.email }, select: { id: true } })
    if (!linked) orphanApps.push(a)
  }

  // ── 3. Operator accounts — ONLY if strictly test-dedicated ───────────────────
  const operatorsSafe = []
  const operatorsExcluded = []
  for (const email of emails) {
    const op = await prisma.operator.findUnique({
      where:  { email },
      select: { id: true, email: true, role: true },
    })
    if (!op) continue
    const [brands, restos, pos, orders, reservations] = await Promise.all([
      prisma.brand.count({ where: { operatorId: op.id } }),
      prisma.restaurant.count({ where: { operatorId: op.id } }),
      prisma.pointOfSale.count({ where: { operatorId: op.id } }).catch(() => 0),
      prisma.order.count({ where: { consumerId: op.id } }),
      prisma.reservation.count({ where: { userId: op.id } }).catch(() => 0),
    ])
    const attached = { brands, restos, pos, orders, reservations }
    if (brands + restos + pos + orders + reservations === 0) {
      operatorsSafe.push(op)
    } else {
      // The slightest doubt → EXCLUDED, listed with the reason.
      operatorsExcluded.push({ ...op, attached })
    }
  }

  // ── 4. The listing (table by table, ids + labels + counts + € totals) ────────
  const salesTotal    = sales.reduce((s, x) => s + (x.amount ?? 0), 0)
  const earningsTotal = sales.reduce((s, x) => s + (x.creatorEarning ?? 0), 0)
  const refEarnings   = referrals.flatMap(r => r.orders).reduce((s, o) => s + (o.creatorEarning ?? 0), 0)

  console.log('\n' + '─'.repeat(72))
  console.log('  CE QUI SERAIT SUPPRIMÉ' + (EXECUTE ? ' (ET VA L’ÊTRE)' : ''))
  console.log('─'.repeat(72))
  console.log(`\n  DishSale            : ${sales.length}  (CA ${eur(salesTotal)}, gains créateur ${eur(earningsTotal)})`)
  for (const s of sales.slice(0, 20)) console.log(`     - ${s.id} ${eur(s.amount)} [${s.status}]`)
  if (sales.length > 20) console.log(`     … +${sales.length - 20}`)
  console.log(`\n  DishAdoption        : ${adoptions.length}`)
  for (const a of adoptions) console.log(`     - ${a.id} [${a.status}] marque=${a.brand?.name ?? '?'} menuItem=${a.menuItemId ?? '—'}`)
  console.log(`\n  MenuItem (adoptés)  : ${menuItemIds.length}  → DÉSACTIVÉS (available=false), JAMAIS supprimés (commandes historiques)`)
  console.log(`\n  AdoptionWaitlist    : ${waitlist.length}`)
  for (const w of waitlist) console.log(`     - ${w.id} [${w.status}] ${w.city}`)
  console.log(`\n  ReferralOrder       : ${referralOrderIds.length}  (gains parrainage ${eur(refEarnings)})`)
  console.log(`  Referral            : ${referrals.length}`)
  console.log(`\n  CreatorDish         : ${dishes.length}`)
  for (const d of dishes) console.log(`     - ${d.id} « ${d.name} » [${d.status}]`)
  console.log(`\n  Creator             : ${targets.length}`)
  console.log(`\n  CreatorApplication (weyss)             : ${applications.length}`)
  for (const a of applications) console.log(`     - ${a.id} ${a.name} <${a.email}> [${a.status}]`)
  console.log(`  CreatorApplication (orphelines f/r)    : ${orphanApps.length}`)
  for (const a of orphanApps) console.log(`     - ${a.id} ${a.name} <${a.email}> [${a.status}]`)
  console.log(`\n  Operator (dédiés test, 0 donnée liée) : ${operatorsSafe.length}`)
  for (const o of operatorsSafe) console.log(`     - ${o.id} <${o.email}> role=${o.role}`)
  if (operatorsExcluded.length) {
    console.log(`\n  ⚠️  Operator EXCLUS (données accrochées — au moindre doute on n’y touche pas) :`)
    for (const o of operatorsExcluded) {
      console.log(`     - ${o.id} <${o.email}> ${JSON.stringify(o.attached)}`)
    }
  }

  const totalRows = sales.length + adoptions.length + waitlist.length
    + referralOrderIds.length + referrals.length + dishes.length + targets.length
    + applications.length + orphanApps.length + operatorsSafe.length
  console.log('\n' + '─'.repeat(72))
  console.log(`  TOTAL : ${totalRows} lignes — €${(salesTotal + refEarnings).toFixed(2)} de flux de test`)
  console.log('─'.repeat(72))

  if (!EXECUTE) {
    console.log('\n✅ DRY RUN — zéro write. Validation Agent 0 requise avant --execute.')
    return
  }

  // ── 5. REAL EXECUTION — one transaction, FK order ────────────────────────────
  console.log('\n⚠️  Exécution dans une transaction…')
  await prisma.$transaction(async (tx) => {
    if (adoptionIds.length) await tx.dishSale.deleteMany({ where: { adoptionId: { in: adoptionIds } } })
    if (menuItemIds.length) await tx.menuItem.updateMany({ where: { id: { in: menuItemIds } }, data: { available: false } })
    if (dishIds.length)     await tx.dishAdoption.deleteMany({ where: { creatorDishId: { in: dishIds } } })
    if (dishIds.length)     await tx.adoptionWaitlist.deleteMany({ where: { creatorDishId: { in: dishIds } } })
    if (referralIds.length) await tx.referralOrder.deleteMany({ where: { referralId: { in: referralIds } } })
    if (creatorIds.length)  await tx.referral.deleteMany({ where: { creatorId: { in: creatorIds } } })
    if (dishIds.length)     await tx.creatorDish.deleteMany({ where: { id: { in: dishIds } } })
    if (creatorIds.length)  await tx.creator.deleteMany({ where: { id: { in: creatorIds } } })
    const appIds = [...applications.map(a => a.id), ...orphanApps.map(a => a.id)]
    if (appIds.length)      await tx.creatorApplication.deleteMany({ where: { id: { in: appIds } } })
    for (const op of operatorsSafe) {
      await tx.session.deleteMany({ where: { userId: op.id } })
      await tx.account.deleteMany({ where: { userId: op.id } })
      await tx.operator.delete({ where: { id: op.id } })
    }
  })
  console.log('✅ PURGE EXÉCUTÉE — listing ci-dessus = ce qui a été supprimé.')
}

main()
  .catch((e) => { console.error('❌ Purge échouée (rien de partiel hors transaction) :', e.message); process.exit(1) })
  .finally(() => prisma.$disconnect())
