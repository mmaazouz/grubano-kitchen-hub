import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── /api/menu/scan-card (AI menu prefill, Agent 89) ──────────────────────────────
// Gated 404 OFF; owner-scoped (401/403); upload validated (type/size); extraction via
// the LLM GATEWAY (quota → 429); returns a DRAFT and creates NOTHING (zero auto-save).
// The real lib/menu-extract is used (pure validation); prisma + gateway + auth mocked.

const { db, session, llm } = vi.hoisted(() => {
  class LlmQuotaError extends Error {}
  class LlmDisabledError extends Error {}
  return {
    db: { operator: { findUnique: vi.fn() }, menuItem: { create: vi.fn() } },
    session: vi.fn(),
    llm: { llmComplete: vi.fn(), LlmQuotaError, LlmDisabledError },
  }
})
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth', () => ({ getServerSession: session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/llm', () => llm)

import { GET, POST } from '@/app/api/menu/scan-card/route'

const post = (body: unknown) => POST(new Request('http://x/api/menu/scan-card', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))
const IMG = 'QUJD' // tiny valid base64

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ONBOARDING_AI_MENU_PREFILL_ENABLED = 'true'
  session.mockResolvedValue({ user: { email: 'r@x.fr' } })
  db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant' })
  llm.llmComplete.mockResolvedValue({ text: JSON.stringify([
    { name: 'Burrata', description: 'Crémeuse', price: 12.5, category: 'Entrées' },
    { name: 'Tiramisu', description: '', price: 6, category: 'Desserts' },
  ]) })
})
afterEach(() => { delete process.env.ONBOARDING_AI_MENU_PREFILL_ENABLED })

describe('GET — feature flag probe', () => {
  it('reports enabled true/false from the flag', async () => {
    expect((await (await GET()).json()).enabled).toBe(true)
    delete process.env.ONBOARDING_AI_MENU_PREFILL_ENABLED
    expect((await (await GET()).json()).enabled).toBe(false)
  })
})

describe('POST — gating + owner-scoping', () => {
  it('flag OFF → 404, no auth/LLM touched', async () => {
    delete process.env.ONBOARDING_AI_MENU_PREFILL_ENABLED
    expect((await post({ fileBase64: IMG, mediaType: 'image/jpeg' })).status).toBe(404)
    expect(session).not.toHaveBeenCalled()
    expect(llm.llmComplete).not.toHaveBeenCalled()
  })
  it('no session → 401; non-restaurant role → 403', async () => {
    session.mockResolvedValue(null)
    expect((await post({ fileBase64: IMG, mediaType: 'image/jpeg' })).status).toBe(401)
    session.mockResolvedValue({ user: { email: 'c@x.fr' } })
    db.operator.findUnique.mockResolvedValue({ id: 'c1', role: 'consumer' })
    expect((await post({ fileBase64: IMG, mediaType: 'image/jpeg' })).status).toBe(403)
    expect(llm.llmComplete).not.toHaveBeenCalled()
  })
})

describe('POST — upload validation', () => {
  it('invalid mediaType → 400', async () => {
    expect((await post({ fileBase64: IMG, mediaType: 'application/zip' })).status).toBe(400)
    expect(llm.llmComplete).not.toHaveBeenCalled()
  })
  it('oversized file → 413', async () => {
    const huge = 'A'.repeat(11_200_004) // > 8 MB decoded
    expect((await post({ fileBase64: huge, mediaType: 'image/jpeg' })).status).toBe(413)
    expect(llm.llmComplete).not.toHaveBeenCalled()
  })
})

describe('POST — extraction via the gateway, draft only (zero auto-save)', () => {
  it('routes through llmComplete(task menu_extract, operatorId) and returns the validated draft', async () => {
    const res = await post({ fileBase64: IMG, mediaType: 'image/jpeg' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.draft).toHaveLength(2)
    expect(body.draft[0]).toMatchObject({ name: 'Burrata', price: 12.5, category: 'Entrées' })
    const call = llm.llmComplete.mock.calls[0][0]
    expect(call.task).toBe('menu_extract')
    expect(call.operatorId).toBe('op1')          // per-partner quota attribution
    // ⚠️ NOTHING is created — confirmation happens later via the existing POST /api/menu
    expect(db.menuItem.create).not.toHaveBeenCalled()
  })

  it('malformed model output → empty draft (no crash, still 200)', async () => {
    llm.llmComplete.mockResolvedValue({ text: 'sorry I cannot' })
    const res = await post({ fileBase64: IMG, mediaType: 'image/jpeg' })
    expect(res.status).toBe(200)
    expect((await res.json()).draft).toEqual([])
    expect(db.menuItem.create).not.toHaveBeenCalled()
  })

  it('gateway quota exceeded → 429', async () => {
    llm.llmComplete.mockRejectedValue(new llm.LlmQuotaError())
    expect((await post({ fileBase64: IMG, mediaType: 'image/jpeg' })).status).toBe(429)
  })
})
