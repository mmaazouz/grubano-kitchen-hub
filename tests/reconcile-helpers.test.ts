// tests/reconcile-helpers.test.ts — execution plumbing of the direct financial reconciliation
// (scripts/server/reconcile-helpers.js): env loading like the deployed app, dependency resolution,
// READ-ONLY Stripe REST client, window-edge classification, window verdict. No network.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const H = require('../scripts/server/reconcile-helpers.js')

const ROOT = path.resolve(__dirname, '..')

describe('env loading — same contract as the deployed app', () => {
  const saved: Record<string, string | undefined> = {}
  // @next/env picks the file set from NODE_ENV: under vitest it is 'test' (→ .env.test*, no .env.local).
  // The operator runs with NODE_ENV unset on the server → 'production' set, exactly like the app.
  const KEYS = ['DATABASE_URL', 'STRIPE_SECRET_KEY', 'ONLY_IN_FILE_X1', '__NEXT_PROCESSED_ENV', 'NODE_ENV']
  beforeEach(() => { for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k] } })
  afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } })

  it('@next/env resolves from an app root that has node_modules (the standalone ships it), loads .env.local into process.env, and a pre-existing value (hosting injection) is never overridden', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grubano-env-'))
    fs.writeFileSync(path.join(dir, '.env.local'), 'DATABASE_URL=mysql://u:p@h/grubano_staging\nSTRIPE_SECRET_KEY=sk_test_fromfile\nONLY_IN_FILE_X1=1\n')
    // "hosting-injected" BEFORE the load (in the operator this is the Passenger/shell env at start)
    process.env.STRIPE_SECRET_KEY = 'sk_test_fromhosting'
    // resolve @next/env from the repo (stands in for APP_ROOT/node_modules of the standalone).
    // @next/env snapshots process.env on its FIRST load and restores that snapshot on forceReload,
    // so the single-load-per-process contract of the operator is what this test exercises.
    const req = Object.assign((p: string) => require(p), { resolve: (name: string) => require.resolve(name, { paths: [ROOT] }) })
    const r = H.loadRuntimeEnv(dir, { require: req })
    expect(r.loader).toMatch(/^@next\/env/)
    expect(r.filesLoaded).toEqual(['.env.local'])
    expect(H.envFacts()).toEqual({ databaseUrl: true, stripeKey: true, stripeMode: 'TEST' })
    expect(process.env.ONLY_IN_FILE_X1).toBe('1')
    expect(process.env.STRIPE_SECRET_KEY).toBe('sk_test_fromhosting') // hosting wins, like the runtime
    fs.rmSync(dir, { recursive: true, force: true })
  })
  it('fallback dotenv merge when @next/env is not resolvable — same order, no override', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grubano-env-'))
    fs.writeFileSync(path.join(dir, '.env.local'), 'DATABASE_URL=mysql://u:p@h/grubano_staging\n')
    fs.writeFileSync(path.join(dir, '.env'), 'DATABASE_URL=mysql://ignored\nSTRIPE_SECRET_KEY=sk_live_no\n')
    const env: Record<string, string> = {}
    const r = H.loadRuntimeEnv(dir, { forceFallback: true, env })
    expect(r.loader).toMatch(/fallback/)
    expect(env.DATABASE_URL).toBe('mysql://u:p@h/grubano_staging')
    expect(H.envFacts(env)).toEqual({ databaseUrl: true, stripeKey: true, stripeMode: 'LIVE' })
    fs.rmSync(dir, { recursive: true, force: true })
  })
  it('envFacts never returns a value', () => {
    const f = H.envFacts({ DATABASE_URL: 'mysql://secret', STRIPE_SECRET_KEY: 'sk_test_zzz' })
    expect(JSON.stringify(f)).not.toMatch(/secret|zzz|mysql/)
  })
})

describe('dependency resolution (deployed layout)', () => {
  it('@prisma/client and lib/ledger-check-core resolve from the repo root; a missing package reports FAIL with code', () => {
    expect(H.resolveFromApp('@prisma/client', ROOT).ok).toBe(true)
    expect(fs.existsSync(path.join(ROOT, 'lib', 'ledger-check-core.js'))).toBe(true)
    const miss = H.resolveFromApp('definitely-not-a-package-xyz', ROOT)
    expect(miss.ok).toBe(false); expect(miss.error).toBe('MODULE_NOT_FOUND')
  })
  it('makeStripeClient falls back to the REST read-only client when the SDK is absent from the app root', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grubano-noapp-'))
    const m = H.makeStripeClient('sk_test_x', dir, { fetch: async () => ({ status: 200, json: async () => ({ data: [], has_more: false }) }) })
    expect(m.resolution).toMatch(/READ-ONLY REST client/)
    expect(m.client.kind).toBe('rest-readonly')
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('READ-ONLY Stripe REST client', () => {
  const pages: Record<string, unknown>[] = []
  const fakeFetch = async (url: string, init: { method: string; headers: Record<string, string> }) => {
    pages.push({ url, method: init.method, auth: init.headers.Authorization })
    const u = new URL(url)
    if (u.pathname === '/v1/payment_intents') {
      const after = u.searchParams.get('starting_after')
      if (!after) return { status: 200, json: async () => ({ data: [{ id: 'pi_1', status: 'succeeded', amount_received: 1450 }, { id: 'pi_2', status: 'requires_payment_method', amount_received: 0 }], has_more: true }) }
      return { status: 200, json: async () => ({ data: [{ id: 'pi_3', status: 'succeeded', amount_received: 1410 }], has_more: false }) }
    }
    if (u.pathname === '/v1/refunds') return { status: 200, json: async () => ({ data: [{ id: 're_1', status: 'succeeded', amount: 1450 }], has_more: false }) }
    if (u.pathname === '/v1/payment_intents/pi_old') return { status: 200, json: async () => ({ id: 'pi_old', status: 'succeeded', amount_received: 700, created: 1_700_000_000 }) }
    return { status: 404, json: async () => ({ error: { type: 'invalid_request_error' } }) }
  }
  beforeEach(() => { pages.length = 0 })

  it('GET only, Bearer auth, created window + limit encoded like the SDK, pagination via starting_after, cap honoured', async () => {
    const c = H.createStripeReadOnlyClient('sk_test_k', { fetch: fakeFetch })
    const pis = await c.paymentIntents.list({ created: { gte: 1000, lte: 2000 }, limit: 100 }).autoPagingToArray({ limit: 1000 })
    expect(pis.map((p: { id: string }) => p.id)).toEqual(['pi_1', 'pi_2', 'pi_3'])
    expect(pages.every((p) => p.method === 'GET')).toBe(true)
    expect(pages[0].url).toContain('created%5Bgte%5D=1000'); expect(pages[0].url).toContain('created%5Blte%5D=2000'); expect(pages[0].url).toContain('limit=100')
    expect(pages[1].url).toContain('starting_after=pi_2')
    expect(pages[0].auth).toBe('Bearer sk_test_k')
    const capped = await c.paymentIntents.list({ limit: 100 }).autoPagingToArray({ limit: 2 })
    expect(capped.length).toBe(2)
    const rf = await c.refunds.list({ limit: 100 }).autoPagingToArray({ limit: 1000 })
    expect(rf[0].id).toBe('re_1')
  })
  it('the core runs unchanged on the REST client (reconcileLedger with prisma fake)', async () => {
    const core = require('../lib/ledger-check-core.js')
    const c = H.createStripeReadOnlyClient('sk_test_k', { fetch: fakeFetch })
    const from = new Date(1000 * 1000), to = new Date(2000 * 1000)
    const lines = [
      { id: 'l1', type: 'payment', grossAmount: 1450, applicationFeeAmount: 116, netToRestaurant: 1334, stripePaymentIntentId: 'pi_1', sourceEventId: 'pi_1', createdAt: new Date(1500 * 1000) },
      { id: 'l2', type: 'payment', grossAmount: 1410, applicationFeeAmount: 76, netToRestaurant: 1334, stripePaymentIntentId: 'pi_3', sourceEventId: 'pi_3', createdAt: new Date(1500 * 1000) },
      { id: 'l3', type: 'refund', grossAmount: -1450, applicationFeeAmount: -116, netToRestaurant: -1334, stripePaymentIntentId: 'pi_1', sourceEventId: 're_1', createdAt: new Date(1600 * 1000) },
    ]
    const prisma = { ledgerEntry: { findMany: async (q: { where: Record<string, unknown> }) => {
      const w = q.where as { createdAt?: unknown; stripePaymentIntentId?: { in: string[] }; sourceEventId?: { in: string[] } }
      if (w.createdAt) return lines
      if (w.stripePaymentIntentId) return lines.filter((l) => w.stripePaymentIntentId!.in.includes(l.stripePaymentIntentId)).map((l) => ({ stripePaymentIntentId: l.stripePaymentIntentId }))
      if (w.sourceEventId) return lines.filter((l) => l.type === 'refund' && w.sourceEventId!.in.includes(l.sourceEventId)).map((l) => ({ sourceEventId: l.sourceEventId }))
      return []
    } } }
    const r = await core.reconcileLedger({ prisma, stripe: c, from, to })
    expect(r.ok).toBe(true); expect([r.ledgerCount, r.stripeCount, r.ledgerSum, r.stripeSum]).toEqual([2, 2, 2860, 2860]); expect(r.refunds.checked).toBe(true)
  })
  it('rehearsal getters: retrieveAny is whitelisted GET, balanceFor sends Stripe-Account header, listWebhookEndpoints returns data', async () => {
    const seen: { url: string; headers: Record<string, string> }[] = []
    const f = async (url: string, init: { headers: Record<string, string> }) => {
      seen.push({ url, headers: init.headers })
      const u = new URL(url)
      if (u.pathname === '/v1/balance') return { status: 200, json: async () => ({ available: [{ currency: 'eur', amount: 0 }], pending: [{ currency: 'eur', amount: 2668 }] }) }
      if (u.pathname === '/v1/webhook_endpoints') return { status: 200, json: async () => ({ data: [{ id: 'we_1', enabled_events: ['charge.refunded'] }] }) }
      if (u.pathname === '/v1/accounts/acct_x') return { status: 200, json: async () => ({ id: 'acct_x', settings: { payouts: { schedule: { interval: 'manual' } } } }) }
      return { status: 404, json: async () => ({ error: { type: 'invalid_request_error' } }) }
    }
    const c = H.createStripeReadOnlyClient('sk_test_k', { fetch: f })
    const bal = await c.balanceFor('acct_x')
    expect(bal.pending[0].amount).toBe(2668)
    expect(seen[0].headers['Stripe-Account']).toBe('acct_x')
    expect((await c.listWebhookEndpoints())[0].id).toBe('we_1')
    expect((await c.retrieveAny('accounts', 'acct_x')).settings.payouts.schedule.interval).toBe('manual')
    expect(() => c.retrieveAny('customers', 'cus_x')).toThrow(/kind not allowed/)
  })
  it('non-2xx → throws stripe_http_<code> (never silently empty); 5xx retried', async () => {
    let n = 0
    const flaky = async () => { n++; return n === 1 ? { status: 500, json: async () => ({}) } : { status: 200, json: async () => ({ data: [], has_more: false }) } }
    const c = H.createStripeReadOnlyClient('sk_test_k', { fetch: flaky })
    expect(await c.refunds.list({}).autoPagingToArray({ limit: 10 })).toEqual([]); expect(n).toBe(2)
    const bad = H.createStripeReadOnlyClient('sk_test_k', { fetch: async () => ({ status: 401, json: async () => ({ error: { type: 'invalid_request_error' } }) }) })
    await expect(bad.refunds.list({}).autoPagingToArray({ limit: 10 })).rejects.toThrow(/stripe_http_401/)
  })
  it('API base is pinned: anything but api.stripe.com or a loopback harness is refused', () => {
    expect(() => H.createStripeReadOnlyClient('sk_test_k', { apiBase: 'https://evil.example.com' })).toThrow(/refusing API base/)
    expect(() => H.createStripeReadOnlyClient('sk_test_k', { apiBase: 'http://api.stripe.com' })).toThrow(/refusing/)
  })
  it('malformed 200 bodies never yield a silent short list (mirror of the SDK)', async () => {
    const bad1 = H.createStripeReadOnlyClient('sk_test_k', { fetch: async () => ({ status: 200, json: async () => { throw new Error('not json') } }) })
    await expect(bad1.refunds.list({}).autoPagingToArray({ limit: 10 })).rejects.toThrow(/stripe_malformed_200/)
    const bad2 = H.createStripeReadOnlyClient('sk_test_k', { fetch: async () => ({ status: 200, json: async () => ({ object: 'list' }) }) })
    await expect(bad2.refunds.list({}).autoPagingToArray({ limit: 10 })).rejects.toThrow(/stripe_malformed_list/)
    const bad3 = H.createStripeReadOnlyClient('sk_test_k', { fetch: async () => ({ status: 200, json: async () => ({ data: [], has_more: true }) }) })
    await expect(bad3.refunds.list({}).autoPagingToArray({ limit: 10 })).rejects.toThrow(/stripe_malformed_pagination/)
    expect(() => H.createStripeReadOnlyClient('sk_test_k', { apiBase: 'http://127.0.0.1:4242' })).toThrow(/refusing/)
    expect(() => H.createStripeReadOnlyClient('sk_test_k', { apiBase: 'http://127.0.0.1:4242', allowLoopback: true })).not.toThrow()
  })
})

describe('window-edge classification + verdict', () => {
  const from = new Date('2026-08-29T12:00:00Z')
  const prisma = { ledgerEntry: { findUnique: async ({ where }: { where: { id: string } }) => (where.id === 'l_edge' ? { grossAmount: 700, createdAt: new Date('2026-08-29T12:00:05Z'), type: 'payment' } : { grossAmount: 999, createdAt: new Date(), type: 'payment' }) } }
  const stripe = { paymentIntents: { retrieve: async (id: string) => (id === 'pi_old' ? { id, status: 'succeeded', amount_received: 700, created: Math.floor(new Date('2026-08-29T11:59:58Z').getTime() / 1000) } : { id, status: 'succeeded', amount_received: 700, created: Math.floor(new Date('2026-08-30T00:00:00Z').getTime() / 1000) }) } }

  it('PI created seconds before the window start, same amount, succeeded → WINDOW_EDGE_ONLY', async () => {
    const c = await H.classifyWindowEdges([{ kind: 'not_in_stripe_window', ledgerId: 'l_edge', stripePaymentIntentId: 'pi_old' }], { prisma, stripe, from })
    expect(c[0].cls).toBe('WINDOW_EDGE_ONLY'); expect(c[0].amount).toBe(700)
  })
  it('amount differs, or PI created inside the window, or any other ecart kind → TRUE_FINANCIAL_MISMATCH', async () => {
    const c1 = await H.classifyWindowEdges([{ kind: 'not_in_stripe_window', ledgerId: 'l_other', stripePaymentIntentId: 'pi_old' }], { prisma, stripe, from })
    expect(c1[0].cls).toBe('TRUE_FINANCIAL_MISMATCH')
    const c2 = await H.classifyWindowEdges([{ kind: 'not_in_stripe_window', ledgerId: 'l_edge', stripePaymentIntentId: 'pi_inside' }], { prisma, stripe, from })
    expect(c2[0].cls).toBe('TRUE_FINANCIAL_MISMATCH')
    const c3 = await H.classifyWindowEdges([{ kind: 'missing_in_ledger', stripePaymentIntentId: 'pi_x', amount: 5 }], { prisma, stripe, from })
    expect(c3[0].cls).toBe('TRUE_FINANCIAL_MISMATCH')
  })
  it('a PI response without `created` is never proven an edge (fail-closed)', async () => {
    const s2 = { paymentIntents: { retrieve: async (id: string) => ({ id, status: 'succeeded', amount_received: 700 }) } }
    const c = await H.classifyWindowEdges([{ kind: 'not_in_stripe_window', ledgerId: 'l_edge', stripePaymentIntentId: 'pi_old' }], { prisma, stripe: s2, from })
    expect(c[0].cls).toBe('TRUE_FINANCIAL_MISMATCH'); expect(c[0].reason).toMatch(/created missing/)
  })
  it('two proven edges on the SAME PaymentIntent → FAIL (hidden duplicate money line)', () => {
    const r = { ok: false, internalOk: true, refundsOk: true, ledgerCount: 4, stripeCount: 2, ledgerSum: 4260, stripeSum: 2860, ecarts: [{ kind: 'not_in_stripe_window', ledgerId: 'a', stripePaymentIntentId: 'pi_old' }, { kind: 'not_in_stripe_window', ledgerId: 'b', stripePaymentIntentId: 'pi_old' }], refunds: { checked: true } }
    expect(H.windowVerdict(r, [{ ecart: r.ecarts[0], cls: 'WINDOW_EDGE_ONLY', amount: 700, pi: 'pi_old' }, { ecart: r.ecarts[1], cls: 'WINDOW_EDGE_ONLY', amount: 700, pi: 'pi_old' }])).toMatch(/^FAIL/)
  })
  it('windowVerdict: ok → PASS ; proven edges only with matching sums after exclusion → PASS (WINDOW_EDGE_ONLY) ; otherwise FAIL ; refunds unchecked → FAIL', () => {
    const base = { ok: true, internalOk: true, refundsOk: true, ledgerCount: 2, stripeCount: 2, ledgerSum: 2860, stripeSum: 2860, ecarts: [] as unknown[], refunds: { checked: true } }
    expect(H.windowVerdict(base, [])).toBe('PASS')
    const edge = { ...base, ok: false, ledgerCount: 3, ledgerSum: 3560, ecarts: [{ kind: 'not_in_stripe_window', ledgerId: 'l_edge', stripePaymentIntentId: 'pi_old' }] }
    expect(H.windowVerdict(edge, [{ ecart: edge.ecarts[0], cls: 'WINDOW_EDGE_ONLY', amount: 700 }])).toMatch(/^PASS \(WINDOW_EDGE_ONLY/)
    // same shape but the excluded amount does not explain the sum gap → FAIL
    expect(H.windowVerdict({ ...edge, ledgerSum: 3561 }, [{ ecart: edge.ecarts[0], cls: 'WINDOW_EDGE_ONLY', amount: 700 }])).toBe('FAIL')
    expect(H.windowVerdict(edge, [{ ecart: edge.ecarts[0], cls: 'TRUE_FINANCIAL_MISMATCH' }])).toBe('FAIL')
    expect(H.windowVerdict({ ...base, refunds: { checked: false } }, [])).toMatch(/^FAIL/)
    // extra ecart of another kind alongside a proven edge → FAIL
    const mixed = { ...edge, ecarts: [...edge.ecarts, { kind: 'missing_in_ledger', stripePaymentIntentId: 'pi_z', amount: 1 }] }
    expect(H.windowVerdict(mixed, [{ ecart: mixed.ecarts[0], cls: 'WINDOW_EDGE_ONLY', amount: 700 }, { ecart: mixed.ecarts[1], cls: 'TRUE_FINANCIAL_MISMATCH' }])).toBe('FAIL')
  })
})
