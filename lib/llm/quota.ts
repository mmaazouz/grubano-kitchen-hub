/**
 * Per-PARTNER LLM quotas (cost-governance step 2, Agent 14).
 *
 * Soft, graceful budget per operator, read from the step-1 metering table
 * (LlmUsage.estimatedCostCents). The budget is MODEL-WEIGHTED for free: a Sonnet
 * call already records a higher estimatedCostCents than a Haiku one, so heavy
 * Sonnet use consumes the budget faster. Two rolling windows: calendar day + month.
 *
 * NON-NEGOTIABLE behaviours:
 *   - GENEROUS defaults — a legitimate partner never hits them (configurable via env).
 *   - GRACEFUL: over quota → the gateway throws LlmQuotaError BEFORE the SDK call, so
 *     each caller's EXISTING fail-safe applies (vetting → pending, routes → a clear
 *     429, never a naked 500).
 *   - FAIL-OPEN: if the usage check itself errors (transient DB issue), DO NOT block
 *     the call — a metering hiccup must never break the product. The hard stop is the
 *     step-1 kill-switch (LLM_DISABLED) and the step-3 global budget, not this check.
 *   - Quotas apply ONLY to operator-attributed calls; system/cron (email-agent) and
 *     pre-account vetting (creator apply / supplier register) pass no operatorId and
 *     are never blocked here.
 *
 * Thresholds are in the SAME estimated-cents unit as the gateway's placeholder cost
 * rates — calibrate both together. No schema: this reads LlmUsage only.
 */

import { prisma } from '@/lib/prisma'

// GENEROUS defaults (estimated cents). At the placeholder rates a typical call costs
// a fraction of a cent to a few cents, so these allow hundreds of calls/day.
export const QUOTA = {
  dailyCents:   Number(process.env.LLM_QUOTA_DAILY_CENTS)   || 1000,   // ~$10/day estimated
  monthlyCents: Number(process.env.LLM_QUOTA_MONTHLY_CENTS) || 20000,  // ~$200/month estimated
}

export class LlmQuotaError extends Error {
  constructor(public scope: 'day' | 'month' = 'day') {
    super(`LLM quota exceeded (${scope})`)
    this.name = 'LlmQuotaError'
  }
}

/** Day + month window starts (local time — single-region app). */
export function windowStarts(now: Date = new Date()): { dayStart: Date; monthStart: Date } {
  const dayStart = new Date(now)
  dayStart.setHours(0, 0, 0, 0)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  return { dayStart, monthStart }
}

export interface OperatorUsage { dayCents: number; monthCents: number }

/** Summed ESTIMATED cost for one operator over the day + month windows. */
export async function getOperatorUsage(operatorId: string, now: Date = new Date()): Promise<OperatorUsage> {
  const { dayStart, monthStart } = windowStarts(now)
  const [day, month] = await Promise.all([
    prisma.llmUsage.aggregate({ _sum: { estimatedCostCents: true }, where: { operatorId, createdAt: { gte: dayStart } } }),
    prisma.llmUsage.aggregate({ _sum: { estimatedCostCents: true }, where: { operatorId, createdAt: { gte: monthStart } } }),
  ])
  return {
    dayCents:   day._sum.estimatedCostCents   ?? 0,
    monthCents: month._sum.estimatedCostCents ?? 0,
  }
}

/**
 * Is this operator AT/ABOVE quota for the current day OR month? FAIL-OPEN: any error
 * returns false (never block the product on a transient metering failure).
 */
export async function isOverQuota(operatorId: string, now: Date = new Date()): Promise<boolean> {
  try {
    const { dayCents, monthCents } = await getOperatorUsage(operatorId, now)
    return dayCents >= QUOTA.dailyCents || monthCents >= QUOTA.monthlyCents
  } catch (e) {
    console.error('[llm-quota] usage check failed — FAIL-OPEN (allowing call):', e instanceof Error ? e.message : e)
    return false
  }
}

export interface UsageRow {
  operatorId:     string
  dayCents:       number
  monthCents:     number
  monthCalls:     number
  dayRemaining:   number
  monthRemaining: number
}

/** Admin overview: per-operator usage (day + month) + remaining vs quota, busiest first. */
export async function getUsageOverview(now: Date = new Date()): Promise<{ quota: typeof QUOTA; operators: UsageRow[] }> {
  const { dayStart, monthStart } = windowStarts(now)
  const [monthRows, dayRows] = await Promise.all([
    prisma.llmUsage.groupBy({
      by:     ['operatorId'],
      where:  { createdAt: { gte: monthStart }, operatorId: { not: null } },
      _sum:   { estimatedCostCents: true },
      _count: { _all: true },
    }),
    prisma.llmUsage.groupBy({
      by:    ['operatorId'],
      where: { createdAt: { gte: dayStart }, operatorId: { not: null } },
      _sum:  { estimatedCostCents: true },
    }),
  ])

  const dayMap = new Map<string, number>()
  for (const r of dayRows) if (r.operatorId) dayMap.set(r.operatorId, r._sum.estimatedCostCents ?? 0)

  const operators: UsageRow[] = monthRows
    .filter((r) => r.operatorId)
    .map((r) => {
      const operatorId = r.operatorId as string
      const monthCents = r._sum.estimatedCostCents ?? 0
      const dayCents   = dayMap.get(operatorId) ?? 0
      return {
        operatorId,
        dayCents,
        monthCents,
        monthCalls:     r._count._all,
        dayRemaining:   Math.max(0, QUOTA.dailyCents - dayCents),
        monthRemaining: Math.max(0, QUOTA.monthlyCents - monthCents),
      }
    })
    .sort((a, b) => b.monthCents - a.monthCents)

  return { quota: QUOTA, operators }
}
