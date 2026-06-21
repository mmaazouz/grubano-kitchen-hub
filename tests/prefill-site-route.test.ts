import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── /api/restaurants/prefill-site (AI profile prefill from a website, Agent 91) ────────
// Gated 404 OFF; owner-scoped (401/403); SSRF-safe fetch is MOCKED (its own SSRF matrix is
// in safe-fetch.test); extraction via the LLM GATEWAY (quota → 429); returns a NON-LEGAL
// DRAFT and writes NOTHING (zero auto-save — confirmation is the untouched PATCH route).
// The REAL lib/site-extract is used (strict NON-LEGAL parsing); fetch + gateway + prisma + auth mocked.

const { db, session, llm, safeFetch } = vi.hoisted(() => {
  class LlmQuotaError extends Error {}
  class LlmDisabledError extends Error {}
  class SafeFetchError extends Error {
    constructor(public code: string) { super(code); this.name = 'SafeFetchError' }
  }
  return {
    db: { operator: { findUnique: vi.fn() }, restaurant: { update: vi.fn() } },
    session: vi.fn(),
    llm: { llmComplete: vi.fn(), LlmQuotaError, LlmDisabledError },
    safeFetch: { fetchSiteText: vi.fn(), SafeFetchError },
  }
})
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth', () => ({ getServerSession: session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/llm', () => llm)
vi.mock('@/lib/safe-fetch', () => safeFetch)

import { GET, POST } from '@/app/api/restaurants/prefill-site/route'

const post = (body: unknown) => POST(new Request('http://x/api/restaurants/prefill-site', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))
const URL_OK = 'https://chez-luigi.fr'

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ONBOARDING_AI_SITE_PREFILL_ENABLED = 'true'
  session.mockResolvedValue({ user: { email: 'r@x.fr' } })
  db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant' })
  safeFetch.fetchSiteText.mockResolvedValue('Chez Luigi — pizzeria italienne à Lyon. Pizzas au feu de bois.')
  llm.llmComplete.mockResolvedValue({ text: JSON.stringify({
    name: 'Chez Luigi', description: 'Pizzeria italienne au feu de bois.', cuisine: ['italien', 'pizza'],
    // adversarial extras the model might emit — must be dropped by the strict parser:
    siren: '912345678', officialName: 'LUIGI SARL', vatNumber: 'FR123', evil: 'rm -rf',
  }) })
})
afterEach(() => { delete process.env.ONBOARDING_AI_SITE_PREFILL_ENABLED })

describe('GET — feature flag probe', () => {
  it('reports enabled true/false from the flag', async () => {
    expect((await (await GET()).json()).enabled).toBe(true)
    delete process.env.ONBOARDING_AI_SITE_PREFILL_ENABLED
    expect((await (await GET()).json()).enabled).toBe(false)
  })
})

describe('POST — gating + owner-scoping', () => {
  it('flag OFF → 404, nothing touched', async () => {
    delete process.env.ONBOARDING_AI_SITE_PREFILL_ENABLED
    expect((await post({ url: URL_OK })).status).toBe(404)
    expect(session).not.toHaveBeenCalled()
    expect(safeFetch.fetchSiteText).not.toHaveBeenCalled()
    expect(llm.llmComplete).not.toHaveBeenCalled()
  })
  it('no session → 401; non-restaurant role → 403 (no fetch, no LLM)', async () => {
    session.mockResolvedValue(null)
    expect((await post({ url: URL_OK })).status).toBe(401)
    session.mockResolvedValue({ user: { email: 'c@x.fr' } })
    db.operator.findUnique.mockResolvedValue({ id: 'c1', role: 'consumer' })
    expect((await post({ url: URL_OK })).status).toBe(403)
    expect(safeFetch.fetchSiteText).not.toHaveBeenCalled()
    expect(llm.llmComplete).not.toHaveBeenCalled()
  })
  it('invalid body → 400 (no fetch)', async () => {
    expect((await post({ nope: 1 })).status).toBe(400)
    expect(safeFetch.fetchSiteText).not.toHaveBeenCalled()
  })
})

describe('POST — SSRF failures map to GENERIC codes (no oracle), LLM never reached', () => {
  it('blocked / invalid / bad_content / fetch_failed → 400 generic', async () => {
    for (const code of ['blocked', 'invalid_url', 'bad_content', 'fetch_failed']) {
      safeFetch.fetchSiteText.mockRejectedValueOnce(new safeFetch.SafeFetchError(code))
      const res = await post({ url: URL_OK })
      expect(res.status, code).toBe(400)
    }
    expect(llm.llmComplete).not.toHaveBeenCalled()
  })
  it('too_large → 413; timeout → 504', async () => {
    safeFetch.fetchSiteText.mockRejectedValueOnce(new safeFetch.SafeFetchError('too_large'))
    expect((await post({ url: URL_OK })).status).toBe(413)
    safeFetch.fetchSiteText.mockRejectedValueOnce(new safeFetch.SafeFetchError('timeout'))
    expect((await post({ url: URL_OK })).status).toBe(504)
    expect(llm.llmComplete).not.toHaveBeenCalled()
  })
})

describe('POST — extraction via the gateway, NON-LEGAL draft only, zero auto-save', () => {
  it('routes through llmComplete(task site_extract, operatorId) and returns a NON-LEGAL draft', async () => {
    const res = await post({ url: URL_OK })
    expect(res.status).toBe(200)
    const body = await res.json()
    // ⚠️ ONLY {name, description, cuisine} survive — never a legal/KYB key from the web.
    expect(Object.keys(body.draft).sort()).toEqual(['cuisine', 'description', 'name'])
    expect(body.draft.name).toBe('Chez Luigi')
    expect(body.draft.cuisine).toEqual(['italien', 'pizza'])
    expect(body.draft.siren).toBeUndefined()
    expect(body.draft.officialName).toBeUndefined()
    expect(body.draft.vatNumber).toBeUndefined()

    const call = llm.llmComplete.mock.calls[0][0]
    expect(call.task).toBe('site_extract')
    expect(call.operatorId).toBe('op1')              // per-partner quota attribution
    // ⚠️ NOTHING is written — confirmation happens later via the existing PATCH route.
    expect(db.restaurant.update).not.toHaveBeenCalled()
  })

  it('malformed model output → empty draft (no crash, still 200, nothing written)', async () => {
    llm.llmComplete.mockResolvedValue({ text: 'sorry I cannot' })
    const res = await post({ url: URL_OK })
    expect(res.status).toBe(200)
    expect((await res.json()).draft).toEqual({ name: '', description: '', cuisine: [] })
    expect(db.restaurant.update).not.toHaveBeenCalled()
  })

  it('gateway quota exceeded → 429', async () => {
    llm.llmComplete.mockRejectedValue(new llm.LlmQuotaError())
    expect((await post({ url: URL_OK })).status).toBe(429)
  })
})
