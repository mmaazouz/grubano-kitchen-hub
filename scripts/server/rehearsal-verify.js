'use strict'
/* ═══════════════════════════════════════════════════════════════════════════════
   rehearsal-verify.js — LECTURE SEULE. AUCUNE ÉCRITURE. AUCUN MODE DESTRUCTIF.

   Mission FINAL BETA ACCEPTANCE (2026-08-30). Le fondateur exécute ce script sur
   le serveur STAGING à chaque jalon de la répétition humaine (rehearsal) :

     cd ~/app.grubano.com && source ~/nodevenv/app.grubano.com/24/bin/activate \
       && node scripts/server/rehearsal-verify.js <sous-commande>

   Sous-commandes :
     baseline   Compteurs globaux AVANT la création des identités pilote (photo F1).
     partner    État complet corrélé à pilote-resto@grubano.com (compte, resto,
                marques, menus, horaires).
     order      La/les commandes de pilote-client@grubano.com + ligne(s) de ledger
                corrélée(s), remboursement éventuel, points de fidélité.
     final      Inventaire COMPLET table par table des lignes corrélées aux 2
                identités pilote (inventaire F3 pré-clean-room) + bloc
                REHEARSAL INVENTORY final.

   Sécurité de sortie : AUCUN secret (pas de hash, pas de token, présence de mot de
   passe = booléen seulement), références Stripe TRONQUÉES (pi_***XXXX / acct_***XXXX).
   PII bornée : seules les DEUX identités pilote (données de test déclarées) sont
   affichées en clair — tout autre e-mail serait masqué (aucun autre n'est requêté).
   ⚠ Piège connu : Operator.notifPrefs est INVALIDE sur ~96 % des lignes staging →
   TOUS les select Operator sont EXPLICITES et ne touchent JAMAIS notifPrefs.
   ═══════════════════════════════════════════════════════════════════════════════ */

// ── Garde d'entrée AVANT toute connexion (et avant même le chargement d'env) ───
const SUBCOMMANDS = ['baseline', 'partner', 'order', 'final', 'ledger']
const SUB = process.argv[2]
if (!SUB || !SUBCOMMANDS.includes(SUB)) {
  console.error('Usage : node scripts/server/rehearsal-verify.js <baseline|partner|order|final|ledger>')
  console.error('')
  console.error('  baseline  compteurs globaux (photo AVANT la répétition)')
  console.error('  partner   état corrélé à pilote-resto@grubano.com')
  console.error('  order     commande(s) + ledger + fidélité de pilote-client@grubano.com')
  console.error('  final     inventaire complet des lignes pilote (pré-clean-room)')
  console.error('  ledger [depuisISO]  lignes de ledger depuis une date (défaut 2026-08-28)')
  console.error('                      — audit d\'un delta de compteurs, lecture seule')
  console.error('')
  console.error('Script en LECTURE SEULE — aucune écriture, aucun mode destructif.')
  process.exit(1)
}

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
  console.error('[rehearsal-verify] DATABASE_URL introuvable (env + .env.local). Abandon.')
  process.exit(1)
}
try {
  const u = new URL(process.env.DATABASE_URL)
  // Username masked too (cPanel account name on o2switch) — this output is meant
  // to be pasted into reports; host + db name identify the target well enough.
  console.log(`Base ciblée : ${u.protocol}//***:***@${u.host}${u.pathname}`)
} catch { console.log('Base ciblée : (DSN non parsable — masqué)') }

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// Helpers partagés (masques + tri stable — même numérotation que classification-read)
const { mask, maskEmail, shortId, d, stableSort } = require('./classification-lib')

// SEULES identités autorisées en clair (données de répétition, déclarées test).
const PILOT_PARTNER_EMAIL = 'pilote-resto@grubano.com'
const PILOT_CONSUMER_EMAIL = 'pilote-client@grubano.com'
const PILOT_EMAILS = [PILOT_PARTNER_EMAIL, PILOT_CONSUMER_EMAIL]

// Schema-lag tolerance that MUST NOT hide bugs: a swallowed
// PrismaClientValidationError (wrong field name) or an unknown failure would
// silently read as "0 rows" — catastrophic in `final` mode, where a degraded
// count feeds the clean-room reference. Known Prisma request errors (e.code set,
// e.g. P2021/P2022 = table/column behind the schema) stay silently tolerated;
// everything else prints ONE visible warning line, then degrades.
const tolerant = (fallback) => (e) => {
  const name = e && e.constructor ? e.constructor.name : 'Error'
  if (name === 'PrismaClientValidationError' || !(e && e.code)) {
    const last = String((e && e.message) || '').split('\n').filter(Boolean).pop() || '—'
    console.error(`  ⚠ requête illisible (${name}) : ${last} — valeur dégradée (pas un vrai 0)`)
  }
  return fallback
}

const H = (t) => console.log(`\n=== ${t} ===`)
const note = (t) => console.log('    ' + t)
const eur = (f) => (typeof f === 'number' ? f.toFixed(2) + '€' : '—')
const cents = (c) => ((c || 0) / 100).toFixed(2) + '€'
const round2 = (x) => (typeof x === 'number' ? Math.round(x * 100) / 100 : null)
const yn = (b) => (b ? 'OUI' : 'non')

// Select Operator EXPLICITE — ne touche JAMAIS notifPrefs (piège staging connu).
const OP_SELECT = {
  id: true, email: true, name: true, role: true, status: true, createdAt: true,
  emailVerifiedAt: true, consentAt: true,
}

/* Read-only Operator lookup by pilot email (explicit select — never notifPrefs). */
async function findPilotOperator(email) {
  return prisma.operator.findUnique({ where: { email }, select: OP_SELECT })
}

/* Full role SET (OperatorRole rows) for one operator — [] if the table is behind. */
async function roleSetOf(operatorId) {
  const rows = await prisma.operatorRole.findMany({ where: { operatorId }, select: { role: true } }).catch(tolerant([]))
  return rows.map((r) => r.role)
}

function printHeader(title) {
  console.log('\n──────────────────────────────────────────────────────────────')
  console.log(` GRUBANO — REHEARSAL VERIFY · ${title} (lecture seule)`)
  console.log(' Exécution : ' + new Date().toISOString())
  console.log('──────────────────────────────────────────────────────────────')
}

/* ═══ baseline — compteurs globaux (photo F1 avant création rehearsal) ═════════ */
async function cmdBaseline() {
  printHeader('BASELINE')

  H('OPÉRATEURS')
  // groupBy only reads the grouped column + the aggregate → notifPrefs untouched.
  const opTotal = await prisma.operator.count()
  const byStatus = await prisma.operator.groupBy({ by: ['status'], _count: { _all: true } })
  const byRole = await prisma.operator.groupBy({ by: ['role'], _count: { _all: true } })
  console.log(`  Total : ${opTotal}`)
  console.log('  Par statut : ' + (byStatus.map((s) => `${s.status}=${s._count._all}`).join(' · ') || '—'))
  console.log('  Par rôle (primaire) : ' + (byRole.map((r) => `${r.role}=${r._count._all}`).join(' · ') || '—'))

  H('RESTAURANTS / MARQUES / MENUS')
  const restoTotal = await prisma.restaurant.count()
  const restoPublic = await prisma.restaurant.count({ where: { isActive: true, archivedAt: null } })
  const brandTotal = await prisma.brand.count().catch(tolerant(0))
  const menuTotal = await prisma.menuItem.count().catch(tolerant(0))
  console.log(`  Restaurants : total=${restoTotal} · publics (isActive && !archivedAt)=${restoPublic}`)
  console.log(`  Marques : ${brandTotal} · Plats (MenuItem) : ${menuTotal}`)

  H('COMMANDES / ARGENT')
  const orderTotal = await prisma.order.count().catch(tolerant(0))
  const orderPaid = await prisma.order.count({ where: { paymentStatus: 'paid' } }).catch(tolerant(0))
  console.log(`  Orders : total=${orderTotal} · payées=${orderPaid}`)
  const ledger = await prisma.ledgerEntry.aggregate({
    _count: { _all: true },
    _sum: { grossAmount: true, applicationFeeAmount: true, netToRestaurant: true },
  }).catch(tolerant(null))
  if (ledger) {
    const g = ledger._sum.grossAmount || 0
    const f = ledger._sum.applicationFeeAmount || 0
    const n = ledger._sum.netToRestaurant || 0
    console.log(`  LedgerEntry : ${ledger._count._all} lignes · brut=${cents(g)} · commission=${cents(f)} · net restos=${cents(n)}`)
    console.log(`  Égalité brut = commission + net : ${g === f + n ? 'OK ✅' : `ÉCART ${cents(g - f - n)} ⚠`}`)
  } else console.log('  LedgerEntry : table illisible (schéma en retard ?)')
  const refunds = await prisma.refund.count().catch(tolerant(0))
  const invoices = await prisma.invoice.count().catch(tolerant(0))
  console.log(`  Refunds : ${refunds} · Invoices (factures légales) : ${invoices}`)

  H('FIDÉLITÉ / WAITLISTS / RÉSERVATIONS')
  const loyal = await prisma.loyaltyCustomer.count().catch(tolerant(0))
  const courierWaitlist = await prisma.logisticsProfile.count().catch(tolerant(0))
  const restoWaitlist = await prisma.waitlist.count().catch(tolerant(0))
  const resas = await prisma.reservation.count().catch(tolerant(0))
  console.log(`  LoyaltyCustomer : ${loyal}`)
  console.log(`  Waitlist livreur (LogisticsProfile) : ${courierWaitlist}`)
  console.log(`  Waitlist resto (file d'attente consommateur) : ${restoWaitlist}`)
  console.log(`  Réservations : ${resas}`)

  console.log('\n══════════════════════ BASELINE ══════════════════════')
  console.log(JSON.stringify({
    operators: opTotal, restaurants: restoTotal, restaurantsPublic: restoPublic,
    brands: brandTotal, menuItems: menuTotal, orders: orderTotal, ordersPaid: orderPaid,
    ledger: ledger ? ledger._count._all : null, refunds, invoices,
    loyaltyCustomers: loyal, courierWaitlist, restoWaitlist, reservations: resas,
  }, null, 2))
}

/* ═══ partner — tout l'état corrélé à pilote-resto@ ════════════════════════════ */
async function cmdPartner() {
  printHeader('PARTNER · ' + PILOT_PARTNER_EMAIL)

  const op = await findPilotOperator(PILOT_PARTNER_EMAIL)
  if (!op) {
    console.log(`\n  ${PILOT_PARTNER_EMAIL} : ABSENT de la base — le jalon "inscription partenaire" n'est pas encore franchi.`)
    return
  }

  H('COMPTE OPÉRATEUR')
  const roles = await roleSetOf(op.id)
  console.log(`  ${op.email}  id=${shortId(op.id)}`)
  console.log(`  status=${op.status} · rôle primaire=${op.role} · rôles (set)=[${roles.join(', ') || op.role}]`)
  console.log(`  créé=${d(op.createdAt)} · email vérifié=${op.emailVerifiedAt ? d(op.emailVerifiedAt) : 'NON'} · consentement RGPD=${op.consentAt ? d(op.consentAt) : 'NON'}`)

  H('RESTAURANT(S)')
  const restos = await prisma.restaurant.findMany({
    where: { operatorId: op.id },
    select: {
      id: true, name: true, city: true, lat: true, lng: true, isActive: true,
      approvedAt: true, archivedAt: true, pickupEnabled: true, deliveryEnabled: true,
      stripeAccountId: true, stripeAccountStatus: true, openingHours: true, createdAt: true,
    },
  })
  if (!restos.length) console.log('  (aucun restaurant — jalon "création établissement" pas encore franchi)')
  for (const r of stableSort(restos)) {
    const hasGeo = typeof r.lat === 'number' && typeof r.lng === 'number'
    console.log(`  « ${r.name} » (${r.city}) id=${shortId(r.id)}`)
    console.log(`    coords=${hasGeo ? `OUI (~${round2(r.lat)}, ~${round2(r.lng)})` : 'NON'} · pickup=${yn(r.pickupEnabled)} · delivery=${yn(r.deliveryEnabled)}`)
    console.log(`    isActive=${yn(r.isActive)} · approuvé=${d(r.approvedAt)} · archivé=${r.archivedAt ? d(r.archivedAt) : 'non'}`)
    console.log(`    Connect=${r.stripeAccountId ? `${mask(r.stripeAccountId)} status=${r.stripeAccountStatus || '?'}` : 'aucun'} · openingHours(Json legacy)=${r.openingHours ? 'présent' : 'absent'}`)
    const hours = await prisma.openingHour.findMany({
      where: { restaurantId: r.id },
      select: { dayOfWeek: true, openTime: true, closeTime: true, channel: true },
      orderBy: [{ dayOfWeek: 'asc' }, { openTime: 'asc' }],
    }).catch(tolerant([]))
    const DAYS = ['dim', 'lun', 'mar', 'mer', 'jeu', 'ven', 'sam']
    console.log(`    OpeningHour (relationnel) : ${hours.length} plage(s)` + (hours.length ? ' → ' + hours.map((h) => `${DAYS[h.dayOfWeek] || h.dayOfWeek} ${h.openTime}-${h.closeTime}`).join(' · ') : ' (non configuré = aucune restriction)'))
  }

  H('MARQUES + MENUS')
  const brands = await prisma.brand.findMany({
    where: { operatorId: op.id },
    select: { id: true, name: true, status: true, restaurantId: true, createdAt: true },
  }).catch(tolerant([]))
  if (!brands.length) console.log('  (aucune marque)')
  for (const b of stableSort(brands)) {
    console.log(`  Marque « ${b.name} » id=${shortId(b.id)} status=${b.status} restaurant=${b.restaurantId ? shortId(b.restaurantId) : 'NON RATTACHÉE ⚠'}`)
    const items = await prisma.menuItem.findMany({
      where: { brandId: b.id },
      select: { id: true, name: true, price: true, allergens: true, available: true, createdAt: true },
    }).catch(tolerant([]))
    if (!items.length) { console.log('    (0 plat)'); continue }
    for (const it of stableSort(items)) {
      const allergensFilled = Array.isArray(it.allergens) && it.allergens.length > 0
      console.log(`    Plat « ${it.name} » ${eur(it.price)} · allergènes renseignés=${yn(allergensFilled)} · dispo=${yn(it.available)}`)
    }
  }

  console.log('\n══════════════════════ PARTNER ══════════════════════')
  console.log(`OPERATOR: ${op.status === 'active' ? 'ACTIF ✅' : op.status.toUpperCase()} · restaurants=${restos.length} · marques=${brands.length}`)
}

/* ═══ order — commande(s) du consumer pilote + ledger + fidélité ═══════════════ */
async function cmdOrder() {
  printHeader('ORDER · ' + PILOT_CONSUMER_EMAIL)

  const client = await findPilotOperator(PILOT_CONSUMER_EMAIL)
  if (!client) {
    console.log(`\n  ${PILOT_CONSUMER_EMAIL} : ABSENT de la base — le jalon "inscription client" n'est pas encore franchi.`)
    return
  }
  console.log(`\n  Client : ${client.email} id=${shortId(client.id)} status=${client.status} créé=${d(client.createdAt)}`)

  H('COMMANDE(S)')
  const orders = await prisma.order.findMany({
    where: { consumerId: client.id },
    select: {
      id: true, restaurantId: true, status: true, fulfillmentType: true,
      subtotal: true, total: true, paymentStatus: true, stripePaymentIntentId: true,
      pointsEarned: true, pointsRedeemed: true, createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  }).catch(tolerant([]))
  if (!orders.length) console.log('  (aucune commande — jalon "commande pilote" pas encore franchi)')

  for (const o of orders) {
    console.log(`  Commande ${shortId(o.id)} du ${d(o.createdAt)} · resto=${shortId(o.restaurantId)}`)
    console.log(`    status=${o.status} · mode=${o.fulfillmentType} · sous-total=${eur(o.subtotal)} · total=${eur(o.total)}`)
    console.log(`    paiement=${o.paymentStatus || 'non initié'} · PI=${o.stripePaymentIntentId ? mask(o.stripePaymentIntentId) : 'aucun'} · points gagnés=${o.pointsEarned} · points dépensés=${o.pointsRedeemed || 0}`)

    // Correlated ledger line(s) — matched on the PaymentIntent (webhook-written).
    if (o.stripePaymentIntentId) {
      const leds = await prisma.ledgerEntry.findMany({
        where: { stripePaymentIntentId: o.stripePaymentIntentId },
        select: { id: true, type: true, grossAmount: true, applicationFeeAmount: true, netToRestaurant: true, channel: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }).catch(tolerant([]))
      if (!leds.length) console.log('    Ledger : AUCUNE ligne corrélée à ce PI ⚠ (webhook pas encore passé ?)')
      for (const l of leds) {
        const ok = l.grossAmount === l.applicationFeeAmount + l.netToRestaurant
        console.log(`    Ledger ${shortId(l.id)} type=${l.type} canal=${l.channel || '—'} · brut=${cents(l.grossAmount)} = commission=${cents(l.applicationFeeAmount)} + net=${cents(l.netToRestaurant)} → ${ok ? 'ÉGALITÉ OK ✅' : 'ÉCART ⚠'}`)
      }
    } else console.log('    Ledger : (pas de PI sur la commande → pas de corrélation possible)')

    const refs = await prisma.refund.findMany({
      where: { orderId: o.id },
      select: { id: true, stripeRefundId: true, amountCents: true, status: true, createdAt: true },
    }).catch(tolerant([]))
    if (refs.length) for (const rf of refs) console.log(`    Refund ${shortId(rf.id)} ${rf.stripeRefundId ? mask(rf.stripeRefundId) : '(pas encore accepté par Stripe)'} montant=${cents(rf.amountCents)} status=${rf.status} le ${d(rf.createdAt)}`)
    else console.log('    Refund : aucun')
  }

  H('FIDÉLITÉ DU CLIENT')
  const loyal = await prisma.loyaltyCustomer.findUnique({
    where: { email: PILOT_CONSUMER_EMAIL },
    select: { id: true, pointsBalance: true, tier: true, createdAt: true },
  }).catch(tolerant(null))
  if (!loyal) console.log('  (aucune fiche LoyaltyCustomer pour cet e-mail)')
  else {
    console.log(`  LoyaltyCustomer ${shortId(loyal.id)} · solde=${loyal.pointsBalance} pts · palier=${loyal.tier} · créé=${d(loyal.createdAt)}`)
    const txs = await prisma.loyaltyTransaction.findMany({
      where: { customerId: loyal.id },
      select: { type: true, points: true, orderId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }).catch(tolerant([]))
    if (!txs.length) console.log('  (aucun mouvement de points)')
    for (const t of txs) console.log(`    ${d(t.createdAt)} ${t.type} ${t.points > 0 ? '+' : ''}${t.points} pts` + (t.orderId ? ` (commande ${shortId(t.orderId)})` : ''))
  }

  console.log('\n══════════════════════ ORDER ══════════════════════')
  console.log(`COMMANDES PILOTE: ${orders.length} · payées=${orders.filter((o) => o.paymentStatus === 'paid').length} · avec refund=${orders.length ? 'voir détail ci-dessus' : '0'}`)
}

/* ═══ final — inventaire COMPLET des lignes corrélées aux 2 identités pilote ═══ */
async function cmdFinal() {
  printHeader('FINAL · INVENTAIRE PILOTE (pré-clean-room)')
  note('Toutes les lignes listées ici sont corrélées aux DEUX identités de répétition')
  note(`(${PILOT_PARTNER_EMAIL} + ${PILOT_CONSUMER_EMAIL}) — données de test déclarées.`)

  const inv = {}
  const list = (ids) => (ids.length ? ids.map(shortId).join(', ') : '—')

  // Operators (explicit select — never notifPrefs)
  const pilotOps = await prisma.operator.findMany({ where: { email: { in: PILOT_EMAILS } }, select: OP_SELECT })
  const opIds = pilotOps.map((o) => o.id)
  H('OPERATOR')
  for (const o of stableSort(pilotOps)) console.log(`  ${o.email} id=${shortId(o.id)} role=${o.role} status=${o.status} créé=${d(o.createdAt)}`)
  if (!pilotOps.length) console.log('  (aucun compte pilote en base)')
  inv.operators = pilotOps.length

  const emptyIn = { in: opIds.length ? opIds : ['__none__'] } // safe empty-set filter

  // OperatorRole / auth-adjacent rows (counts only — no token content ever read)
  const roleRows = await prisma.operatorRole.findMany({ where: { operatorId: emptyIn }, select: { id: true, role: true, operatorId: true } }).catch(tolerant([]))
  const sessions = await prisma.session.count({ where: { userId: emptyIn } }).catch(tolerant(0))
  const accounts = await prisma.account.count({ where: { userId: emptyIn } }).catch(tolerant(0))
  const addresses = await prisma.address.count({ where: { userId: emptyIn } }).catch(tolerant(0))
  H('OPERATOR ROLE / SESSIONS / ACCOUNTS / ADDRESSES')
  console.log(`  OperatorRole : ${roleRows.length}` + (roleRows.length ? ' → ' + roleRows.map((r) => r.role).join(', ') : ''))
  console.log(`  Session (NextAuth) : ${sessions} · Account (NextAuth) : ${accounts} · Address (carnet livraison) : ${addresses}`)
  inv.operatorRoles = roleRows.length
  inv.sessions = sessions
  inv.accounts = accounts
  inv.addresses = addresses

  // Restaurants owned by the pilot partner
  const restos = await prisma.restaurant.findMany({ where: { operatorId: emptyIn }, select: { id: true, name: true, city: true, isActive: true, archivedAt: true, createdAt: true } })
  const restoIds = restos.map((r) => r.id)
  const restoIn = { in: restoIds.length ? restoIds : ['__none__'] }
  H('RESTAURANT')
  for (const r of stableSort(restos)) console.log(`  « ${r.name} » (${r.city}) id=${shortId(r.id)} actif=${yn(r.isActive)} archivé=${r.archivedAt ? d(r.archivedAt) : 'non'}`)
  if (!restos.length) console.log('  (aucun)')
  inv.restaurants = restos.length

  // Brands + menu items
  const brands = await prisma.brand.findMany({ where: { operatorId: emptyIn }, select: { id: true, name: true } }).catch(tolerant([]))
  const brandIds = brands.map((b) => b.id)
  const brandIn = { in: brandIds.length ? brandIds : ['__none__'] }
  const menuItems = await prisma.menuItem.findMany({ where: { brandId: brandIn }, select: { id: true, name: true } }).catch(tolerant([]))
  const categories = await prisma.category.count({ where: { brandId: brandIn } }).catch(tolerant(0))
  H('BRAND / MENUITEM / CATEGORY')
  console.log(`  Brand : ${brands.length}` + (brands.length ? ' → ' + brands.map((b) => `« ${b.name} » ${shortId(b.id)}`).join(' · ') : ''))
  console.log(`  MenuItem : ${menuItems.length}` + (menuItems.length ? ' → ids ' + list(menuItems.map((m) => m.id)) : ''))
  console.log(`  Category (catégories custom) : ${categories}`)
  inv.brands = brands.length
  inv.menuItems = menuItems.length
  inv.categories = categories

  // Hours / tables / reservations tied to the pilot restaurant(s)
  const openingHours = await prisma.openingHour.count({ where: { restaurantId: restoIn } }).catch(tolerant(0))
  const closures = await prisma.closureException.count({ where: { restaurantId: restoIn } }).catch(tolerant(0))
  const tables = await prisma.restaurantTable.count({ where: { restaurantId: restoIn } }).catch(tolerant(0))
  const resas = await prisma.reservation.findMany({
    where: { OR: [{ restaurantId: restoIn }, { userId: emptyIn }] },
    select: { id: true },
  }).catch(tolerant([]))
  H('OPENING HOURS / TABLES / RESERVATIONS')
  console.log(`  OpeningHour : ${openingHours} · ClosureException : ${closures} · RestaurantTable : ${tables}`)
  console.log(`  Reservation (resto pilote OU client pilote) : ${resas.length}` + (resas.length ? ' → ids ' + list(resas.map((r) => r.id)) : ''))
  inv.openingHours = openingHours
  inv.closures = closures
  inv.tables = tables
  inv.reservations = resas.length

  // Orders: placed BY the pilot consumer OR received BY the pilot restaurant(s)
  const orders = await prisma.order.findMany({
    where: { OR: [{ consumerId: emptyIn }, { restaurantId: restoIn }] },
    select: { id: true, status: true, paymentStatus: true, stripePaymentIntentId: true },
  }).catch(tolerant([]))
  const orderIds = orders.map((o) => o.id)
  const orderIn = { in: orderIds.length ? orderIds : ['__none__'] }
  const orderPIs = orders.map((o) => o.stripePaymentIntentId).filter(Boolean)
  H('ORDER')
  console.log(`  Order : ${orders.length} (payées=${orders.filter((o) => o.paymentStatus === 'paid').length})` + (orders.length ? ' → ids ' + list(orderIds) : ''))
  inv.orders = orders.length

  // Money trail: ledger (by resto OR by the orders' PIs), refunds, invoices
  const ledger = await prisma.ledgerEntry.findMany({
    where: { OR: [{ restaurantId: restoIn }, { stripePaymentIntentId: { in: orderPIs.length ? orderPIs : ['__none__'] } }] },
    select: { id: true, type: true, grossAmount: true, applicationFeeAmount: true, netToRestaurant: true },
  }).catch(tolerant([]))
  const refunds = await prisma.refund.findMany({
    where: { OR: [{ orderId: orderIn }, { restaurantId: restoIn }] },
    select: { id: true, status: true, amountCents: true },
  }).catch(tolerant([]))
  const invoices = await prisma.invoice.count({ where: { restaurantId: restoIn } }).catch(tolerant(0))
  H('LEDGER / REFUND / INVOICE')
  console.log(`  LedgerEntry : ${ledger.length}` + (ledger.length ? ' → ' + ledger.map((l) => `${shortId(l.id)} ${l.type} ${cents(l.grossAmount)}`).join(' · ') : ''))
  console.log(`  Refund : ${refunds.length}` + (refunds.length ? ' → ' + refunds.map((r) => `${shortId(r.id)} ${r.status} ${cents(r.amountCents)}`).join(' · ') : ''))
  console.log(`  Invoice (⚠ document LÉGAL — numérotation sans trous, avis comptable avant tout traitement) : ${invoices}`)
  inv.ledger = ledger.length
  inv.refunds = refunds.length
  inv.invoices = invoices

  // Loyalty tied to the pilot consumer email
  const loyal = await prisma.loyaltyCustomer.findUnique({ where: { email: PILOT_CONSUMER_EMAIL }, select: { id: true } }).catch(tolerant(null))
  const loyalTx = loyal
    ? await prisma.loyaltyTransaction.count({ where: { customerId: loyal.id } }).catch(tolerant(0))
    : 0
  H('LOYALTY')
  console.log(`  LoyaltyCustomer : ${loyal ? 1 : 0}` + (loyal ? ` (id=${shortId(loyal.id)})` : '') + ` · LoyaltyTransaction : ${loyalTx}`)
  inv.loyalty = (loyal ? 1 : 0)
  inv.loyaltyTransactions = loyalTx

  // Consumer-side leftovers: reviews, resto waitlist entries, promo redemptions
  const reviews = await prisma.review.count({ where: { OR: [{ userId: emptyIn }, { restaurantId: restoIn }] } }).catch(tolerant(0))
  const waitlistEntries = await prisma.waitlist.count({ where: { OR: [{ userId: emptyIn }, { restaurantId: restoIn }] } }).catch(tolerant(0))
  // PromoRedemption keys the redeemer as `userId` (relation to Operator) — same
  // key as Review / Waitlist / Address; `operatorId` does not exist on this model.
  const promoRedemptions = await prisma.promoRedemption.count({ where: { userId: emptyIn } }).catch(tolerant(0))
  H('REVIEW / WAITLIST RESTO / PROMO')
  console.log(`  Review : ${reviews} · Waitlist (file resto) : ${waitlistEntries} · PromoRedemption : ${promoRedemptions}`)
  inv.reviews = reviews
  inv.waitlistEntries = waitlistEntries
  inv.promoRedemptions = promoRedemptions

  // Courier waitlist (should be 0 for the pilots — the rehearsal has no courier)
  const logistics = await prisma.logisticsProfile.count({ where: { email: { in: PILOT_EMAILS } } }).catch(tolerant(0))
  H('LOGISTICS (waitlist livreur)')
  console.log(`  LogisticsProfile aux e-mails pilote : ${logistics}${logistics ? ' ⚠ inattendu' : ''}`)
  inv.logisticsProfiles = logistics

  // ═══ Consolidated inventory block (the F3 pre-clean-room reference) ═══
  console.log('\n══════════════════ REHEARSAL INVENTORY ══════════════════')
  console.log('REHEARSAL INVENTORY = ' + JSON.stringify(inv, null, 2))
  console.log('══════════════════════════════════════════════════════════')
  note('Cet inventaire est la référence F3 : au clean room, ces lignes (et UNIQUEMENT')
  note('elles pour le volet rehearsal) sont candidates au retrait — Invoice exceptée')
  note('(document légal). Rien n\'a été écrit par ce script.')
}

/* ═══ ledger [depuisISO] — audit d'un delta de compteurs ledger (lecture seule) ══
   Liste chaque LedgerEntry depuis la date donnée (défaut 2026-08-28) avec le nom
   du restaurant, le canal et les montants — pour établir l'ORIGINE exacte d'un
   delta constaté entre deux lectures (ex. +6 lignes / +58,00 € entre le 29 et le
   30 août). Aucun secret : PI/charge tronqués (mask), aucune donnée client. */
async function cmdLedger() {
  const sinceArg = process.argv[3]
  let since = new Date('2026-08-28T00:00:00Z')
  if (sinceArg) {
    const parsed = new Date(sinceArg)
    if (Number.isNaN(parsed.getTime())) {
      console.error(`  ⚠ date « ${sinceArg} » illisible — défaut 2026-08-28 conservé.`)
    } else { since = parsed }
  }
  printHeader(`LEDGER depuis ${since.toISOString().slice(0, 10)}`)

  const rows = await prisma.ledgerEntry.findMany({
    where: { createdAt: { gte: since } },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true, createdAt: true, type: true, channel: true,
      grossAmount: true, applicationFeeAmount: true, netToRestaurant: true,
      restaurantId: true, stripePaymentIntentId: true,
      reservationId: true, ticketId: true, routed: true,
    },
  })
  const restoIds = [...new Set(rows.map((r) => r.restaurantId))]
  const restos = restoIds.length
    ? await prisma.restaurant.findMany({ where: { id: { in: restoIds } }, select: { id: true, name: true, city: true } }).catch(tolerant([]))
    : []
  const restoName = new Map(restos.map((r) => [r.id, `${r.name} (${r.city})`]))

  H(`${rows.length} LIGNE(S) DEPUIS ${since.toISOString()}`)
  for (const r of rows) {
    const src = r.reservationId ? 'résa-empreinte' : r.ticketId ? 'addition-table' : 'commande'
    console.log(
      `  ${r.createdAt.toISOString()} · ${r.type}/${r.channel || '—'} · ${src}` +
      ` · brut ${cents(r.grossAmount)} · com ${cents(r.applicationFeeAmount)} · net ${cents(r.netToRestaurant)}` +
      `\n      resto : ${restoName.get(r.restaurantId) || shortId(r.restaurantId) + ' (⚠ resto introuvable)'} · PI ${r.stripePaymentIntentId ? mask(r.stripePaymentIntentId) : '—'} · routé=${yn(r.routed)}`
    )
  }
  const sum = (k) => rows.reduce((a, r) => a + (r[k] || 0), 0)
  H('TOTAL DE LA FENÊTRE')
  console.log(`  ${rows.length} ligne(s) · brut ${cents(sum('grossAmount'))} · com ${cents(sum('applicationFeeAmount'))} · net ${cents(sum('netToRestaurant'))}`)
  const all = await prisma.ledgerEntry.aggregate({ _count: true, _sum: { grossAmount: true } })
  console.log(`  Rappel GLOBAL table : ${all._count} ligne(s) · brut ${cents(all._sum.grossAmount)}`)
  note('Croiser chaque ligne avec vos propres essais (date/heure, resto, montant) :')
  note('un delta expliqué = TEST confirmé ; une ligne inexpliquée = STOP CLEAN ROOM.')
}

async function main() {
  if (SUB === 'baseline') await cmdBaseline()
  else if (SUB === 'partner') await cmdPartner()
  else if (SUB === 'order') await cmdOrder()
  else if (SUB === 'final') await cmdFinal()
  else if (SUB === 'ledger') await cmdLedger()
  console.log('\nAUCUNE ÉCRITURE N\'A ÉTÉ FAITE (script en lecture seule).')
}

main()
  .catch((e) => { console.error('❌ échec :', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
