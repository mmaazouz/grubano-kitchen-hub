// tests/ledger-check-route.test.ts — HTTP wrapper of GET /api/admin/ledger/check.
// Auth contract (UNCHANGED by the core extraction): X-Internal-Token compared RAW, in
// constant time, with process.env.INTERNAL_CRON_TOKEN read AT REQUEST TIME (trimmed);
// empty/unset env NEVER opens the route; otherwise admin session only. No bypass, no leak.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const core = vi.hoisted(() => ({ reconcileLedger: vi.fn(async () => ({ ok: true, marker: 'core-result' })) }))
const session = vi.hoisted(() => ({ value: null as null | { user: { email: string } } }))
const operator = vi.hoisted(() => ({ role: 'admin' as string | null }))

vi.mock('@/lib/ledger-check-core', () => ({
  reconcileLedger: core.reconcileLedger,
  resolveWindow: (f: string | null, t: string | null) => {
    if (f === 'bad') return { error: 'Période invalide (from/to ISO, from < to)' }
    return { from: new Date('2026-08-29T00:00:00Z'), to: new Date('2026-09-05T00:00:00Z') }
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: { operator: { findUnique: async () => (operator.role ? { role: operator.role } : null) } } }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: async () => session.value }))
vi.mock('@/lib/stripe', () => ({ getStripe: () => ({ tag: 'stripe' }) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => null }))

import { GET } from '@/app/api/admin/ledger/check/route'

const req = (headers: Record<string, string> = {}, qs = '') =>
  new Request('https://app.grubano.com/api/admin/ledger/check' + qs, { headers })

beforeEach(() => { core.reconcileLedger.mockClear(); session.value = null; operator.role = 'admin' })
afterEach(() => { delete process.env.INTERNAL_CRON_TOKEN })

describe('GET /api/admin/ledger/check — internal token', () => {
  it('correct authoritative token → 200 with the core result (read at request time)', async () => {
    process.env.INTERNAL_CRON_TOKEN = 'tok-correct-0123456789'
    const res = await GET(req({ 'X-Internal-Token': 'tok-correct-0123456789' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, marker: 'core-result' })
    expect(core.reconcileLedger).toHaveBeenCalledTimes(1)
    const calls = core.reconcileLedger.mock.calls as unknown as Array<[{ stripe: unknown; from: Date; to: Date }]>
    const arg = calls[0][0]
    expect(arg.stripe).toEqual({ tag: 'stripe' })
    expect(arg.from.toISOString()).toBe('2026-08-29T00:00:00.000Z')
  })
  it('env token with surrounding whitespace is trimmed on the EXPECTED side; header padding is stripped by the HTTP layer itself; inner whitespace never matches', async () => {
    process.env.INTERNAL_CRON_TOKEN = '  tok-correct-0123456789 \n'
    expect((await GET(req({ 'X-Internal-Token': 'tok-correct-0123456789' }))).status).toBe(200)
    // The Fetch Headers API normalises leading/trailing HTTP whitespace of a header VALUE
    // before the route ever sees it — so padding is NOT a route-side trim, it is protocol.
    expect((await GET(req({ 'X-Internal-Token': ' tok-correct-0123456789 ' }))).status).toBe(200)
    expect((await GET(req({ 'X-Internal-Token': 'tok-correct 0123456789' }))).status).toBe(401)
  })
  it('wrong token → 401, core never called', async () => {
    process.env.INTERNAL_CRON_TOKEN = 'tok-correct-0123456789'
    const res = await GET(req({ 'X-Internal-Token': 'tok-wrong---0123456789' }))
    expect(res.status).toBe(401)
    expect(core.reconcileLedger).not.toHaveBeenCalled()
  })
  it('missing token (and no session) → 401', async () => {
    process.env.INTERNAL_CRON_TOKEN = 'tok-correct-0123456789'
    expect((await GET(req())).status).toBe(401)
  })
  it('"Bearer <token>" is NOT accepted (raw header contract)', async () => {
    process.env.INTERNAL_CRON_TOKEN = 'tok-correct-0123456789'
    expect((await GET(req({ 'X-Internal-Token': 'Bearer tok-correct-0123456789' }))).status).toBe(401)
  })
  it('token comparison is case-sensitive', async () => {
    process.env.INTERNAL_CRON_TOKEN = 'TokCorrect0123456789'
    expect((await GET(req({ 'X-Internal-Token': 'tokcorrect0123456789' }))).status).toBe(401)
  })
  it('NO BYPASS: unset env + empty header → 401 ; empty env + empty header → 401', async () => {
    delete process.env.INTERNAL_CRON_TOKEN
    expect((await GET(req({ 'X-Internal-Token': '' }))).status).toBe(401)
    process.env.INTERNAL_CRON_TOKEN = '   '
    expect((await GET(req({ 'X-Internal-Token': '' }))).status).toBe(401)
    expect((await GET(req({ 'X-Internal-Token': '   ' }))).status).toBe(401)
    expect(core.reconcileLedger).not.toHaveBeenCalled()
  })
  it('the env is read at REQUEST time (a token set after module import is honoured)', async () => {
    process.env.INTERNAL_CRON_TOKEN = 'late-token-0123456789'
    expect((await GET(req({ 'X-Internal-Token': 'late-token-0123456789' }))).status).toBe(200)
    process.env.INTERNAL_CRON_TOKEN = 'rotated-token-0123456789'
    expect((await GET(req({ 'X-Internal-Token': 'late-token-0123456789' }))).status).toBe(401)
    expect((await GET(req({ 'X-Internal-Token': 'rotated-token-0123456789' }))).status).toBe(200)
  })
  it('no leakage: a 401 body never echoes the header or the expected token', async () => {
    process.env.INTERNAL_CRON_TOKEN = 'tok-secret-0123456789'
    const res = await GET(req({ 'X-Internal-Token': 'attacker-value' }))
    const text = await res.text()
    expect(text).not.toContain('tok-secret'); expect(text).not.toContain('attacker-value')
    expect(text).toBe(JSON.stringify({ error: 'Non autorisé' }))
  })
})

describe('GET /api/admin/ledger/check — session fallback + window', () => {
  it('admin session → 200 ; non-admin session → 403 ; unknown operator → 403', async () => {
    session.value = { user: { email: 'admin@grubano.com' } }
    expect((await GET(req())).status).toBe(200)
    operator.role = 'restaurant'
    expect((await GET(req())).status).toBe(403)
    operator.role = null
    expect((await GET(req())).status).toBe(403)
  })
  it('invalid window → 400 (after auth)', async () => {
    process.env.INTERNAL_CRON_TOKEN = 'tok-correct-0123456789'
    const res = await GET(req({ 'X-Internal-Token': 'tok-correct-0123456789' }, '?from=bad'))
    expect(res.status).toBe(400)
    expect(core.reconcileLedger).not.toHaveBeenCalled()
  })
  it('stripe_not_configured → 500 "Paiement non configuré."', async () => {
    process.env.INTERNAL_CRON_TOKEN = 'tok-correct-0123456789'
    core.reconcileLedger.mockRejectedValueOnce(new Error('stripe_not_configured'))
    const res = await GET(req({ 'X-Internal-Token': 'tok-correct-0123456789' }))
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Paiement non configuré.' })
  })
})
