import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── LLM gateway (cost-governance step 1, Agent 14) ────────────────────────────
// The gateway is the SOLE @anthropic-ai/sdk caller: it picks model + caps by task,
// meters every call into LlmUsage, and exposes a kill-switch. The SDK + prisma are
// mocked; this proves transport behaviour (the task modules' prompts/parsing/fail-
// safes are tested in their own suites).

const { createMock, db } = vi.hoisted(() => ({
  createMock: vi.fn(),
  db: { llmUsage: { create: vi.fn() } },
}))
vi.mock('@anthropic-ai/sdk', () => ({ default: class { messages = { create: createMock } } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import {
  llmComplete, isLlmDisabled, estimateCostCents, LlmDisabledError,
  HAIKU, SONNET, MAX_INPUT_CHARS,
} from '@/lib/llm'

const reply = (text: string, inTok = 10, outTok = 20) => ({
  content: [{ type: 'text', text }],
  usage:   { input_tokens: inTok, output_tokens: outTok },
})

beforeEach(() => {
  vi.clearAllMocks()
  db.llmUsage.create.mockResolvedValue({})
  delete process.env.LLM_DISABLED
})

describe('model + caps selection by task', () => {
  it('uses the configured model + max_output per task', async () => {
    createMock.mockResolvedValue(reply('ok'))
    await llmComplete({ task: 'supplier_vetting', content: 'x' })
    expect(createMock.mock.calls[0][0]).toMatchObject({ model: HAIKU, max_tokens: 200 })

    createMock.mockClear()
    await llmComplete({ task: 'dish_scan', content: 'x' })
    expect(createMock.mock.calls[0][0]).toMatchObject({ model: SONNET, max_tokens: 1024 })
  })

  it('honors a max-output override', async () => {
    createMock.mockResolvedValue(reply('ok'))
    await llmComplete({ task: 'briefing', content: 'x', maxOutputTokens: 50 })
    expect(createMock.mock.calls[0][0].max_tokens).toBe(50)
  })
})

describe('result + metering', () => {
  it('returns the first text block + real usage + estimated cost', async () => {
    createMock.mockResolvedValue(reply('hello', 1000, 2000))
    const r = await llmComplete({ task: 'creator_vetting', content: 'x' })
    expect(r.text).toBe('hello')
    expect(r.usage).toEqual({ inputTokens: 1000, outputTokens: 2000 })
    expect(r.model).toBe(HAIKU)
    expect(r.estimatedCostCents).toBeCloseTo((1000 * 100 + 2000 * 500) / 1_000_000, 6)
  })

  it('records ONE LlmUsage row per call (tokens + cost + task + operator)', async () => {
    createMock.mockResolvedValue(reply('ok', 100, 200))
    await llmComplete({ task: 'stock_parse', content: 'x', operatorId: 'op9' })
    expect(db.llmUsage.create).toHaveBeenCalledTimes(1)
    const data = db.llmUsage.create.mock.calls[0][0].data
    expect(data).toMatchObject({ task: 'stock_parse', model: SONNET, inputTokens: 100, outputTokens: 200, operatorId: 'op9' })
    expect(data.estimatedCostCents).toBeGreaterThan(0)
  })

  it('operatorId defaults to null when not provided', async () => {
    createMock.mockResolvedValue(reply('ok'))
    await llmComplete({ task: 'briefing', content: 'x' })
    expect(db.llmUsage.create.mock.calls[0][0].data.operatorId).toBeNull()
  })

  it('a metering DB failure is swallowed — the call still returns', async () => {
    createMock.mockResolvedValue(reply('hi'))
    db.llmUsage.create.mockRejectedValue(new Error('db down'))
    const r = await llmComplete({ task: 'creator_vetting', content: 'x' })
    expect(r.text).toBe('hi')
  })
})

describe('kill-switch + error surfacing (caller fail-safe applies)', () => {
  it('LLM_DISABLED → throws LlmDisabledError, NO SDK call, NO metering', async () => {
    process.env.LLM_DISABLED = '1'
    await expect(llmComplete({ task: 'creator_vetting', content: 'x' })).rejects.toBeInstanceOf(LlmDisabledError)
    expect(createMock).not.toHaveBeenCalled()
    expect(db.llmUsage.create).not.toHaveBeenCalled()
  })

  it('isLlmDisabled parses 1/true/yes vs off', () => {
    process.env.LLM_DISABLED = 'true'; expect(isLlmDisabled()).toBe(true)
    process.env.LLM_DISABLED = 'YES';  expect(isLlmDisabled()).toBe(true)
    process.env.LLM_DISABLED = '0';    expect(isLlmDisabled()).toBe(false)
    delete process.env.LLM_DISABLED;   expect(isLlmDisabled()).toBe(false)
  })

  it('an SDK/transport error propagates (so the caller fail-safe runs)', async () => {
    createMock.mockRejectedValue(new Error('500'))
    await expect(llmComplete({ task: 'creator_vetting', content: 'x' })).rejects.toThrow()
  })
})

describe('input caps + multimodal passthrough', () => {
  it('caps oversized text (backstop) but leaves normal input untouched', async () => {
    createMock.mockResolvedValue(reply('ok'))
    const huge = 'a'.repeat(MAX_INPUT_CHARS + 5000)
    await llmComplete({ task: 'briefing', content: huge })
    const sent = createMock.mock.calls[0][0].messages[0].content as string
    expect(sent.length).toBeLessThan(huge.length)
    expect(sent).toContain('troncature')

    createMock.mockClear()
    await llmComplete({ task: 'briefing', content: 'small' })
    expect(createMock.mock.calls[0][0].messages[0].content).toBe('small')
  })

  it('passes multimodal content blocks through (image untouched)', async () => {
    createMock.mockResolvedValue(reply('ok'))
    const content = [
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'abc' } },
      { type: 'text',  text: 'desc' },
    ] as const
    await llmComplete({ task: 'dish_moderation', content: content as never })
    const sent = createMock.mock.calls[0][0].messages[0].content
    expect(Array.isArray(sent)).toBe(true)
    expect(sent[0].type).toBe('image')
  })
})

describe('estimateCostCents', () => {
  it('uses per-model placeholder rates; unknown model → 0', () => {
    expect(estimateCostCents(HAIKU, 1_000_000, 0)).toBeCloseTo(100, 6)
    expect(estimateCostCents(SONNET, 0, 1_000_000)).toBeCloseTo(1500, 6)
    expect(estimateCostCents('unknown-model', 1000, 1000)).toBe(0)
  })
})
