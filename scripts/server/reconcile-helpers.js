'use strict'
/* ─────────────────────────────────────────────────────────────────────────────
   scripts/server/reconcile-helpers.js — execution plumbing for the DIRECT financial
   reconciliation run by scripts/server/phase2-preflight.js on the staging server.
   Pure helpers, fully unit-tested (tests/reconcile-helpers.test.ts). READ-ONLY by design.

   Why this file exists (v4 regression, measured 2026-09-05):
     • v4 built its own env view and never populated process.env → PrismaClient (schema:
       url = env("DATABASE_URL")) had no URL. v3 had populated it. Fix: load env EXACTLY like
       the deployed app does — through @next/env (present in the standalone node_modules) —
       and hand Prisma the URL explicitly (datasources.db.url) so nothing depends on ambient env.
     • the `stripe` npm package is NOT in the standalone runtime (Next bundles it into the route
       chunks; only serverComponentsExternalPackages = ['@prisma/client'] stays external). Fix:
       a minimal READ-ONLY Stripe REST client (GET only, api.stripe.com pinned) exposing the two
       calls lib/ledger-check-core.js needs — paymentIntents.list / refunds.list with
       autoPagingToArray — plus paymentIntents.retrieve for window-edge classification.
   ───────────────────────────────────────────────────────────────────────────── */

const path = require('path')

/** Resolve a module the way the deployed app would (from APP_ROOT/node_modules). */
function resolveFromApp(name, appRoot, req) {
  const r = req || require
  try { return { ok: true, path: r.resolve(name, { paths: [appRoot] }) } } catch (e) { return { ok: false, error: e && e.code ? e.code : 'ERR' } }
}

/**
 * Load the runtime env like the deployed Next app (@next/env: .env.production.local ›
 * .env.local › .env.production › .env ; pre-existing process.env never overridden).
 * Falls back to a dotenv merge (same order) populating process.env WITHOUT overriding.
 * Returns { loader, filesLoaded } — never any value.
 */
function loadRuntimeEnv(appRoot, opts) {
  const o = opts || {}
  const req = o.require || require
  const env = o.env || process.env
  const res = resolveFromApp('@next/env', appRoot, req)
  if (res.ok && !o.forceFallback) {
    const nextEnv = req(res.path)
    const quiet = { info() {}, warn() {}, error() {} }
    // dev=false → production file set. forceReload=true so a cached earlier load never wins.
    const r = nextEnv.loadEnvConfig(appRoot, false, quiet, true)
    return { loader: '@next/env (' + path.relative(appRoot, res.path).split(path.sep).join('/') + ')', filesLoaded: (r && r.loadedEnvFiles ? r.loadedEnvFiles.map((f) => f.path) : []) }
  }
  const prov = o.prov || require(path.join(__dirname, 'env-provenance.js'))
  const fs = o.fs || require('fs')
  const texts = prov.readNextEnvFiles(fs, path, appRoot)
  const merged = prov.mergeNextEnvFiles(texts).merged
  for (const [k, v] of Object.entries(merged)) if (typeof env[k] === 'undefined') env[k] = v
  return { loader: 'fallback dotenv merge (same order, no override)', filesLoaded: Object.keys(texts) }
}

/** Presence facts only — never a value. */
function envFacts(env) {
  const e = env || process.env
  const key = e.STRIPE_SECRET_KEY || ''
  return {
    databaseUrl: !!(e.DATABASE_URL && e.DATABASE_URL.length),
    stripeKey: !!key.length,
    stripeMode: key.startsWith('sk_test_') ? 'TEST' : (key.startsWith('sk_live_') ? 'LIVE' : 'ABSENT/UNKNOWN'),
  }
}

// ── Minimal READ-ONLY Stripe REST client ─────────────────────────────────────────
const STRIPE_API_DEFAULT = 'https://api.stripe.com'

function encodeParams(params, prefix) {
  const parts = []
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue
    const name = prefix ? prefix + '[' + k + ']' : k
    if (typeof v === 'object' && !Array.isArray(v)) parts.push(encodeParams(v, name))
    else if (Array.isArray(v)) v.forEach((x, i) => parts.push(encodeURIComponent(name + '[' + i + ']') + '=' + encodeURIComponent(String(x))))
    else parts.push(encodeURIComponent(name) + '=' + encodeURIComponent(String(v)))
  }
  return parts.filter(Boolean).join('&')
}

/**
 * @param {string} secretKey  Stripe secret (in-process only)
 * @param {{ apiBase?: string, fetch?: Function, maxRetries?: number }} [opts]
 *   apiBase may ONLY be api.stripe.com or a loopback harness (127.0.0.1 / localhost).
 */
function createStripeReadOnlyClient(secretKey, opts) {
  const o = opts || {}
  const apiBase = (o.apiBase || STRIPE_API_DEFAULT).replace(/\/$/, '')
  const u = new URL(apiBase)
  const loop = (u.hostname === '127.0.0.1' || u.hostname === 'localhost') && (o.allowLoopback === true)
  if (!(u.protocol === 'https:' && u.hostname === 'api.stripe.com') && !loop) throw new Error('stripe-readonly: refusing API base ' + u.origin)
  const doFetch = o.fetch || fetch
  const maxRetries = o.maxRetries == null ? 2 : o.maxRetries
  const calls = []
  async function get(pathname, params, extraHeaders) {
    const qs = encodeParams(params)
    const url = apiBase + pathname + (qs ? '?' + qs : '')
    let lastErr = null
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await doFetch(url, { method: 'GET', headers: Object.assign({ Authorization: 'Bearer ' + secretKey, 'Stripe-Version': '2024-06-20', 'User-Agent': 'grubano-phase2-preflight-readonly/5' }, extraHeaders || {}) })
        let body = null, parseFailed = false
        try { body = await res.json() } catch { parseFailed = true }
        if (res.status >= 500 && attempt < maxRetries) { lastErr = new Error('stripe ' + res.status); continue }
        if (res.status !== 200) { const e = new Error('stripe_http_' + res.status + (body && body.error && body.error.type ? ':' + body.error.type : '')); e.status = res.status; throw e }
        if (parseFailed || body === null || typeof body !== 'object') { const e = new Error('stripe_malformed_200'); e.status = 200; throw e }
        calls.push({ method: 'GET', pathname })
        return body
      } catch (e) { lastErr = e; if (attempt >= maxRetries || (e.status && e.status < 500)) throw e }
    }
    throw lastErr
  }
  function listAll(pathname, params, cap) {
    return {
      async autoPagingToArray(pg) {
        const limitAll = (pg && pg.limit) || cap || 1000
        const out = []
        let startingAfter
        for (;;) {
          const page = await get(pathname, Object.assign({}, params, startingAfter ? { starting_after: startingAfter } : {}))
          if (!Array.isArray(page.data)) { const e = new Error('stripe_malformed_list'); e.status = 200; throw e }
          const data = page.data
          for (const d of data) { out.push(d); if (out.length >= limitAll) return out }
          if (page.has_more && !data.length) { const e = new Error('stripe_malformed_pagination'); e.status = 200; throw e }
          if (!page.has_more) return out
          startingAfter = data[data.length - 1].id
        }
      },
    }
  }
  return {
    kind: 'rest-readonly',
    origin: u.origin,
    calls,
    paymentIntents: { list: (params) => listAll('/v1/payment_intents', params), retrieve: (id, params) => get('/v1/payment_intents/' + encodeURIComponent(id), params) },
    refunds: { list: (params) => listAll('/v1/refunds', params), retrieve: (id) => get('/v1/refunds/' + encodeURIComponent(id)) },
    // Extra READ-ONLY getters for the rehearsal precheck (whitelisted kinds; GET only).
    retrieveAny: (kind, id, params) => {
      if (!['payment_intents', 'charges', 'transfers', 'application_fees', 'accounts', 'refunds'].includes(kind)) throw new Error('stripe-readonly: kind not allowed ' + kind)
      return get('/v1/' + kind + '/' + encodeURIComponent(id), params)
    },
    balanceFor: (connectedAccountId) => get('/v1/balance', undefined, { 'Stripe-Account': String(connectedAccountId) }),
    listWebhookEndpoints: async () => (await get('/v1/webhook_endpoints', { limit: 10 })).data || [],
  }
}

/** Prefer the real SDK if the app can resolve it; otherwise the REST read-only client. */
function makeStripeClient(secretKey, appRoot, opts) {
  const o = opts || {}
  const res = resolveFromApp('stripe', appRoot, o.require || require)
  if (res.ok && !o.forceRest) {
    let Stripe = (o.require || require)(res.path); Stripe = Stripe.default || Stripe
    return { client: new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 30000 }), resolution: 'PASS (stripe SDK from ' + path.relative(appRoot, res.path).split(path.sep).join('/') + ')' }
  }
  const client = createStripeReadOnlyClient(secretKey, { apiBase: o.apiBase, fetch: o.fetch, allowLoopback: o.allowLoopback === true })
  return { client, resolution: 'PASS (stripe SDK not in the standalone runtime → READ-ONLY REST client, GET only, origin ' + client.origin + ')' }
}

// ── Window-edge classification ────────────────────────────────────────────────────
/**
 * For every `not_in_stripe_window` ecart: prove WINDOW_EDGE_ONLY (the PaymentIntent exists at
 * Stripe, status succeeded, amount_received == ledger gross, created before the window start)
 * or leave it as TRUE_FINANCIAL_MISMATCH. Read-only: prisma.ledgerEntry.findUnique + PI retrieve.
 */
async function classifyWindowEdges(ecarts, ctx) {
  const out = []
  for (const e of ecarts) {
    if (e.kind !== 'not_in_stripe_window') { out.push({ ecart: e, cls: 'TRUE_FINANCIAL_MISMATCH', reason: e.kind }); continue }
    try {
      const line = await ctx.prisma.ledgerEntry.findUnique({ where: { id: e.ledgerId }, select: { grossAmount: true, createdAt: true, type: true } })
      const pi = await ctx.stripe.paymentIntents.retrieve(e.stripePaymentIntentId)
      const createdMs = Number.isInteger(pi && pi.created) && pi.created > 0 ? pi.created * 1000 : NaN
      const sameObject = !!pi && pi.id === e.stripePaymentIntentId
      const amountMatch = !!line && pi.amount_received === line.grossAmount
      const statusOk = pi.status === 'succeeded'
      const beforeWindow = Number.isFinite(createdMs) && createdMs < ctx.from.getTime()
      const cls = sameObject && amountMatch && statusOk && beforeWindow ? 'WINDOW_EDGE_ONLY' : 'TRUE_FINANCIAL_MISMATCH'
      out.push({ ecart: e, cls, reason: cls === 'WINDOW_EDGE_ONLY' ? 'PI exists, succeeded, amount_received == ledger gross, created ' + new Date(createdMs).toISOString() + ' < window start' : 'sameObject=' + sameObject + ' amountMatch=' + amountMatch + ' status=' + (pi && pi.status) + ' beforeWindow=' + beforeWindow + (Number.isFinite(createdMs) ? '' : ' (created missing)'), amount: line ? line.grossAmount : null, pi: e.stripePaymentIntentId })
    } catch (err) {
      out.push({ ecart: e, cls: 'TRUE_FINANCIAL_MISMATCH', reason: 'could not verify: ' + (err && err.message ? String(err.message).slice(0, 60) : 'error') })
    }
  }
  return out
}

/**
 * Window verdict from the core result + classified edges.
 *  PASS                       — core ok:true and refunds checked
 *  PASS (WINDOW_EDGE_ONLY)    — the ONLY deviations are proven window-edge lines and, once they are
 *                               removed from the ledger side, counts and sums match exactly
 *  FAIL                       — anything else (never forced)
 */
function windowVerdict(r, classified) {
  if (!r.refunds.checked) return 'FAIL (refunds listing NOT MEASURED)'
  if (r.ok) return 'PASS'
  const edges = classified.filter((c) => c.cls === 'WINDOW_EDGE_ONLY')
  const others = classified.filter((c) => c.cls !== 'WINDOW_EDGE_ONLY')
  if (others.length || edges.length !== r.ecarts.length) return 'FAIL'
  // one money line per PI: two proven edges on the same PaymentIntent would hide a duplicate line
  const piIds = edges.map((c) => c.pi || (c.ecart && c.ecart.stripePaymentIntentId))
  if (new Set(piIds).size !== piIds.length) return 'FAIL (duplicate money lines on one edge PI)'
  const edgeSum = edges.reduce((a, c) => a + (c.amount || 0), 0)
  const countsMatch = r.ledgerCount - edges.length === r.stripeCount
  const sumsMatch = r.ledgerSum - edgeSum === r.stripeSum
  return r.internalOk && r.refundsOk && countsMatch && sumsMatch ? 'PASS (WINDOW_EDGE_ONLY — ' + edges.length + ' line(s) proven, sums match after exclusion)' : 'FAIL'
}

module.exports = { resolveFromApp, loadRuntimeEnv, envFacts, createStripeReadOnlyClient, makeStripeClient, encodeParams, classifyWindowEdges, windowVerdict, STRIPE_API_DEFAULT }
