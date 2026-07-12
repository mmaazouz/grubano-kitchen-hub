import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Graceful degradation at a route (step 2, Agent 14) ────────────────────────
// When the gateway throws LlmQuotaError, an authenticated route returns a CLEAR
// 429 — never a naked 500 — and it passes the session operatorId to the gateway.
// Exemplar: reviews/generate-reply (the others map LlmQuotaError → 429 the same way).

const { llmMock, QuotaErr, caller } = vi.hoisted(() => {
  class QuotaErr extends Error { constructor() { super('quota'); this.name = 'LlmQuotaError' } }
  return { llmMock: vi.fn(), QuotaErr, caller: vi.fn() }
})
vi.mock('@/lib/llm', () => ({ llmComplete: llmMock, LlmQuotaError: QuotaErr }))
vi.mock('@/lib/operator-session', () => ({ callerOperator: caller }))

import { POST } from '@/app/api/reviews/generate-reply/route'

const post = () => POST(new Request('http://x/api/reviews/generate-reply', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ platform: 'Google', authorName: 'Alex', rating: 5, text: 'super' }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  caller.mockResolvedValue({ id: 'op1', role: 'restaurant' })
})

it('quota exceeded → 429 with a clear message (no naked 500)', async () => {
  llmMock.mockRejectedValue(new QuotaErr())
  const res = await post()
  expect(res.status).toBe(429)
  expect((await res.json()).error).toContain('Limite IA')
})

it('under quota → 200 reply', async () => {
  llmMock.mockResolvedValue({ text: "Merci beaucoup ! L'équipe Grubano" })
  const res = await post()
  expect(res.status).toBe(200)
  expect((await res.json()).reply).toContain('Grubano')
})

it('passes the session operatorId to the gateway', async () => {
  llmMock.mockResolvedValue({ text: 'ok' })
  await post()
  expect(llmMock.mock.calls[0][0].operatorId).toBe('op1')
})
