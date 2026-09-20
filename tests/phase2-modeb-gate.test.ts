// tests/phase2-modeb-gate.test.ts — MODE B : l'opérateur COMBINÉ, et ce qu'il refuse.
//
// POURQUOI IL EXISTE. Mode B exige CLAIMS et REFUNDS ouverts AU MÊME INSTANT (le remboursement est
// déclenché DANS l'action de réclamation). Les deux opérateurs existants se refusent mutuellement
// par construction : phase2-claims-gate n'ouvre que si la gate refund est CLOSED et la re-sonde
// toutes les 15 s ; phase2-refund-gate lève une anomalie si CLAIMS_ENABLED vaut 'true'. Cet
// opérateur-ci est la SEULE porte qui ouvre les deux, sous une phrase unique, pour UNE commande,
// UN montant, et une durée bornée par le plus COURT des deux plafonds.
//
// CE FICHIER ÉPINGLE les propriétés qui rendent cette porte sûre sans jamais l'ouvrir :
// écriture fermée d'urgence, verrou inter-opérateurs, plafonds de bail, et le fait que le script
// n'exécute AUCUN remboursement.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const OP = require('../scripts/server/phase2-modeb-gate.js') as {
  writeFlag: (envFile: string, key: string, value: string, stamp: string) => { changed: boolean; backup: string | null }
  emergencyClose: () => void
  armClose: (envFile: string, stamp: string) => void
  isCloseArmed: () => boolean
  takeLock: () => { ok: boolean; held?: { pid: number | null; op: string } }
  releaseLock: () => void
  CONFIRM_SENTENCE: string
  REFUND_LEASE_MAX_MS: number
  CLAIMS_LEASE_MAX_MS: number
  LEASE_SLACK_MS: number
  LOCK_FILE: string
}

const SRC = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'server', 'phase2-modeb-gate.js'), 'utf8')

let tmp: string
let envFile: string
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'modeb-op-'))
  envFile = path.join(tmp, '.env.local')
  fs.writeFileSync(envFile, 'DATABASE_URL=mysql://x\nCLAIMS_ENABLED=false\nREFUNDS_ENABLED=false\n')
})
afterEach(() => { try { fs.rmSync(tmp, { recursive: true, force: true }) } catch { /* best-effort */ } })

describe('MODE B opérateur — la fermeture d’urgence ferme les QUATRE clés', () => {
  it('armée puis déclenchée : les deux drapeaux à false ET les deux baux expirés, sur le disque', () => {
    OP.writeFlag(envFile, 'CLAIMS_ENABLED', 'true', '2026-09-20T10:00:00.000Z')
    OP.writeFlag(envFile, 'REFUNDS_ENABLED', 'true', '2026-09-20T10:00:00.000Z')
    OP.writeFlag(envFile, 'CLAIMS_WINDOW_UNTIL', new Date(Date.now() + 600000).toISOString(), '2026-09-20T10:00:00.000Z')
    OP.writeFlag(envFile, 'REFUNDS_WINDOW_UNTIL', new Date(Date.now() + 600000).toISOString(), '2026-09-20T10:00:00.000Z')
    OP.armClose(envFile, '2026-09-20T10:00:00.000Z')
    expect(OP.isCloseArmed()).toBe(true)

    OP.emergencyClose()

    const out = fs.readFileSync(envFile, 'utf8')
    expect(out).toMatch(/^CLAIMS_ENABLED=false$/m)
    expect(out).toMatch(/^REFUNDS_ENABLED=false$/m)
    const claimsLease = /^CLAIMS_WINDOW_UNTIL=(.+)$/m.exec(out)![1]
    const refundsLease = /^REFUNDS_WINDOW_UNTIL=(.+)$/m.exec(out)![1]
    expect(new Date(claimsLease).getTime()).toBeLessThan(Date.now())   // bail EXPIRÉ, pas seulement le drapeau
    expect(new Date(refundsLease).getTime()).toBeLessThan(Date.now())
    expect(OP.isCloseArmed()).toBe(false)
  })

  it('non armée → ne touche à rien (octet pour octet)', () => {
    const before = fs.readFileSync(envFile)
    OP.emergencyClose()
    expect(fs.readFileSync(envFile).equals(before)).toBe(true)
  })

  it('writeFlag sauvegarde avant d’écrire et ne restaure JAMAIS une ancienne sauvegarde', () => {
    const out = OP.writeFlag(envFile, 'CLAIMS_ENABLED', 'true', '2026-09-20T11:00:00.000Z')
    expect(out.changed).toBe(true)
    expect(out.backup).toMatch(/\.bak-modeb-gate-/)
    expect(fs.existsSync(path.join(tmp, out.backup as string))).toBe(true)
    // la source ne contient aucune restauration de sauvegarde
    expect(SRC).not.toMatch(/copyFileSync\([^)]*bak[^)]*,\s*envFile/)
    expect(SRC).not.toMatch(/restore|rollbackEnv/i)
  })

  it('les quatre clés, et SEULEMENT elles, sont écrites par l’opérateur', () => {
    const keys = Array.from(SRC.matchAll(/writeFlag\(envFile, '([A-Z_]+)'/g)).map((m) => m[1])
    expect(new Set(keys)).toEqual(new Set(['CLAIMS_ENABLED', 'REFUNDS_ENABLED', 'CLAIMS_WINDOW_UNTIL', 'REFUNDS_WINDOW_UNTIL']))
  })
})

describe('MODE B opérateur — verrou inter-opérateurs', () => {
  it('un second opérateur VIVANT bloque la prise du verrou', () => {
    fs.mkdirSync(path.dirname(OP.LOCK_FILE), { recursive: true })
    fs.writeFileSync(OP.LOCK_FILE, JSON.stringify({ pid: process.pid, op: 'phase2-refund-gate', at: new Date().toISOString() }))
    const got = OP.takeLock()
    expect(got.ok).toBe(false)
    expect(got.held?.op).toBe('phase2-refund-gate')
    fs.unlinkSync(OP.LOCK_FILE)
  })

  it('un verrou ORPHELIN (pid mort) est repris, puis rendu', () => {
    fs.mkdirSync(path.dirname(OP.LOCK_FILE), { recursive: true })
    fs.writeFileSync(OP.LOCK_FILE, JSON.stringify({ pid: 999999999, op: 'phase2-claims-gate', at: new Date().toISOString() }))
    expect(OP.takeLock().ok).toBe(true)
    expect(JSON.parse(fs.readFileSync(OP.LOCK_FILE, 'utf8')).pid).toBe(process.pid)
    OP.releaseLock()
    expect(fs.existsSync(OP.LOCK_FILE)).toBe(false)
  })
})

describe('MODE B opérateur — la fenêtre est bornée par le plus COURT des deux plafonds', () => {
  it('les plafonds déclarés sont ceux de l’application, et le commun est celui des remboursements', () => {
    expect(OP.CLAIMS_LEASE_MAX_MS).toBe(60 * 60 * 1000)
    expect(OP.REFUND_LEASE_MAX_MS).toBe(30 * 60 * 1000)
    expect(Math.min(OP.CLAIMS_LEASE_MAX_MS, OP.REFUND_LEASE_MAX_MS)).toBe(OP.REFUND_LEASE_MAX_MS)
  })

  it('le bail écrit ne dépasse jamais le plafond, même si on demande une fenêtre trop longue', () => {
    const asked = 90 * 60 * 1000
    const written = Math.min(asked + OP.LEASE_SLACK_MS, OP.REFUND_LEASE_MAX_MS)
    expect(written).toBe(OP.REFUND_LEASE_MAX_MS)
    // et la source REFUSE explicitement plutôt que de raccourcir en silence
    expect(SRC).toMatch(/dépasse ce que le bail le plus court peut couvrir/)
  })

  it('la fenêtre est écrite AVANT les drapeaux : l’autorisation meurt d’elle-même même si l’ouverture échoue', () => {
    const leaseAt = SRC.indexOf("writeFlag(envFile, 'CLAIMS_WINDOW_UNTIL', leaseUntil")
    const flagAt = SRC.indexOf("writeFlag(envFile, 'CLAIMS_ENABLED', 'true'")
    expect(leaseAt).toBeGreaterThan(-1)
    expect(flagAt).toBeGreaterThan(leaseAt)
  })
})

describe('MODE B opérateur — ce qu’il REFUSE, et ce qu’il ne fait jamais', () => {
  const refusals: Array<[string, RegExp]> = [
    ['Stripe live', /la clé n’est pas sk_test_/],
    ['production / hors staging (vue FICHIERS)', /NEXTAUTH_URL des FICHIERS n’est pas https:\/\/app\.grubano\.com/],
    ['shell qui déplace la cible', /diverge des fichiers — refus/],
    ['base de données nommée PROD', /base nommée PROD/],
    ['branche autre que develop', /branche déployée/],
    ['SHA non certifié', /n’est pas le SHA certifié attendu/],
    ['une gate déjà ouverte', /la gate CLAIMS n’est pas CLOSED|la gate REFUNDS n’est pas CLOSED/],
    ['commande non payée', /le rail réclamation exige « paid »/],
    ['hors fenêtre de réclamation', /hors fenêtre de réclamation/],
    ['réclamation active existante', /réclamation ACTIVE existe déjà/],
    ['identité de remboursement en double', /identité de remboursement \(doublon\)/],
    ['ligne pending préexistante', /ligne\(s\) « pending » préexistante/],
    ['verrou E2', /verrouille le rail de cette commande \(E2\)/],
    ['déjà remboursée', /a déjà été remboursée/],
    ['résidu refunding', /réclamation\(s\) en « refunding »/],
    ['résidu vérification financière', /en vérification financière/],
    ['résidu approuvées non payées', /approuvées non payées/],
    ['charge contestée', /charge CONTESTÉE/],
    ['cash remboursable insuffisant', /cash remboursable .* < montant de répétition/],
    ['financement connecté insuffisant', /solde connecté disponible .* < BRUT/],
    ['versement automatique', /planning de versement/],
    ['charge routée sans commission', /charge ROUTÉE sans commission/],
    ['Stripe illisible', /lecture PI\/charge/],
    ['autre opérateur en cours', /un autre opérateur phase2 tourne déjà/],
    ['phrase d’autorisation', /phrase d’autorisation absente ou incorrecte/],
    ['anomalies au precheck', /anomalies au precheck — FENÊTRE REFUSÉE/],
  ]
  for (const [name, re] of refusals) {
    it(`refuse : ${name}`, () => { expect(SRC, name).toMatch(re) })
  }

  it('la phrase d’autorisation est unique, explicite et exigée telle quelle', () => {
    expect(OP.CONFIRM_SENTENCE).toBe('I AUTHORIZE THE STAGING MODE B REHEARSAL')
    expect(SRC).toMatch(/process\.env\.PHASE2_MODEB_CONFIRM !== CONFIRM_SENTENCE/)
  })

  it('⭐ l’opérateur n’exécute JAMAIS de remboursement : il ouvre, observe, referme', () => {
    expect(SRC).not.toMatch(/refunds\.create\(/)
    expect(SRC).not.toMatch(/executeRefund/)
    expect(SRC).not.toMatch(/\/api\/admin\/refunds\/run['"]\s*,\s*\{[^}]*method:\s*'POST'[^}]*body:\s*JSON/)
    // les seules écritures DB : aucune. Le script lit.
    expect(SRC).not.toMatch(/prisma\.\w+\.(create|update|updateMany|delete|deleteMany|upsert)\(/)
  })

  it('le precheck est LECTURE SEULE : aucune écriture de drapeau hors du mode window', () => {
    const windowAt = SRC.indexOf('// ── MODE WINDOW')
    expect(windowAt).toBeGreaterThan(-1)
    const beforeWindow = SRC.slice(0, windowAt)
    // seules les définitions (fonction writeFlag / emergencyClose) précèdent, jamais un appel d'ouverture
    expect(beforeWindow).not.toMatch(/writeFlag\(envFile, '(CLAIMS|REFUNDS)_ENABLED', 'true'/)
  })

  it('la fermeture est INCONDITIONNELLE (finally) et re-sonde les DEUX gates', () => {
    expect(SRC).toMatch(/\} finally \{/)
    expect(SRC).toMatch(/waitBoth\(base, 'CLOSED'/)
    expect(SRC).toMatch(/ATTENTION HUMAINE REQUISE/)
  })

  it('une incohérence en cours de fenêtre referme immédiatement', () => {
    expect(SRC).toMatch(/incohérence confirmée/)
  })

  it('une sonde 429 n’est jamais lue comme « ouverte » (leçon Mode A)', () => {
    expect(SRC).toMatch(/429 = limite de débit AVANT la gate/)
    expect(SRC).toMatch(/return 'UNKNOWN\(' \+ r\.status \+ '\)'/)
  })
})

// ── revue adversariale de l'opérateur (28 agents) : les défauts confirmés, épinglés ──────────
describe('MODE B opérateur — corrections issues de la revue adversariale', () => {
  it('⭐ P0 — la fenêtre observe l’OBJET STRIPE, jamais la ligne DB (le moteur écrit AVANT d’appeler Stripe)', () => {
    // s'arrêter sur la ligne DB refermerait les gates et redémarrerait Passenger pendant que
    // l'appel Stripe est en vol : exactement l'état absorbant que ce chantier existe pour éviter.
    expect(SRC).toMatch(/ON N'OBSERVE PAS LA LIGNE DB/)
    expect(SRC).toMatch(/stripe\.refunds\.list\(\{ payment_intent: order\.stripePaymentIntentId/)
    expect(SRC).toMatch(/data\.length > stripeRefundsBefore/)
    // et la boucle ne doit PAS casser sur un simple compte de lignes
    expect(SRC).not.toMatch(/rows\.length > refundsBefore/)
  })

  it('⭐ P0 — rien n’est refermé ni redémarré tant qu’une tentative est NON RÉSOLUE', () => {
    expect(SRC).toMatch(/SETTLE BEFORE CLOSE|encore NON RÉSOLUE à la fermeture/)
    const settleAt = SRC.indexOf('settleUntil')
    const closeAt = SRC.indexOf("writeFlag(envFile, 'REFUNDS_WINDOW_UNTIL', past")
    expect(settleAt).toBeGreaterThan(-1)
    expect(settleAt).toBeLessThan(closeAt)   // on attend AVANT de fermer
  })

  it('une sonde isolée ne referme pas : il faut DEUX lectures non-OPEN consécutives', () => {
    expect(SRC).toMatch(/blips\+\+/)
    expect(SRC).toMatch(/if \(blips >= 2\)/)
  })

  it('la deadline d’observation est ré-ancrée sur le BAIL (l’ouverture consomme du temps)', () => {
    expect(SRC).toMatch(/const deadline = Math\.min\(Date\.now\(\) \+ WINDOW_MS, leaseEndMs - LEASE_SLACK_MS\)/)
  })

  it('le garde-fou PRODUCTION lit les FICHIERS .env, pas le shell, et refuse une divergence', () => {
    expect(SRC).toMatch(/mergeNextEnvFiles\(prov\.readNextEnvFiles\(APP_ROOT\)\)/)
    expect(SRC).toMatch(/NEXTAUTH_URL des FICHIERS n’est pas https:\/\/app\.grubano\.com/)
    expect(SRC).toMatch(/diverge des fichiers — refus/)
  })

  it('une base nommée PROD est refusée avant toute écriture', () => {
    expect(SRC).toMatch(/if \(\/prod\/i\.test\(dbName\)\) return fail/)
  })

  it('la cible HTTP est ANCRÉE (une sous-chaîne laisserait passer un domaine voisin)', () => {
    expect(SRC).toMatch(/if \(!\/\^https:\\\/\\\/app\\\.grubano\\\.com\$\/i\.test\(base\)\)/)
  })

  it('les automatismes d’argent doivent être désarmés pendant la fenêtre', () => {
    for (const k of ['ALLOW_PLATFORM_FALLBACK', 'CLAIMS_AUTO_APPROVE_ENABLED', 'CLAIM_AUTO_RESOLVE_ENABLED', 'GHOST_ORDER_AUTO_REFUND_ENABLED']) {
      expect(SRC, k).toContain(k)
    }
    expect(SRC).toMatch(/aucun automatisme d’argent ne doit être armé/)
  })

  it('toute réclamation ACTIVE bloque (pas seulement refunding / vérification financière)', () => {
    expect(SRC).toMatch(/réclamation\(s\) ACTIVE\(s\) — aucune répétition ne démarre/)
  })

  it('un client Stripe en repli sans balance/accounts rend le financement NON VÉRIFIABLE et le dit', () => {
    expect(SRC).toMatch(/typeof stripe\.balance === 'undefined' \|\| typeof stripe\.accounts === 'undefined'/)
    expect(SRC).toMatch(/NON VÉRIFIABLES/)
  })

  it('la fermeture d’urgence écrit chaque clé dans SON try, désarme en premier, et nomme l’action humaine', () => {
    const fn = SRC.slice(SRC.indexOf('function emergencyClose'), SRC.indexOf('for (const sig of'))
    expect(fn).toMatch(/armedClose = null\s+\/\/ une seule fois/)
    expect(fn).toMatch(/for \(const \[k, v\] of writes\)/)
    expect((fn.match(/try \{/g) || []).length).toBeGreaterThanOrEqual(2)
    expect(fn).toMatch(/ACTION HUMAINE REQUISE MAINTENANT/)
  })

  it('done() force la sortie, comme les opérateurs frères', () => {
    expect(SRC).toMatch(/setTimeout\(\(\) => process\.exit\(process\.exitCode\), 1500\)\.unref\(\)/)
  })

  it('la chaîne de masquage est celle de la maison (clé, URL, jeton long, 160)', () => {
    expect(SRC).toMatch(/replace\(\/\[a-z\]\[a-z0-9\+\.-\]\*:\\\/\\\/\[\^\\s\]\+\/gi, '<url>'\)/)
    expect(SRC).toMatch(/replace\(\/\[A-Za-z0-9_-\]\{24,\}\/g, '…'\)/)
    expect(SRC).toMatch(/\.slice\(0, 160\)/)
  })

  it('le verrou dit la VÉRITÉ sur sa portée : il n’exclut pas encore les deux opérateurs frères', () => {
    // les deux opérateurs de référence n'écrivent pas ce verrou : le texte ne doit pas prétendre l'inverse
    const refund = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'server', 'phase2-refund-gate.js'), 'utf8')
    const claims = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'server', 'phase2-claims-gate.js'), 'utf8')
    const othersTakeIt = /phase2-operator\.lock/.test(refund) || /phase2-operator\.lock/.test(claims)
    expect(SRC).toMatch(othersTakeIt ? /verrou partagé/ : /PORTÉE DU VERROU/)
  })
})
