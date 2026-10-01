'use strict'
/* ═══════════════════════════════════════════════════════════════════════════════
   neutralize-public-credentials.js — NEUTRALISATION BORNÉE des 7 comptes staging
   dont les mots de passe ont été versionnés publiquement dans le dépôt.

   Mission BETA SECURITY GATE (2026-08-29). À exécuter UNE fois par le fondateur :

     cd ~/app.grubano.com && source ~/nodevenv/app.grubano.com/24/bin/activate \
       && node scripts/server/neutralize-public-credentials.js --i-have-admin-access

   CE QUE FAIT LE SCRIPT (et RIEN d'autre) :
     · cible EXACTEMENT les 7 e-mails listés ci-dessous — aucun wildcard, aucun
       domaine, aucun LIKE, aucun rôle global ;
     · PRECHECK : pour chaque e-mail — existence, rôle, statut, présence de mot
       de passe ; toute donnée INATTENDUE (ex. un de ces comptes déjà passwordless
       ET suspendu, ou un rôle imprévu) → rapport et ABORT sans écrire ;
     · TRANSACTION atomique : password=NULL + status='suspended' (+ statusReason)
       + purge des tokens de connexion (verify/magic/pendingEmail) + suppression
       des Sessions NextAuth actives de ces comptes ;
     · POSTCHECK : « comptes à credential public actifs avec mot de passe = 0 » ;
     · AUDIT : une ligne AdminAuditLog (jamais de mot de passe ni de hash loggé).

   POURQUOI suspended+password NULL : les 3 portes d'auth (mot de passe,
   magic-link, OTP) refusent un compte suspendu ; password NULL ferme en plus le
   chemin bcrypt définitivement. Le sort final (delete vs archive) sera décidé au
   CLEAN ROOM — ce script ne supprime AUCUNE donnée métier.

   GARDE-FOU ADMIN : `createur@grubano.com` porte le rôle admin. Le neutraliser
   sans autre admin contrôlé = perdre l'accès admin. Le flag OBLIGATOIRE
   `--i-have-admin-access` atteste que le fondateur S'EST CONNECTÉ par magic-link
   sur l'admin qu'il conserve (ex. admin-qa@…, passwordless, provisionné par le
   script officiel) et a atteint /admin/approvals. Sans ce flag → ABORT.
   ═══════════════════════════════════════════════════════════════════════════════ */

const fs = require('fs')
const path = require('path')

// ── env (.env.local : cwd puis racine app) ─────────────────────────────────────
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
if (!process.env.DATABASE_URL) { console.error('[neutralize] DATABASE_URL introuvable. Abandon.'); process.exit(1) }
try { const u = new URL(process.env.DATABASE_URL); console.log(`Base ciblée : ${u.protocol}//${u.username}:***@${u.host}${u.pathname}`) } catch {}

const CONFIRM = process.argv.includes('--i-have-admin-access')
const DRY = process.argv.includes('--dry-run')

// Les 7 identités EXACTES (classification-read + audit du dépôt — commit fcbbfd0,
// scripts/seed-demo-data.js). Rôles attendus d'après la lecture staging du fondateur.
const TARGETS = [
  { email: 'test@grubano.com', expectRoles: ['consumer'] },
  { email: 'resto@grubano.com', expectRoles: ['restaurant'] },
  { email: 'resto2@grubano.com', expectRoles: ['restaurant'] },
  { email: 'franchise@grubano.com', expectRoles: ['franchise', 'restaurant'] },
  { email: 'createur@grubano.com', expectRoles: ['creator', 'admin', 'restaurant'] }, // ⚠ porte admin sur staging
  { email: 'demo-franchiseur1@grubano.com', expectRoles: ['restaurant'] },
  { email: 'demo-franchiseur2@grubano.com', expectRoles: ['restaurant'] },
]
const REASON = 'public-credential-neutralized-2026-08-29 (mots de passe versionnés dans le dépôt public — mission BETA SECURITY GATE)'

const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  if (!CONFIRM && !DRY) {
    console.error('\nABORT — flag obligatoire manquant : --i-have-admin-access')
    console.error('Avant de neutraliser createur@grubano.com (qui porte le rôle admin), vous DEVEZ')
    console.error('avoir vérifié votre propre accès : connexion par lien magique sur l\'admin que')
    console.error('vous conservez (ex. admin-qa@…) puis ouverture de /admin/approvals.')
    console.error('Essai sans écriture : --dry-run')
    process.exit(1)
  }

  // ── PRECHECK ─────────────────────────────────────────────────────────────────
  console.log('\n══ PRECHECK (lecture seule) ══')
  const rows = []
  let unexpected = 0
  for (const t of TARGETS) {
    const op = await prisma.operator.findUnique({
      where: { email: t.email },
      select: { id: true, email: true, role: true, status: true, password: true, createdAt: true },
    })
    if (!op) { console.log(`  ${t.email} : ABSENT (rien à faire pour celui-ci)`); continue }
    const hasPwd = op.password !== null
    const roleOk = t.expectRoles.includes(op.role)
    const already = !hasPwd && op.status === 'suspended'
    console.log(`  ${op.email} : role=${op.role}${roleOk ? '' : ' ⚠INATTENDU'} status=${op.status} pwd=${hasPwd ? 'PRÉSENT' : 'null'}${already ? ' (déjà neutralisé)' : ''}`)
    if (!roleOk) unexpected++
    if (!already) rows.push(op)
  }
  const total = await prisma.operator.count({ where: { email: { in: TARGETS.map(t => t.email) } } })
  console.log(`  Total en base parmi les 7 : ${total} · à neutraliser : ${rows.length} · rôles inattendus : ${unexpected}`)
  if (unexpected > 0) {
    console.error('\nABORT — au moins un rôle ne correspond pas à l\'attendu. AUCUNE écriture.')
    console.error('Renvoyez cette sortie : la cible sera revalidée avant toute nouvelle tentative.')
    process.exit(2)
  }
  if (rows.length === 0) { console.log('\nRien à neutraliser (tout est déjà sain). ✅'); return }
  if (DRY) { console.log('\n--dry-run : PRECHECK OK, aucune écriture effectuée.'); return }

  // ── TRANSACTION atomique ─────────────────────────────────────────────────────
  console.log('\n══ NEUTRALISATION (transaction atomique) ══')
  const ids = rows.map(r => r.id)
  await prisma.$transaction(async (tx) => {
    for (const r of rows) {
      await tx.operator.update({
        where: { id: r.id },
        data: {
          password: null,
          status: 'suspended',
          statusReason: REASON,
          verifyTokenHash: null, verifyTokenExpiry: null,
          magicLinkTokenHash: null, magicLinkTokenExpiry: null,
          pendingEmail: null, pendingEmailTokenHash: null, pendingEmailTokenExpiry: null,
        },
      })
    }
    const s = await tx.session.deleteMany({ where: { userId: { in: ids } } })
    console.log(`  Sessions NextAuth actives supprimées : ${s.count}`)
    await tx.adminAuditLog.create({
      data: {
        actorId: 'system:ops-script',
        action: 'security.neutralize_public_credentials',
        targetType: 'operator',
        targetId: ids.join(','),
        metadata: { emails: rows.map(r => r.email), reason: 'repo-versioned passwords', count: rows.length },
      },
    })
  })

  // ── POSTCHECK ────────────────────────────────────────────────────────────────
  console.log('\n══ POSTCHECK ══')
  const still = await prisma.operator.findMany({
    where: { email: { in: TARGETS.map(t => t.email) }, status: { not: 'suspended' } },
    select: { email: true, status: true },
  })
  const withPwd = await prisma.operator.count({ where: { email: { in: TARGETS.map(t => t.email) }, password: { not: null } } })
  console.log(`  Non-suspendus restants parmi les 7 : ${still.length} ${still.length ? JSON.stringify(still) : ''}`)
  console.log(`  PUBLIC CREDENTIAL ACCOUNT ACTIVE WITH PASSWORD = ${withPwd}`)
  if (still.length === 0 && withPwd === 0) console.log('\n✅ NEUTRALISATION COMPLÈTE. Le sort final (delete/archive) sera réglé au Clean Room.')
  else { console.error('\n❌ POSTCHECK inattendu — renvoyez cette sortie complète.'); process.exit(3) }
}

main()
  .catch((e) => { console.error('❌ échec :', e); process.exit(1) })
  .finally(() => prisma.$disconnect())
