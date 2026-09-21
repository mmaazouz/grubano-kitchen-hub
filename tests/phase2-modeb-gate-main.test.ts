// tests/phase2-modeb-gate-main.test.ts — MODE B : main() EXÉCUTÉ DE BOUT EN BOUT.
//
// LE DÉFAUT QUI A ÉCHAPPÉ DEUX FOIS (71caabc puis 3e32e01). main() appelait
// `prov.readNextEnvFiles(APP_ROOT)` alors que la signature est (fs, path, dir) : l'helper avale sa
// propre TypeError, renvoie {}, et l'opérateur lisait NEXTAUTH_URL « ABSENT » — refus à l'étape [1] à
// CHAQUE lancement, precheck comme fenêtre. Fermé, donc sans danger, mais l'opérateur « certifié » ne
// pouvait ouvrir aucune fenêtre. Aucun test ne l'a vu parce qu'AUCUN test n'exécutait main() : les
// suites existantes épinglent la SOURCE (dont, à l'époque, l'appel fautif lui-même) et n'exercent que
// des fonctions exportées.
//
// CE FICHIER LANCE LE VRAI SCRIPT dans un processus enfant, contre une racine d'application
// temporaire : un vrai `.env.local`, un faux `@prisma/client` résolu depuis cette racine (comme sur le
// serveur), AUCUN SDK `stripe` (⇒ client REST, comme le standalone déployé), et un faux monde
// préchargé (`node -r`) qui
//   (a) ouvre/ferme les gates d'après le CONTENU RÉEL du `.env.local` écrit par l'opérateur — baux et
//       PLAFONDS de bail compris, comme l'application ;
//   (b) sert les points d'entrée Stripe REST, en DEUX temps (pendant la fenêtre / après fermeture) ;
//   (c) horodate chaque écriture de `.env.local` et de `tmp/restart.txt` (ENVWRITE / RESTART) : les
//       tests jugent l'ÉTAT DISQUE, pas une sonde ;
//   (d) LÈVE sur tout appel réseau inattendu ou tout appel Stripe qui ne serait pas un GET.
// Rien ne sort de la machine.
import { describe, it, expect, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const REPO = path.join(__dirname, '..')
const OP_PATH = path.join(REPO, 'scripts', 'server', 'phase2-modeb-gate.js')
const SENTENCE = 'I AUTHORIZE THE STAGING MODE B REHEARSAL'
const ORDER_ID = 'cmtestorder0001modeb0000main'
const PI_ID = 'pi_test_main_1'
const DEST = 'acct_test_pilot'
const WINDOW_MS = 6000

const ENV_OK = [
  'NEXTAUTH_URL=https://app.grubano.com',
  'STRIPE_SECRET_KEY=sk_test_mainharness',
  'DATABASE_URL=mysql://u:p@localhost:3306/grubano_staging',
  'CLAIMS_ENABLED=false',
  'REFUNDS_ENABLED=false',
  '',
].join('\n')

type Row = Record<string, unknown>
type Db = { orders: Row[]; claims: Row[]; refunds: Row[] }
const dbOk = (over: Partial<Db> = {}, orderOver: Row = {}): Db => ({
  orders: [{ id: ORDER_ID, restaurantId: 'r1', consumerId: 'c1', paymentStatus: 'paid', stripePaymentIntentId: PI_ID, total: 14.5, updatedAtAgoH: 5, status: 'delivered', ...orderOver }],
  claims: [],
  refunds: [],
  ...over,
})
const CLAIM_ID = 'clm_test_1'
const ROW_ID = 'rf_row_1'
const claimRow = (over: Row = {}): Row => ({ id: CLAIM_ID, orderId: ORDER_ID, status: 'refunded', refundId: ROW_ID, refundError: null, refundAttempted: true, requestedAmountCents: 500, ...over })
const refundRow = (over: Row = {}): Row => ({ id: ROW_ID, orderId: ORDER_ID, status: 'succeeded', stripeRefundId: 're_test_1', amountCents: 500, reason: 'claim:' + CLAIM_ID, idempotencyKey: 'refund:' + ORDER_ID + ':0', createdAt: '2026-01-01T00:00:00Z', ...over })
/** L'état DB d'une répétition RÉUSSIE : la réclamation payée, liée à SA ligne, liée à l'objet Stripe. */
const dbPaid = (claimOver: Row = {}, rowOver: Row = {}) => dbOk({ claims: [claimRow(claimOver)], refunds: [refundRow(rowOver)] })

// Faux @prisma/client. Le DB peut être en DEUX temps : `__next` remplace l'état à `__switchAt`
// (le moteur a fini), horodaté DBRESOLVED dans le journal.
const FAKE_PRISMA = `
const fs = require('fs'), path = require('path')
const ROOT = process.env.PHASE2_APP_ROOT
const DB = () => {
  let d = JSON.parse(fs.readFileSync(path.join(ROOT, 'db.json'), 'utf8'))
  if (d.__next && Date.now() >= d.__switchAt) {
    const next = d.__next
    fs.writeFileSync(path.join(ROOT, 'db.json'), JSON.stringify(next))
    fs.appendFileSync(path.join(ROOT, 'net.log'), 'DBRESOLVED ' + Date.now() + '\\n')
    d = next
  }
  return d
}
const match = (row, where) => Object.entries(where || {}).every(([k, v]) => (v && typeof v === 'object' && Array.isArray(v.in)) ? v.in.includes(row[k]) : row[k] === v)
class PrismaClient {
  constructor() {
    this.order = { findUnique: async ({ where }) => { const o = DB().orders.find((x) => x.id === where.id) || null; return o ? { ...o, updatedAt: o.updatedAtAgoH === null ? 'not-a-date' : new Date(Date.now() - o.updatedAtAgoH * 3600000) } : null } }
    this.claim = { findMany: async ({ where }) => DB().claims.filter((r) => match(r, where)), count: async ({ where }) => DB().claims.filter((r) => match(r, where)).length }
    this.refund = { findMany: async ({ where }) => DB().refunds.filter((r) => match(r, where)) }
  }
  async $disconnect() {}
}
module.exports = { PrismaClient }
`

// Faux monde PRÉCHARGÉ : remplace fetch et instrumente fs AVANT que l'opérateur ne charge quoi que ce soit.
const PRELOAD = `
const fs = require('fs'), path = require('path')
const ROOT = process.env.PHASE2_APP_ROOT
const LOG = path.join(ROOT, 'net.log')
const ENVF = path.join(ROOT, '.env.local')
const RESTART = path.join(ROOT, 'tmp', 'restart.txt')
const log = (l) => fs.appendFileSync(LOG, l + '\\n')
const NET = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'net.json'), 'utf8'))
const envVal = (k) => { let v; for (const l of fs.readFileSync(ENVF, 'utf8').split(/\\r?\\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && m[1] === k) v = m[2] } return v }
// Comme l'application : drapeau true ET bail futur ET bail ≤ plafond (refunds 30 min, claims 60 min).
const open = (flag, lease, maxMs) => { const t = new Date(envVal(lease) || 0).getTime(); return envVal(flag) === 'true' && t > Date.now() && t - Date.now() <= maxMs }
const claimsOpen = () => open('CLAIMS_ENABLED', 'CLAIMS_WINDOW_UNTIL', 60 * 60000)
const refundsOpen = () => open('REFUNDS_ENABLED', 'REFUNDS_WINDOW_UNTIL', 30 * 60000)
const res = (status, body) => ({ status, ok: status < 400, json: async () => body, text: async () => JSON.stringify(body) })
let refundListCalls = 0, appeared = false, failedOnce = false, openProbes = 0, lastCall = ''

// (c) état disque horodaté — et panne d'écriture injectable à la fermeture
const realWrite = fs.writeFileSync.bind(fs)
fs.writeFileSync = function (file, data, ...rest) {
  const f = path.resolve(String(file))
  if (f === path.resolve(ENVF)) {
    const net = NET()
    if (net.failFirstCloseWrite && appeared && !failedOnce) { failedOnce = true; log('ENVWRITEFAIL ' + Date.now()); const e = new Error('EDQUOT: disk quota exceeded (simulated)'); e.code = 'EDQUOT'; throw e }
    const txt = String(data), kv = (k) => { let v = ''; for (const l of txt.split(/\\r?\\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && m[1] === k) v = m[2] } return v }
    realWrite(file, data, ...rest)
    log('ENVWRITE ' + Date.now() + ' CLAIMS_ENABLED=' + kv('CLAIMS_ENABLED') + ' REFUNDS_ENABLED=' + kv('REFUNDS_ENABLED') + ' CLAIMS_WINDOW_UNTIL=' + kv('CLAIMS_WINDOW_UNTIL') + ' REFUNDS_WINDOW_UNTIL=' + kv('REFUNDS_WINDOW_UNTIL'))
    return
  }
  realWrite(file, data, ...rest)
  if (f === path.resolve(RESTART)) log('RESTART ' + Date.now())
}

const appearNow = (ap) => {
  if (appeared) return
  appeared = true
  log('APPEARED ' + Date.now())
  if (ap.dbPending) realWrite(path.join(ROOT, 'db.json'), JSON.stringify({ ...ap.dbPending, __next: ap.db, __switchAt: Date.now() + (ap.resolveAfterMs || 0) }))
  else if (ap.db) realWrite(path.join(ROOT, 'db.json'), JSON.stringify(ap.db))
}

globalThis.fetch = async (input, init) => {
  const url = new URL(String(input)), method = (init && init.method) || 'GET', net = NET()
  log(method + ' ' + url.host + url.pathname)
  const prev = lastCall; lastCall = url.pathname
  if (url.host === 'app.grubano.com') {
    if (url.pathname === '/version.json') return res(200, net.version || { commit: 'abc1234' + '0'.repeat(33), shortCommit: 'abc1234', branch: 'develop', buildDate: '2026-01-01T00:00:00Z' })
    if (url.pathname === '/api/claims') {
      const isOpen = net.claimsAlwaysOpen || claimsOpen()
      log('CLAIMSPROBE ' + (isOpen ? 'OPEN' : 'CLOSED') + ' ' + Date.now())
      if (isOpen && net.sigtermAfterOpenProbes && ++openProbes === net.sigtermAfterOpenProbes) setTimeout(() => { log('SIGTERM ' + Date.now()); process.emit('SIGTERM') }, 0)
      return isOpen ? res(401, { error: 'Non autorisé' }) : res(403, { error: 'x', gated: true })
    }
    if (url.pathname === '/api/admin/refunds/run') return refundsOpen() ? res(401, { error: 'Non autorisé' }) : res(403, { error: 'x', gated: true })
  }
  if (url.host === 'api.stripe.com') {
    if (method !== 'GET') throw new Error('TEST VIOLATION: non-GET Stripe call ' + method + ' ' + url.pathname)
    if (url.pathname === '/v1/refunds') {
      refundListCalls++
      const ap = net.appear
      const gatesOpenOnDisk = envVal('CLAIMS_ENABLED') === 'true'
      if (ap && !appeared) {
        // 'loop' : au Nᵉ appel de liste · 'late' : premier appel de liste, gates OUVERTES, qui ne suit PAS
        // une sonde (= la relecture après la boucle) · 'afterClose' : seulement une fois refermé.
        const due = ap.mode === 'late' ? (gatesOpenOnDisk && prev !== '/api/admin/refunds/run')
          : ap.mode === 'afterClose' ? (!gatesOpenOnDisk && refundListCalls > 2)
          : refundListCalls > (ap.afterListCalls || 3)
        if (due) appearNow(ap)
      }
      if (ap && appeared) {
        if (!gatesOpenOnDisk && ap.afterCloseError) return res(500, { error: { type: 'api_error' } })
        const data = !gatesOpenOnDisk && ap.afterClose ? ap.afterClose : ap.refunds
        return res(200, { object: 'list', data, has_more: false })
      }
      return res(200, { object: 'list', data: net.refundsBefore || [], has_more: false })
    }
    if (url.pathname === '/v1/payment_intents/${PI_ID}') return res(200, net.pi)
    if (url.pathname === '/v1/balance') return res(200, net.balance)
    if (url.pathname === '/v1/accounts/${DEST}') return res(200, net.account)
  }
  throw new Error('TEST VIOLATION: unexpected network call ' + method + ' ' + url.href)
}
`

const charge = (over: Row = {}) => ({ id: 'ch_test_main', object: 'charge', paid: true, captured: true, amount: 1450, amount_captured: 1450, amount_refunded: 0, refunded: false, disputed: false, application_fee_amount: 116, ...over })
const netOk = (over: Row = {}) => ({
  pi: { id: PI_ID, object: 'payment_intent', livemode: false, status: 'succeeded', amount: 1450, currency: 'eur', application_fee_amount: 116, transfer_data: { destination: DEST }, latest_charge: charge() },
  balance: { object: 'balance', available: [{ amount: 861, currency: 'eur' }], pending: [{ amount: 1334, currency: 'eur' }] },
  account: { id: DEST, object: 'account', settings: { payouts: { schedule: { interval: 'manual' } } } },
  ...over,
})
const RE_OK = { id: 're_test_1', amount: 500, status: 'succeeded' }
/** Le remboursement « apparaît » chez Stripe (1ᵉʳ appel de liste = precheck, 2ᵉ = référence AVANT, 3ᵉ+ = boucle). */
const appear = (refunds: Row[], extra: Row = {}) => ({ afterListCalls: 3, refunds, db: dbPaid(), ...extra })

const roots: string[] = []
afterEach(() => { for (const r of roots.splice(0)) { try { fs.rmSync(r, { recursive: true, force: true }) } catch { /* best-effort */ } } })

const canResolve = (name: string, from: string) => { try { require.resolve(name, { paths: [from] }); return true } catch { return false } }

function mkRoot(o: { env?: string; db?: Db; net?: Row; withNextEnv?: boolean; lock?: Row } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'modeb-main-'))
  roots.push(root)
  fs.mkdirSync(path.join(root, 'home'))
  fs.writeFileSync(path.join(root, '.env.local'), o.env ?? ENV_OK)
  const pdir = path.join(root, 'node_modules', '@prisma', 'client')
  fs.mkdirSync(pdir, { recursive: true })
  fs.writeFileSync(path.join(pdir, 'package.json'), '{"name":"@prisma/client","version":"0.0.0","main":"index.js"}')
  fs.writeFileSync(path.join(pdir, 'index.js'), FAKE_PRISMA)
  if (o.withNextEnv) fs.cpSync(path.join(REPO, 'node_modules', '@next', 'env'), path.join(root, 'node_modules', '@next', 'env'), { recursive: true })
  if (o.lock) { fs.mkdirSync(path.join(root, 'home', '.grubano'), { recursive: true }); fs.writeFileSync(path.join(root, 'home', '.grubano', 'phase2-operator.lock'), JSON.stringify(o.lock)) }
  fs.writeFileSync(path.join(root, 'db.json'), JSON.stringify(o.db ?? dbOk()))
  fs.writeFileSync(path.join(root, 'net.json'), JSON.stringify(o.net ?? netOk()))
  fs.writeFileSync(path.join(root, 'preload.js'), PRELOAD)
  // Isolation : aucun `stripe` (sinon SDK réel + réseau réel) ni `@next/env` inattendu ne doit se résoudre
  // depuis un node_modules ANCÊTRE du répertoire temporaire.
  expect(canResolve('stripe', root), 'un paquet `stripe` se résout depuis un ancêtre de ' + root).toBe(false)
  expect(canResolve('@next/env', root), '@next/env se résout depuis ' + root).toBe(!!o.withNextEnv)
  return root
}

// Seules ces lignes peuvent apparaître dans le journal du faux monde.
const NET_ALLOW = [
  /^GET app\.grubano\.com\/version\.json$/, /^POST app\.grubano\.com\/api\/claims$/, /^POST app\.grubano\.com\/api\/admin\/refunds\/run$/,
  new RegExp('^GET api\\.stripe\\.com/v1/(refunds|balance|payment_intents/' + PI_ID + '|accounts/' + DEST + ')$'),
  /^(APPEARED|DBRESOLVED|RESTART|SIGTERM|ENVWRITEFAIL) \d+$/, /^CLAIMSPROBE (OPEN|CLOSED) \d+$/, /^ENVWRITE \d+ /,
]

function runOp(root: string, mode: 'precheck' | 'window', envOver: Record<string, string> = {}) {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    // L'enfant ne doit RIEN hériter de l'environnement de dev : seuls les FICHIERS de la racine parlent.
    if (v === undefined || /^(NEXTAUTH_|STRIPE_|DATABASE_URL|CLAIMS?_|REFUNDS?_|PHASE2_|ALLOW_PLATFORM|GHOST_|PUNITIVE_|NODE_OPTIONS|NODE_ENV|NODE_PATH|VITEST)/.test(k)) continue
    env[k] = v
  }
  Object.assign(env, {
    PHASE2_APP_ROOT: root, HOME: path.join(root, 'home'), USERPROFILE: path.join(root, 'home'),
    PHASE2_MODEB_ORDER_ID: ORDER_ID, PHASE2_MODEB_AMOUNT_CENTS: '500', PHASE2_MODEB_EXPECT_SHA: 'abc1234',
    PHASE2_MODEB_POLL_MS: '150', PHASE2_MODEB_GRACE_MS: '300', PHASE2_RELOAD_DEADLINE_MS: '5000', PHASE2_RELOAD_INTERVAL_MS: '100', PHASE2_MODEB_WINDOW_MS: String(WINDOW_MS),
  }, envOver)
  const t0 = Date.now()
  const r = spawnSync(process.execPath, ['-r', path.join(root, 'preload.js'), OP_PATH, ...(mode === 'window' ? ['window'] : [])], { env: env as NodeJS.ProcessEnv, encoding: 'utf8', timeout: 90000 })
  const out = (r.stdout || '') + (r.stderr || '')
  const netLog = fs.existsSync(path.join(root, 'net.log')) ? fs.readFileSync(path.join(root, 'net.log'), 'utf8') : ''
  // Débogage : SHOW_OP_OUT=1 imprime la sortie RÉELLE de l'opérateur et son journal.
  if (process.env.SHOW_OP_OUT) console.log(out + '\n--- net.log ---\n' + netLog)
  expect(out).not.toMatch(/TEST VIOLATION/)
  for (const l of netLog.split('\n').filter(Boolean)) expect(NET_ALLOW.some((re) => re.test(l)), 'appel hors liste blanche : ' + l).toBe(true)
  const lines = netLog.split('\n').filter(Boolean)
  const stamp = (prefix: string) => lines.filter((l) => l.startsWith(prefix + ' ')).map((l) => Number(l.split(' ')[1]))
  const envWrites = lines.filter((l) => l.startsWith('ENVWRITE ')).map((l) => {
    const [, ts, ...kv] = l.split(' ')
    return { ts: Number(ts), ...Object.fromEntries(kv.map((x) => x.split('=') as [string, string])) } as Record<string, string | number>
  })
  return {
    status: r.status, out, netLog, t0, envWrites,
    appeared: stamp('APPEARED')[0], dbResolved: stamp('DBRESOLVED')[0], restarts: stamp('RESTART'),
    envAfter: fs.readFileSync(path.join(root, '.env.local'), 'utf8'),
    lockExists: fs.existsSync(path.join(root, 'home', '.grubano', 'phase2-operator.lock')),
    lockText: fs.existsSync(path.join(root, 'home', '.grubano', 'phase2-operator.lock')) ? fs.readFileSync(path.join(root, 'home', '.grubano', 'phase2-operator.lock'), 'utf8') : null,
    restarted: fs.existsSync(path.join(root, 'tmp', 'restart.txt')),
  }
}
const envKey = (txt: string, k: string) => { let v: string | undefined; for (const l of txt.split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m && m[1] === k) v = m[2] } return v }
/** Les quatre clés FERMÉES sur le disque (baux au passé). */
function expectClosedOnDisk(envAfter: string) {
  expect(envKey(envAfter, 'CLAIMS_ENABLED')).toBe('false')
  expect(envKey(envAfter, 'REFUNDS_ENABLED')).toBe('false')
  expect(new Date(envKey(envAfter, 'CLAIMS_WINDOW_UNTIL')!).getTime()).toBeLessThan(Date.now())
  expect(new Date(envKey(envAfter, 'REFUNDS_WINDOW_UNTIL')!).getTime()).toBeLessThan(Date.now())
}
/** Instant de la PREMIÈRE écriture de fermeture sur le disque (un bail remis au passé). */
const firstCloseWrite = (r: ReturnType<typeof runOp>) => r.envWrites.find((w) => {
  const t = new Date(String(w.REFUNDS_WINDOW_UNTIL || 0)).getTime()
  return w.REFUNDS_WINDOW_UNTIL && t < Number(w.ts)
})

// ══ PRECHECK EXÉCUTÉ ═════════════════════════════════════════════════════════════════════════
describe('MODE B — main() EXÉCUTÉ en precheck (lecture seule)', () => {
  it('⭐ état certifié ⇒ READY, 0 anomalie, vue FICHIERS lue, rien écrit, aucun verrou laissé', () => {
    const root = mkRoot()
    const r = runOp(root, 'precheck')
    expect(r.out).toMatch(/NEXTAUTH_URL \(fichiers\): https:\/\/app\.grubano\.com/)   // ← l'étape [1] que l'opérateur livré ne passait JAMAIS
    expect(r.out).toMatch(/DATABASE: grubano_staging/)
    expect(r.out).toMatch(/DEPLOYED SHA: abc1234/)
    expect(r.out).toMatch(/CLAIMS GATE \(avant\): CLOSED/)
    expect(r.out).toMatch(/REFUNDS GATE \(avant\): CLOSED/)
    expect(r.out).toMatch(/STRIPE CLIENT: REST lecture seule/)                       // pas de SDK dans la racine ⇒ parité standalone
    expect(r.out).toMatch(/CONNECTED AVAILABLE \(EUR c\): 861 · pending 1334/)
    expect(r.out).toMatch(/RESULT = READY FOR FOUNDER AUTHORIZATION/)
    expect(r.out).toMatch(/ANOMALIES = none/)
    expect(r.status).toBe(0)
    expect(r.envAfter).toBe(ENV_OK)          // precheck : AUCUNE écriture
    expect(r.envWrites).toEqual([])
    expect(r.restarted).toBe(false)
    expect(r.lockExists).toBe(false)
  }, 60000)

  it('⭐ branche SERVEUR du chargeur (@next/env présent, comme le standalone) : CRLF + valeur entre guillemets + « / » final ⇒ READY', () => {
    const env = ['NEXTAUTH_URL="https://app.grubano.com/"', 'STRIPE_SECRET_KEY=sk_test_mainharness', 'DATABASE_URL="mysql://u:p@localhost:3306/grubano_staging"', 'CLAIMS_ENABLED=false', 'REFUNDS_ENABLED=false', ''].join('\r\n')
    const r = runOp(mkRoot({ env, withNextEnv: true }), 'precheck')
    expect(r.out).toMatch(/NEXTAUTH_URL \(fichiers\): https:\/\/app\.grubano\.com\s*$/m)
    expect(r.out).not.toMatch(/diverge des fichiers/)
    expect(r.out).toMatch(/RESULT = READY FOR FOUNDER AUTHORIZATION/)
    expect(r.status).toBe(0)
  }, 60000)

  it('NEXTAUTH_URL des FICHIERS = production ⇒ FAIL avant tout appel réseau, verrou RENDU', () => {
    const root = mkRoot({ env: ENV_OK.replace('https://app.grubano.com', 'https://grubano.com') })
    const r = runOp(root, 'precheck')
    expect(r.out).toMatch(/NEXTAUTH_URL des FICHIERS n’est pas https:\/\/app\.grubano\.com/)
    expect(r.out).toMatch(/RESULT = FAIL/)
    expect(r.status).toBe(1)
    expect(r.netLog).toBe('')
    expect(r.lockExists).toBe(false)         // un refus précoce laissait le verrou derrière lui
  }, 60000)

  it('NEXTAUTH_URL du SHELL divergent ⇒ FAIL (on ne se laisse pas déplacer de cible)', () => {
    const r = runOp(mkRoot(), 'precheck', { NEXTAUTH_URL: 'https://grubano.com' })
    expect(r.out).toMatch(/diverge des fichiers/)
    expect(r.status).toBe(1)
    expect(r.lockExists).toBe(false)
  }, 60000)

  it('fichiers .env sans aucune clé lisible ⇒ FAIL « vue FICHIERS vide » (jamais un défaut silencieux)', () => {
    const r = runOp(mkRoot({ env: '# rien\n' }), 'precheck', { STRIPE_SECRET_KEY: 'sk_test_fromshell' })
    expect(r.out).toMatch(/vue FICHIERS vide, rien n’est prouvable/)
    expect(r.out).toMatch(/RESULT = FAIL/)
    expect(r.status).toBe(1)
  }, 60000)

  it('⭐ verrou d’un AUTRE opérateur VIVANT ⇒ refus, et ce verrou-là n’est PAS retiré', () => {
    const lock = { pid: process.pid, op: 'phase2-refund-gate', at: new Date().toISOString() }   // le worker vitest est vivant
    const r = runOp(mkRoot({ lock }), 'precheck')
    expect(r.out).toMatch(/0 lock: un autre opérateur phase2 tourne déjà/)
    expect(r.status).toBe(1)
    expect(r.netLog).toBe('')
    expect(r.lockText && JSON.parse(r.lockText)).toEqual(lock)
  }, 60000)

  it('verrou PÉRIMÉ (pid mort) ⇒ récupéré, precheck READY, verrou rendu', () => {
    const r = runOp(mkRoot({ lock: { pid: 999999, op: 'phase2-modeb-gate', at: '2026-01-01T00:00:00Z' } }), 'precheck')
    expect(r.out).toMatch(/STALE OPERATOR LOCK: pid 999999/)
    expect(r.out).toMatch(/RESULT = READY/)
    expect(r.lockExists).toBe(false)
  }, 60000)

  it.each([
    ['SHA déployé ≠ SHA certifié', {}, { PHASE2_MODEB_EXPECT_SHA: 'fffffff' }, /n’est pas le SHA certifié attendu/, 'FAIL'],
    ['drapeau dangereux armé', { env: ENV_OK + 'REFUND_VOID_ENABLED=true\n' }, {}, /REFUND_VOID_ENABLED est ACTIF/, 'BLOCKED'],
    ['gate CLAIMS déjà ouverte', { net: netOk({ claimsAlwaysOpen: true }) }, {}, /la gate CLAIMS n’est pas CLOSED/, 'BLOCKED'],
    ['réclamation ACTIVE sur la commande', { db: dbOk({ claims: [claimRow({ status: 'arbitration', refundId: null, refundAttempted: false })] }) }, {}, /réclamation ACTIVE existe déjà/, 'BLOCKED'],
    ['ligne Refund « pending » préexistante', { db: dbOk({ refunds: [refundRow({ status: 'pending', stripeRefundId: null })] }) }, {}, /ligne\(s\) « pending » préexistante/, 'BLOCKED'],
    ['objet remboursement Stripe déjà présent', { net: netOk({ refundsBefore: [{ id: 're_old', amount: 500, status: 'succeeded' }] }) }, {}, /n’est plus une première répétition/, 'BLOCKED'],
    ['commande hors fenêtre de réclamation (49 h)', { db: dbOk({}, { updatedAtAgoH: 49 }) }, {}, /hors fenêtre de réclamation/, 'BLOCKED'],
    ['fenêtre de réclamation sans marge (47,5 h)', { db: dbOk({}, { updatedAtAgoH: 47.5 }) }, {}, /trop proche de l’expiration/, 'BLOCKED'],
    ['Order.updatedAt illisible', { db: dbOk({}, { updatedAtAgoH: null }) }, {}, /fenêtre de réclamation NON PROUVÉE/, 'BLOCKED'],
    ['solde connecté insuffisant', { net: netOk({ balance: { object: 'balance', available: [{ amount: 100, currency: 'eur' }], pending: [] } }) }, {}, /solde connecté disponible 100 c < BRUT 500 c/, 'BLOCKED'],
  ] as const)('%s ⇒ refus, rien écrit', (_name, rootOpts, envOver, anomaly, verdict) => {
    const root = mkRoot(rootOpts as Parameters<typeof mkRoot>[0])
    const before = fs.readFileSync(path.join(root, '.env.local'), 'utf8')
    const r = runOp(root, 'precheck', envOver as Record<string, string>)
    expect(r.out).toMatch(anomaly)
    expect(r.out).toMatch(new RegExp('RESULT = ' + verdict))
    expect(r.status).toBe(1)
    expect(r.envAfter).toBe(before)
    expect(r.lockExists).toBe(false)
  }, 60000)

  it('CLAIM_WINDOW_HOURS est lu comme l’APPLICATION le lit (parseInt) : « 72h » = 72, « abc » = 48', () => {
    const r72 = runOp(mkRoot({ env: ENV_OK + 'CLAIM_WINDOW_HOURS=72h\n', db: dbOk({}, { updatedAtAgoH: 60 }) }), 'precheck')
    expect(r72.out).toMatch(/CLAIM WINDOW: âge 60\.0 h \/ fenêtre 72 h/)
    expect(r72.out).toMatch(/RESULT = READY/)
    const rBad = runOp(mkRoot({ env: ENV_OK + 'CLAIM_WINDOW_HOURS=abc\n', db: dbOk({}, { updatedAtAgoH: 60 }) }), 'precheck')
    expect(rBad.out).toMatch(/fenêtre 48 h/)
    expect(rBad.out).toMatch(/hors fenêtre de réclamation/)      // avant : Number('abc') = NaN ⇒ jamais signalé
  }, 90000)
})

// ══ CE QUE LE FAUX PRISMA NE PEUT PAS PROUVER : les champs existent dans le VRAI schéma ═══════
describe('MODE B — chaque requête Prisma de l’opérateur ne lit que des champs du VRAI schéma, modèle par modèle', () => {
  it('select ET where de chaque appel prisma.<modèle>.<méthode>(…) ⊆ champs de ce modèle dans prisma/schema.prisma', () => {
    const schema = fs.readFileSync(path.join(REPO, 'prisma', 'schema.prisma'), 'utf8').replace(/\r/g, '')
    const fieldsOf = (name: string) => {
      const start = schema.indexOf('\nmodel ' + name + ' {')
      expect(start, 'modèle ' + name).toBeGreaterThan(-1)
      return new Set(schema.slice(start, schema.indexOf('\n}', start)).split('\n').slice(2).map((l) => l.trim().split(/\s+/)[0]).filter(Boolean))
    }
    const MODEL: Record<string, string> = { order: 'Order', claim: 'Claim', refund: 'Refund' }
    const src = fs.readFileSync(OP_PATH, 'utf8')
    // clés de premier niveau d'un objet littéral commençant à `open` (l'accolade ouvrante)
    const topKeys = (s: string, open: number) => {
      const keys: string[] = []; let depth = 0
      for (let i = open; i < s.length; i++) {
        const ch = s[i]
        if (ch === '{' || ch === '[' || ch === '(') depth++
        else if (ch === '}' || ch === ']' || ch === ')') { depth--; if (depth === 0) break }
        else if (depth === 1) { const m = s.slice(i).match(/^([A-Za-z_]\w*)\s*:/); if (m && /[{,\s]/.test(s[i - 1])) { keys.push(m[1]); i += m[0].length - 1 } }
      }
      return keys
    }
    const calls = Array.from(src.matchAll(/prisma\.(order|claim|refund)\.(findUnique|findMany|count)\(\{/g))
    expect(calls.length).toBeGreaterThanOrEqual(10)
    let checked = 0
    for (const c of calls) {
      const fields = fieldsOf(MODEL[c[1]])
      const argStart = c.index! + c[0].length - 1
      const argKeys = topKeys(src, argStart)
      for (const part of ['select', 'where']) {
        if (!argKeys.includes(part)) continue
        const at = src.indexOf(part + ':', argStart)
        for (const k of topKeys(src, src.indexOf('{', at))) { expect(fields.has(k), c[1] + '.' + part + '.' + k).toBe(true); checked++ }
      }
    }
    expect(checked).toBeGreaterThan(25)
    expect(schema).toMatch(/datasource db \{/)   // main() construit PrismaClient({ datasources: { db: … } })
  })
})

// ══ FENÊTRE EXÉCUTÉE ═════════════════════════════════════════════════════════════════════════
describe('MODE B — main() EXÉCUTÉ en mode window (ouvre, observe Stripe, referme, prouve)', () => {
  it('sans la phrase d’autorisation ⇒ FAIL, rien écrit, aucun redémarrage, verrou rendu', () => {
    const root = mkRoot()
    const r = runOp(root, 'window')
    expect(r.out).toMatch(/phrase d’autorisation absente ou incorrecte/)
    expect(r.status).toBe(1)
    expect(r.envAfter).toBe(ENV_OK)
    expect(r.restarted).toBe(false)
    expect(r.lockExists).toBe(false)
  }, 60000)

  it('anomalie au precheck ⇒ FENÊTRE REFUSÉE, .env.local octet pour octet, aucun redémarrage', () => {
    const root = mkRoot({ net: netOk({ refundsBefore: [{ id: 're_old', amount: 500, status: 'succeeded' }] }) })
    const r = runOp(root, 'window', { PHASE2_MODEB_CONFIRM: SENTENCE })
    expect(r.out).toMatch(/FENÊTRE REFUSÉE, rien changé/)
    expect(r.envAfter).toBe(ENV_OK)
    expect(r.envWrites).toEqual([])
    expect(r.restarted).toBe(false)
    expect(r.lockExists).toBe(false)
  }, 60000)

  it('⭐ chemin nominal : UN remboursement de 500 c payé PAR la réclamation ⇒ PASS ; baux posés AVANT les drapeaux, égaux, bornés ; tout refermé', () => {
    const root = mkRoot({ net: netOk({ appear: appear([RE_OK]) }) })
    const r = runOp(root, 'window', { PHASE2_MODEB_CONFIRM: SENTENCE })
    expect(r.out).toMatch(/GATES APRÈS OUVERTURE: claims OPEN · refunds OPEN/)
    expect(r.out).toMatch(/FENÊTRE: OUVERTE à /)
    expect(r.out).toMatch(/REFUND OBSERVED \(Stripe\): re_test_1…:succeeded:500$/m)
    expect(r.out).toMatch(/SETTLE BEFORE CLOSE/)
    expect(r.out).toMatch(/GATES APRÈS FERMETURE: claims CLOSED · refunds CLOSED/)
    expect(r.out).toMatch(/STRIPE REFUNDS AFTER: re_test_1…:succeeded:500/)
    expect(r.out).toMatch(/AFTER · REFUND ROWS: rf_row_1…:succeeded:500/)
    expect(r.out).toMatch(/AFTER · CLAIMS: clm_test_1…:refunded/)
    expect(r.out).toMatch(/RESULT = PASS/)
    expect(r.out).toMatch(/ANOMALIES = none/)
    expect(r.status).toBe(0)
    expectClosedOnDisk(r.envAfter)
    expect(envKey(r.envAfter, 'NEXTAUTH_URL')).toBe('https://app.grubano.com')   // les autres clés sont intactes
    expect(r.restarts.length).toBe(2)                                               // ouverture + fermeture
    expect(r.lockExists).toBe(false)
    // ── BAUX, sur le disque : posés AVANT toute ouverture de drapeau, identiques, bornés
    const firstOpen = r.envWrites.findIndex((w) => w.CLAIMS_ENABLED === 'true' || w.REFUNDS_ENABLED === 'true')
    expect(firstOpen).toBeGreaterThan(0)
    const atOpen = r.envWrites[firstOpen - 1]
    expect(atOpen.CLAIMS_WINDOW_UNTIL).toBeTruthy()
    expect(atOpen.CLAIMS_WINDOW_UNTIL).toBe(atOpen.REFUNDS_WINDOW_UNTIL)
    const leaseMs = new Date(String(atOpen.CLAIMS_WINDOW_UNTIL)).getTime() - Number(atOpen.ts)
    expect(leaseMs).toBeGreaterThan(WINDOW_MS)
    expect(leaseMs).toBeLessThanOrEqual(WINDOW_MS + 2 * 60000 + 2000)                 // fenêtre + 2 min, jamais plus
    expect(leaseMs).toBeLessThanOrEqual(30 * 60000)
    expect(r.netLog).not.toMatch(/^(POST|PUT|DELETE|PATCH) api\.stripe\.com/m)       // l'opérateur ne mute JAMAIS Stripe
  }, 90000)

  it('⭐ GRÂCE, sur le DISQUE : ni écriture de fermeture ni redémarrage dans l’instant où Stripe montre le remboursement', () => {
    const r = runOp(mkRoot({ net: netOk({ appear: appear([RE_OK]) }) }), 'window', { PHASE2_MODEB_CONFIRM: SENTENCE, PHASE2_MODEB_GRACE_MS: '2500' })
    expect(r.out).toMatch(/GRACE BEFORE CLOSE: 3 s/)
    expect(r.out).toMatch(/RESULT = PASS/)
    expect(r.appeared).toBeGreaterThan(0)
    const close = firstCloseWrite(r)
    expect(close, 'aucune écriture de fermeture trouvée').toBeTruthy()
    expect(Number(close!.ts) - r.appeared).toBeGreaterThanOrEqual(2400)
    expect(r.restarts.length).toBe(2)
    expect(r.restarts[1] - r.appeared).toBeGreaterThanOrEqual(2400)
  }, 90000)

  it('⭐ remboursement créé APRÈS la dernière lecture de la boucle ⇒ relu, et il reçoit QUAND MÊME la grâce', () => {
    const r = runOp(mkRoot({ net: netOk({ appear: appear([RE_OK], { mode: 'late' }) }) }), 'window', { PHASE2_MODEB_CONFIRM: SENTENCE, PHASE2_MODEB_WINDOW_MS: '1500', PHASE2_MODEB_GRACE_MS: '2500' })
    expect(r.out).toMatch(/REFUND OBSERVED \(Stripe\): re_test_1…:succeeded:500 \(vu APRÈS la dernière lecture de la boucle\)/)
    expect(r.out).toMatch(/GRACE BEFORE CLOSE: 3 s/)
    expect(r.out).toMatch(/RESULT = PASS/)
    expect(Number(firstCloseWrite(r)!.ts) - r.appeared).toBeGreaterThanOrEqual(2400)
  }, 90000)

  it('⭐ RÈGLE 5 — tentative EN COURS (ligne « pending », réclamation « refunding ») : AUCUNE fermeture ni redémarrage avant qu’elle soit résolue', () => {
    const dbPending = dbOk({ claims: [claimRow({ status: 'refunding', refundId: null })], refunds: [refundRow({ status: 'pending', stripeRefundId: null })] })
    const r = runOp(mkRoot({ net: netOk({ appear: appear([RE_OK], { dbPending, resolveAfterMs: 3000 }) }) }), 'window', { PHASE2_MODEB_CONFIRM: SENTENCE })
    expect(r.dbResolved, 'le faux moteur n’a jamais résolu').toBeGreaterThan(0)
    const close = firstCloseWrite(r)
    expect(Number(close!.ts)).toBeGreaterThanOrEqual(r.dbResolved)                  // fermeture APRÈS la résolution
    expect(r.restarts[1]).toBeGreaterThanOrEqual(r.dbResolved)                       // redémarrage APRÈS la résolution
    expect(r.out).toMatch(/SETTLE BEFORE CLOSE/)
    expect(r.out).toMatch(/RESULT = PASS/)
  }, 90000)

  it('⭐ tentative vue seulement PENDANT LE RÈGLEMENT (objet Stripe pas encore visible) ⇒ attente de résolution PUIS grâce, avant toute fermeture', () => {
    const dbPending = dbOk({ claims: [claimRow({ status: 'refunding', refundId: null })], refunds: [refundRow({ status: 'pending', stripeRefundId: null })] })
    const ap = appear([], { mode: 'late', dbPending, resolveAfterMs: 3000, afterClose: [RE_OK] })
    const r = runOp(mkRoot({ net: netOk({ appear: ap }) }), 'window', { PHASE2_MODEB_CONFIRM: SENTENCE, PHASE2_MODEB_WINDOW_MS: '1500', PHASE2_MODEB_GRACE_MS: '2500' })
    expect(r.out).toMatch(/AUCUN nouvel objet Stripe pendant la fenêtre/)
    expect(r.out).toMatch(/GRACE BEFORE CLOSE: 3 s — une tentative vient de se résoudre pendant le règlement/)
    expect(r.dbResolved).toBeGreaterThan(0)
    expect(Number(firstCloseWrite(r)!.ts) - r.dbResolved).toBeGreaterThanOrEqual(2400)   // résolue, PUIS la grâce, PUIS la fermeture
    expect(r.out).toMatch(/STRIPE REFUNDS AFTER: re_test_1…:succeeded:500/)
    expect(r.out).toMatch(/RESULT = PASS/)
  }, 90000)

  it('⭐ une ligne Refund apparue SANS objet Stripe (rejet) ⇒ FAIL « état NON RÉSOLU », jamais NOT EXECUTED', () => {
    const db = dbOk({ refunds: [refundRow({ status: 'failed', stripeRefundId: null })] })
    const r = runOp(mkRoot({ net: netOk({ appear: { mode: 'afterClose', refunds: [], db } }) }), 'window', { PHASE2_MODEB_CONFIRM: SENTENCE, PHASE2_MODEB_WINDOW_MS: '2500' })
    expect(r.out).toContain('12 db: 1 nouvelle(s) ligne(s) Refund SANS objet Stripe observé — état NON RÉSOLU')
    expect(r.out).toMatch(/RESULT = FAIL/)
    expectClosedOnDisk(r.envAfter)
  }, 90000)

  it('⭐ le verdict relit Stripe APRÈS la fermeture : la boucle voit UN objet, la relecture en montre DEUX ⇒ FAIL', () => {
    const r = runOp(mkRoot({ net: netOk({ appear: appear([RE_OK], { afterClose: [RE_OK, { id: 're_test_2', amount: 500, status: 'succeeded' }] }) }) }), 'window', { PHASE2_MODEB_CONFIRM: SENTENCE })
    expect(r.out).toMatch(/REFUND OBSERVED \(Stripe\): re_test_1…:succeeded:500$/m)
    expect(r.out).toMatch(/2 objets remboursement Stripe sur la PI — la répétition en autorise UN SEUL/)
    expect(r.out).toMatch(/RESULT = FAIL/)
    expectClosedOnDisk(r.envAfter)
  }, 90000)

  it('⭐ « pending » pendant la fenêtre puis « succeeded » après fermeture ⇒ le verdict suit la vérité FINALE (PASS)', () => {
    const r = runOp(mkRoot({ net: netOk({ appear: appear([{ ...RE_OK, status: 'pending' }], { afterClose: [RE_OK] }) }) }), 'window', { PHASE2_MODEB_CONFIRM: SENTENCE })
    expect(r.out).toMatch(/REFUND STATUS TRUTH: au moins un remboursement n’est PAS « succeeded »/)
    expect(r.out).toMatch(/STRIPE REFUNDS AFTER: re_test_1…:succeeded:500/)
    expect(r.out).toMatch(/RESULT = PASS/)
  }, 90000)

  it('⭐ énumération Stripe FINALE illisible ⇒ issue NON PROUVÉE (FAIL), gates quand même refermées', () => {
    const r = runOp(mkRoot({ net: netOk({ appear: appear([RE_OK], { afterCloseError: true }) }) }), 'window', { PHASE2_MODEB_CONFIRM: SENTENCE })
    expect(r.out).toMatch(/11 verdict: énumération Stripe finale illisible\/ambiguë/)
    expect(r.out).toMatch(/RESULT = FAIL/)
    expectClosedOnDisk(r.envAfter)
  }, 90000)

  it('⭐ un remboursement de 500 c qui n’est PAS payé par la réclamation (Dashboard / rail direct) ⇒ FAIL, jamais PASS', () => {
    const r = runOp(mkRoot({ net: netOk({ appear: appear([RE_OK], { db: dbOk() }) }) }), 'window', { PHASE2_MODEB_CONFIRM: SENTENCE })
    expect(r.out).toMatch(/12 db: 0 nouvelle\(s\) ligne\(s\) Refund — la répétition en attend EXACTEMENT UNE/)
    expect(r.out).toMatch(/RESULT = FAIL/)
  }, 90000)

  it.each([
    ['ligne sans l’identité de la réclamation (reason)', dbPaid({}, { reason: 'admin:orders/[id]/refund' }), /ne porte PAS l’identité de la réclamation/],
    ['réclamation liée à une AUTRE ligne', dbPaid({ refundId: 'rf_other' }), /n’est PAS liée à la ligne Refund/],
    ['ligne qui ne porte pas l’id Stripe observé', dbPaid({}, { stripeRefundId: 're_elsewhere' }), /jointure ligne ↔ Stripe NON PROUVÉE/],
    ['réclamation restée « approved » avec une erreur', dbPaid({ status: 'approved', refundError: 'engine_failed: x' }), /la réclamation est « approved », pas « refunded »/],
  ] as const)('⭐ jointure DB rompue — %s ⇒ FAIL', (_n, db, anomaly) => {
    const r = runOp(mkRoot({ net: netOk({ appear: appear([RE_OK], { db }) }) }), 'window', { PHASE2_MODEB_CONFIRM: SENTENCE })
    expect(r.out).toMatch(anomaly)
    expect(r.out).toMatch(/RESULT = FAIL/)
  }, 90000)

  it('⭐ rien ne se passe pendant la fenêtre ⇒ « NOT EXECUTED » (jamais PASS), gates refermées', () => {
    const r = runOp(mkRoot(), 'window', { PHASE2_MODEB_CONFIRM: SENTENCE, PHASE2_MODEB_WINDOW_MS: '2500' })
    expect(r.out).toMatch(/AUCUN nouvel objet Stripe pendant la fenêtre/)
    expect(r.out).toMatch(/STRIPE REFUNDS AFTER: 0/)
    expect(r.out).toMatch(/RESULT = NOT EXECUTED/)
    expect(r.out).not.toMatch(/RESULT = PASS/)
    expect(r.status).toBe(1)
    expectClosedOnDisk(r.envAfter)
    expect(r.lockExists).toBe(false)
  }, 90000)

  it('⭐ fenêtre expirée avec une réclamation déposée mais NON approuvée ⇒ FAIL « réclamation ACTIVE laissée » (pas un simple NOT EXECUTED)', () => {
    // la réclamation apparaît pendant la fenêtre (déposée, acceptée), l'approbation n'arrive jamais
    const db = dbOk({ claims: [claimRow({ status: 'arbitration', refundId: null, refundAttempted: false })] })
    const r = runOp(mkRoot({ net: netOk({ appear: { mode: 'afterClose', refunds: [], db } }) }), 'window', { PHASE2_MODEB_CONFIRM: SENTENCE, PHASE2_MODEB_WINDOW_MS: '2500' })
    expect(r.out).toMatch(/12 db: 1 réclamation\(s\) ACTIVE\(S\) laissée\(s\) sur la commande \(arbitration\)/)
    expect(r.out).toMatch(/RESULT = FAIL/)
    expectClosedOnDisk(r.envAfter)
  }, 90000)

  it.each([
    ['montant ≠ montant autorisé (1450 c)', [{ id: 're_test_1', amount: 1450, status: 'succeeded' }], /de 1450 c ≠ montant autorisé 500 c/],
    ['remboursement « pending » chez Stripe', [{ id: 're_test_1', amount: 500, status: 'pending' }], /« pending » — PAS un succès/],
    ['DEUX remboursements', [RE_OK, { id: 're_test_2', amount: 500, status: 'succeeded' }], /2 objets remboursement Stripe sur la PI — la répétition en autorise UN SEUL/],
  ] as const)('⭐ %s ⇒ FAIL (jamais PASS), et les gates sont QUAND MÊME refermées', (_n, refunds, anomaly) => {
    const r = runOp(mkRoot({ net: netOk({ appear: appear(refunds as unknown as Row[]) }) }), 'window', { PHASE2_MODEB_CONFIRM: SENTENCE })
    expect(r.out).toMatch(anomaly)
    expect(r.out).toMatch(/RESULT = FAIL/)
    expect(r.status).toBe(1)
    expect(r.out).toMatch(/GATES APRÈS FERMETURE: claims CLOSED · refunds CLOSED/)
    expectClosedOnDisk(r.envAfter)
    expect(r.lockExists).toBe(false)
  }, 90000)

  it('⭐ écriture de fermeture en ÉCHEC (quota disque) ⇒ la fermeture d’urgence reprend clé par clé : tout est fermé, FAIL', () => {
    const r = runOp(mkRoot({ net: netOk({ appear: appear([RE_OK]), failFirstCloseWrite: true }) }), 'window', { PHASE2_MODEB_CONFIRM: SENTENCE })
    expect(r.netLog).toMatch(/^ENVWRITEFAIL /m)
    expect(r.out).toMatch(/10 refreeze: EDQUOT/)
    expect(r.out).toMatch(/EMERGENCY CLOSE — les quatre clés sont fermées sur le disque/)
    expect(r.out).toMatch(/GATES APRÈS FERMETURE D’URGENCE: claims CLOSED · refunds CLOSED/)
    expect(r.out).toMatch(/RESULT = FAIL/)
    expectClosedOnDisk(r.envAfter)
    expect(r.lockExists).toBe(false)
  }, 90000)

  it('⭐ SIGTERM pendant la fenêtre ⇒ fermeture d’urgence : quatre clés fermées, redémarrage, verrou RENDU, sortie 1', () => {
    const r = runOp(mkRoot({ net: netOk({ sigtermAfterOpenProbes: 2 }) }), 'window', { PHASE2_MODEB_CONFIRM: SENTENCE })
    expect(r.netLog).toMatch(/^SIGTERM /m)
    expect(r.out).toMatch(/EMERGENCY CLOSE — les quatre clés sont fermées sur le disque/)
    expect(r.out).not.toMatch(/RESULT = /)                      // le processus est sorti par le gestionnaire de signal
    expect(r.status).toBe(1)
    expectClosedOnDisk(r.envAfter)
    expect(r.restarts.length).toBe(2)
    expect(r.lockExists).toBe(false)
  }, 90000)
})
