import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── P1-SEC — POST /api/menu/scan-dish hardening ───────────────────────────────
// The route used to reach a paid Sonnet VISION call with NO auth, NO rate limit and
// NO input bound, and it resolved the operator with `.catch(() => undefined)` — so an
// ANONYMOUS caller produced `operatorId: undefined`, the exact condition that DISABLES
// the per-partner LLM quota (lib/llm/index.ts:176). These tests pin the four fixes:
//   401 anonymous · 403 wrong role · operatorId ALWAYS attributed · bounded input · 429.
//
// SCOPE NOTE (why there is no "foreign resource" case here): the payload is
// { imageBase64, mediaType } only — no brand/dish/restaurant id is ever sent (the sole
// caller is app/[locale]/menu/page.tsx:1645) and the route reads/writes nothing. There
// is no cross-tenant object to reach, so ownership is enforced downstream by
// POST /api/menu, not here. The scan is scoped to the CALLING OPERATOR.

const { db, session, llm } = vi.hoisted(() => ({
  db:      { operator: { findUnique: vi.fn() } },
  session: vi.fn(),
  llm:     vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth', () => ({ getServerSession: session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/llm', () => {
  class LlmQuotaError extends Error {
    constructor(public scope: 'day' | 'month' = 'day') {
      super(`LLM quota exceeded (${scope})`)
      this.name = 'LlmQuotaError'
    }
  }
  return { llmComplete: llm, LlmQuotaError }
})

import { POST } from '@/app/api/menu/scan-dish/route'
import { MAX_IMAGE_BYTES } from '@/lib/dish-photo'
import { __resetRateLimit } from '@/lib/rate-limit'

// A tiny valid-looking base64 payload (content is irrelevant — the LLM is mocked).
const SMALL_IMAGE = Buffer.from('fake-jpeg-bytes').toString('base64')

const scan = (body: unknown, ip = '10.0.0.1') =>
  POST(new Request('http://x/api/menu/scan-dish', {
    method:  'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body:    JSON.stringify(body),
  }))

/** Raw variant: lets a test declare a Content-Length that does not match the body,
 *  which is exactly what the pre-json() short-circuit is there to catch. */
const scanRaw = (raw: string, headers: Record<string, string>) =>
  POST(new Request('http://x/api/menu/scan-dish', {
    method:  'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.0.0.1', ...headers },
    body:    raw,
  }))

// actor helpers (same shape as tests/menu-mutation-ownership-route.test.ts)
const anon = () => session.mockResolvedValue(null)
const as = (id: string, role: string) => {
  session.mockResolvedValue({ user: { email: `${id}@x.fr` } })
  db.operator.findUnique.mockResolvedValue({ id, role })
}

beforeEach(() => {
  vi.clearAllMocks()
  __resetRateLimit()
  delete process.env.RATE_LIMIT_ENABLED
  delete process.env.RATE_LIMIT_MENU_SCAN_DISH_MAX
  llm.mockResolvedValue({ text: '{"name":"Pizza margherita","category":"Plats"}' })
})

afterEach(() => {
  delete process.env.RATE_LIMIT_ENABLED
  delete process.env.RATE_LIMIT_MENU_SCAN_DISH_MAX
})

describe('POST /api/menu/scan-dish — auth (was fully anonymous)', () => {
  it('anonymous → 401, the LLM is NEVER called', async () => {
    anon()
    const res = await scan({ imageBase64: SMALL_IMAGE, mediaType: 'image/jpeg' })
    expect(res.status).toBe(401)
    expect(llm).not.toHaveBeenCalled()
  })

  it('consumer role → 403, the LLM is NEVER called (same contract as POST /api/menu)', async () => {
    as('c1', 'consumer')
    const res = await scan({ imageBase64: SMALL_IMAGE, mediaType: 'image/jpeg' })
    expect(res.status).toBe(403)
    expect(llm).not.toHaveBeenCalled()
  })

  it('creator role → 403 (only restaurant|admin may scan)', async () => {
    as('cr1', 'creator')
    const res = await scan({ imageBase64: SMALL_IMAGE, mediaType: 'image/jpeg' })
    expect(res.status).toBe(403)
    expect(llm).not.toHaveBeenCalled()
  })

  it('restaurant operator → 200, the analysis runs', async () => {
    as('op1', 'restaurant')
    const res = await scan({ imageBase64: SMALL_IMAGE, mediaType: 'image/jpeg' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ name: 'Pizza margherita', category: 'Plats' })
    expect(llm).toHaveBeenCalledTimes(1)
  })

  it('admin → 200 (superuser, same as POST /api/menu)', async () => {
    as('adm', 'admin')
    const res = await scan({ imageBase64: SMALL_IMAGE, mediaType: 'image/jpeg' })
    expect(res.status).toBe(200)
    expect(llm).toHaveBeenCalledTimes(1)
  })
})

describe('POST /api/menu/scan-dish — quota attribution', () => {
  it('the session operatorId is ALWAYS passed to llmComplete (quota now applies)', async () => {
    as('op1', 'restaurant')
    await scan({ imageBase64: SMALL_IMAGE, mediaType: 'image/jpeg' })
    expect(llm).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'dish_scan', operatorId: 'op1' }),
    )
    // Regression pin: `undefined` here is what silently disabled the quota before.
    const arg = llm.mock.calls[0][0] as { operatorId?: unknown }
    expect(arg.operatorId).toBe('op1')
    expect(arg.operatorId).not.toBeUndefined()
  })

  it('the operatorId comes from the SESSION, never from the body (no client override)', async () => {
    as('op1', 'restaurant')
    await scan({ imageBase64: SMALL_IMAGE, mediaType: 'image/jpeg', operatorId: 'victim' })
    expect(llm).toHaveBeenCalledWith(expect.objectContaining({ operatorId: 'op1' }))
  })
})

describe('POST /api/menu/scan-dish — input validation', () => {
  it('missing imageBase64 → 400, no LLM call', async () => {
    as('op1', 'restaurant')
    const res = await scan({ mediaType: 'image/jpeg' })
    expect(res.status).toBe(400)
    expect(llm).not.toHaveBeenCalled()
  })

  it('unsupported mediaType → 400, no LLM call', async () => {
    as('op1', 'restaurant')
    const res = await scan({ imageBase64: SMALL_IMAGE, mediaType: 'application/pdf' })
    expect(res.status).toBe(400)
    expect(llm).not.toHaveBeenCalled()
  })

  it('oversized image → 413, no LLM call (8 MB cap, shared with lib/dish-photo)', async () => {
    as('op1', 'restaurant')
    // 4 base64 chars ≈ 3 decoded bytes → overshoot the cap without any padding.
    const tooBig = 'A'.repeat(Math.ceil((MAX_IMAGE_BYTES + 1024) * 4 / 3))
    const res = await scan({ imageBase64: tooBig, mediaType: 'image/jpeg' })
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'Image trop lourde (8 Mo maximum).' })
    expect(llm).not.toHaveBeenCalled()
  })

  it('an image just under the cap still passes → 200', async () => {
    as('op1', 'restaurant')
    const justUnder = 'A'.repeat(Math.floor((MAX_IMAGE_BYTES - 1024) * 4 / 3))
    const res = await scan({ imageBase64: justUnder, mediaType: 'image/jpeg' })
    expect(res.status).toBe(200)
    expect(llm).toHaveBeenCalledTimes(1)
  })

  // App Router route handlers have NO bodyParser.sizeLimit: `await req.json()`
  // buffers AND parses the whole body before base64Bytes() can refuse anything, so
  // an authenticated caller could still push hundreds of MB into the heap. The
  // Content-Length pre-check short-circuits that. It is advisory (absent on chunked
  // requests, and forgeable), hence a short-circuit and NOT the authoritative bound.
  it('a pathological Content-Length → 413 BEFORE the body is parsed', async () => {
    as('op1', 'restaurant')
    // Deliberately UNPARSEABLE body: reaching req.json() would throw → 500. Getting
    // a clean 413 proves the check fired first.
    const res = await scanRaw('{ not json at all', {
      'content-length': String(MAX_IMAGE_BYTES * 40),
    })
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'Image trop lourde (8 Mo maximum).' })
    expect(llm).not.toHaveBeenCalled()
  })

  it('an honest payload with its real Content-Length is untouched → 200', async () => {
    as('op1', 'restaurant')
    const raw = JSON.stringify({ imageBase64: SMALL_IMAGE, mediaType: 'image/jpeg' })
    const res = await scanRaw(raw, { 'content-length': String(Buffer.byteLength(raw)) })
    expect(res.status).toBe(200)
    expect(llm).toHaveBeenCalledTimes(1)
  })

  it('no Content-Length at all → the authoritative base64 bound still returns 413', async () => {
    as('op1', 'restaurant')
    const tooBig = 'A'.repeat(Math.ceil((MAX_IMAGE_BYTES + 1024) * 4 / 3))
    const res = await scan({ imageBase64: tooBig, mediaType: 'image/jpeg' })
    expect(res.status).toBe(413)
    expect(llm).not.toHaveBeenCalled()
  })
})

describe('POST /api/menu/scan-dish — rate limit (shared lib/rate-limit infra)', () => {
  it('flag OFF → NO throttling (byte-identical to today)', async () => {
    as('op1', 'restaurant')
    process.env.RATE_LIMIT_MENU_SCAN_DISH_MAX = '1'
    for (let i = 0; i < 4; i++) {
      const res = await scan({ imageBase64: SMALL_IMAGE, mediaType: 'image/jpeg' }, '10.0.0.9')
      expect(res.status).toBe(200)
    }
    expect(llm).toHaveBeenCalledTimes(4)
  })

  it('flag ON + limit exceeded → 429 + Retry-After, no LLM call', async () => {
    as('op1', 'restaurant')
    process.env.RATE_LIMIT_ENABLED = 'true'
    process.env.RATE_LIMIT_MENU_SCAN_DISH_MAX = '2'

    const ok1 = await scan({ imageBase64: SMALL_IMAGE, mediaType: 'image/jpeg' }, '10.0.0.2')
    const ok2 = await scan({ imageBase64: SMALL_IMAGE, mediaType: 'image/jpeg' }, '10.0.0.2')
    const ko  = await scan({ imageBase64: SMALL_IMAGE, mediaType: 'image/jpeg' }, '10.0.0.2')

    expect(ok1.status).toBe(200)
    expect(ok2.status).toBe(200)
    expect(ko.status).toBe(429)
    expect(ko.headers.get('Retry-After')).toBeTruthy()
    expect(llm).toHaveBeenCalledTimes(2) // the throttled call never reached the model
  })

  // The bucket is sub-keyed by the authenticated operator (`extraKey`), so the
  // NAT collision the ordering comment used to claim credit for is ACTUALLY closed:
  // two partners behind one egress IP (co-working, shared dark kitchen, mobile CGNAT)
  // each get their own budget. Same guarantee when the proxy chain strips
  // x-forwarded-for and lib/rate-limit falls back to its shared 'unknown' bucket.
  it('two operators on the SAME IP do NOT share the bucket', async () => {
    process.env.RATE_LIMIT_ENABLED = 'true'
    process.env.RATE_LIMIT_MENU_SCAN_DISH_MAX = '1'

    as('op1', 'restaurant')
    expect((await scan({ imageBase64: SMALL_IMAGE, mediaType: 'image/jpeg' }, '10.0.0.7')).status).toBe(200)
    expect((await scan({ imageBase64: SMALL_IMAGE, mediaType: 'image/jpeg' }, '10.0.0.7')).status).toBe(429)

    // Same egress IP, different partner → untouched budget.
    as('op2', 'restaurant')
    expect((await scan({ imageBase64: SMALL_IMAGE, mediaType: 'image/jpeg' }, '10.0.0.7')).status).toBe(200)
  })

  it('no x-forwarded-for (shared \'unknown\' bucket) → still per-operator', async () => {
    process.env.RATE_LIMIT_ENABLED = 'true'
    process.env.RATE_LIMIT_MENU_SCAN_DISH_MAX = '1'
    const bare = (body: unknown) =>
      POST(new Request('http://x/api/menu/scan-dish', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify(body),
      }))

    as('op1', 'restaurant')
    expect((await bare({ imageBase64: SMALL_IMAGE, mediaType: 'image/jpeg' })).status).toBe(200)
    expect((await bare({ imageBase64: SMALL_IMAGE, mediaType: 'image/jpeg' })).status).toBe(429)

    // Without the per-operator sub-key EVERY partner of the platform would share a
    // single 10-scans-per-minute budget in that topology.
    as('op2', 'restaurant')
    expect((await bare({ imageBase64: SMALL_IMAGE, mediaType: 'image/jpeg' })).status).toBe(200)
  })

  it('the bucket is per-IP: another IP is unaffected', async () => {
    as('op1', 'restaurant')
    process.env.RATE_LIMIT_ENABLED = 'true'
    process.env.RATE_LIMIT_MENU_SCAN_DISH_MAX = '1'

    expect((await scan({ imageBase64: SMALL_IMAGE, mediaType: 'image/jpeg' }, '10.0.0.3')).status).toBe(200)
    expect((await scan({ imageBase64: SMALL_IMAGE, mediaType: 'image/jpeg' }, '10.0.0.3')).status).toBe(429)
    expect((await scan({ imageBase64: SMALL_IMAGE, mediaType: 'image/jpeg' }, '10.0.0.4')).status).toBe(200)
  })

  it('rejected anonymous calls do NOT consume the bucket (limit checked AFTER auth)', async () => {
    process.env.RATE_LIMIT_ENABLED = 'true'
    process.env.RATE_LIMIT_MENU_SCAN_DISH_MAX = '1'

    anon()
    for (let i = 0; i < 5; i++) {
      const res = await scan({ imageBase64: SMALL_IMAGE, mediaType: 'image/jpeg' }, '10.0.0.5')
      expect(res.status).toBe(401)
    }
    // A legitimate operator behind the SAME egress IP still gets its own budget.
    as('op1', 'restaurant')
    const res = await scan({ imageBase64: SMALL_IMAGE, mediaType: 'image/jpeg' }, '10.0.0.5')
    expect(res.status).toBe(200)
  })
})
