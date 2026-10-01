'use strict'
/* ═══════════════════════════════════════════════════════════════════════════════
   staging-classification-read.js — LECTURE SEULE. AUCUNE ÉCRITURE. AUCUN DELETE.

   Script UNIQUE de classification pré-clean-room (mission PRE-CLEAN SAFETY,
   2026-08-29). À exécuter UNE fois par le fondateur sur staging :

     cd ~/app.grubano.com && source ~/nodevenv/app.grubano.com/24/bin/activate \
       && node scripts/server/staging-classification-read.js

   Il produit des sections nommées (ADMIN / TEST PROVED / TEST HIGH CONFIDENCE /
   UNKNOWN / CONNECT TEST / RELATIONAL BLOCKERS / PROTECTED / CLEANUP CANDIDATES)
   et un résumé final. RÈGLES ABSOLUES : UNKNOWN = DO NOT DELETE · REAL = DO NOT
   DELETE · SYSTEM = DO NOT DELETE · PERMANENT ADMIN = DO NOT DELETE.

   Sécurité de sortie : AUCUN secret (password/hashes/tokens/sessions = présence
   booléenne seulement), références Stripe TRONQUÉES (acct_***XXXX), e-mails des
   lignes UNKNOWN partiellement masqués, pseudonymes ADMIN#n / RESTAURANT#n / …
   ⚠ Piège connu : Operator.notifPrefs est invalide sur la plupart des lignes
   staging → TOUS les select sont EXPLICITES et ne touchent jamais notifPrefs.
   ═══════════════════════════════════════════════════════════════════════════════ */

const fs = require('fs')
const path = require('path')

// ── DATABASE_URL depuis l'env ou .env.local (cwd puis racine app) ──────────────
if (!process.env.DATABASE_URL) {
  for (const dir of [process.cwd(), path.join(__dirname, '..', '..')]) {
    const f = path.join(dir, '.env.local')
    if (!fs.existsSync(f)) continue
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
    }
    if (process.env.DATABASE_URL) break
  }
}
if (!process.env.DATABASE_URL) {
  console.error('[classification] DATABASE_URL introuvable (env + .env.local). Abandon.')
  process.exit(1)
}
try {
  const u = new URL(process.env.DATABASE_URL)
  console.log(`Base ciblée : ${u.protocol}//${u.username}:***@${u.host}${u.pathname}`)
} catch { console.log('Base ciblée : (DSN non parsable — masqué)') }
if (process.env.NEXTAUTH_URL === 'https://grubano.com') {
  console.log('⚠️  ATTENTION : NEXTAUTH_URL = production. Ce script est en lecture seule, mais vérifiez que c\'est voulu.')
}

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// ── Helpers + règles de provenance : lib PARTAGÉE (numérotation stable inter-
//    scripts — unknown-evidence-read.js affiche les mêmes USER#N/RESTAURANT#N) ──
const { mask, maskEmail, shortId, d, COMPROMISED_EMAILS, isQaEmail, numberEntities, stableSort } = require('./classification-lib')

const H = (t) => console.log(`\n=== ${t} ===`)
const note = (t) => console.log('    ' + t)
const summary = {}

async function section(name, fn) {
  try { await fn() } catch (e) {
    console.log(`\n=== ${name} — ERREUR DE LECTURE ===`)
    console.log('    ' + String(e.message).split('\n')[0].slice(0, 220))
    summary._sectionErrors = (summary._sectionErrors || 0) + 1
  }
}

async function main() {
  console.log('\n──────────────────────────────────────────────────────────────')
  console.log(' GRUBANO — CLASSIFICATION PRÉ-CLEAN-ROOM (lecture seule)')
  console.log(' Exécution : ' + new Date().toISOString())
  console.log('──────────────────────────────────────────────────────────────')

  // ═══ 1. OPÉRATEURS (comptes) ═══
  const OP_SELECT = {
    id: true, email: true, name: true, role: true, status: true, createdAt: true,
    emailVerifiedAt: true, consentAt: true, siren: true, kybStatus: true,
    franchiseStripeAccountId: true, affiliateStripeAccountId: true,
  }
  const ops = await prisma.operator.findMany({ select: OP_SELECT }).catch(async () => {
    // repli : certaines colonnes récentes pourraient manquer si la base est en retard de schéma
    return prisma.operator.findMany({ select: { id: true, email: true, name: true, role: true, status: true, createdAt: true } })
  })
  // présence de mot de passe (booléen seulement — jamais la valeur)
  const pwdRows = await prisma.operator.findMany({ select: { id: true, password: true } })
  const hasPwd = new Map(pwdRows.map(r => [r.id, r.password !== null]))
  const roleRows = await prisma.operatorRole.findMany({ select: { operatorId: true, role: true } }).catch(() => [])
  const roleSets = new Map()
  for (const r of roleRows) { if (!roleSets.has(r.operatorId)) roleSets.set(r.operatorId, new Set()); roleSets.get(r.operatorId).add(r.role) }

  // restaurants chargés AVANT la numérotation (la lib numérote tout d'un bloc,
  // tri stable createdAt/id → mêmes pseudonymes à chaque exécution)
  const restos = await prisma.restaurant.findMany({ select: { id: true, operatorId: true, name: true, city: true, isActive: true, approvedAt: true, archivedAt: true, lat: true, lng: true, stripeAccountId: true, stripeAccountStatus: true, pickupEnabled: true, deliveryEnabled: true, createdAt: true } })
  const { opClass, opPseudo, counters, restoClass, restoPseudo } = numberEntities(ops, roleSets, restos)
  const opsSorted = stableSort(ops)
  const restosSorted = stableSort(restos)

  // sonde notifPrefs (lignes illisibles) — lecture seule, par id, plafonnée
  let notifBroken = 0
  await section('SONDE notifPrefs', async () => {
    for (const op of ops.slice(0, 300)) {
      try { await prisma.operator.findUnique({ where: { id: op.id }, select: { notifPrefs: true } }) } catch { notifBroken++ }
    }
  })

  await section('ADMIN / SYSTEM', async () => {
    H('ADMIN / SYSTEM')
    note('Signification : comptes à rôle admin (accès /admin/*) + traces système.')
    note('À vérifier : lequel est LE VÔTRE (permanent). NE PAS SUPPRIMER cette section.')
    const admins = opsSorted.filter(o => opClass.get(o.id) === 'ADMIN')
    if (!admins.length) console.log('  (aucun compte admin)')
    for (const a of admins) {
      const prov = await prisma.adminAuditLog.findFirst({ where: { action: 'admin.provision', OR: [{ targetId: a.id }, { actorEmail: a.email }, { metadata: { path: '$.email', equals: a.email } }] }, select: { createdAt: true, actorId: true } }).catch(() => null)
      console.log(`  ${opPseudo.get(a.id)}  ${a.email}  role=${a.role} status=${a.status} créé=${d(a.createdAt)} pwd=${hasPwd.get(a.id) ? 'OUI(⚠ à examiner)' : 'null(passwordless ✓)'} provision-script=${prov ? 'OUI ' + d(prov.createdAt) : 'non trouvé'}`)
    }
    const provisions = await prisma.adminAuditLog.findMany({ where: { action: 'admin.provision' }, select: { createdAt: true, actorId: true, targetId: true }, orderBy: { createdAt: 'asc' } }).catch(() => [])
    console.log(`  Événements provision-admin dans l'audit : ${provisions.length}`)
    summary.adminCount = admins.length
    summary.permanentAdmin = admins.some(a => !hasPwd.get(a.id)) ? (provisions.length ? 'YES' : 'NON ÉTABLI (admin passwordless présent, provenance script non tracée)') : (admins.length ? 'NON ÉTABLI (admin avec mot de passe — provenance ?)' : 'NO')
    if (notifBroken) console.log(`  ⚠ notifPrefs ILLISIBLE sur ${notifBroken}/${Math.min(ops.length, 300)} lignes Operator sondées (défaut connu — à réparer avant clean room, script provision-admin sait les réparer une à une)`)
  })

  await section('COMPTES À CREDENTIALS PUBLICS (versionnés dans le repo)', async () => {
    H('COMPTES À CREDENTIALS PUBLICS (repo public → mots de passe connus)')
    note('Signification : identifiants imprimés dans le dépôt (Test1234!/Demo1234!). Toute présence ACTIVE = accès ouvert.')
    note('À faire au clean room : SUPPRIMER (ou a minima suspendre + rotater immédiatement).')
    let n = 0
    for (const e of COMPROMISED_EMAILS) {
      const op = ops.find(o => o.email === e)
      if (op) { n++; console.log(`  ${op.email}  role=${op.role} status=${op.status} pwd=${hasPwd.get(op.id) ? 'PRÉSENT 🔴' : 'null'} créé=${d(op.createdAt)}`) }
    }
    if (!n) console.log('  (aucun des 7 e-mails compromis n\'est présent — bon signe)')
    summary.compromised = n
  })

  // ═══ 2. RESTAURANTS / MARQUES / MENUS ═══
  const orderAgg = await prisma.order.groupBy({ by: ['restaurantId'], _count: { _all: true } }).catch(() => [])
  const paidAgg = await prisma.order.groupBy({ by: ['restaurantId'], where: { paymentStatus: 'paid' }, _count: { _all: true } }).catch(() => [])
  const ordersByResto = new Map(orderAgg.map(x => [x.restaurantId, x._count._all]))
  const paidByResto = new Map(paidAgg.map(x => [x.restaurantId, x._count._all]))
  const brands = await prisma.brand.findMany({ select: { id: true, operatorId: true, restaurantId: true, name: true } }).catch(() => [])
  const menuCount = await prisma.menuItem.count().catch(() => 0)

  const printResto = (r) => {
    const geo = (typeof r.lat === 'number' && typeof r.lng === 'number') ? 'géocodé' : 'SANS coords'
    const cx = r.stripeAccountId ? `${mask(r.stripeAccountId)}/${r.stripeAccountStatus || '?'}` : 'aucun'
    console.log(`  ${restoPseudo.get(r.id)}  « ${r.name} » (${r.city}) id=${shortId(r.id)} actif=${r.isActive ? 'OUI' : 'non'} approuvé=${d(r.approvedAt)} ${geo} Connect=${cx} commandes=${ordersByResto.get(r.id) || 0} (payées=${paidByResto.get(r.id) || 0}) owner=${opPseudo.get(r.operatorId) || '?'}`)
  }

  await section('TEST PROVED', async () => {
    H('TEST PROVED — preuve versionnée (ids demo-*, e-mails QA/compromis, noms QA)')
    note('Signification : provenance test PROUVÉE par le dépôt. Candidats à la suppression au clean room.')
    note('À vérifier : rien — sauf si vous reconnaissez une donnée réelle par erreur (dites-le).')
    console.log(`  Opérateurs : ${counters.TEST_PROVED}`)
    for (const o of opsSorted.filter(x => opClass.get(x.id) === 'TEST_PROVED')) console.log(`    ${opPseudo.get(o.id)}  ${o.email}  role=${o.role} status=${o.status} créé=${d(o.createdAt)}`)
    console.log(`  Restaurants : ${restosSorted.filter(r => restoClass.get(r.id) === 'TEST_PROVED').length}`)
    restosSorted.filter(r => restoClass.get(r.id) === 'TEST_PROVED').forEach(printResto)
  })

  await section('TEST HIGH CONFIDENCE', async () => {
    H('TEST HIGH CONFIDENCE — id non-cuid (impossible à créer via l\'application)')
    note('Signification : fixtures d\'une génération antérieure (ex. rest_001…). L\'app ne génère QUE des cuid.')
    note('À vérifier : confirmez que vous ne reconnaissez aucun établissement réel ici, puis traitez comme TEST.')
    console.log(`  Opérateurs : ${counters.TEST_HIGH}`)
    for (const o of opsSorted.filter(x => opClass.get(x.id) === 'TEST_HIGH')) console.log(`    ${opPseudo.get(o.id)}  id=${shortId(o.id)}  ${maskEmail(o.email)}  role=${o.role} créé=${d(o.createdAt)}`)
    console.log(`  Restaurants : ${restosSorted.filter(r => restoClass.get(r.id) === 'TEST_HIGH').length}`)
    restosSorted.filter(r => restoClass.get(r.id) === 'TEST_HIGH').forEach(printResto)
  })

  await section('UNKNOWN', async () => {
    H('UNKNOWN — créés par l\'application, provenance non prouvée · 🔴 DO NOT DELETE')
    note('Signification : cuid réels sans marqueur test. Peut contenir de VRAIES personnes (ou vos propres essais).')
    note('À faire : identifiez chaque ligne (votre essai ? un vrai ? inconnu ?) et renvoyez-moi la liste annotée.')
    console.log(`  Opérateurs : ${counters.UNKNOWN}`)
    for (const o of opsSorted.filter(x => opClass.get(x.id) === 'UNKNOWN')) {
      const indices = []
      if (o.emailVerifiedAt) indices.push('email-vérifié')
      if (o.siren) indices.push('SIREN renseigné')
      if (o.kybStatus === 'verified') indices.push('KYB✓')
      console.log(`    ${opPseudo.get(o.id)}  ${maskEmail(o.email)}  role=${o.role} status=${o.status} créé=${d(o.createdAt)} ${indices.length ? '⚑ ' + indices.join(',') : ''}`)
    }
    const unkR = restosSorted.filter(r => restoClass.get(r.id) === 'UNKNOWN')
    console.log(`  Restaurants : ${unkR.length}`)
    unkR.forEach(r => { printResto(r); if ((typeof r.lat === 'number') && r.stripeAccountStatus === 'active') note('  ⚑ indices de PILOTE RÉEL possible (géocodé + Connect actif) — à confirmer par vous') })
    summary.realPilot = unkR.some(r => typeof r.lat === 'number') ? 'NON ÉTABLI (candidat(s) UNKNOWN à confirmer)' : 'NO'
  })

  // ═══ 3. COMMANDES / RÉSAS / FIDÉLITÉ ═══
  await section('ORDERS / RESERVATIONS / LOYALTY', async () => {
    H('ORDERS / RESERVATIONS / LOYALTY (références pour le nettoyage)')
    const totalOrders = await prisma.order.count()
    const paidOrders = await prisma.order.count({ where: { paymentStatus: 'paid' } })
    const piOrders = await prisma.order.count({ where: { stripePaymentIntentId: { not: null } } })
    const demoOrders = await prisma.order.count({ where: { id: { startsWith: 'demo-' } } })
    console.log(`  Orders : total=${totalOrders} · payées=${paidOrders} · avec PaymentIntent=${piOrders} · fixtures demo-*=${demoOrders}`)
    note('Une commande PAYÉE ou avec PI = de l\'argent (TEST) a réellement transité → à recouper avec le dashboard Stripe TEST avant suppression.')
    const resas = await prisma.reservation.groupBy({ by: ['source'], _count: { _all: true } }).catch(() => [])
    console.log('  Réservations par source : ' + (resas.map(r => `${r.source}=${r._count._all}`).join(' · ') || 'aucune') + '  (source "qa-parity" = fixture QA prouvée)')
    const resaPI = await prisma.reservation.count({ where: { stripePaymentIntentId: { not: null } } }).catch(() => 0)
    console.log(`  Réservations avec empreinte (PI) : ${resaPI}`)
    const loyal = await prisma.loyaltyCustomer.count().catch(() => 0)
    const loyalQa = await prisma.loyaltyOrder.count({ where: { uberOrderNumber: { startsWith: 'QA-PARITY-' } } }).catch(() => 0)
    console.log(`  LoyaltyCustomer=${loyal} · LoyaltyOrder QA-PARITY=${loyalQa}`)
    const tickets = await prisma.tableTicket.count().catch(() => 0)
    console.log(`  TableTickets (additions) : ${tickets}`)
  })

  // ═══ 4. CONNECT TEST ═══
  await section('CONNECT TEST', async () => {
    H('CONNECT TEST — toutes les références Stripe (tronquées)')
    note('Signification : comptes/paiements Stripe TEST rattachés aux données. TEST HISTORICAL = propriétaire test ;')
    note('REAL PILOT = propriétaire réel confirmé par vous ; le reste = UNKNOWN. Aucune clé, aucun secret affiché.')
    let n = 0
    for (const r of restosSorted.filter(r => r.stripeAccountId)) {
      n++
      const cls = restoClass.get(r.id)
      console.log(`  Restaurant ${restoPseudo.get(r.id)} « ${r.name} » → ${mask(r.stripeAccountId)} status=${r.stripeAccountStatus || '?'} provenance=${cls === 'UNKNOWN' ? 'UNKNOWN (à confirmer)' : 'TEST HISTORICAL'}`)
    }
    const profs = [
      ['Creator', await prisma.creator.findMany({ where: { stripeAccountId: { not: null } }, select: { email: true, stripeAccountId: true, payoutStatus: true } }).catch(() => [])],
      ['SupplierProfile', await prisma.supplierProfile.findMany({ where: { stripeAccountId: { not: null } }, select: { email: true, stripeAccountId: true, payoutStatus: true } }).catch(() => [])],
      ['LogisticsProfile', await prisma.logisticsProfile.findMany({ where: { stripeAccountId: { not: null } }, select: { email: true, stripeAccountId: true, payoutStatus: true } }).catch(() => [])],
      ['PrestataireProfile', await prisma.prestataireProfile.findMany({ where: { stripeAccountId: { not: null } }, select: { email: true, stripeAccountId: true, payoutStatus: true } }).catch(() => [])],
    ]
    for (const [label, rows] of profs) for (const p of rows) { n++; console.log(`  ${label} ${isQaEmail(p.email) || COMPROMISED_EMAILS.has(p.email) ? '(TEST)' : maskEmail(p.email)} → ${mask(p.stripeAccountId)} payout=${p.payoutStatus || '—'}`) }
    for (const o of opsSorted.filter(o => o.franchiseStripeAccountId || o.affiliateStripeAccountId)) {
      if (o.franchiseStripeAccountId) { n++; console.log(`  Operator ${opPseudo.get(o.id)} (franchise) → ${mask(o.franchiseStripeAccountId)}`) }
      if (o.affiliateStripeAccountId) { n++; console.log(`  Operator ${opPseudo.get(o.id)} (affilié) → ${mask(o.affiliateStripeAccountId)}`) }
    }
    const ledger = await prisma.ledgerEntry.aggregate({ _count: { _all: true }, _sum: { grossAmount: true, applicationFeeAmount: true, netToRestaurant: true } }).catch(() => null)
    if (ledger) console.log(`  LedgerEntry (append-only) : ${ledger._count._all} lignes · brut=${(ledger._sum.grossAmount || 0) / 100}€ · commission=${(ledger._sum.applicationFeeAmount || 0) / 100}€ · net restos=${(ledger._sum.netToRestaurant || 0) / 100}€`)
    const refunds = await prisma.refund.count().catch(() => 0)
    const payouts = await prisma.payout.count().catch(() => 0)
    console.log(`  Refunds=${refunds} · Payouts=${payouts}`)
    summary.connectRefs = n
  })

  // ═══ 5. WAITLIST LIVREUR ═══
  await section('COURIER WAITLIST', async () => {
    H('COURIER WAITLIST (LogisticsProfile)')
    note('Signification : inscriptions livreur. Une inscription RÉELLE = à PROTÉGER absolument.')
    const lps = await prisma.logisticsProfile.findMany({ select: { id: true, email: true, status: true, siren: true, verificationStatus: true, createdAt: true } }).catch(() => [])
    if (!lps.length) console.log('  (aucune inscription livreur)')
    for (const lp of lps) {
      const test = isQaEmail(lp.email) || COMPROMISED_EMAILS.has(lp.email)
      console.log(`  ${test ? '(TEST) ' + lp.email : 'RÉEL/UNKNOWN ' + maskEmail(lp.email)}  status=${lp.status} siren=${lp.siren ? 'oui' : 'non'} vérif=${lp.verificationStatus || '—'} créé=${d(lp.createdAt)}${test ? '' : '  🔴 DO NOT DELETE'}`)
    }
  })

  // ═══ 6. BLOCKERS RELATIONNELS ═══
  await section('RELATIONAL BLOCKERS', async () => {
    H('RELATIONAL BLOCKERS — ce qui EMPÊCHE ou complique une suppression')
    note('FK bloquantes : Restaurant→(Order, TableTicket, OpeningHour, ClosureException) ; Operator→(Brand, Restaurant, PointOfSale) ; Order→ReferralOrder.')
    note('Références SANS FK (orphelins après suppression) : LedgerEntry.restaurantId, Refund.orderId, Order.consumerId, Claim, FranchiseRoyalty…')
    let blockers = 0
    for (const r of restosSorted.filter(r => restoClass.get(r.id) !== 'UNKNOWN')) {
      const oc = ordersByResto.get(r.id) || 0
      const led = await prisma.ledgerEntry.count({ where: { restaurantId: r.id } }).catch(() => 0)
      const oh = await prisma.openingHour.count({ where: { restaurantId: r.id } }).catch(() => 0)
      if (oc || led || oh) { blockers++; console.log(`  ${restoPseudo.get(r.id)} « ${r.name} » : orders=${oc} (FK bloquante) · ledger=${led} (append-only, orphelins) · horaires=${oh}`) }
    }
    const refOrders = await prisma.referralOrder.count().catch(() => 0)
    if (refOrders) { blockers++; console.log(`  ReferralOrder : ${refOrders} lignes (FK NOT NULL vers Order → bloque la suppression des commandes liées)`) }
    note('Pattern officiel du repo : un restaurant AVEC historique s\'ARCHIVE (archivedAt), il ne se supprime pas.')
    summary.blockers = blockers
  })

  // ═══ 7. PROTECTED ═══
  await section('PROTECTED', async () => {
    H('PROTECTED — à NE JAMAIS SUPPRIMER au clean room')
    console.log('  · Tous les comptes ADMIN ci-dessus (dont le permanent).')
    console.log('  · Toute ligne UNKNOWN tant que vous ne l\'avez pas identifiée.')
    console.log('  · Toute inscription livreur non-TEST.')
    const ic = await prisma.invoiceCounter.findMany().catch(() => [])
    const sic = await prisma.serviceInvoiceCounter.findMany().catch(() => [])
    console.log(`  · Compteurs de factures (numérotation LÉGALE sans trous) : InvoiceCounter=${JSON.stringify(ic)} ServiceInvoiceCounter=${JSON.stringify(sic)}`)
    const rcfg = await prisma.referralConfig.findUnique({ where: { id: 'default' }, select: { commissionPctOfGrubanoFee: true, active: true } }).catch(() => null)
    const acfg = await prisma.adoptionConfig.findUnique({ where: { id: 'default' }, select: { creatorCommissionPctReferred: true, active: true } }).catch(() => null)
    console.log(`  · Config en base : ReferralConfig=${rcfg ? JSON.stringify(rcfg) : 'absente'} AdoptionConfig=${acfg ? JSON.stringify(acfg) : 'absente'}`)
    if (rcfg && Math.abs(rcfg.commissionPctOfGrubanoFee - 0.22) < 1e-9) note('⚑ commissionPctOfGrubanoFee=0.22 = valeur écrite par seed-demo-data → le seed démo A tourné sur cette base.')
    console.log('  · Factures émises (Invoice) : ' + await prisma.invoice.count().catch(() => 0) + ' (document légal — ARCHIVER, ne jamais effacer sans avis comptable)')
  })

  // ═══ 8. CLEANUP CANDIDATES ═══
  await section('CLEANUP CANDIDATES', async () => {
    H('CLEANUP CANDIDATES — résumé des cibles (SUPPRESSION UNIQUEMENT AU CLEAN ROOM, avec votre GO ligne à ligne)')
    console.log(`  · ${counters.TEST_PROVED} opérateurs TEST PROVED + leurs données rattachées (marques, menus, commandes, résas, fidélité).`)
    console.log(`  · ${restosSorted.filter(r => restoClass.get(r.id) === 'TEST_PROVED').length} restaurants TEST PROVED.`)
    console.log(`  · ${counters.TEST_HIGH} opérateurs + ${restosSorted.filter(r => restoClass.get(r.id) === 'TEST_HIGH').length} restaurants TEST HIGH CONFIDENCE (après votre confirmation).`)
    console.log(`  · ${summary.compromised || 0} comptes à credentials publics (suppression OU suspension+rotation immédiate).`)
    note('L\'ordre et les exclusions sont dans docs/ops/PRE-CLEAN-ROOM-PLAN.md.')
  })

  // ═══ 9. ENV FLAGS (serveur) ═══
  await section('ENV FLAGS', async () => {
    H('ENV FLAGS (état sur CE serveur — noms seulement)')
    const FLAGS = ['RATE_LIMIT_ENABLED', 'LOGISTICS_SIGNUP_ENABLED', 'LOGISTICS_ENABLED', 'LOGISTICS_COURIER_ACTIVATION_ENABLED', 'CLAIMS_ENABLED', 'REFUNDS_ENABLED', 'ADMIN_AUDIT_ENABLED', 'AUTH_EMAIL_OTP_ENABLED', 'ALLOW_PLATFORM_FALLBACK', 'PUNITIVE_CAPTURE_ENABLED', 'DELIVERY_ZONE_ENFORCEMENT', 'CREATOR_ENABLED', 'SUPPLIER_ENABLED', 'PRESTATAIRE_ENABLED', 'FRANCHISE_ENABLED', 'AFFILIATE_ENABLED', 'TIPS_ENABLED', 'AUTH_EMAIL_CHANGE_ENABLED']
    for (const f of FLAGS) console.log(`  ${f} = ${process.env[f] === 'true' ? 'ON' : process.env[f] === undefined ? '(absent → OFF)' : 'OFF'}`)
  })

  // ═══ RÉSUMÉ FINAL ═══
  const protectedN = counters.ADMIN + counters.UNKNOWN
  console.log('\n══════════════════════ RÉSUMÉ ══════════════════════')
  console.log(`PROTECTED ENTITIES: ${protectedN} (admins=${counters.ADMIN}, unknown=${counters.UNKNOWN})`)
  console.log(`TEST PROVED: ${counters.TEST_PROVED} opérateurs · ${restosSorted.filter(r => restoClass.get(r.id) === 'TEST_PROVED').length} restaurants`)
  console.log(`TEST HIGH CONFIDENCE: ${counters.TEST_HIGH} opérateurs · ${restosSorted.filter(r => restoClass.get(r.id) === 'TEST_HIGH').length} restaurants`)
  console.log(`UNKNOWN: ${counters.UNKNOWN} opérateurs · ${restosSorted.filter(r => restoClass.get(r.id) === 'UNKNOWN').length} restaurants`)
  console.log(`CONNECT TEST REFERENCES: ${summary.connectRefs || 0}`)
  console.log(`RELATIONAL BLOCKERS: ${summary.blockers || 0}`)
  console.log(`CLEANUP READY: ${counters.UNKNOWN === 0 ? 'YES' : 'NO (identifier les UNKNOWN d\'abord)'}`)
  console.log(`ADMIN IDENTIFIED: ${summary.adminCount ? 'YES' : 'NO'}`)
  console.log(`PERMANENT ADMIN: ${summary.permanentAdmin || 'NON ÉTABLI'}`)
  console.log(`REAL PILOT PRESENT: ${summary.realPilot || 'NON ÉTABLI'}`)
  if (summary._sectionErrors) console.log(`⚠ SECTIONS EN ERREUR: ${summary._sectionErrors} (me transmettre la sortie complète)`)
  console.log('═════════════════════════════════════════════════════')
  console.log('AUCUNE ÉCRITURE N\'A ÉTÉ FAITE. Renvoyez cette sortie complète au canal habituel.')
}

main()
  .catch((e) => { console.error('❌ échec :', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
