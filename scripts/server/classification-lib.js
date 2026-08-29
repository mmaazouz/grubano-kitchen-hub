'use strict'
/* Lib partagée des scripts de lecture pré-clean-room (classification + évidence).
   Source de vérité UNIQUE des règles de provenance et de la NUMÉROTATION stable :
   opérateurs et restaurants sont toujours triés (createdAt ASC, id ASC) avant
   numérotation → USER#N / RESTAURANT#N identiques d'un script et d'un run à l'autre. */

const CUID_RE = /^c[a-z0-9]{24}$/
const mask = (v) => { if (!v) return null; const i = String(v).indexOf('_'); return i > 0 ? `${String(v).slice(0, i + 1)}***${String(v).slice(-4)}` : '***' + String(v).slice(-4) }
const maskEmail = (e) => { if (!e) return null; const [l, d] = String(e).split('@'); return `${l.slice(0, 2)}***@${d || '?'}` }
const shortId = (id) => String(id).slice(0, 8) + '…'
const d = (x) => (x ? new Date(x).toISOString().slice(0, 10) : '—')

// Preuves versionnées : commit fcbbfd0 + scripts/seed-demo-data.js + scripts/qa/*
const COMPROMISED_EMAILS = new Set([
  'test@grubano.com', 'resto@grubano.com', 'resto2@grubano.com',
  'franchise@grubano.com', 'createur@grubano.com',
  'demo-franchiseur1@grubano.com', 'demo-franchiseur2@grubano.com',
])
const QA_NAMES = new Set(['QA Bistro', 'QA Trattoria', 'QA Metro Fournisseur', 'QA Loyal', 'QA Operator', 'QA Beta Trattoria'])
const isQaEmail = (e) => !!e && (e.endsWith('@grubano.test') || e.includes('+qa'))
const isDemoId = (id) => String(id).startsWith('demo-')
const isCuid = (id) => CUID_RE.test(String(id))

function classifyOperator(op, roleSet) {
  if ((roleSet && roleSet.has('admin')) || op.role === 'admin') return 'ADMIN'
  if (COMPROMISED_EMAILS.has(op.email)) return 'TEST_PROVED'
  if (isDemoId(op.id)) return 'TEST_PROVED'
  if (isQaEmail(op.email)) return 'TEST_PROVED'
  if (!isCuid(op.id)) return 'TEST_HIGH'
  return 'UNKNOWN'
}
function classifyRestaurant(r, ownerClass) {
  if (isDemoId(r.id)) return 'TEST_PROVED'
  if (QA_NAMES.has(r.name)) return 'TEST_PROVED'
  if (ownerClass === 'TEST_PROVED') return 'TEST_PROVED'
  if (!isCuid(r.id)) return 'TEST_HIGH'
  if (ownerClass === 'TEST_HIGH') return 'TEST_HIGH'
  return 'UNKNOWN'
}

// Tri STABLE avant numérotation (jamais l'ordre par défaut de la base).
const stableSort = (rows) => [...rows].sort((a, b) => {
  const ta = new Date(a.createdAt).getTime(), tb = new Date(b.createdAt).getTime()
  return ta !== tb ? ta - tb : String(a.id).localeCompare(String(b.id))
})

/* Numérote opérateurs et restaurants exactement comme classification-read :
   compteur PAR CLASSE pour les opérateurs (ADMIN#n / TESTUSER#n / USER#n),
   compteur GLOBAL séquentiel pour les restaurants (RESTAURANT#n). */
function numberEntities(ops, roleSets, restos) {
  const opClass = new Map(), opPseudo = new Map()
  const counters = { ADMIN: 0, TEST_PROVED: 0, TEST_HIGH: 0, UNKNOWN: 0 }
  for (const op of stableSort(ops)) {
    const c = classifyOperator(op, roleSets.get(op.id) || new Set())
    opClass.set(op.id, c); counters[c]++
    opPseudo.set(op.id, (c === 'ADMIN' ? 'ADMIN#' : c === 'UNKNOWN' ? 'USER#' : 'TESTUSER#') + counters[c])
  }
  const restoClass = new Map(), restoPseudo = new Map()
  let rn = 0
  for (const r of stableSort(restos)) {
    const c = classifyRestaurant(r, opClass.get(r.operatorId) || 'UNKNOWN')
    restoClass.set(r.id, c); rn++
    restoPseudo.set(r.id, 'RESTAURANT#' + rn)
  }
  return { opClass, opPseudo, counters, restoClass, restoPseudo }
}

module.exports = { CUID_RE, mask, maskEmail, shortId, d, COMPROMISED_EMAILS, QA_NAMES, isQaEmail, isDemoId, isCuid, classifyOperator, classifyRestaurant, stableSort, numberEntities }
