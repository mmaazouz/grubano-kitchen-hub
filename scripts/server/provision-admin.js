#!/usr/bin/env node
// ── provision-admin.js — créer ou promouvoir un ADMINISTRATEUR Grubano ────────
//
// MISSION U (vague 3). La décision Q3 fait reposer toute la chaîne de
// remboursement sur un admin — et il n'existait AUCUN chemin pour en créer un
// (constat Mission L : pas de seed, pas d'API, pas de doc ; le seul chemin
// pratiqué était un UPDATE SQL manuel, exposé au piège notifPrefs).
//
// POURQUOI UN SCRIPT SERVEUR et pas un écran d'admin :
//   • le PREMIER admin d'un environnement neuf est un problème d'amorçage —
//     un écran d'admin exigerait… un admin pour l'ouvrir ;
//   • un script exécuté en cPanel Terminal n'expose AUCUNE surface web : pas
//     de route, pas de handler, rien d'appelable par HTTP. L'élévation de
//     privilège exige déjà le shell du compte d'hébergement — qui donne de
//     toute façon la base. Aucun privilège nouveau n'est créé ;
//   • scripts/server/ est le dossier d'exploitation DÉSIGNÉ, déjà shippé par
//     les deux workflows de deploy (deploy-staging.yml « Server-run OPS
//     scripts ») — le script est donc présent sur le serveur après chaque
//     déploiement, sans étape manuelle.
//
// CE QUE FAIT LE SCRIPT (idempotent, rejouable sans danger) :
//   compte ABSENT  → créé role='admin', status='active', SANS mot de passe
//                    (connexion par lien magique), notifPrefs = {} valide ;
//   compte PRÉSENT → le rôle 'admin' est AJOUTÉ à son jeu de rôles
//                    (INSERT OperatorRole — même sémantique
//                    qu'addRoleToOperator, upsert @@unique[operatorId, role]).
//                    Son rôle primaire, son mot de passe et ses préférences ne
//                    sont JAMAIS touchés ;
//   status ≠ active → passé à 'active' (nécessaire au login).
//
// LE PIÈGE notifPrefs (48/50 lignes staging invalides — chaîne vide) :
//   • la promotion passe par un INSERT dans OperatorRole : AUCUN UPDATE de la
//     ligne Operator → le CHECK json_valid n'est pas re-déclenché. Une ligne
//     cassée peut donc être promue TELLE QUELLE ;
//   • seul le passage status→active écrit sur Operator. Avant cela, le script
//     SONDE notifPrefs (une lecture Prisma d'un Json invalide échoue) et, si
//     la colonne est invalide, la répare en écrivant {} — ce qui est toujours
//     accepté (le CHECK évalue la NOUVELLE valeur). Une ligne saine garde ses
//     préférences intactes ;
//   • tout échec résiduel sort un message FRANÇAIS explicite, jamais une
//     erreur SQL brute.
//
// TRAÇABILITÉ : une ligne AdminAuditLog est écrite à CHAQUE provision
// (actorId 'system:ops-script', action 'admin.provision') — volontairement
// SANS passer par recordAdminAudit, qui est gaté par ADMIN_AUDIT_ENABLED :
// la création d'un admin doit être tracée même flags OFF. Best-effort : si la
// table n'existe pas encore (db push en retard), le script le DIT et continue.
//
// USAGE (cPanel Terminal, depuis la racine de l'app) :
//   cd ~/app.grubano.com && node scripts/server/provision-admin.js email@exemple.fr
//   options : --name "Prénom Nom"   (nom d'affichage à la création)
// Après une PROMOTION : se DÉCONNECTER puis se reconnecter — le JWT est
// frappé au login, le rôle n'agit qu'après reconnexion.

'use strict'

const fs = require('fs')
const path = require('path')

// .env.local — même chargeur que les scripts cron (le shell cron/cPanel ne
// source rien) : la racine de l'app est ../../ depuis scripts/server/.
function loadDotenv() {
  const candidates = [
    path.join(__dirname, '..', '..', '.env.local'),
    path.join(__dirname, '..', '..', '.env'),
  ]
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue
    for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq <= 0) continue
      const key = line.slice(0, eq).trim()
      let val = line.slice(eq + 1).trim()
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1)
      }
      if (!(key in process.env)) process.env[key] = val
    }
    return file
  }
  return null
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Cœur testable — le client prisma est INJECTÉ (les tests passent un mock).
 * Retourne { mode: 'created'|'promoted'|'already', statusActivated,
 * notifPrefsRepaired, auditWritten } ou lève une Error au message français.
 */
async function provisionAdmin(prisma, emailRaw, opts = {}) {
  const email = String(emailRaw || '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) {
    throw new Error(`« ${emailRaw} » n'est pas une adresse email valide.`)
  }

  const result = { mode: null, statusActivated: false, notifPrefsRepaired: false, auditWritten: false }

  // Lecture SÛRE : jamais notifPrefs dans ce select (une colonne invalide
  // ferait échouer la lecture elle-même — c'est sondé séparément plus bas).
  const existing = await prisma.operator.findUnique({
    where:  { email },
    select: { id: true, role: true, status: true, name: true },
  })

  let operatorId
  if (!existing) {
    const name = (opts.name && String(opts.name).trim()) || email.split('@')[0]
    const created = await prisma.operator.create({
      data: {
        name,
        email,
        role:       'admin',
        status:     'active',
        password:   null,      // passwordless — connexion par lien magique
        notifPrefs: {},        // TOUJOURS un Json valide à la création (piège 4025)
      },
      select: { id: true },
    })
    operatorId = created.id
    result.mode = 'created'
  } else {
    operatorId = existing.id

    // Rôle : primaire déjà admin → rien à faire. Sinon AJOUT au jeu de rôles
    // (INSERT OperatorRole, aucun UPDATE d'Operator → passe même sur une ligne
    // au notifPrefs invalide). Même upsert qu'addRoleToOperator (lib/operator-roles).
    if (existing.role === 'admin') {
      result.mode = 'already'
    } else {
      try {
        await prisma.operatorRole.upsert({
          where:  { operatorId_role: { operatorId, role: 'admin' } },
          update: {},
          create: { operatorId, role: 'admin' },
        })
        result.mode = 'promoted'
      } catch (err) {
        throw new Error(
          "L'ajout du rôle admin a échoué (table OperatorRole indisponible ?). " +
          'Rien n\'a été modifié. Détail technique : ' + (err instanceof Error ? err.message : String(err)),
        )
      }
    }

    // Activation — le SEUL écrit sur la ligne Operator. Le piège notifPrefs est
    // traité AVANT : sonde de lecture, réparation {} si invalide.
    if (existing.status !== 'active') {
      try {
        await prisma.operator.findUnique({ where: { id: operatorId }, select: { notifPrefs: true } })
      } catch {
        await prisma.operator.update({ where: { id: operatorId }, data: { notifPrefs: {} } })
        result.notifPrefsRepaired = true
      }
      try {
        await prisma.operator.update({ where: { id: operatorId }, data: { status: 'active' } })
        result.statusActivated = true
      } catch (err) {
        throw new Error(
          "Le compte a reçu le rôle admin mais n'a PAS pu être activé (status). " +
          'Cause probable : la contrainte notifPrefs (défaut connu, Mission L) sur cette ligne. ' +
          'Relancez le script ; si l\'erreur persiste, exécutez la requête de réparation de ' +
          'docs/ops/provision-admin.md. Détail technique : ' + (err instanceof Error ? err.message : String(err)),
        )
      }
    }
  }

  // Journal d'audit — TOUJOURS tenté (non gaté par ADMIN_AUDIT_ENABLED : la
  // création d'un admin se trace même flags OFF). Best-effort assumé.
  try {
    await prisma.adminAuditLog.create({
      data: {
        actorId:    'system:ops-script',
        actorEmail: null,
        action:     'admin.provision',
        targetType: 'operator',
        targetId:   operatorId,
        metadata:   { email, mode: result.mode, notifPrefsRepaired: result.notifPrefsRepaired, script: 'scripts/server/provision-admin.js' },
      },
    })
    result.auditWritten = true
  } catch {
    // table absente (db push en retard) — signalé par l'appelant CLI.
  }

  return result
}

// ── CLI ───────────────────────────────────────────────────────────────────────
// V4-3 — parsing : la forme DOCUMENTÉE est --email (l'aide et la doc disent la
// même chose) ; la forme positionnelle reste ACCEPTÉE (tolérance, jamais un
// piège). AUCUNE notation à substituer dans l'aide : la commande affichée est
// réelle et copiable telle quelle (le fondateur a échoué 3 fois sur des
// chevrons et un node hors PATH — l'aide montre le chemin absolu du binaire).
function parseArgs(argv) {
  const args = [...argv]
  const out = { email: undefined, name: undefined }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--email') { out.email = args[i + 1]; i++; continue }
    if (args[i] === '--name')  { out.name  = args[i + 1]; i++; continue }
    if (out.email === undefined && !String(args[i]).startsWith('--')) { out.email = args[i]; continue }
  }
  return out
}

const USAGE = [
  'Crée (ou promeut) un ADMINISTRATEUR Grubano — docs/ops/provision-admin.md.',
  '',
  'Commande complète, copiable telle quelle (remplacez seulement l’adresse) :',
  '',
  '  cd ~/app.grubano.com && /home/deyi0010/nodevenv/app.grubano.com/24/bin/node scripts/server/provision-admin.js --email admin@grubano.com',
  '',
  'Option : --name "Mohammed Maazouz"   (nom d’affichage si le compte est créé)',
].join('\n')

async function main() {
  const { email, name } = parseArgs(process.argv.slice(2))

  if (!email) {
    console.log(USAGE)
    process.exit(1)
  }

  const envFile = loadDotenv()
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL introuvable' + (envFile ? ` (chargé : ${envFile})` : ' (aucun .env.local trouvé à la racine de l\'app)') + '.')
    console.error('   Lancez le script DEPUIS la racine de l\'application (cd ~/app.grubano.com).')
    process.exit(1)
  }

  let PrismaClient
  try {
    ({ PrismaClient } = require('@prisma/client'))
  } catch {
    console.error('❌ @prisma/client introuvable. Lancez le script depuis la racine de l\'application')
    console.error('   (cd ~/app.grubano.com) — son node_modules contient le client Prisma.')
    process.exit(1)
  }

  const prisma = new PrismaClient()
  try {
    const r = await provisionAdmin(prisma, email, { name })
    if (r.mode === 'created')  console.log(`✅ Compte ADMIN créé pour ${email} (sans mot de passe — connexion par lien magique).`)
    if (r.mode === 'promoted') console.log(`✅ Rôle ADMIN ajouté au compte existant ${email} (rôle primaire, mot de passe et préférences intacts).`)
    if (r.mode === 'already')  console.log(`ℹ️ ${email} est déjà administrateur — rien à faire (le script est rejouable sans danger).`)
    if (r.statusActivated)     console.log('   Le compte a été activé (status → active).')
    if (r.notifPrefsRepaired)  console.log('   ⚠️ notifPrefs était invalide sur cette ligne (défaut connu) — réparé en {} au passage.')
    console.log(r.auditWritten
      ? '   Tracé dans le journal d\'audit (AdminAuditLog, action admin.provision).'
      : '   ⚠️ Journal d\'audit indisponible (table absente ?) — l\'opération a réussi mais n\'est PAS tracée.')
    console.log('   ➜ IMPORTANT : déconnexion puis reconnexion nécessaires — le rôle n\'agit qu\'au prochain login (JWT).')
  } catch (err) {
    console.error('❌ ' + (err instanceof Error ? err.message : String(err)))
    process.exitCode = 1
  } finally {
    await prisma.$disconnect().catch(() => {})
  }
}

module.exports = { provisionAdmin, parseArgs }
if (require.main === module) main()
