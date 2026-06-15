import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Per-partner LLM quotas (cost-governance step 2, Agent 14) ─────────────────
// Reads LlmUsage.estimatedCostCents (model-weighted) over day + month windows.
// GENEROUS defaults, FAIL-OPEN on error. prisma is mocked.

const { db } = vi.hoisted(() => ({
  db: { llmUsage: { aggregate: vi.fn(), groupBy: vi.fn() } },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { getOperatorUsage, isOverQuota, windowStarts, getUsageOverview, QUOTA } from '@/lib/llm/quota'

const agg = (cents: number | null) => ({ _sum: { estimatedCostCents: cents } })

beforeEach(() => { vi.clearAllMocks() })

describe('windowStarts', () => {
  it('day start = local midnight; month start = the 1st', () => {
    const now = new Date(2026, 5, 15, 14, 30) // 15 June 2026, 14:30 local
    const { dayStart, monthStart } = windowStarts(now)
    expect(dayStart.getHours()).toBe(0)
    expect(dayStart.getDate()).toBe(15)
    expect(monthStart.getDate()).toBe(1)
    expect(monthStart.getMonth()).toBe(5)
  })
})

describe('getOperatorUsage', () => {
  it('sums day then month estimatedCostCents', async () => {
    db.llmUsage.aggregate.mockResolvedValueOnce(agg(120)).mockResolvedValueOnce(agg(900))
    expect(await getOperatorUsage('op1')).toEqual({ dayCents: 120, monthCents: 900 })
  })
  it('treats a null sum as 0', async () => {
    db.llmUsage.aggregate.mockResolvedValue(agg(null))
    expect(await getOperatorUsage('op1')).toEqual({ dayCents: 0, monthCents: 0 })
  })
})

describe('isOverQuota', () => {
  it('under both windows → false (call allowed)', async () => {
    db.llmUsage.aggregate.mockResolvedValue(agg(1))
    expect(await isOverQuota('op1')).toBe(false)
  })
  it('at/over the DAILY quota → true', async () => {
    db.llmUsage.aggregate.mockResolvedValueOnce(agg(QUOTA.dailyCents)).mockResolvedValueOnce(agg(0))
    expect(await isOverQuota('op1')).toBe(true)
  })
  it('at/over the MONTHLY quota (day fine) → true', async () => {
    db.llmUsage.aggregate.mockResolvedValueOnce(agg(0)).mockResolvedValueOnce(agg(QUOTA.monthlyCents))
    expect(await isOverQuota('op1')).toBe(true)
  })
  it('FAIL-OPEN: aggregate throws → false (never block on a metering error)', async () => {
    db.llmUsage.aggregate.mockRejectedValue(new Error('db down'))
    expect(await isOverQuota('op1')).toBe(false)
  })
})

describe('getUsageOverview', () => {
  it('merges month + day, computes remaining, busiest month first', async () => {
    db.llmUsage.groupBy
      .mockResolvedValueOnce([ // month
        { operatorId: 'opA', _sum: { estimatedCostCents: 500 },  _count: { _all: 10 } },
        { operatorId: 'opB', _sum: { estimatedCostCents: 1500 }, _count: { _all: 30 } },
      ])
      .mockResolvedValueOnce([ // day
        { operatorId: 'opB', _sum: { estimatedCostCents: 200 } },
      ])
    const { quota, operators } = await getUsageOverview()
    expect(quota).toEqual(QUOTA)
    expect(operators[0]).toMatchObject({ operatorId: 'opB', monthCents: 1500, dayCents: 200, monthCalls: 30 })
    expect(operators[0].monthRemaining).toBe(Math.max(0, QUOTA.monthlyCents - 1500))
    expect(operators[0].dayRemaining).toBe(Math.max(0, QUOTA.dailyCents - 200))
    expect(operators[1]).toMatchObject({ operatorId: 'opA', monthCents: 500, dayCents: 0 })
  })
})
