'use strict'
/* ═══════════════════════════════════════════════════════════════════════════════
   unknown-evidence-read.js — LECTURE SEULE. Dossier d'évidence pour CHAQUE ligne
   UNKNOWN, afin que le FONDATEUR classe TEST / REAL / KEEP UNKNOWN sans coller
   d'e-mail dans le chat.

     cd ~/app.grubano.com && source ~/nodevenv/app.grubano.com/24/bin/activate \
       && node scripts/server/unknown-evidence-read.js

   DEUX blocs de sortie :
     1) « DOSSIER LOCAL — NE PAS PARTAGER » : e-mails COMPLETS + contexte
        (créé le, vérifié, restos liés, commandes, résas, Connect, dernière
        activité, preuves automatiques). À lire dans le terminal uniquement.
     2) « GABARIT À RENVOYER (SAFE) » : USER#N = ___ / RESTAURANT#N = ___,
        SANS e-mail — c'est la SEULE chose à recopier dans le chat.

   La numérotation USER#N / RESTAURANT#N est IDENTIQUE à celle de
   staging-classification-read.js (lib partagée, tri stable createdAt/id).
   Le domaine d'un e-mail n'est JAMAIS traité comme preuve de test : les seules
   preuves automatiques admises sont les marqueurs versionnés (qaParity,
   QA-PARITY-%, source='qa-parity', notes 'QA-%') portés par les données mêmes.
   ═══════════════════════════════════════════════════════════════════════════════ */

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
if (!process.env.DATABASE_URL) { console.error('[evidence] DATABASE_URL introuvable. Abandon.'); process.exit(1) }
try { const u = new URL(process.env.DATABASE_URL); console.log(`Base ciblée : ${u.protocol}//${u.username}:***@${u.host}${u.pathname}`) } catch {}

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const { d, shortId, mask, numberEntities, stableSort } = require('./classification-lib')

// Indices contextuels versionnés (jamais une preuve à eux seuls)
const REPO_HINTS = new Map([
  ['Riz dala', 'seul resto géocodé AVANT la wave géo (Paris 11ᵉ, BAN réel) — candidat RÉEL probable, menu vide'],
])

async function main() {
  const OP_SELECT = { id: true, email: true, name: true, role: true, status: true, createdAt: true, emailVerifiedAt: true, consentAt: true, siren: true, kybStatus: true }
  const ops = await prisma.operator.findMany({ select: OP_SELECT })
  const pwdRows = await prisma.operator.findMany({ select: { id: true, password: true } })
  const hasPwd = new Map(pwdRows.map(r => [r.id, r.password !== null]))
  const roleRows = await prisma.operatorRole.findMany({ select: { operatorId: true, role: true } }).catch(() => [])
  const roleSets = new Map()
  for (const r of roleRows) { if (!roleSets.has(r.operatorId)) roleSets.set(r.operatorId, new Set()); roleSets.get(r.operatorId).add(r.role) }
  const restos = await prisma.restaurant.findMany({ select: { id: true, operatorId: true, name: true, city: true, isActive: true, approvedAt: true, lat: true, lng: true, stripeAccountId: true, stripeAccountStatus: true, createdAt: true } })
  const { opClass, opPseudo, restoClass, restoPseudo } = numberEntities(ops, roleSets, restos)

  const unkOps = stableSort(ops).filter(o => opClass.get(o.id) === 'UNKNOWN')
  const unkRestos = stableSort(restos).filter(r => restoClass.get(r.id) === 'UNKNOWN')

  console.log('\n████ 1) DOSSIER LOCAL — NE PAS PARTAGER (e-mails complets, terminal uniquement) ████')
  console.log(`UNKNOWN : ${unkOps.length} opérateurs · ${unkRestos.length} restaurants\n`)

  const autoProofTest = []
  for (const o of unkOps) {
    const myRestos = restos.filter(r => r.operatorId === o.id)
    const orders = await prisma.order.count({ where: { consumerId: o.id } }).catch(() => 0)
    const paid = await prisma.order.count({ where: { consumerId: o.id, paymentStatus: 'paid' } }).catch(() => 0)
    const resas = await prisma.reservation.count({ where: { userId: o.id } }).catch(() => 0)
    const resasQa = await prisma.reservation.count({ where: { userId: o.id, source: 'qa-parity' } }).catch(() => 0)
    // preuve auto : commandes portant le marqueur JSON qaParity (fixture versionnée)
    let qaOrders = 0
    try { qaOrders = await prisma.order.count({ where: { consumerId: o.id, items: { path: '$[0].qaParity', equals: true } } }) } catch { /* JSON path indisponible → 0 */ }
    const lastSession = await prisma.session.findFirst({ where: { userId: o.id }, orderBy: { expires: 'desc' }, select: { expires: true } }).catch(() => null)
    const emailsSent = await prisma.emailLog.count({ where: { recipient: o.email } }).catch(() => 0)
    const lastEmail = await prisma.emailLog.findFirst({ where: { recipient: o.email }, orderBy: { sentAt: 'desc' }, select: { sentAt: true, trigger: true } }).catch(() => null)
    const oauth = await prisma.account.count({ where: { userId: o.id } }).catch(() => 0)
    const logistics = await prisma.logisticsProfile.findUnique({ where: { email: o.email }, select: { status: true } }).catch(() => null)

    const proofs = []
    if (qaOrders > 0) proofs.push(`${qaOrders} commande(s) au marqueur qaParity (fixture QA versionnée)`)
    if (resasQa > 0) proofs.push(`${resasQa} réservation(s) source='qa-parity'`)
    if (proofs.length) autoProofTest.push({ pseudo: opPseudo.get(o.id), proofs })

    const acts = [
      o.emailVerifiedAt ? 'e-mail vérifié ' + d(o.emailVerifiedAt) : 'e-mail JAMAIS vérifié',
      lastSession ? 'dernière session exp. ' + d(lastSession.expires) : 'aucune session',
      emailsSent ? `${emailsSent} e-mail(s) envoyé(s), dernier ${lastEmail ? d(lastEmail.sentAt) + ' (' + lastEmail.trigger + ')' : ''}` : 'aucun e-mail envoyé',
    ]
    console.log(`── ${opPseudo.get(o.id)} ─ ${o.email}`)
    console.log(`   créé=${d(o.createdAt)} role=${o.role}${roleSets.get(o.id) ? ' [' + [...roleSets.get(o.id)].join(',') + ']' : ''} status=${o.status} pwd=${hasPwd.get(o.id) ? 'oui' : 'null'} siren=${o.siren ? 'oui' : '—'} kyb=${o.kybStatus || '—'} oauth=${oauth}${logistics ? ' livreur=' + logistics.status : ''}`)
    console.log(`   activité : ${acts.join(' · ')}`)
    console.log(`   commandes conso=${orders} (payées=${paid}) · résas=${resas}`)
    if (myRestos.length) console.log(`   restos liés : ${myRestos.map(r => `${restoPseudo.get(r.id)} « ${r.name} » (${r.isActive ? 'actif' : 'inactif'})`).join(' · ')}`)
    if (proofs.length) console.log(`   🔎 PREUVE AUTO TEST : ${proofs.join(' ; ')}`)
    if (!o.emailVerifiedAt && !orders && !resas && !lastSession) console.log('   💡 indice : inscription jamais vérifiée, zéro activité — probable essai abandonné (à confirmer)')
    console.log('')
  }

  for (const r of unkRestos) {
    const owner = ops.find(o => o.id === r.operatorId)
    const orders = await prisma.order.count({ where: { restaurantId: r.id } }).catch(() => 0)
    const paid = await prisma.order.count({ where: { restaurantId: r.id, paymentStatus: 'paid' } }).catch(() => 0)
    const menu = await prisma.brand.count({ where: { restaurantId: r.id } }).catch(() => 0)
    const hint = REPO_HINTS.get(r.name)
    console.log(`── ${restoPseudo.get(r.id)} ─ « ${r.name} » (${r.city}) id=${shortId(r.id)}`)
    console.log(`   créé=${d(r.createdAt)} actif=${r.isActive ? 'OUI' : 'non'} approuvé=${d(r.approvedAt)} géo=${typeof r.lat === 'number' ? 'oui' : 'non'} Connect=${r.stripeAccountId ? mask(r.stripeAccountId) + '/' + (r.stripeAccountStatus || '?') : '—'} marques=${menu} commandes=${orders} (payées=${paid})`)
    console.log(`   propriétaire : ${owner ? `${opPseudo.get(owner.id)} ${owner.email}` : '(introuvable)'}`)
    if (hint) console.log(`   💡 indice repo : ${hint}`)
    console.log('')
  }

  if (autoProofTest.length) {
    console.log('🔎 PREUVES AUTOMATIQUES TROUVÉES (reclassables TEST PROVED sans votre aide) :')
    for (const p of autoProofTest) console.log(`   ${p.pseudo} — ${p.proofs.join(' ; ')}`)
  }

  console.log('\n████ 2) GABARIT À RENVOYER (SAFE — aucun e-mail, copiez-collez et complétez) ████\n')
  for (const o of unkOps) {
    const pre = autoProofTest.find(p => p.pseudo === opPseudo.get(o.id)) ? 'TEST (preuve auto)' : '___'
    console.log(`${opPseudo.get(o.id)} = ${pre}    (choix : TEST / REAL / KEEP UNKNOWN)`)
  }
  for (const r of unkRestos) console.log(`${restoPseudo.get(r.id)} = ___    (choix : TEST / REAL / KEEP UNKNOWN)`)
  console.log('\nRappel : le domaine de l\'e-mail seul n\'est PAS une preuve. En cas de doute : KEEP UNKNOWN.')
  console.log('AUCUNE ÉCRITURE N\'A ÉTÉ FAITE.')
}

main()
  .catch((e) => { console.error('❌ échec :', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
