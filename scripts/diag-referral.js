// scripts/diag-referral.js
// ─────────────────────────────────────────────────────────────────────────────
// READ-ONLY diagnostic. Inspects the referral attribution (brique 5B) for a
// single consumer email and prints everything we need to understand whether the
// welcome discount + Referral binding were applied as expected.
//
//   ⚠️  SELECT ONLY. This script NEVER writes: no create / update / delete,
//       no upsert, no $executeRaw. It only reads (findUnique / findMany) and
//       logs. Fully idempotent, zero side effects, safe on production.
//
// Usage (cPanel Terminal on STAGING, from the app root — or locally if your
// .env.local DATABASE_URL points at a DB you can reach):
//   node scripts/diag-referral.js jean@test.com
//
// It loads DATABASE_URL from .env.local (same loader as scripts/seed-demo-data.js)
// when the variable isn't already in the environment.
// ─────────────────────────────────────────────────────────────────────────────

'use strict'

const fs   = require('fs')
const path = require('path')

// ── 1. Load DATABASE_URL (+ any other vars) from .env.local if not in env ──────
//    Mirrors scripts/seed-demo-data.js's loader.
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
  console.error('[diag-referral] DATABASE_URL not set (checked env + .env.local). Aborting.')
  process.exit(1)
}

// ── 2. Args ────────────────────────────────────────────────────────────────────
const email = (process.argv[2] || '').trim()
if (!email) {
  console.error('[diag-referral] Usage: node scripts/diag-referral.js <email>')
  console.error('  e.g. node scripts/diag-referral.js jean@test.com')
  process.exit(1)
}

// ── small formatting helpers (display only) ────────────────────────────────────
const round2 = (n) => Math.round(n * 100) / 100
const eur    = (n) => (n === null || n === undefined ? '—' : `${round2(n)} EUR`)
const dt     = (d) => (d ? new Date(d).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '—')
const line   = () => console.log('─'.repeat(78))

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  // Masked target so the operator can eyeball which DB this read hit.
  try {
    const u = new URL(process.env.DATABASE_URL)
    const cred = u.username ? `${u.username}:***@` : ''
    console.log(`[diag-referral] DB: ${u.protocol}//${cred}${u.host}${u.pathname}`)
  } catch {
    console.log('[diag-referral] DB: (unparseable DATABASE_URL — masked)')
  }
  console.log(`[diag-referral] email: ${email}`)
  line()

  // ── 1) Operator (consumer) ───────────────────────────────────────────────────
  const operator = await prisma.operator.findUnique({
    where: { email },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  })

  if (!operator) {
    console.log(`❌  Aucun Operator trouvé pour l'email "${email}".`)
    console.log('    (Le client n\'a peut-être pas de compte, ou l\'email est différent.)')
    return
  }

  console.log('1) OPERATOR (consumer)')
  console.log(`   id        : ${operator.id}`)
  console.log(`   name      : ${operator.name}`)
  console.log(`   email     : ${operator.email}`)
  console.log(`   role      : ${operator.role}`)
  console.log(`   createdAt : ${dt(operator.createdAt)}`)
  line()

  // ── 2) Orders (consumerId = operator.id), newest first ────────────────────────
  const orders = await prisma.order.findMany({
    where: { consumerId: operator.id },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, createdAt: true, subtotal: true, deliveryFee: true,
      total: true, referralCode: true, status: true, items: true,
    },
  })

  console.log(`2) ORDERS — ${orders.length} commande(s) (triées par createdAt desc)`)
  if (orders.length === 0) {
    console.log('   (aucune commande)')
  }
  for (const o of orders) {
    console.log('   ' + '·'.repeat(74))
    console.log(`   id           : ${o.id}`)
    console.log(`   createdAt    : ${dt(o.createdAt)}`)
    console.log(`   status       : ${o.status}`)
    console.log(`   subtotal     : ${eur(o.subtotal)}`)
    console.log(`   deliveryFee  : ${eur(o.deliveryFee)}`)
    console.log(`   total        : ${eur(o.total)}`)
    const impliedDiscount = round2((o.subtotal ?? 0) + (o.deliveryFee ?? 0) - (o.total ?? 0))
    console.log(`   => remise implicite (subtotal + deliveryFee - total) : ${eur(impliedDiscount)}`)
    console.log(`   referralCode : ${o.referralCode ?? '— (aucun)'}`)
    // items is a Json column → already parsed by Prisma (array of line objects).
    let items = o.items
    if (typeof items === 'string') { try { items = JSON.parse(items) } catch { items = [] } }
    if (!Array.isArray(items)) items = []
    console.log(`   items        : ${items.length} ligne(s)`)
    for (const it of items) {
      const name  = it && it.name  !== undefined ? it.name  : '?'
      const price = it && it.price !== undefined ? it.price : '?'
      const qty   = it && it.qty   !== undefined ? it.qty   : '?'
      const itemId = it && it.itemId !== undefined ? it.itemId : '?'
      const optCount = it && Array.isArray(it.options) ? it.options.length : 0
      console.log(`       - ${name} | prix unit ${price} x ${qty}${optCount ? ` | ${optCount} option(s)` : ''}`)
      console.log(`         itemId: ${itemId}`)
    }
  }
  line()

  // ── 3) Referrals (customerId = operator.id) ──────────────────────────────────
  const referrals = await prisma.referral.findMany({
    where: { customerId: operator.id },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true, creatorId: true, codeUsed: true,
      startedAt: true, expiresAt: true, active: true, createdAt: true,
    },
  })

  // Resolve creators for readability (single batched read).
  const creatorIds = [...new Set(referrals.map((r) => r.creatorId))]
  const creators = creatorIds.length
    ? await prisma.creator.findMany({
        where: { id: { in: creatorIds } },
        select: { id: true, email: true, referralCode: true, name: true },
      })
    : []
  const creatorById = new Map(creators.map((c) => [c.id, c]))

  console.log(`3) REFERRALS — ${referrals.length} binding(s) (where customerId = operator.id)`)
  if (referrals.length === 0) {
    console.log('   (aucun Referral — le client n\'a jamais été lié à un créateur)')
  }
  const now = new Date()
  for (const r of referrals) {
    const c = creatorById.get(r.creatorId)
    const expired = r.expiresAt && new Date(r.expiresAt) <= now
    console.log('   ' + '·'.repeat(74))
    console.log(`   id            : ${r.id}`)
    console.log(`   creatorId     : ${r.creatorId}`)
    console.log(`   creator       : ${c ? `${c.name} <${c.email}> code=${c.referralCode ?? '—'}` : '(créateur introuvable)'}`)
    console.log(`   codeUsed      : ${r.codeUsed}`)
    console.log(`   startedAt     : ${dt(r.startedAt)}`)
    console.log(`   expiresAt     : ${dt(r.expiresAt)}  ${expired ? '⚠️ EXPIRÉ' : '(fenêtre ouverte)'}`)
    console.log(`   active        : ${r.active}`)
    console.log(`   createdAt     : ${dt(r.createdAt)}`)
  }
  line()

  // ── 4) ReferralOrders linked to those referrals ──────────────────────────────
  const referralIds = referrals.map((r) => r.id)
  const referralOrders = referralIds.length
    ? await prisma.referralOrder.findMany({
        where: { referralId: { in: referralIds } },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, referralId: true, orderId: true,
          grubanoFee: true, creatorEarning: true, createdAt: true,
        },
      })
    : []

  console.log(`4) REFERRAL ORDERS — ${referralOrders.length} (liés aux Referral ci-dessus)`)
  if (referralOrders.length === 0) {
    console.log('   (aucun ReferralOrder — aucune commande n\'a généré de gain affiliation)')
  }
  for (const ro of referralOrders) {
    console.log('   ' + '·'.repeat(74))
    console.log(`   id             : ${ro.id}`)
    console.log(`   referralId     : ${ro.referralId}`)
    console.log(`   orderId        : ${ro.orderId}`)
    console.log(`   grubanoFee     : ${eur(ro.grubanoFee)}`)
    console.log(`   creatorEarning : ${eur(ro.creatorEarning)}`)
    console.log(`   createdAt      : ${dt(ro.createdAt)}`)
  }
  line()

  // ── 5) Plain-language summary ────────────────────────────────────────────────
  console.log('5) RÉSUMÉ')
  console.log(`   ${orders.length} Order, ${referrals.length} Referral, ${referralOrders.length} ReferralOrder.`)

  // "1ère commande" = la plus ancienne chronologiquement (orders est trié desc).
  const firstOrder = orders.length ? orders[orders.length - 1] : null
  if (firstOrder) {
    const totalLtSubtotal = (firstOrder.total ?? 0) < (firstOrder.subtotal ?? 0)
    const impliedDiscount = round2((firstOrder.subtotal ?? 0) + (firstOrder.deliveryFee ?? 0) - (firstOrder.total ?? 0))
    console.log(`   1ère commande (la plus ancienne): ${firstOrder.id} du ${dt(firstOrder.createdAt)}`)
    console.log(`     subtotal=${eur(firstOrder.subtotal)}  deliveryFee=${eur(firstOrder.deliveryFee)}  total=${eur(firstOrder.total)}`)
    console.log(`     total < subtotal ? ${totalLtSubtotal ? 'OUI' : 'NON'}`)
    console.log(`     remise implicite (subtotal + deliveryFee - total) = ${eur(impliedDiscount)}`)
    if (impliedDiscount > 0.001) {
      console.log('     => une remise SEMBLE avoir été appliquée (total < subtotal + deliveryFee).')
    } else if (impliedDiscount < -0.001) {
      console.log('     => total > subtotal + deliveryFee : AUCUNE remise (total plus élevé que prévu).')
    } else {
      console.log('     => total = subtotal + deliveryFee : AUCUNE remise appliquée.')
    }
    console.log(`     referralCode sur cette commande: ${firstOrder.referralCode ?? '— (aucun)'}`)
  } else {
    console.log('   Aucune commande à analyser.')
  }

  // Diagnostic hint: a Referral that existed BEFORE the first order would have
  // forced CAS 2 (no discount) instead of CAS 1.
  if (firstOrder && referrals.length) {
    const priorReferral = referrals.find(
      (r) => r.createdAt && firstOrder.createdAt && new Date(r.createdAt) < new Date(firstOrder.createdAt),
    )
    if (priorReferral) {
      console.log(`   ⚠️ Un Referral (${priorReferral.id}) existait AVANT la 1ère commande visible —`)
      console.log('      cela expliquerait un CAS 2 (réutilisation, donc PAS de remise de bienvenue).')
    }
  }
  line()
}

main()
  .catch((err) => {
    console.error('[diag-referral] erreur:', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
