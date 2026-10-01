'use strict'
/* ═══════════════════════════════════════════════════════════════════════════════
   clean-room.js — LE script unique et borné du CLEAN ROOM final de staging.
   Mission FINAL BETA ACCEPTANCE (2026-08-30). Doctrine suivie À LA LETTRE :
   docs/ops/CLEAN-ROOM-ARCHITECTURE.md (DELETE / ARCHIVE / PRESERVE).

   DÉCLARATION FONDATEUR (source de vérité) : il n'existe AUCUN vrai utilisateur /
   restaurateur / restaurant sur staging — TOUTES les données métier actuelles
   (anciennes UNKNOWN et TEST HIGH incluses) sont TEST CONFIRMED BY FOUNDER, plus
   les données de répétition de pilote-resto@grubano.com / pilote-client@grubano.com.

   À exécuter par le fondateur sur staging UNIQUEMENT, backup local téléchargé :

     cd ~/app.grubano.com && source ~/nodevenv/app.grubano.com/24/bin/activate \
       && node scripts/server/clean-room.js --dry-run
     # puis, après lecture du plan ET backup téléchargé EN LOCAL :
       && node scripts/server/clean-room.js --execute --i-confirm-local-backup

   CE QUE FAIT LE SCRIPT (et RIEN d'autre) :
     · PRECHECK lecture seule (compteurs, admin permanent, 7 comptes compromis,
       set PRESERVE, équation ledger gross=fee+net) ;
     · PLAN calculé (DELETE / ARCHIVE / PRESERVE) puis ORPHAN GATE simulé —
       UNEXPECTED ORPHANS ≠ 0 → ABORT sans écrire ;
     · Exécution par LOTS FK-sûrs ($transaction séquentiels, deleteMany par
       paquets de 200 ids), idempotente (re-run safe) ;
     · POSTCHECK avec recomptage RÉEL + une ligne AdminAuditLog
       (action clean_room_executed, jamais de secret).

   JAMAIS : TRUNCATE · appel Stripe (TEST ou LIVE) · suppression de
   Invoice / InvoiceCounter / ServiceInvoiceCounter / ServiceInvoice /
   AdminAuditLog / LedgerEntry / Refund / Payout / Dispute / Claim /
   EmailLog / EmailDispatch / LlmUsage · toucher à l'admin permanent.

   ⚠ Piège staging connu : Operator.notifPrefs est un JSON INVALIDE sur ~96 % des
   lignes → TOUS les select Operator sont EXPLICITES et ne lisent JAMAIS notifPrefs.
   ═══════════════════════════════════════════════════════════════════════════════ */

/* ═══ GARDE 1 — NEXTAUTH_URL (PREMIÈRES instructions exécutables : AVANT tout
   require('@prisma/client') et AVANT toute lecture de DATABASE_URL). AUCUN bypass. ═══ */
{
  const raw = process.env.NEXTAUTH_URL
  const refuse = (lines) => { for (const l of lines) console.error(l); process.exit(1) }
  if (!raw) {
    refuse([
      '',
      'REFUS — NEXTAUTH_URL est ABSENT de l\'environnement.',
      'Ce script ne devine JAMAIS sa cible : sans NEXTAUTH_URL, impossible de prouver',
      'que la base visée est bien le STAGING (app.grubano.com) → arrêt fail-closed.',
      'Hôtes autorisés : app.grubano.com (staging) · localhost / 127.* (--dry-run uniquement).',
    ])
  }
  let host = ''
  try { host = new URL(raw).hostname.toLowerCase() } catch {
    refuse(['', `REFUS — NEXTAUTH_URL illisible (« ${raw} »). Arrêt fail-closed.`])
  }
  if (host === 'grubano.com' || host === 'www.grubano.com') {
    refuse([
      '',
      `REFUS — NEXTAUTH_URL désigne la PRODUCTION (${host}).`,
      'Le Clean Room est un outil de STAGING. Il ne s\'exécutera JAMAIS contre la',
      'production, quel que soit le flag passé. Aucun bypass n\'existe.',
    ])
  }
  // Loopback = a REAL 127.x.y.z IPv4 only — a prefix test on the hostname would
  // let "127.evil.com" / "127.0.0.1.nip.io" through the allowlist (fail-open corner).
  const allowed = host === 'app.grubano.com' || host === 'localhost' || /^127(\.\d{1,3}){3}$/.test(host)
  if (!allowed) {
    refuse([
      '',
      `REFUS — hôte inconnu dans NEXTAUTH_URL (${host}).`,
      'Seuls app.grubano.com (staging) et localhost / 127.* (validation locale) sont',
      'autorisés. Tout autre hôte = arrêt fail-closed, aucune connexion, aucune écriture.',
    ])
  }
}

/* ═══ GARDE 2 — modes. Sans argument : usage + exit 1, AUCUNE connexion. ═══ */
const ARGS = process.argv.slice(2)
const DRY = ARGS.includes('--dry-run')
const EXECUTE = ARGS.includes('--execute')
const BACKUP_CONFIRMED = ARGS.includes('--i-confirm-local-backup')
if (!DRY && !EXECUTE) {
  console.error(`
Usage :
  node scripts/server/clean-room.js --dry-run
  node scripts/server/clean-room.js --execute --i-confirm-local-backup

  (sans argument)            → ce message, exit 1. AUCUNE écriture, AUCUNE connexion.
  --dry-run                  → lectures seules + PLAN complet (DELETE / ARCHIVE /
                               PRESERVE, prédiction d'orphelins, identités rehearsal).
  --execute                  → exécution réelle. EXIGE AUSSI --i-confirm-local-backup,
                               qui atteste : « BACKUP DOWNLOADED LOCALLY = YES »
                               (dump SQL complet téléchargé HORS du serveur).
                               Règle absolue : NO LOCAL BACKUP = NO CLEAN ROOM.
`)
  process.exit(1)
}
if (DRY && EXECUTE) {
  console.error('\nREFUS — --dry-run et --execute sont mutuellement exclusifs. Choisissez UN mode.')
  process.exit(1)
}
if (EXECUTE && !BACKUP_CONFIRMED) {
  console.error(`
REFUS — --execute exige le flag d'attestation --i-confirm-local-backup.

Règle absolue du Clean Room : NO LOCAL BACKUP = NO CLEAN ROOM.
Ce flag atteste que vous avez TÉLÉCHARGÉ EN LOCAL (hors serveur) un backup complet
de la base staging (« BACKUP DOWNLOADED LOCALLY = YES ») AVANT toute suppression.
Un backup resté sur le serveur ne compte pas. Faites le dump, téléchargez-le,
vérifiez sa taille, PUIS relancez avec les deux flags.
`)
  process.exit(1)
}

/* ═══ GARDE 2-bis — --execute est RÉSERVÉ au staging (app.grubano.com). AUCUN bypass.
   localhost / 127.* ne valent QUE pour --dry-run : lancé depuis ~/grubano.com (prod)
   avec NEXTAUTH_URL=http://localhost, le loader .env.local ci-dessous chargerait le
   DATABASE_URL de PRODUCTION — et sur o2switch staging et prod partagent le même hôte
   MySQL (localhost), donc AUCUNE vérification d'hôte DB ne peut compenser. ═══ */
if (EXECUTE) {
  const execHost = new URL(process.env.NEXTAUTH_URL).hostname.toLowerCase()
  if (execHost !== 'app.grubano.com') {
    console.error('\nREFUS — --execute exige NEXTAUTH_URL=https://app.grubano.com (staging).')
    console.error(`Hôte actuel : ${execHost}. localhost / 127.* ne sont autorisés que pour`)
    console.error('--dry-run (validation locale, lectures seules). Aucun bypass n\'existe.')
    process.exit(1)
  }
}

/* ═══ Env (.env.local : cwd puis racine app) — APRÈS les gardes ═══ */
const fs = require('fs')
const path = require('path')
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
if (!process.env.DATABASE_URL) { console.error('[clean-room] DATABASE_URL introuvable (env + .env.local). Abandon.'); process.exit(1) }
// Username masked too: on o2switch the DB user = the cPanel account name — this
// output is pasted into reports, host + db name are enough to identify the target.
try { const u = new URL(process.env.DATABASE_URL); console.log(`Base ciblée : ${u.protocol}//***:***@${u.host}${u.pathname}`) } catch { console.log('Base ciblée : (DSN non parsable — masqué)') }

const { PrismaClient } = require('@prisma/client')
const { mask, maskEmail, shortId, COMPROMISED_EMAILS } = require('./classification-lib')
const prisma = new PrismaClient()

/* ═══ Constantes ═══ */
const REHEARSAL_EMAILS = ['pilote-resto@grubano.com', 'pilote-client@grubano.com']
// Only these emails are printed in clear (known identities); everything else is masked.
const SHOW_EMAILS = new Set([...REHEARSAL_EMAILS, ...COMPROMISED_EMAILS])
const showEmail = (e) => (e && SHOW_EMAILS.has(e) ? e : maskEmail(e))
const REASON = 'clean-room-2026 (donnée de test — Clean Room final de la bêta, déclaration fondateur)'
const CHUNK = 200
const TX_OPTS = { timeout: 300_000, maxWait: 60_000 } // enlarged interactive-tx timeout
const chunk = (arr) => { const out = []; for (let i = 0; i < arr.length; i += CHUNK) out.push(arr.slice(i, i + CHUNK)); return out }
const setOf = (rows, key) => new Set(rows.map((r) => r[key]).filter((v) => v !== null && v !== undefined))

// Schema defaults for the seed-fingerprint realignment (0.22 = seed-demo-data mark).
const SEED_MARK = 0.22
const nearMark = (v) => typeof v === 'number' && Math.abs(v - SEED_MARK) < 1e-9
const REFERRAL_DEFAULTS = { commissionPctOfGrubanoFee: 0.30, influencerCommissionPct: 0.40, newCustomerBonusAmount: 0, durationDays: 90, customerDiscountPct: 0.10, customerDiscountCapEur: 5, active: true }
const ADOPTION_DEFAULTS = { minCommitmentDays: 60, successThresholdEur: 300, creatorCommissionPct: 0.04, creatorCommissionPctReferred: 0.02, creatorCommissionPctOrganic: 0.02, grubanoCutPct: 0, active: true }

// Every table counted in the PRECHECK (read-only). PRESERVE-strict tables included
// so the founder sees them counted, never touched.
const MODELS = [
  'operator', 'operatorRole', 'address', 'account', 'session', 'verificationToken',
  'restaurant', 'brand', 'category', 'menuItem', 'promotion', 'promoRedemption', 'stockItem',
  'order', 'review', 'waitlist', 'reservation', 'restaurantTable', 'tableTicket', 'ticketItem',
  'openingHour', 'closureException',
  'loyaltyCustomer', 'loyaltyOrder', 'loyaltyTransaction', 'reward',
  'creator', 'creatorDish', 'creatorCampaign', 'creatorFollow', 'dishAdoption', 'adoptionWaitlist', 'dishSale',
  'referral', 'referralOrder', 'referralClick', 'affiliate', 'audienceVerificationRequest',
  'supplier', 'supplierProduct', 'supplierOrder',
  'supplierProfile', 'supplierCatalogItem', 'supplyOrder', 'supplyOrderLine',
  'logisticsProfile', 'mission', 'missionDecline', 'courierEarning', 'courierPosition',
  'prestataireProfile', 'prestataireUnavailability', 'serviceOffering', 'serviceMission', 'serviceReview',
  'serviceInvoice', 'serviceInvoiceCounter',
  'franchiseApplication', 'creatorApplication', 'franchiseeApplication', 'pointOfSale', 'franchiseRoyalty',
  'ledgerEntry', 'refund', 'payout', 'dispute', 'claim', 'invoice', 'invoiceCounter',
  'emailLog', 'emailDispatch', 'emailOtp', 'onboardingNudge', 'llmUsage', 'adminAuditLog',
  'referralConfig', 'adoptionConfig',
]

const H = (t) => console.log(`\n══ ${t} ══`)

/* ═══ Snapshot (lecture seule, selects EXPLICITES — jamais notifPrefs) ═══ */
async function loadSnapshot() {
  // Operator select is EXPLICIT and NEVER includes notifPrefs (invalid JSON on
  // ~96% of staging rows → Prisma crash). Token values are read for null-checks
  // only and are NEVER printed.
  const ops = await prisma.operator.findMany({
    select: {
      id: true, email: true, name: true, role: true, status: true, password: true, createdAt: true,
      verifyTokenHash: true, magicLinkTokenHash: true, pendingEmailTokenHash: true,
    },
  })
  const roleRows = await prisma.operatorRole.findMany({ select: { operatorId: true, role: true } })
  const roleSets = new Map()
  for (const r of roleRows) { if (!roleSets.has(r.operatorId)) roleSets.set(r.operatorId, new Set()); roleSets.get(r.operatorId).add(r.role) }

  // Core money / preserve reads: NO .catch — a read failure must abort BEFORE any
  // write is planned (silent fallback on a destructive script would be dangerous).
  const restos = await prisma.restaurant.findMany({ select: { id: true, operatorId: true, name: true, city: true, isActive: true, approvedAt: true, archivedAt: true, stripeAccountId: true, pointOfSaleId: true, createdAt: true } })
  const orders = await prisma.order.findMany({ select: { id: true, consumerId: true, restaurantId: true, stripePaymentIntentId: true, paymentStatus: true, pointOfSaleId: true } })
  const refunds = await prisma.refund.findMany({ select: { id: true, orderId: true, restaurantId: true } })
  const claims = await prisma.claim.findMany({ select: { id: true, orderId: true } })
  const royalties = await prisma.franchiseRoyalty.findMany({ select: { id: true, orderId: true, franchisorOperatorId: true, restaurantId: true, pointOfSaleId: true } })
  const invoices = await prisma.invoice.findMany({ select: { id: true, restaurantId: true } })
  const ledgerRestoRows = await prisma.ledgerEntry.groupBy({ by: ['restaurantId'], _count: { _all: true } })
  const tickets = await prisma.tableTicket.findMany({ select: { id: true, restaurantId: true, restaurantTableId: true, status: true, stripePaymentIntentId: true } })
  const reservations = await prisma.reservation.findMany({ select: { id: true, restaurantId: true, tableId: true, userId: true, stripePaymentIntentId: true } })
  const tables = await prisma.restaurantTable.findMany({ select: { id: true, restaurantId: true } })
  const brands = await prisma.brand.findMany({ select: { id: true, operatorId: true, restaurantId: true, name: true } })
  const poses = await prisma.pointOfSale.findMany({ select: { id: true, franchiseId: true } })
  const referralOrders = await prisma.referralOrder.findMany({ select: { id: true, orderId: true, referralId: true, affiliateId: true } })
  // creatorId (optional FK → silent SET NULL on Creator delete) + affiliateId /
  // customerId (bare Operator-id scalars, no FK) are needed to keep the payee /
  // account attribution of every KEPT accrual line.
  const referrals = await prisma.referral.findMany({ select: { id: true, creatorId: true, affiliateId: true, customerId: true } })
  const affiliates = await prisma.affiliate.findMany({ select: { id: true, operatorId: true } })
  // Dispute is PRESERVE-strict but its orderId / restaurantId are bare scalars
  // (no FK) — read them so the plan never deletes a disputed target.
  const disputes = await prisma.dispute.findMany({ select: { id: true, orderId: true, restaurantId: true } })
  // LedgerEntry ticketId / reservationId are bare scalars too (gate coverage).
  const ledgerRefRows = await prisma.ledgerEntry.findMany({ where: { OR: [{ ticketId: { not: null } }, { reservationId: { not: null } }] }, select: { id: true, ticketId: true, reservationId: true } })
  const serviceInvoices = await prisma.serviceInvoice.findMany({ select: { id: true, restaurantOperatorId: true, prestataireProfileId: true, serviceMissionId: true } })
  const serviceMissions = await prisma.serviceMission.findMany({ select: { id: true, restaurantOperatorId: true, prestataireProfileId: true } })
  const payouts = await prisma.payout.findMany({ select: { id: true, role: true, creatorId: true, supplierProfileId: true, logisticsProfileId: true, operatorId: true, restaurantId: true } })
  const auditRows = await prisma.adminAuditLog.findMany({ select: { actorId: true, targetType: true, targetId: true } })
  const creators = await prisma.creator.findMany({ select: { id: true, email: true } })
  const supplierProfiles = await prisma.supplierProfile.findMany({ select: { id: true, email: true } })
  const logisticsProfiles = await prisma.logisticsProfile.findMany({ select: { id: true, email: true } })
  const prestataireProfiles = await prisma.prestataireProfile.findMany({ select: { id: true, email: true } })
  const sessionAgg = await prisma.session.groupBy({ by: ['userId'], _count: { _all: true } })

  return {
    ops, roleSets, restos, orders, refunds, claims, royalties, invoices, ledgerRestoRows,
    tickets, reservations, tables, brands, poses, referralOrders, referrals, affiliates,
    disputes, ledgerRefRows,
    serviceInvoices, serviceMissions, payouts, auditRows,
    creators, supplierProfiles, logisticsProfiles, prestataireProfiles,
    sessionsByOp: new Map(sessionAgg.map((s) => [s.userId, s._count._all])),
  }
}

/* ═══ PLAN — DELETE / ARCHIVE / PRESERVE, doctrine CLEAN-ROOM-ARCHITECTURE.md ═══ */
function computePlan(s) {
  const errors = [] // any inconsistency here → ABORT before writing

  const isAdmin = (op) => op.role === 'admin' || (s.roleSets.get(op.id) || new Set()).has('admin')
  // PRESERVE: permanent admin(s) = admin role + password null + status active.
  const permanentAdminIds = new Set(s.ops.filter((o) => isAdmin(o) && o.password === null && o.status === 'active').map((o) => o.id))

  // ── Orders : preserved = paid (PI) OR paymentStatus set OR referenced by a
  //    PRESERVE document (Refund / Claim / FranchiseRoyalty / Dispute). Invoice
  //    references restaurants (not orders); LedgerEntry ties via the PI (⇒ PI
  //    non-null, covered). Dispute.orderId is a bare scalar: a dispute attached
  //    via charge metadata may point at an order with NO PI — still preserved.
  const refundOrderIds = setOf(s.refunds, 'orderId')
  const claimOrderIds = setOf(s.claims, 'orderId')
  const royaltyOrderIds = setOf(s.royalties, 'orderId')
  const disputeOrderIds = setOf(s.disputes, 'orderId')
  const preservedOrderIds = new Set()
  for (const o of s.orders) {
    if (o.stripePaymentIntentId !== null || o.paymentStatus !== null ||
        refundOrderIds.has(o.id) || claimOrderIds.has(o.id) || royaltyOrderIds.has(o.id) ||
        disputeOrderIds.has(o.id)) preservedOrderIds.add(o.id)
  }
  const deleteOrderIds = s.orders.filter((o) => !preservedOrderIds.has(o.id)).map((o) => o.id)
  const deleteOrderSet = new Set(deleteOrderIds)

  // ── Restaurants : money-history ⇒ ARCHIVE ; sinon DELETE (tous sont TEST). ──
  const ledgerRestoIds = setOf(s.ledgerRestoRows, 'restaurantId')
  const invoiceRestoIds = setOf(s.invoices, 'restaurantId')
  const refundRestoIds = setOf(s.refunds, 'restaurantId')
  const royaltyRestoIds = setOf(s.royalties, 'restaurantId')
  const payoutRestoIds = setOf(s.payouts, 'restaurantId')
  const disputeRestoIds = setOf(s.disputes, 'restaurantId')
  const restoOfTable = new Map(s.tables.map((t) => [t.id, t.restaurantId]))
  const paidTicketRestoIds = new Set(s.tickets.filter((t) => t.status === 'paid' || t.stripePaymentIntentId !== null).map((t) => t.restaurantId))
  const resaPIRestoIds = new Set()
  for (const r of s.reservations) {
    if (r.stripePaymentIntentId === null) continue
    if (r.restaurantId) resaPIRestoIds.add(r.restaurantId)
    const viaTable = restoOfTable.get(r.tableId)
    if (viaTable) resaPIRestoIds.add(viaTable)
  }
  const preservedOrderRestoIds = new Set(s.orders.filter((o) => preservedOrderIds.has(o.id)).map((o) => o.restaurantId))
  const archiveRestoIds = new Set()
  const deleteRestoIds = new Set()
  for (const r of s.restos) {
    const money = preservedOrderRestoIds.has(r.id) || ledgerRestoIds.has(r.id) || invoiceRestoIds.has(r.id) ||
      refundRestoIds.has(r.id) || royaltyRestoIds.has(r.id) || payoutRestoIds.has(r.id) ||
      disputeRestoIds.has(r.id) || paidTicketRestoIds.has(r.id) || resaPIRestoIds.has(r.id)
    if (money) archiveRestoIds.add(r.id); else deleteRestoIds.add(r.id)
  }

  // ── PointOfSale : conservé (isActive=false) si référencé par une FranchiseRoyalty
  //    (PRESERVE doc), par une commande PRÉSERVÉE ou par un resto ARCHIVÉ.
  //    Order.pointOfSale / Restaurant.pointOfSale sont des FK optionnelles SANS
  //    onDelete (défaut Prisma = SET NULL) : supprimer un tel POS écraserait EN
  //    SILENCE l'attribution franchise d'une ligne d'argent conservée. ──
  const royaltyPosIds = setOf(s.royalties, 'pointOfSaleId')
  const preservedOrderPosIds = new Set(s.orders.filter((o) => preservedOrderIds.has(o.id) && o.pointOfSaleId).map((o) => o.pointOfSaleId))
  const archivedRestoPosIds = new Set(s.restos.filter((r) => archiveRestoIds.has(r.id) && r.pointOfSaleId).map((r) => r.pointOfSaleId))
  const wantedPosIds = new Set([...royaltyPosIds, ...preservedOrderPosIds, ...archivedRestoPosIds])
  const keepPosIds = new Set(s.poses.filter((p) => wantedPosIds.has(p.id)).map((p) => p.id))
  const deletePosIds = s.poses.filter((p) => !keepPosIds.has(p.id)).map((p) => p.id)

  // ── Referral : les ReferralOrder des commandes SUPPRIMÉES partent d'abord ;
  //    un Referral qui garde ≥1 ReferralOrder survivant est CONSERVÉ (FK Restrict)
  //    mais désactivé (active=false) ; les autres sont supprimés. ──
  const deleteReferralOrderIds = s.referralOrders.filter((ro) => deleteOrderSet.has(ro.orderId)).map((ro) => ro.id)
  const survivingReferralOrders = s.referralOrders.filter((ro) => !deleteOrderSet.has(ro.orderId))
  const keepReferralIds = new Set(survivingReferralOrders.map((ro) => ro.referralId))
  const deleteReferralIds = s.referrals.filter((r) => !keepReferralIds.has(r.id)).map((r) => r.id)
  const keptReferrals = s.referrals.filter((r) => keepReferralIds.has(r.id))
  // Referral.creatorId is an OPTIONAL FK without onDelete (default = SET NULL):
  // deleting the creator of a KEPT referral would silently null the payee of a
  // frozen creatorEarning → those creators are kept too.
  const keptReferralCreatorIds = new Set(keptReferrals.filter((r) => r.creatorId).map((r) => r.creatorId))
  // Bare Operator-id scalars on kept accrual lines (no FK): the affiliate credited
  // by a surviving ReferralOrder / kept Referral, and the kept Referral's customer,
  // must keep their Operator row (ARCHIVE, never DELETE) — see the operator loop.
  const keptAffiliateOpIds = new Set([
    ...survivingReferralOrders.filter((ro) => ro.affiliateId).map((ro) => ro.affiliateId),
    ...keptReferrals.filter((r) => r.affiliateId).map((r) => r.affiliateId),
  ])
  const keptReferralCustomerIds = new Set(keptReferrals.map((r) => r.customerId))
  // Affiliate rows: kept (suspended) when their operator is a kept payee — a
  // blanket wipe would orphan the affiliateId of conserved accrual lines.
  const keepAffiliateIds = new Set(s.affiliates.filter((a) => keptAffiliateOpIds.has(a.operatorId)).map((a) => a.id))
  const deleteAffiliateIds = s.affiliates.filter((a) => !keepAffiliateIds.has(a.id)).map((a) => a.id)

  // ── Profils préservés par un document PRESERVE (Payout / ServiceInvoice)
  //    ou par une ligne d'accrual conservée (Referral conservé → Creator). ──
  const payoutCreatorIds = setOf(s.payouts, 'creatorId')
  const payoutSupplierProfileIds = setOf(s.payouts, 'supplierProfileId')
  const payoutLogisticsProfileIds = setOf(s.payouts, 'logisticsProfileId')
  const payoutOperatorIds = setOf(s.payouts, 'operatorId')
  const svcInvPrestataireIds = setOf(s.serviceInvoices, 'prestataireProfileId')
  const svcInvOperatorIds = setOf(s.serviceInvoices, 'restaurantOperatorId')
  const svcInvMissionIds = setOf(s.serviceInvoices, 'serviceMissionId')
  // Cascade belt: ServiceInvoice (PRESERVE-strict) is reachable via ServiceMission
  // (both operator + prestataire FKs are onDelete: Cascade, and the invoice
  // cascades with its mission). Keep-sets must therefore ALSO derive from the
  // INVOICED missions themselves — if a mission's denormalised ids diverge from
  // its invoice's, deleting that op/prestataire would cascade mission → invoice.
  const invoicedMissions = s.serviceMissions.filter((m) => svcInvMissionIds.has(m.id))
  const invoicedMissionOperatorIds = new Set(invoicedMissions.map((m) => m.restaurantOperatorId))
  const invoicedMissionPrestataireIds = new Set(invoicedMissions.map((m) => m.prestataireProfileId))

  const keepCreatorIds = new Set(s.creators.filter((c) => payoutCreatorIds.has(c.id) || keptReferralCreatorIds.has(c.id)).map((c) => c.id))
  const deleteCreatorIds = s.creators.filter((c) => !keepCreatorIds.has(c.id)).map((c) => c.id)
  const keepSupplierProfileIds = new Set(s.supplierProfiles.filter((p) => payoutSupplierProfileIds.has(p.id)).map((p) => p.id))
  const deleteSupplierProfileIds = s.supplierProfiles.filter((p) => !keepSupplierProfileIds.has(p.id)).map((p) => p.id)
  const keepLogisticsProfileIds = new Set(s.logisticsProfiles.filter((p) => payoutLogisticsProfileIds.has(p.id)).map((p) => p.id))
  const deleteLogisticsProfileIds = s.logisticsProfiles.filter((p) => !keepLogisticsProfileIds.has(p.id)).map((p) => p.id)
  const keepPrestataireIds = new Set(s.prestataireProfiles.filter((p) => svcInvPrestataireIds.has(p.id) || invoicedMissionPrestataireIds.has(p.id)).map((p) => p.id))
  const deletePrestataireIds = s.prestataireProfiles.filter((p) => !keepPrestataireIds.has(p.id)).map((p) => p.id)
  // ServiceMission : DELETE sauf mission facturée (ServiceInvoice 1:1 = PRESERVE).
  const deleteServiceMissionIds = s.serviceMissions.filter((m) => !svcInvMissionIds.has(m.id)).map((m) => m.id)

  // ── Enfants des restos DELETE (ordre FK de l'architecture doc) — calculés AVANT
  //    le tri des opérateurs, pour connaître les réservations CONSERVÉES. ──
  const deleteTableIds = s.tables.filter((t) => t.restaurantId && deleteRestoIds.has(t.restaurantId)).map((t) => t.id)
  const deleteTableSet = new Set(deleteTableIds)
  const deleteTicketIds = s.tickets.filter((t) => deleteRestoIds.has(t.restaurantId)).map((t) => t.id)
  const deleteResaIds = s.reservations.filter((r) => (r.restaurantId && deleteRestoIds.has(r.restaurantId)) || deleteTableSet.has(r.tableId)).map((r) => r.id)
  const deleteResaSet = new Set(deleteResaIds)
  // Reservation.userId is a bare scalar (no FK): the account link of EVERY kept
  // reservation (children of archived restos) must survive as an archived Operator
  // — not only the deposit-fingerprint ones — or the pay+order app channel would
  // silently treat a linked reservation as anonymous.
  const keptResaUserIds = new Set(s.reservations.filter((r) => r.userId && !deleteResaSet.has(r.id)).map((r) => r.userId))

  // ── Opérateurs : TOUT est TEST sauf les admins passwordless actifs. ──
  const keptOrderConsumerIds = new Set(s.orders.filter((o) => !deleteOrderSet.has(o.id)).map((o) => o.consumerId))
  const archivedRestoOwnerIds = new Set(s.restos.filter((r) => archiveRestoIds.has(r.id)).map((r) => r.operatorId))
  const keptPosOwnerIds = new Set(s.poses.filter((p) => keepPosIds.has(p.id)).map((p) => p.franchiseId))
  const royaltyFranchisorIds = setOf(s.royalties, 'franchisorOperatorId')
  const resaPIUserIds = new Set(s.reservations.filter((r) => r.stripePaymentIntentId !== null && r.userId).map((r) => r.userId))
  const auditRefOpIds = new Set()
  for (const a of s.auditRows) {
    if (a.actorId) auditRefOpIds.add(a.actorId)
    // neutralize-public-credentials wrote targetId as a comma-joined id list
    if (a.targetType === 'operator' && a.targetId) for (const id of String(a.targetId).split(',')) auditRefOpIds.add(id.trim())
  }

  const archiveOpIds = new Set()
  const deleteOpIds = new Set()
  const opArchiveWhy = new Map()
  for (const op of s.ops) {
    if (permanentAdminIds.has(op.id)) continue // PRESERVE
    const why = []
    if (keptOrderConsumerIds.has(op.id)) why.push('order-historique')
    if (archivedRestoOwnerIds.has(op.id)) why.push('resto-archivé')
    if (auditRefOpIds.has(op.id)) why.push('audit')
    if (svcInvOperatorIds.has(op.id)) why.push('service-invoice')
    if (invoicedMissionOperatorIds.has(op.id)) why.push('service-mission-facturée')
    if (payoutOperatorIds.has(op.id)) why.push('payout')
    if (royaltyFranchisorIds.has(op.id)) why.push('royalty')
    if (keptPosOwnerIds.has(op.id)) why.push('pos-conservé')
    if (resaPIUserIds.has(op.id)) why.push('résa-empreinte')
    else if (keptResaUserIds.has(op.id)) why.push('résa-conservée')
    if (keptAffiliateOpIds.has(op.id)) why.push('affiliation-survivante')
    if (keptReferralCustomerIds.has(op.id)) why.push('referral-conservé')
    if (why.length) { archiveOpIds.add(op.id); opArchiveWhy.set(op.id, why) } else deleteOpIds.add(op.id)
  }
  // Edge FK : une marque d'un op DELETE liée à un resto ARCHIVÉ doit survivre
  // (enfants conservés) → on PROMEUT son propriétaire en ARCHIVE.
  for (const b of s.brands) {
    if (deleteOpIds.has(b.operatorId) && b.restaurantId && archiveRestoIds.has(b.restaurantId)) {
      deleteOpIds.delete(b.operatorId); archiveOpIds.add(b.operatorId)
      opArchiveWhy.set(b.operatorId, [...(opArchiveWhy.get(b.operatorId) || []), 'marque-sur-resto-archivé'])
    }
  }

  // ── Marques : DELETE = marques des opérateurs DELETE (enfants des ops/restos
  //    archivés CONSERVÉS, invisibles). ──
  const deleteBrandIds = s.brands.filter((b) => deleteOpIds.has(b.operatorId)).map((b) => b.id)

  // ── Assertions de cohérence (ceintures) : jamais d'argent dans un lot DELETE. ──
  for (const t of s.tickets) {
    if (deleteRestoIds.has(t.restaurantId) && (t.status === 'paid' || t.stripePaymentIntentId !== null)) {
      errors.push(`TableTicket payé ${shortId(t.id)} sur un resto planifié DELETE — incohérence de plan`)
    }
  }
  for (const r of s.reservations) {
    if (deleteResaSet.has(r.id) && r.stripePaymentIntentId !== null) {
      errors.push(`Réservation avec empreinte ${shortId(r.id)} planifiée DELETE — incohérence de plan`)
    }
  }
  for (const o of s.orders) {
    if (preservedOrderIds.has(o.id) && deleteRestoIds.has(o.restaurantId)) {
      errors.push(`Order conservée ${shortId(o.id)} sur un resto planifié DELETE — incohérence de plan`)
    }
  }
  // Belt: a POS referenced by a preserved order / archived resto must never be
  // planned DELETE (its FKs would silently SET NULL the kept money attribution).
  const deletePosSet = new Set(deletePosIds)
  for (const o of s.orders) {
    if (preservedOrderIds.has(o.id) && o.pointOfSaleId && deletePosSet.has(o.pointOfSaleId)) {
      errors.push(`PointOfSale ${shortId(o.pointOfSaleId)} d'une commande conservée ${shortId(o.id)} planifié DELETE — incohérence de plan`)
    }
  }
  for (const r of s.restos) {
    if (archiveRestoIds.has(r.id) && r.pointOfSaleId && deletePosSet.has(r.pointOfSaleId)) {
      errors.push(`PointOfSale ${shortId(r.pointOfSaleId)} d'un resto archivé ${shortId(r.id)} planifié DELETE — incohérence de plan`)
    }
  }
  // A KEPT ticket must never reference a table planned for deletion (cross-resto
  // data oddity would break the FK mid-run) — fail the gate instead.
  const deleteTicketSet = new Set(deleteTicketIds)
  for (const t of s.tickets) {
    if (!deleteTicketSet.has(t.id) && deleteTableSet.has(t.restaurantTableId)) {
      errors.push(`TableTicket conservé ${shortId(t.id)} référence une table planifiée DELETE — incohérence de plan`)
    }
  }

  const rehearsal = s.ops.filter((o) => REHEARSAL_EMAILS.includes(o.email))

  return {
    errors, permanentAdminIds,
    preservedOrderIds, deleteOrderIds,
    archiveRestoIds, deleteRestoIds,
    keepPosIds, deletePosIds,
    keepCreatorIds, deleteCreatorIds,
    keepSupplierProfileIds, deleteSupplierProfileIds,
    keepLogisticsProfileIds, deleteLogisticsProfileIds,
    keepPrestataireIds, deletePrestataireIds,
    deleteServiceMissionIds,
    deleteReferralOrderIds, keepReferralIds, deleteReferralIds,
    keepAffiliateIds, deleteAffiliateIds,
    archiveOpIds, deleteOpIds, opArchiveWhy,
    deleteBrandIds, deleteTableIds, deleteTicketIds, deleteResaIds,
    rehearsal,
  }
}

/* ═══ ORPHAN GATE — simulation sur le PLAN (aucune écriture). Les orphelins
   PRÉ-EXISTANTS (déjà pendants avant le plan) sont comptés à part et servent de
   baseline au recomptage POSTCHECK ; UNEXPECTED = créés PAR le plan. ═══ */
function computeGate(s, plan) {
  const allRestoIds = new Set(s.restos.map((r) => r.id))
  const allOrderIds = new Set(s.orders.map((o) => o.id))
  const allOpIds = new Set(s.ops.map((o) => o.id))
  const survRestoIds = new Set([...allRestoIds].filter((id) => !plan.deleteRestoIds.has(id)))
  const deleteOrderSet = new Set(plan.deleteOrderIds)
  const survOrderIds = new Set([...allOrderIds].filter((id) => !deleteOrderSet.has(id)))
  const survOpIds = new Set([...allOpIds].filter((id) => !plan.deleteOpIds.has(id)))
  const allCreatorIds = new Set(s.creators.map((c) => c.id))
  const deleteCreatorSet = new Set(plan.deleteCreatorIds)
  const survCreatorIds = new Set([...allCreatorIds].filter((id) => !deleteCreatorSet.has(id)))
  const allTicketIds = new Set(s.tickets.map((t) => t.id))
  const deleteTicketSet = new Set(plan.deleteTicketIds)
  const survTicketIds = new Set([...allTicketIds].filter((id) => !deleteTicketSet.has(id)))
  const allResaIds = new Set(s.reservations.map((r) => r.id))
  const deleteResaSet = new Set(plan.deleteResaIds)
  const survResaIds = new Set([...allResaIds].filter((id) => !deleteResaSet.has(id)))
  const deleteReferralSet = new Set(plan.deleteReferralIds)
  const deleteReferralOrderSet = new Set(plan.deleteReferralOrderIds)

  const preExistingKeys = new Set()
  const unexpected = []
  const check = (kind, refId, target, existsBefore, survives) => {
    if (survives) return
    if (!existsBefore) { preExistingKeys.add(`${kind}:${refId}`); return }
    unexpected.push(`${kind} : réf ${shortId(refId)} → cible ${shortId(target)} supprimée par le plan`)
  }
  for (const g of s.ledgerRestoRows) check('ledger-resto', g.restaurantId, g.restaurantId, allRestoIds.has(g.restaurantId), survRestoIds.has(g.restaurantId))
  for (const i of s.invoices) check('invoice-resto', i.restaurantId, i.restaurantId, allRestoIds.has(i.restaurantId), survRestoIds.has(i.restaurantId))
  for (const r of s.refunds) check('refund-order', r.id, r.orderId, allOrderIds.has(r.orderId), survOrderIds.has(r.orderId))
  for (const c of s.claims) check('claim-order', c.id, c.orderId, allOrderIds.has(c.orderId), survOrderIds.has(c.orderId))
  for (const fr of s.royalties) check('royalty-order', fr.id, fr.orderId, allOrderIds.has(fr.orderId), survOrderIds.has(fr.orderId))
  for (const o of s.orders) {
    if (deleteOrderSet.has(o.id)) continue
    check('order-consumer', o.id, o.consumerId, allOpIds.has(o.consumerId), survOpIds.has(o.consumerId))
  }
  // Dispute (PRESERVE) → order / resto : scalaires sans FK, nullables.
  for (const dsp of s.disputes) {
    if (dsp.orderId) check('dispute-order', dsp.id, dsp.orderId, allOrderIds.has(dsp.orderId), survOrderIds.has(dsp.orderId))
    if (dsp.restaurantId) check('dispute-resto', dsp.id, dsp.restaurantId, allRestoIds.has(dsp.restaurantId), survRestoIds.has(dsp.restaurantId))
  }
  // LedgerEntry (PRESERVE) → ticket / réservation : scalaires sans FK, nullables.
  for (const l of s.ledgerRefRows) {
    if (l.ticketId) check('ledger-ticket', l.id, l.ticketId, allTicketIds.has(l.ticketId), survTicketIds.has(l.ticketId))
    if (l.reservationId) check('ledger-resa', l.id, l.reservationId, allResaIds.has(l.reservationId), survResaIds.has(l.reservationId))
  }
  // Referral CONSERVÉS → creator (FK SetNull silencieux) + affilié/client (scalaires).
  for (const r of s.referrals) {
    if (deleteReferralSet.has(r.id)) continue
    if (r.creatorId) check('referral-creator', r.id, r.creatorId, allCreatorIds.has(r.creatorId), survCreatorIds.has(r.creatorId))
    if (r.affiliateId) check('referral-affiliate', r.id, r.affiliateId, allOpIds.has(r.affiliateId), survOpIds.has(r.affiliateId))
    if (r.customerId) check('referral-customer', r.id, r.customerId, allOpIds.has(r.customerId), survOpIds.has(r.customerId))
  }
  // ReferralOrder SURVIVANTES → opérateur affilié (scalaire sans FK).
  for (const ro of s.referralOrders) {
    if (deleteReferralOrderSet.has(ro.id)) continue
    if (ro.affiliateId) check('referralorder-affiliate', ro.id, ro.affiliateId, allOpIds.has(ro.affiliateId), survOpIds.has(ro.affiliateId))
  }
  // Réservations CONSERVÉES → lien de compte userId (scalaire sans FK).
  for (const r of s.reservations) {
    if (deleteResaSet.has(r.id)) continue
    if (r.userId) check('resa-user', r.id, r.userId, allOpIds.has(r.userId), survOpIds.has(r.userId))
  }
  return { preExistingKeys, unexpected }
}

/* ═══ Recomptage RÉEL des orphelins (POSTCHECK) — mêmes clés que la baseline. ═══ */
async function recountOrphans(baseline) {
  const restoIds = new Set((await prisma.restaurant.findMany({ select: { id: true } })).map((r) => r.id))
  const orderIds = new Set((await prisma.order.findMany({ select: { id: true } })).map((o) => o.id))
  const opIds = new Set((await prisma.operator.findMany({ select: { id: true } })).map((o) => o.id))
  const creatorIds = new Set((await prisma.creator.findMany({ select: { id: true } })).map((c) => c.id))
  const ticketIds = new Set((await prisma.tableTicket.findMany({ select: { id: true } })).map((t) => t.id))
  const resaRows = await prisma.reservation.findMany({ select: { id: true, userId: true } })
  const resaIds = new Set(resaRows.map((r) => r.id))
  let unexpected = 0, preExisting = 0
  const check = (kind, refId, ok) => {
    if (ok) return
    if (baseline.has(`${kind}:${refId}`)) preExisting++
    else unexpected++
  }
  for (const g of await prisma.ledgerEntry.groupBy({ by: ['restaurantId'] })) check('ledger-resto', g.restaurantId, restoIds.has(g.restaurantId))
  for (const i of await prisma.invoice.findMany({ select: { restaurantId: true } })) check('invoice-resto', i.restaurantId, restoIds.has(i.restaurantId))
  for (const r of await prisma.refund.findMany({ select: { id: true, orderId: true } })) check('refund-order', r.id, orderIds.has(r.orderId))
  for (const c of await prisma.claim.findMany({ select: { id: true, orderId: true } })) check('claim-order', c.id, orderIds.has(c.orderId))
  for (const fr of await prisma.franchiseRoyalty.findMany({ select: { id: true, orderId: true } })) check('royalty-order', fr.id, orderIds.has(fr.orderId))
  for (const o of await prisma.order.findMany({ select: { id: true, consumerId: true } })) check('order-consumer', o.id, opIds.has(o.consumerId))
  for (const dsp of await prisma.dispute.findMany({ select: { id: true, orderId: true, restaurantId: true } })) {
    if (dsp.orderId) check('dispute-order', dsp.id, orderIds.has(dsp.orderId))
    if (dsp.restaurantId) check('dispute-resto', dsp.id, restoIds.has(dsp.restaurantId))
  }
  for (const l of await prisma.ledgerEntry.findMany({ where: { OR: [{ ticketId: { not: null } }, { reservationId: { not: null } }] }, select: { id: true, ticketId: true, reservationId: true } })) {
    if (l.ticketId) check('ledger-ticket', l.id, ticketIds.has(l.ticketId))
    if (l.reservationId) check('ledger-resa', l.id, resaIds.has(l.reservationId))
  }
  for (const r of await prisma.referral.findMany({ select: { id: true, creatorId: true, affiliateId: true, customerId: true } })) {
    if (r.creatorId) check('referral-creator', r.id, creatorIds.has(r.creatorId))
    if (r.affiliateId) check('referral-affiliate', r.id, opIds.has(r.affiliateId))
    if (r.customerId) check('referral-customer', r.id, opIds.has(r.customerId))
  }
  for (const ro of await prisma.referralOrder.findMany({ select: { id: true, affiliateId: true } })) {
    if (ro.affiliateId) check('referralorder-affiliate', ro.id, opIds.has(ro.affiliateId))
  }
  for (const r of resaRows) if (r.userId) check('resa-user', r.id, opIds.has(r.userId))
  return { unexpected, preExisting }
}

/* ═══ Affichage du plan (dry-run ET avant exécution) — e-mails masqués sauf
   les 2 pilote-* et les 7 compromis ; ids Stripe masqués. ═══ */
function printPlan(s, plan, gate, configPlan) {
  H('PLAN — OPÉRATEURS')
  const opById = new Map(s.ops.map((o) => [o.id, o]))
  const admins = [...plan.permanentAdminIds].map((id) => opById.get(id))
  console.log(`  PRESERVE (admin permanent) : ${admins.length}`)
  for (const a of admins) console.log(`    ${showEmail(a.email)}  role=${a.role} status=${a.status} pwd=null (passwordless ✓)`)
  console.log(`  ARCHIVE (suspendu + password null + tokens purgés + sessions/accounts supprimés) : ${plan.archiveOpIds.size}`)
  for (const id of plan.archiveOpIds) {
    const o = opById.get(id)
    console.log(`    ${showEmail(o.email)}  role=${o.role} status=${o.status} ← ${(plan.opArchiveWhy.get(id) || []).join(',')}`)
  }
  console.log(`  DELETE : ${plan.deleteOpIds.size}`)
  for (const id of plan.deleteOpIds) {
    const o = opById.get(id)
    console.log(`    ${showEmail(o.email)}  role=${o.role} status=${o.status}`)
  }

  H('PLAN — RESTAURANTS')
  console.log(`  ARCHIVE (archivedAt=now · isActive=false · approvedAt=null · enfants CONSERVÉS) : ${plan.archiveRestoIds.size}`)
  for (const r of s.restos.filter((x) => plan.archiveRestoIds.has(x.id))) {
    console.log(`    « ${r.name} » (${r.city}) id=${shortId(r.id)} Connect=${r.stripeAccountId ? mask(r.stripeAccountId) + ' (référence PRÉSERVÉE, aucun appel Stripe)' : 'aucun'}`)
  }
  console.log(`  DELETE (ordre FK : TicketItem→TableTicket · Réservations · Tables · Horaires/Fermetures · puis Restaurant) : ${plan.deleteRestoIds.size}`)
  for (const r of s.restos.filter((x) => plan.deleteRestoIds.has(x.id))) console.log(`    « ${r.name} » (${r.city}) id=${shortId(r.id)}`)

  H('PLAN — COMMANDES')
  console.log(`  CONSERVÉES (payées / référencées par Refund·Claim·FranchiseRoyalty — rendues invisibles par l'archivage) : ${plan.preservedOrderIds.size}`)
  console.log(`  DELETE (jamais payées, non référencées ; ReferralOrder liées supprimées AVANT) : ${plan.deleteOrderIds.length}`)

  H('PLAN — RÔLES / PROFILS / MÉCANISMES')
  console.log(`  Waitlist LIVREUR (LogisticsProfile) : DELETE=${plan.deleteLogisticsProfileIds.length} · ARCHIVE(payout)=${plan.keepLogisticsProfileIds.size} — le MÉCANISME (code + flag) reste intact : waitlist vide + signup fonctionnel après clean.`)
  console.log(`  Missions/Declines/Earnings/Positions livreur : DELETE totalité.`)
  console.log(`  SupplierProfile : DELETE=${plan.deleteSupplierProfileIds.length} · ARCHIVE(payout)=${plan.keepSupplierProfileIds.size}`)
  console.log(`  PrestataireProfile : DELETE=${plan.deletePrestataireIds.length} · ARCHIVE(service-invoice)=${plan.keepPrestataireIds.size}`)
  console.log(`  ServiceMission : DELETE=${plan.deleteServiceMissionIds.length} · CONSERVÉES (facturées)=${setOf(s.serviceInvoices, 'serviceMissionId').size}`)
  console.log(`  Creator : DELETE=${plan.deleteCreatorIds.length} · CONSERVÉS(payout/referral-conservé)=${plan.keepCreatorIds.size}`)
  console.log(`  Referral : DELETE=${plan.deleteReferralIds.length} · CONSERVÉS+désactivés (ReferralOrder survivante)=${plan.keepReferralIds.size} · ReferralOrder DELETE=${plan.deleteReferralOrderIds.length}`)
  console.log(`  Affiliate : DELETE=${plan.deleteAffiliateIds.length} · CONSERVÉS+suspendus (payee d'une ligne d'accrual conservée)=${plan.keepAffiliateIds.size}`)
  console.log(`  PointOfSale : DELETE=${plan.deletePosIds.length} · CONSERVÉS+isActive=false (FranchiseRoyalty / commande conservée / resto archivé)=${plan.keepPosIds.size}`)
  console.log(`  Marques (opérateurs DELETE, avec MenuItem/Promotion/StockItem/Category) : DELETE=${plan.deleteBrandIds.length}`)
  console.log('  DELETE totalité : Loyalty (customers/orders/transactions/rewards) · DishSale/DishAdoption/AdoptionWaitlist/CreatorCampaign/CreatorDish/CreatorFollow ·')
  console.log('    ReferralClick/AudienceVerificationRequest · Review · Waitlist resto · PromoRedemption · EmailOtp · OnboardingNudge ·')
  console.log('    FranchiseApplication/CreatorApplication/FranchiseeApplication · Supplier/SupplierProduct/SupplierOrder (répertoire privé) ·')
  console.log('    SupplierCatalogItem/SupplyOrder(+Lines) · ServiceOffering/ServiceReview/PrestataireUnavailability.')

  H('PLAN — PRESERVE STRICT (jamais touchés)')
  console.log('  Invoice · InvoiceCounter · ServiceInvoiceCounter · ServiceInvoice · AdminAuditLog · LedgerEntry · Refund · Payout · Dispute · Claim ·')
  console.log('  EmailLog · EmailDispatch · LlmUsage · VerificationToken · sessions/tokens de l\'admin permanent. AUCUN appel Stripe (références Connect TEST préservées).')

  H('PLAN — CONFIG (empreinte seed 0.22 → RÉALIGNEMENT sur les défauts schéma, update jamais delete)')
  if (!configPlan.referral.length && !configPlan.adoption.length) console.log('  Aucune empreinte seed détectée — configs laissées telles quelles.')
  for (const c of configPlan.referral) console.log(`  ReferralConfig ${shortId(c.id)} : avant=${JSON.stringify(c.before)} → après=${JSON.stringify(c.after)}`)
  for (const c of configPlan.adoption) console.log(`  AdoptionConfig ${shortId(c.id)} : avant=${JSON.stringify(c.before)} → après=${JSON.stringify(c.after)}`)

  H('PLAN — IDENTITÉS REHEARSAL (pilote)')
  if (!plan.rehearsal.length) console.log('  (aucun des 2 comptes pilote trouvé en base)')
  for (const o of plan.rehearsal) {
    const verdict = plan.deleteOpIds.has(o.id) ? 'DELETE' : plan.archiveOpIds.has(o.id) ? 'ARCHIVE' : 'PRESERVE (⚠ inattendu)'
    console.log(`  ${o.email}  role=${o.role} status=${o.status} → ${verdict}`)
  }

  H('PLAN — PRÉDICTION ORPHELINS (gate de sortie)')
  console.log(`  UNEXPECTED ORPHANS prédits = ${gate.unexpected.length} (attendu 0)`)
  for (const u of gate.unexpected.slice(0, 20)) console.log(`    ✗ ${u}`)
  console.log(`  Orphelins PRÉ-EXISTANTS (déjà pendants AVANT le plan, non créés par lui) = ${gate.preExistingKeys.size}`)
  if (plan.errors.length) {
    console.log(`  ✗ INCOHÉRENCES DE PLAN = ${plan.errors.length}`)
    for (const e of plan.errors) console.log(`    ✗ ${e}`)
  }
}

/* ═══ EXÉCUTION — lots FK-sûrs, $transaction séquentiels, chunks de 200. ═══ */
async function executePlan(s, plan, configPlan) {
  const stats = {}
  const bump = (k, n) => { stats[k] = (stats[k] || 0) + n }
  const delByIds = async (tx, model, ids, label) => {
    let n = 0
    for (const c of chunk(ids)) n += (await tx[model].deleteMany({ where: { id: { in: c } } })).count
    if (n || ids.length) console.log(`    ${label} : ${n} supprimé(s)`)
    bump(label, n)
    return n
  }
  const wipe = async (tx, model, label) => {
    const n = (await tx[model].deleteMany({})).count
    if (n) console.log(`    ${label} : ${n} supprimé(s)`)
    bump(label, n)
    return n
  }
  const lot = async (name, fn) => {
    console.log(`  ── LOT ${name}`)
    await prisma.$transaction(fn, TX_OPTS)
  }

  await lot('1 · configs (réalignement seed → défauts schéma)', async (tx) => {
    for (const c of configPlan.referral) { await tx.referralConfig.update({ where: { id: c.id }, data: c.after }); console.log(`    ReferralConfig ${shortId(c.id)} réaligné`) }
    for (const c of configPlan.adoption) { await tx.adoptionConfig.update({ where: { id: c.id }, data: c.after }); console.log(`    AdoptionConfig ${shortId(c.id)} réaligné`) }
  })

  await lot('2 · fidélité', async (tx) => {
    await wipe(tx, 'loyaltyTransaction', 'LoyaltyTransaction')
    await wipe(tx, 'reward', 'Reward')
    await wipe(tx, 'loyaltyOrder', 'LoyaltyOrder')
    await wipe(tx, 'loyaltyCustomer', 'LoyaltyCustomer')
  })

  await lot('3 · économie créateur', async (tx) => {
    // DishSale is wiped IN FULL (doctrine CLEAN-ROOM-ARCHITECTURE: creator economy
    // = DELETE totalité) even though some rows reference preserved paid orders —
    // a ReferralOrder-style partial keep is IMPOSSIBLE here without also keeping
    // the whole adoption chain (DishSale.adoptionId is a REQUIRED FK → keeping any
    // row would make the DishAdoption/CreatorDish wipes below fail on Restrict).
    // Founder-visible trade-off: the frozen chef-royalty trace of preserved orders
    // is dropped with the rail; the order + ledger money lines are untouched.
    await wipe(tx, 'dishSale', 'DishSale')
    await wipe(tx, 'dishAdoption', 'DishAdoption')
    await wipe(tx, 'adoptionWaitlist', 'AdoptionWaitlist')
    await wipe(tx, 'creatorCampaign', 'CreatorCampaign')
    await wipe(tx, 'creatorDish', 'CreatorDish')
    await wipe(tx, 'creatorFollow', 'CreatorFollow')
    await delByIds(tx, 'creator', plan.deleteCreatorIds, 'Creator')
  })

  await lot('4 · rail affiliation / referral', async (tx) => {
    await wipe(tx, 'referralClick', 'ReferralClick')
    await delByIds(tx, 'referralOrder', plan.deleteReferralOrderIds, 'ReferralOrder')
    await delByIds(tx, 'referral', plan.deleteReferralIds, 'Referral')
    for (const c of chunk([...plan.keepReferralIds])) await tx.referral.updateMany({ where: { id: { in: c } }, data: { active: false } })
    if (plan.keepReferralIds.size) console.log(`    Referral conservés désactivés : ${plan.keepReferralIds.size}`)
    await wipe(tx, 'audienceVerificationRequest', 'AudienceVerificationRequest')
    // Affiliate: SELECTIVE — a kept accrual line (surviving ReferralOrder / kept
    // Referral) must keep its payee identity; kept rows are suspended, never wiped.
    await delByIds(tx, 'affiliate', plan.deleteAffiliateIds, 'Affiliate')
    for (const c of chunk([...plan.keepAffiliateIds])) await tx.affiliate.updateMany({ where: { id: { in: c } }, data: { status: 'suspended' } })
    if (plan.keepAffiliateIds.size) console.log(`    Affiliate conservés suspendus : ${plan.keepAffiliateIds.size}`)
  })

  await lot('5 · logistique (waitlist livreur — mécanisme intact)', async (tx) => {
    await wipe(tx, 'courierPosition', 'CourierPosition')
    await wipe(tx, 'courierEarning', 'CourierEarning')
    await wipe(tx, 'missionDecline', 'MissionDecline')
    await wipe(tx, 'mission', 'Mission')
    await delByIds(tx, 'logisticsProfile', plan.deleteLogisticsProfileIds, 'LogisticsProfile')
    for (const c of chunk([...plan.keepLogisticsProfileIds])) await tx.logisticsProfile.updateMany({ where: { id: { in: c } }, data: { status: 'suspended' } })
  })

  await lot('6 · services / prestataires (ServiceInvoice JAMAIS supprimée)', async (tx) => {
    await wipe(tx, 'serviceReview', 'ServiceReview')
    await delByIds(tx, 'serviceMission', plan.deleteServiceMissionIds, 'ServiceMission')
    await wipe(tx, 'serviceOffering', 'ServiceOffering')
    await wipe(tx, 'prestataireUnavailability', 'PrestataireUnavailability')
    await delByIds(tx, 'prestataireProfile', plan.deletePrestataireIds, 'PrestataireProfile')
    for (const c of chunk([...plan.keepPrestataireIds])) await tx.prestataireProfile.updateMany({ where: { id: { in: c } }, data: { status: 'suspended' } })
  })

  await lot('7 · B2B supply marketplace', async (tx) => {
    await wipe(tx, 'supplyOrderLine', 'SupplyOrderLine')
    await wipe(tx, 'supplyOrder', 'SupplyOrder')
    await wipe(tx, 'supplierCatalogItem', 'SupplierCatalogItem')
    await delByIds(tx, 'supplierProfile', plan.deleteSupplierProfileIds, 'SupplierProfile')
    for (const c of chunk([...plan.keepSupplierProfileIds])) await tx.supplierProfile.updateMany({ where: { id: { in: c } }, data: { status: 'suspended' } })
  })

  await lot('8 · répertoire fournisseurs privé', async (tx) => {
    await wipe(tx, 'supplierProduct', 'SupplierProduct')
    await wipe(tx, 'supplierOrder', 'SupplierOrder')
    await wipe(tx, 'supplier', 'Supplier')
  })

  await lot('9 · divers conso + candidatures', async (tx) => {
    await wipe(tx, 'review', 'Review')
    await wipe(tx, 'waitlist', 'Waitlist (resto)')
    await wipe(tx, 'promoRedemption', 'PromoRedemption')
    await wipe(tx, 'emailOtp', 'EmailOtp')
    await wipe(tx, 'onboardingNudge', 'OnboardingNudge')
    await wipe(tx, 'franchiseApplication', 'FranchiseApplication')
    await wipe(tx, 'creatorApplication', 'CreatorApplication')
    await wipe(tx, 'franchiseeApplication', 'FranchiseeApplication')
  })

  await lot('10 · commandes jamais payées / non référencées', async (tx) => {
    await delByIds(tx, 'order', plan.deleteOrderIds, 'Order')
  })

  await lot('11 · enfants des restos DELETE (ordre FK doc)', async (tx) => {
    let ti = 0
    for (const c of chunk(plan.deleteTicketIds)) ti += (await tx.ticketItem.deleteMany({ where: { ticketId: { in: c } } })).count
    console.log(`    TicketItem : ${ti} supprimé(s)`); bump('TicketItem', ti)
    await delByIds(tx, 'tableTicket', plan.deleteTicketIds, 'TableTicket')
    await delByIds(tx, 'reservation', plan.deleteResaIds, 'Reservation')
    await delByIds(tx, 'restaurantTable', plan.deleteTableIds, 'RestaurantTable')
    let oh = 0, ce = 0
    for (const c of chunk([...plan.deleteRestoIds])) {
      oh += (await tx.openingHour.deleteMany({ where: { restaurantId: { in: c } } })).count
      ce += (await tx.closureException.deleteMany({ where: { restaurantId: { in: c } } })).count
    }
    console.log(`    OpeningHour : ${oh} · ClosureException : ${ce}`); bump('OpeningHour', oh); bump('ClosureException', ce)
  })

  await lot('12 · marques des opérateurs DELETE (+ enfants)', async (tx) => {
    let mi = 0, pr = 0, st = 0
    for (const c of chunk(plan.deleteBrandIds)) {
      mi += (await tx.menuItem.deleteMany({ where: { brandId: { in: c } } })).count
      pr += (await tx.promotion.deleteMany({ where: { brandId: { in: c } } })).count
      st += (await tx.stockItem.deleteMany({ where: { brandId: { in: c } } })).count
    }
    console.log(`    MenuItem : ${mi} · Promotion : ${pr} · StockItem : ${st}`)
    bump('MenuItem', mi); bump('Promotion', pr); bump('StockItem', st)
    await delByIds(tx, 'brand', plan.deleteBrandIds, 'Brand')
  })

  await lot('13 · restaurants (DELETE + ARCHIVE)', async (tx) => {
    await delByIds(tx, 'restaurant', [...plan.deleteRestoIds], 'Restaurant')
    const now = new Date()
    for (const c of chunk([...plan.archiveRestoIds])) {
      // idempotent: archivedAt is only stamped once, the flags re-applied each run
      await tx.restaurant.updateMany({ where: { id: { in: c }, archivedAt: null }, data: { archivedAt: now } })
      await tx.restaurant.updateMany({ where: { id: { in: c } }, data: { isActive: false, approvedAt: null } })
    }
    console.log(`    Restaurant archivés : ${plan.archiveRestoIds.size}`); bump('RestaurantArchive', plan.archiveRestoIds.size)
  })

  await lot('14 · points de vente franchise', async (tx) => {
    await delByIds(tx, 'pointOfSale', plan.deletePosIds, 'PointOfSale')
    for (const c of chunk([...plan.keepPosIds])) await tx.pointOfSale.updateMany({ where: { id: { in: c } }, data: { isActive: false } })
  })

  await lot('15 · opérateurs (ARCHIVE puis DELETE)', async (tx) => {
    const archIds = [...plan.archiveOpIds]
    for (const c of chunk(archIds)) {
      // only rows still authenticatable are rewritten (keeps neutralize's statusReason intact)
      await tx.operator.updateMany({
        where: {
          id: { in: c },
          OR: [
            { status: { not: 'suspended' } }, { password: { not: null } },
            { verifyTokenHash: { not: null } }, { magicLinkTokenHash: { not: null } }, { pendingEmailTokenHash: { not: null } },
          ],
        },
        data: {
          status: 'suspended', statusReason: REASON, password: null,
          verifyTokenHash: null, verifyTokenExpiry: null,
          magicLinkTokenHash: null, magicLinkTokenExpiry: null,
          pendingEmail: null, pendingEmailTokenHash: null, pendingEmailTokenExpiry: null,
        },
      })
      await tx.session.deleteMany({ where: { userId: { in: c } } })
      await tx.account.deleteMany({ where: { userId: { in: c } } })
    }
    console.log(`    Operator archivés (suspendu + password null + tokens purgés + sessions/accounts supprimés) : ${archIds.length}`)
    bump('OperatorArchive', archIds.length)
    await delByIds(tx, 'operator', [...plan.deleteOpIds], 'Operator')
  })

  return stats
}

/* ═══ POSTCHECK — recomptage RÉEL (lignes EXACTES exigées). ═══ */
async function postcheck(baselineOrphans) {
  const ops = await prisma.operator.findMany({
    select: {
      id: true, email: true, role: true, status: true, password: true,
      verifyTokenHash: true, magicLinkTokenHash: true, pendingEmailTokenHash: true,
    },
  })
  const roleRows = await prisma.operatorRole.findMany({ select: { operatorId: true, role: true } })
  const adminSet = new Set(roleRows.filter((r) => r.role === 'admin').map((r) => r.operatorId))
  const isAdmin = (o) => o.role === 'admin' || adminSet.has(o.id)
  const permanentAdmins = ops.filter((o) => isAdmin(o) && o.password === null && o.status === 'active')
  const permanentIds = new Set(permanentAdmins.map((o) => o.id))
  const sessAgg = await prisma.session.groupBy({ by: ['userId'], _count: { _all: true } })
  const sessByOp = new Map(sessAgg.map((x) => [x.userId, x._count._all]))

  const publicCredActive = ops.filter((o) => COMPROMISED_EMAILS.has(o.email) && (o.status !== 'suspended' || o.password !== null)).length
  const authenticatable = ops.filter((o) => !permanentIds.has(o.id) && (
    o.status !== 'suspended' || o.password !== null || (sessByOp.get(o.id) || 0) > 0 ||
    o.verifyTokenHash !== null || o.magicLinkTokenHash !== null || o.pendingEmailTokenHash !== null
  )).length
  const publicResto = await prisma.restaurant.count({ where: { isActive: true, archivedAt: null } })
  const commandableResto = await prisma.restaurant.count({ where: { isActive: true, archivedAt: null, approvedAt: { not: null } } })
  const activePartner = ops.filter((o) => !permanentIds.has(o.id) && o.status === 'active').length
  const rehearsalActive = ops.filter((o) => REHEARSAL_EMAILS.includes(o.email) && o.status === 'active').length
  const orphans = await recountOrphans(baselineOrphans)

  return {
    publicCredActive, authenticatable, publicResto, commandableResto, activePartner,
    rehearsalActive, unexpectedOrphans: orphans.unexpected, preExistingOrphans: orphans.preExisting,
    permanentAdmin: permanentAdmins.length > 0,
  }
}

function printPostcheck(p) {
  H('POSTCHECK (recomptage RÉEL post-écriture)')
  console.log(`PUBLIC CREDENTIAL ACTIVE = ${p.publicCredActive} (attendu 0)`)
  console.log(`AUTHENTICATABLE TEST USER = ${p.authenticatable} (attendu 0)`)
  console.log(`PUBLIC TEST RESTAURANT = ${p.publicResto} (attendu 0)`)
  console.log(`COMMANDABLE TEST RESTAURANT = ${p.commandableResto} (attendu 0)`)
  console.log(`ACTIVE TEST PARTNER = ${p.activePartner} (attendu 0)`)
  console.log(`REHEARSAL ACTIVE ACCOUNT = ${p.rehearsalActive} (attendu 0)`)
  console.log(`UNEXPECTED ORPHANS = ${p.unexpectedOrphans} (attendu 0)`)
  console.log(`PERMANENT ADMIN = ${p.permanentAdmin ? 'PRESENT' : 'ABSENT'}`)
  if (p.preExistingOrphans) console.log(`(orphelins pré-existants, hors périmètre du plan : ${p.preExistingOrphans})`)
}

/* ═══ MAIN ═══ */
async function main() {
  console.log('\n──────────────────────────────────────────────────────────────')
  console.log(` GRUBANO — CLEAN ROOM FINAL DE STAGING · mode ${DRY ? 'DRY-RUN (aucune écriture)' : 'EXÉCUTION RÉELLE'}`)
  console.log(' Exécution : ' + new Date().toISOString())
  console.log(' Aucun appel Stripe. Aucune table PRESERVE touchée.')
  console.log('──────────────────────────────────────────────────────────────')

  // ═══ PRECHECK ═══
  H('PRECHECK — compteurs par table (lecture seule)')
  const counts = {}
  for (const m of MODELS) counts[m] = await prisma[m].count().catch(() => null)
  {
    const parts = MODELS.map((m) => `${m}=${counts[m] === null ? 'ERR' : counts[m]}`)
    for (let i = 0; i < parts.length; i += 5) console.log('  ' + parts.slice(i, i + 5).join(' · '))
  }

  H('PRECHECK — ADMIN PERMANENT (doit survivre)')
  const preOps = await prisma.operator.findMany({ select: { id: true, email: true, role: true, status: true, password: true, createdAt: true } })
  const preRoleRows = await prisma.operatorRole.findMany({ select: { operatorId: true, role: true } })
  const preAdminSet = new Set(preRoleRows.filter((r) => r.role === 'admin').map((r) => r.operatorId))
  const preAdmins = preOps.filter((o) => (o.role === 'admin' || preAdminSet.has(o.id)) && o.password === null && o.status === 'active')
  for (const a of preAdmins) console.log(`  ${showEmail(a.email)}  role=${a.role} status=${a.status} pwd=null (passwordless ✓)`)
  if (!preAdmins.length) {
    console.error('\nABORT — AUCUN admin passwordless actif (attendu ≥1, historiquement admin-qa@grubano.com).')
    console.error('L\'admin permanent DOIT survivre au Clean Room. Provisionnez-le d\'abord')
    console.error('(scripts/server/provision-admin) puis relancez. AUCUNE écriture effectuée.')
    process.exit(2)
  }

  H('PRECHECK — 7 IDENTITÉS COMPROMISES (attendu : déjà suspendues / password null)')
  let compromisedWarn = 0
  for (const e of COMPROMISED_EMAILS) {
    const op = preOps.find((o) => o.email === e)
    if (!op) { console.log(`  ${e} : ABSENT`); continue }
    const clean = op.status === 'suspended' && op.password === null
    if (!clean) compromisedWarn++
    console.log(`  ${e} : role=${op.role} status=${op.status} pwd=${op.password !== null ? 'PRÉSENT 🔴' : 'null'} ${clean ? '(déjà neutralisé ✓)' : '⚠ WARN — pas encore neutralisé (le clean room l\'archivera)'}`)
  }
  if (compromisedWarn) console.log(`  ⚠ ${compromisedWarn} compte(s) compromis pas encore neutralisé(s) — neutralize-public-credentials aurait dû passer AVANT (pré-requis doctrine).`)

  H('PRECHECK — SET PRESERVE ATTENDU (jamais touché par ce script)')
  const invoiceCount = counts.invoice
  const ic = await prisma.invoiceCounter.findMany().catch(() => [])
  const sic = await prisma.serviceInvoiceCounter.findMany().catch(() => [])
  const ledgerAgg = await prisma.ledgerEntry.aggregate({ _count: { _all: true }, _sum: { grossAmount: true, applicationFeeAmount: true, netToRestaurant: true } })
  const gross = ledgerAgg._sum.grossAmount || 0, fee = ledgerAgg._sum.applicationFeeAmount || 0, net = ledgerAgg._sum.netToRestaurant || 0
  const eqOk = Math.abs(gross - (fee + net)) <= 1
  console.log(`  Invoice = ${invoiceCount} · InvoiceCounter = ${JSON.stringify(ic)} · ServiceInvoiceCounter = ${JSON.stringify(sic)}`)
  console.log(`  AdminAuditLog = ${counts.adminAuditLog} · Refund = ${counts.refund} · Payout = ${counts.payout} · Dispute = ${counts.dispute} · Claim = ${counts.claim}`)
  console.log(`  LedgerEntry = ${ledgerAgg._count._all} lignes · gross=${gross}c · fee=${fee}c · net=${net}c · équation gross=fee+net (±1c) : ${eqOk ? 'OK ✓' : `⚠ ÉCART ${gross - (fee + net)}c — à investiguer (le ledger n'est PAS touché)`}`)
  console.log(`  EmailLog = ${counts.emailLog} · EmailDispatch = ${counts.emailDispatch} · LlmUsage = ${counts.llmUsage}`)
  const refCfgs = await prisma.referralConfig.findMany({ select: { id: true, commissionPctOfGrubanoFee: true, influencerCommissionPct: true, newCustomerBonusAmount: true, durationDays: true, customerDiscountPct: true, customerDiscountCapEur: true, active: true } })
  const adoCfgs = await prisma.adoptionConfig.findMany({ select: { id: true, minCommitmentDays: true, successThresholdEur: true, creatorCommissionPct: true, creatorCommissionPctReferred: true, creatorCommissionPctOrganic: true, grubanoCutPct: true, active: true } })
  console.log(`  ReferralConfig = ${refCfgs.length} ligne(s) · AdoptionConfig = ${adoCfgs.length} ligne(s)`)

  // Config realignment plan (seed fingerprint 0.22 → schema defaults; UPDATE, never delete).
  const configPlan = { referral: [], adoption: [] }
  for (const c of refCfgs) {
    if (nearMark(c.commissionPctOfGrubanoFee) || nearMark(c.influencerCommissionPct) || nearMark(c.customerDiscountPct)) {
      const { id, ...before } = c
      configPlan.referral.push({ id, before, after: { ...REFERRAL_DEFAULTS } })
    }
  }
  for (const c of adoCfgs) {
    if (nearMark(c.creatorCommissionPct) || nearMark(c.creatorCommissionPctReferred) || nearMark(c.creatorCommissionPctOrganic) || nearMark(c.grubanoCutPct)) {
      const { id, ...before } = c
      configPlan.adoption.push({ id, before, after: { ...ADOPTION_DEFAULTS } })
    }
  }

  // ═══ SNAPSHOT + PLAN + GATE ═══
  const snap = await loadSnapshot()
  const plan = computePlan(snap)
  const gate = computeGate(snap, plan)
  printPlan(snap, plan, gate, configPlan)

  if (gate.unexpected.length || plan.errors.length) {
    console.error(`\nABORT — ORPHAN GATE : UNEXPECTED ORPHANS = ${gate.unexpected.length} · incohérences de plan = ${plan.errors.length}.`)
    console.error('AUCUNE écriture effectuée. Renvoyez cette sortie complète.')
    process.exit(4)
  }
  console.log('\n  ORPHAN GATE : UNEXPECTED ORPHANS prédits = 0 ✓')

  if (DRY) {
    console.log('\n--dry-run : PLAN complet ci-dessus, AUCUNE écriture effectuée. ✅')
    console.log('Prochaine étape (après BACKUP TÉLÉCHARGÉ EN LOCAL) :')
    console.log('  node scripts/server/clean-room.js --execute --i-confirm-local-backup')
    return
  }

  // ═══ EXÉCUTION RÉELLE ═══
  H('EXÉCUTION (lots FK-sûrs, transactions séquentielles, chunks de 200)')
  const stats = await executePlan(snap, plan, configPlan)

  // Ledger integrity re-check: the PRESERVE aggregate must be byte-identical —
  // count AND every money column (a partial corruption of fee/net with the same
  // gross would otherwise pass), plus the gross=fee+net equation re-proved post-run.
  const ledgerPost = await prisma.ledgerEntry.aggregate({ _count: { _all: true }, _sum: { grossAmount: true, applicationFeeAmount: true, netToRestaurant: true } })
  const postGross = ledgerPost._sum.grossAmount || 0, postFee = ledgerPost._sum.applicationFeeAmount || 0, postNet = ledgerPost._sum.netToRestaurant || 0
  const ledgerIntact = ledgerPost._count._all === ledgerAgg._count._all && postGross === gross && postFee === fee && postNet === net
  const postEqOk = Math.abs(postGross - (postFee + postNet)) <= 1
  console.log(`  Ledger intact : ${ledgerIntact ? 'OUI ✓' : 'NON 🔴 (comptes avant/après différents — renvoyez cette sortie IMMÉDIATEMENT)'}`)
  console.log(`  Équation ledger post-run gross=fee+net (±1c) : ${postEqOk ? 'OK ✓' : `⚠ ÉCART ${postGross - (postFee + postNet)}c`} (gross=${postGross}c · fee=${postFee}c · net=${postNet}c)`)

  // PRESERVE-strict recount: a cascade chain (e.g. ServiceMission → ServiceInvoice)
  // could silently destroy preserved documents — every PRESERVE counter must be
  // UNCHANGED vs the PRECHECK. adminAuditLog is recounted BEFORE the audit line
  // written below, so the equality holds by construction on a clean run.
  const PRESERVE_RECOUNT = ['serviceInvoice', 'invoice', 'refund', 'payout', 'dispute', 'claim', 'franchiseRoyalty', 'adminAuditLog']
  const preserveDiffs = []
  for (const m of PRESERVE_RECOUNT) {
    const after = await prisma[m].count().catch(() => null)
    if (counts[m] !== null && after !== null && after !== counts[m]) preserveDiffs.push(`${m} avant=${counts[m]} après=${after}`)
  }
  const preserveIntact = preserveDiffs.length === 0
  console.log(`  Tables PRESERVE intactes (recomptage) : ${preserveIntact ? 'OUI ✓' : 'NON 🔴 → ' + preserveDiffs.join(' · ')}`)

  // ═══ POSTCHECK + AUDIT ═══
  const post = await postcheck(gate.preExistingKeys)
  const ok = post.publicCredActive === 0 && post.authenticatable === 0 && post.publicResto === 0 &&
    post.commandableResto === 0 && post.activePartner === 0 && post.rehearsalActive === 0 &&
    post.unexpectedOrphans === 0 && post.permanentAdmin && ledgerIntact && preserveIntact

  // Audit line — NEVER any secret/password/token in the metadata.
  try {
    await prisma.adminAuditLog.create({
      data: {
        actorId: 'system:ops-script',
        action: 'clean_room_executed',
        targetType: 'staging',
        targetId: 'clean-room',
        metadata: {
          operatorsArchived: plan.archiveOpIds.size, operatorsDeleted: plan.deleteOpIds.size,
          restaurantsArchived: plan.archiveRestoIds.size, restaurantsDeleted: plan.deleteRestoIds.size,
          ordersDeleted: plan.deleteOrderIds.length,
          unexpectedOrphans: post.unexpectedOrphans,
          permanentAdmin: post.permanentAdmin ? 'PRESENT' : 'ABSENT',
          verdict: ok ? 'clean' : 'postcheck_failed',
          deleted: stats,
        },
      },
    })
    console.log('  AdminAuditLog : ligne clean_room_executed écrite ✓')
  } catch (e) {
    console.error('  ⚠ AdminAuditLog non écrit : ' + String(e && e.message).split('\n')[0])
  }

  printPostcheck(post)
  if (ok) {
    console.log('\n✅ CLEAN ROOM COMPLET — staging vide, invisible, non connectable, mécanismes intacts, historiques préservés.')
  } else {
    console.error('\n❌ POSTCHECK inattendu — renvoyez cette sortie complète AVANT toute autre action.')
    process.exit(3)
  }
}

main()
  .catch((e) => { console.error('❌ échec :', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
