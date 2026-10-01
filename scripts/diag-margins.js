#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// AUDIT DES MARGES — 100% LECTURE SEULE (Agent 13).
//
// Produit la VRAIE marge nette de Grubano par type de commande, doctrine
// complète appliquée, pour cadrer une décision pricing. ZÉRO write, ZÉRO
// migration : Phase 1 = grille théorique pure (offline) ; Phase 2 = lecture
// d'un échantillon de commandes réelles + leur ledger (findMany/aggregate/count
// uniquement) et calibrage Stripe estimé vs réel.
//
// DOCTRINE (LUE dans le code, citée — jamais inventée) :
//   marge_nette_Grubano = commission_encaissée − frais_Stripe − royalty − affiliation
//     · commission = 8% pickup / 12% delivery × SOUS-TOTAL        (lib/commission.ts:14-19,50-59)
//     · commission ENCAISSÉE = commission_brute − crédit_fidélité (app/api/orders/[id]/pay:115-123)
//       → Grubano renonce à sa propre commission pour financer le crédit (le resto touche plein)
//       → donc le crédit fidélité est DÉJÀ dans applicationFeeAmount ; on ne le re-soustrait pas
//     · frais_Stripe (estimé) = STRIPE_FEE_PCT × charge + STRIPE_FEE_FIXED   (lib/loyalty.ts:38-55)
//         défauts code : 0.029 (2,9%) + 25c ; charge = sous-total + frais de livraison (AVANT crédit)
//         Grubano les porte (destination charge) ; le RÉEL est ledger.stripeFeeAmount (balance txn)
//     · royalty créateur = 2% du PRIX PLEIN du plat de recette adoptée       (AdoptionConfig.creatorCommissionPctReferred=0.02 ; orders/route.ts:488-490)
//     · affiliation = 30% de la commission Grubano (PAS du panier)           (ReferralConfig.commissionPctOfGrubanoFee=0.30 ; orders/route.ts:558-560)
//   BORNE FIDÉLITÉ (lib/loyalty resolveLoyaltyCredit) : crédit ≤ commission −
//   (stripe + royalty + affiliation) → la fidélité ne peut JAMAIS rendre la
//   marge négative (elle consomme le headroom positif jusqu'à 0). Le risque de
//   marge ≤ 0 vient DONC du cumul stripe+royalty+affiliation sur une commission
//   mince — indépendant de la fidélité.
//
// USAGE :
//   node scripts/diag-margins.js              → Phase 1 (grille) + Phase 2 si DB joignable
//   .env.local (DATABASE_URL) est chargé automatiquement comme les autres scripts.
//   Sur le serveur : cd ~/app.grubano.com && source ~/nodevenv/.../activate && node scripts/diag-margins.js
// ─────────────────────────────────────────────────────────────────────────────

'use strict'

const fs = require('fs')
const path = require('path')

// ── Loader .env.local (pattern notion-sync / purge) ────────────────────────────
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

// ── Rates (code defaults; Phase 2 overrides with the REAL DB config) ───────────
const COMMISSION = { pickup: 0.08, delivery: 0.12 }                          // lib/commission.ts
let ROYALTY_PCT     = 0.02                                                   // AdoptionConfig.creatorCommissionPctReferred
let AFFILIATION_PCT = 0.30                                                   // ReferralConfig.commissionPctOfGrubanoFee
const STRIPE_PCT    = Number(process.env.STRIPE_FEE_PCT) || 0.029           // lib/loyalty.ts default
const STRIPE_FIXED  = (Number(process.env.STRIPE_FEE_FIXED_CENTS) || 25) / 100 // €
const DELIVERY_FEE  = 2.99                                                   // representative delivery fee (resto keeps it; Grubano pays Stripe on it)

const r2 = (n) => Math.round(n * 100) / 100
const pct = (part, whole) => whole > 0 ? r2((part / whole) * 100) : 0
// 🔴 perte réelle · ⚪ équilibre exact (0, p.ex. fidélité au plafond qui consomme
// tout le headroom — voulu, pas une perte) · 🟠 marge positive mais < 2%.
const flag = (margin, subtotal) =>
  margin < -0.001 ? '🔴 perte'
  : Math.abs(margin) <= 0.001 ? '⚪ équilibre'
  : pct(margin, subtotal) < 2 ? '🟠 <2%'
  : ''
const pad = (s, n) => String(s).padEnd(n)
const padL = (s, n) => String(s).padStart(n)

// ── Theoretical margin for one (subtotal, channel, type) at a given combo ──────
function line(subtotal, channel, isChef, { affiliation, loyaltyMax }) {
  const rate       = COMMISSION[channel]
  const commission = r2(subtotal * rate)
  const charge     = subtotal + (channel === 'delivery' ? DELIVERY_FEE : 0)
  const stripe     = r2(STRIPE_PCT * charge + STRIPE_FIXED)
  const royalty    = isChef ? r2(subtotal * ROYALTY_PCT) : 0
  const affil      = affiliation ? r2(commission * AFFILIATION_PCT) : 0
  // Strict loyalty cap = remaining margin after stripe+royalty+affiliation (≥0).
  const headroom   = r2(commission - stripe - royalty - affil)
  const loyalty    = loyaltyMax ? Math.max(0, headroom) : 0
  const margin     = r2(commission - stripe - royalty - affil - loyalty)
  return { commission, stripe, royalty, affil, loyalty, margin, marginPct: pct(margin, subtotal) }
}

// ── PHASE 1 — the theoretical grid ─────────────────────────────────────────────
function phase1() {
  console.log('\n' + '='.repeat(96))
  console.log('  PHASE 1 — GRILLE THÉORIQUE DE LA MARGE NETTE GRUBANO (doctrine complète)')
  console.log(`  Taux: commission pickup ${(COMMISSION.pickup * 100).toFixed(0)}% / delivery ${(COMMISSION.delivery * 100).toFixed(0)}% · royalty ${(ROYALTY_PCT * 100).toFixed(0)}% · affiliation ${(AFFILIATION_PCT * 100).toFixed(0)}% de la commission`)
  console.log(`  Stripe (estimé): ${(STRIPE_PCT * 100).toFixed(2)}% × charge + ${(STRIPE_FIXED).toFixed(2)}€ · livraison repère ${DELIVERY_FEE.toFixed(2)}€ (le resto la garde, Grubano paie Stripe dessus)`)
  console.log('='.repeat(96))

  const montants = [9, 16, 25, 50]
  const combos = [
    { key: '(a) plein tarif',          affiliation: false, loyaltyMax: false },
    { key: '(b) + affiliation',        affiliation: true,  loyaltyMax: false },
    { key: '(c) + fidélité max',       affiliation: false, loyaltyMax: true  },
    { key: '(d) pire cumul (affil+fid)', affiliation: true, loyaltyMax: true },
  ]

  for (const channel of ['pickup', 'delivery']) {
    for (const isChef of [false, true]) {
      console.log(`\n── ${channel.toUpperCase()} · plat ${isChef ? 'CHEF (royalty 2%)' : 'NORMAL'} ` + '─'.repeat(40))
      console.log('  ' + pad('combo', 26) + padL('ST', 4) + '  ' +
        pad('comm', 7) + pad('stripe', 8) + pad('royal', 7) + pad('affil', 7) + pad('fidMax', 8) +
        pad('MARGE€', 8) + pad('marge%', 8) + 'flag')
      for (const c of combos) {
        for (const subtotal of montants) {
          const x = line(subtotal, channel, isChef, c)
          console.log('  ' + pad(c.key, 26) + padL(subtotal + '€', 4) + '  ' +
            pad(x.commission.toFixed(2), 7) + pad(x.stripe.toFixed(2), 8) +
            pad(x.royalty.toFixed(2), 7) + pad(x.affil.toFixed(2), 7) + pad(x.loyalty.toFixed(2), 8) +
            pad(x.margin.toFixed(2), 8) + pad(x.marginPct + '%', 8) + flag(x.margin, subtotal))
        }
      }
    }
  }
  console.log('\n  Lecture : 🔴 marge ≤ 0  ·  🟠 marge < 2% du sous-total (zone de fragilité).')
  console.log('  NB fidélité : (c)/(d) → la marge tombe à 0 quand il reste du headroom (le crédit le consomme),')
  console.log('     et reste = headroom NÉGATIF quand commission < stripe+royalty+affiliation (le crédit est alors bloqué à 0).')
}

// ── PHASE 2 — the real sample (READ-ONLY) ──────────────────────────────────────
async function phase2() {
  console.log('\n' + '='.repeat(96))
  console.log('  PHASE 2 — LE RÉEL (lecture base, comparaison au modèle) — READ ONLY')
  console.log('='.repeat(96))

  if (!process.env.DATABASE_URL) {
    console.log('  ⚠️  DATABASE_URL absent — Phase 2 ignorée. Relancer sur le serveur (voir en-tête).')
    return
  }

  let PrismaClient
  try { ({ PrismaClient } = require('@prisma/client')) }
  catch { console.log('  ⚠️  @prisma/client introuvable ici — relancer dans le contexte app.'); return }
  const prisma = new PrismaClient()

  try {
    // Real config rates (cite the truth in base).
    const adoptionCfg = await prisma.adoptionConfig.findFirst({ where: { active: true }, orderBy: { createdAt: 'asc' } }).catch(() => null)
    const referralCfg = await prisma.referralConfig.findFirst({ where: { active: true }, orderBy: { createdAt: 'desc' } }).catch(() => null)
    if (typeof adoptionCfg?.creatorCommissionPctReferred === 'number') ROYALTY_PCT = adoptionCfg.creatorCommissionPctReferred
    if (typeof referralCfg?.commissionPctOfGrubanoFee === 'number') AFFILIATION_PCT = referralCfg.commissionPctOfGrubanoFee
    console.log(`  Config en base : royalty=${ROYALTY_PCT} (AdoptionConfig) · affiliation=${AFFILIATION_PCT} (ReferralConfig)` +
      (adoptionCfg ? '' : '  [AdoptionConfig absente → défaut 0.02]') + (referralCfg ? '' : '  [ReferralConfig absente → défaut 0.30]'))

    // Paid orders sample (read-only).
    const orders = await prisma.order.findMany({
      where:   { paymentStatus: 'paid' },
      orderBy: { createdAt: 'desc' },
      take:    300,
      select: {
        id: true, subtotal: true, deliveryFee: true, total: true, discount: true,
        loyaltyCreditCents: true, fulfillmentType: true, stripePaymentIntentId: true, createdAt: true,
      },
    })
    console.log(`  Commandes payées échantillonnées : ${orders.length}`)
    if (orders.length === 0) {
      console.log('  (aucune commande payée — rien à comparer ; la grille Phase 1 reste la référence)')
      return
    }

    const piIds = orders.map(o => o.stripePaymentIntentId).filter(Boolean)
    const ledgers = piIds.length ? await prisma.ledgerEntry.findMany({
      where:  { type: 'payment', stripePaymentIntentId: { in: piIds } },
      select: { stripePaymentIntentId: true, grossAmount: true, applicationFeeAmount: true, stripeFeeAmount: true, channel: true },
    }) : []
    const ledgerByPi = new Map(ledgers.map(l => [l.stripePaymentIntentId, l]))

    const orderIds = orders.map(o => o.id)
    const dishSales = orderIds.length ? await prisma.dishSale.findMany({
      where:  { orderId: { in: orderIds } },
      select: { orderId: true, creatorEarning: true },
    }) : []
    const royaltyByOrder = new Map()
    for (const s of dishSales) royaltyByOrder.set(s.orderId, (royaltyByOrder.get(s.orderId) ?? 0) + (s.creatorEarning ?? 0))

    const refOrders = orderIds.length ? await prisma.referralOrder.findMany({
      where:  { orderId: { in: orderIds } },
      select: { orderId: true, creatorEarning: true },
    }) : []
    const affilByOrder = new Map()
    for (const ro of refOrders) affilByOrder.set(ro.orderId, (affilByOrder.get(ro.orderId) ?? 0) + (ro.creatorEarning ?? 0))

    // Per-order REAL margin + Stripe estimate vs real.
    const agg = {} // key channel|type → {n, marginSum, subSum, neg, frag}
    let withLedger = 0, withRealStripe = 0
    const stripePoints = [] // {charge, realFee} for calibration
    let estStripeSum = 0, realStripeSum = 0

    for (const o of orders) {
      const led = o.stripePaymentIntentId ? ledgerByPi.get(o.stripePaymentIntentId) : null
      const royalty = royaltyByOrder.get(o.id) ?? 0
      const affil   = affilByOrder.get(o.id) ?? 0
      const isChef  = royalty > 0
      const channel = o.fulfillmentType === 'pickup' ? 'pickup' : 'delivery'

      // Commission collected: ledger applicationFeeAmount (real, already net of loyalty) when available,
      // else theoretical gross commission − loyalty credit (floored ≥0).
      const grossCommission = r2(o.subtotal * COMMISSION[channel])
      const loyaltyEur = (o.loyaltyCreditCents ?? 0) / 100
      const commissionCollected = led ? led.applicationFeeAmount / 100 : Math.max(0, r2(grossCommission - loyaltyEur))

      // Stripe: real ledger fee when present, else estimate on the charge.
      const charge = o.total // the real amount charged (after discount + loyalty)
      const estStripe = r2(STRIPE_PCT * charge + STRIPE_FIXED)
      const realStripe = (led && typeof led.stripeFeeAmount === 'number') ? led.stripeFeeAmount / 100 : null
      const stripe = realStripe ?? estStripe
      if (led) withLedger++
      if (realStripe !== null) {
        withRealStripe++
        stripePoints.push({ charge: Math.round((led.grossAmount ?? Math.round(charge * 100))), realFee: led.stripeFeeAmount })
        estStripeSum += estStripe; realStripeSum += realStripe
      }

      const margin = r2(commissionCollected - stripe - royalty - affil)
      const key = `${channel}|${isChef ? 'chef' : 'normal'}`
      const a = agg[key] ?? (agg[key] = { n: 0, marginSum: 0, subSum: 0, neg: 0, frag: 0 })
      a.n++; a.marginSum += margin; a.subSum += o.subtotal
      if (margin <= 0) a.neg++
      else if (pct(margin, o.subtotal) < 2) a.frag++
    }

    console.log(`\n  Ledger joint : ${withLedger}/${orders.length} commandes · frais Stripe RÉEL présent : ${withRealStripe}`)
    console.log('\n  ── Marge nette moyenne par canal/type ' + '─'.repeat(50))
    console.log('  ' + pad('canal|type', 18) + padL('n', 5) + padL('marge€ moy', 14) + padL('marge% moy', 14) + padL('≤0', 6) + padL('<2%', 6))
    for (const [key, a] of Object.entries(agg)) {
      const avgMargin = r2(a.marginSum / a.n)
      const avgPct    = pct(a.marginSum, a.subSum)
      console.log('  ' + pad(key, 18) + padL(a.n, 5) + padL(avgMargin.toFixed(2), 14) + padL(avgPct + '%', 14) + padL(a.neg, 6) + padL(a.frag, 6))
    }
    const totalN = Object.values(agg).reduce((s, a) => s + a.n, 0)
    const totalNeg = Object.values(agg).reduce((s, a) => s + a.neg, 0)
    const totalFrag = Object.values(agg).reduce((s, a) => s + a.frag, 0)
    console.log(`\n  GLOBAL : ${totalN} commandes · marge ≤ 0 : ${totalNeg} (${pct(totalNeg, totalN)}%) · marge < 2% : ${totalFrag} (${pct(totalFrag, totalN)}%)`)

    // ── Stripe calibration: linear regression realFee = pct × charge + fixed ────
    console.log('\n  ── Calibrage Stripe (estimé vs réel) ' + '─'.repeat(50))
    if (stripePoints.length >= 2) {
      const n = stripePoints.length
      const sx = stripePoints.reduce((s, p) => s + p.charge, 0)
      const sy = stripePoints.reduce((s, p) => s + p.realFee, 0)
      const sxx = stripePoints.reduce((s, p) => s + p.charge * p.charge, 0)
      const sxy = stripePoints.reduce((s, p) => s + p.charge * p.realFee, 0)
      const denom = n * sxx - sx * sx
      const slope = denom !== 0 ? (n * sxy - sx * sy) / denom : 0       // pct (fee cents per charge cent)
      const intercept = (sy - slope * sx) / n                          // fixed (cents)
      console.log(`  Régression sur ${n} commandes à frais Stripe réel :`)
      console.log(`    STRIPE_FEE_PCT recommandé ≈ ${(slope).toFixed(4)} (${(slope * 100).toFixed(2)}%)   [défaut code 0.029]`)
      console.log(`    STRIPE_FEE_FIXED_CENTS recommandé ≈ ${Math.round(intercept)} c (${(intercept / 100).toFixed(2)}€)   [défaut code 25]`)
      console.log(`    Estimé moyen ${r2(estStripeSum / n).toFixed(2)}€ vs réel moyen ${r2(realStripeSum / n).toFixed(2)}€ par commande` +
        `  → écart ${r2((estStripeSum - realStripeSum) / n).toFixed(2)}€/cmd (${estStripeSum >= realStripeSum ? 'estimation prudente' : 'SOUS-ESTIMÉ ⚠️'})`)
    } else {
      console.log(`  Pas assez de commandes à frais Stripe réel (${stripePoints.length}) pour calibrer — l'estimation 2,9%+0,25€ reste la référence.`)
    }
  } catch (err) {
    console.log('  ⚠️  Phase 2 indisponible (lecture base) :', err.message)
    console.log('     La grille Phase 1 reste valide. Relancer sur le serveur pour le réel.')
  } finally {
    await prisma.$disconnect().catch(() => {})
  }
}

async function main() {
  console.log('AUDIT DES MARGES GRUBANO — zéro write, zéro fichier applicatif modifié.')
  phase1()
  await phase2()
  console.log('\n— fin de l\'audit (lecture seule). —\n')
}

main().catch((e) => { console.error('diag-margins échec:', e.message); process.exit(1) })
