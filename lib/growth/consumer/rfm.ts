// ── Growth / consumer — RFM aggregation + cohort assignment ───────────────────────────
//
// PURE. No I/O, no clock reads. Builds a per-(tenant × contact) snapshot from a batch of
// normalised orders (see ./money.ts) and attaches an explainable cohort. Deterministic.
//
// Doctrine (why this file exists):
//   - Base `consumerRFM` in ../scoring.ts is correct but input-naive: it accepts any list
//     of `{atMs, valueCents}` and returns the score. It does not know about tenants, it
//     does not know about refunds, and it does not expose cohort reasons. This file
//     COMPOSES ../scoring.ts on top of the money normaliser and makes tenant isolation
//     an INPUT-level invariant, not a caller discipline.
//   - Tenant isolation: the input scope is explicit (`tenantRestaurantId × contactId`).
//     Any order row that does not match that scope is rejected in ./money.ts (reason
//     'tenant_mismatch') and never contributes. A test that reproduces the A→B cross-
//     account leak proves this file does not fold B's orders into A's cohort.
//   - Cohort assignment is DETERMINISTIC and PRIORITY-ORDERED so an operator can read the
//     reason off the row and reconstruct the decision without re-running the function.

import type { ConsumerRFM } from '../scoring'
import { consumerRFM, reorderWindowDays } from '../scoring'
import type { ConsumerOrderInput, ConsumerOrderNet } from './money'
import { normaliseOrderBatch } from './money'

// ── Cohort taxonomy ────────────────────────────────────────────────────────────────────

export const CONSUMER_COHORTS = [
  'none',          // zero countable orders
  'new',           // exactly 1 lifetime order within newWindowDays
  'first_time',    // exactly 1 lifetime order, outside newWindowDays
  'high_value',    // ≥2 countable orders in-window AND monetary ≥ highValueCents
  'regular',       // ≥2 countable orders AND recency ≤ reorderMedian
  'at_risk',       // ≥2 orders AND reorderMedian < recency ≤ 2× reorderMedian
  'dormant',       // ≥2 orders AND 2× < recency ≤ 4× reorderMedian
  'winback',       // ≥1 order AND 4× < recency ≤ winbackMaxDays — reachable once
  'lost',          // recency > winbackMaxDays — do not solicit via commercial channels
] as const
export type ConsumerCohort = (typeof CONSUMER_COHORTS)[number]

// ── Options ────────────────────────────────────────────────────────────────────────────

export interface ConsumerRFMOptions {
  /** Window (days) over which F and M are counted. Default 365. */
  windowDays?:        number
  /** How recent counts as 'new' for a 1-order customer. Default 14. */
  newWindowDays?:     number
  /** Monetary threshold (cents) in-window for `high_value`. Default 15_000 (= 150 €). */
  highValueCents?:    number
  /** Reorder median (days). If omitted, we derive it from the contact's own history
   *  (fallback 21 days when fewer than 2 orders), via `reorderWindowDays`. */
  reorderMedianDays?: number
  /** Max days after which a contact is 'lost' — no more commercial outreach. Default 365. */
  winbackMaxDays?:    number
  /**
   * GDPR Art. 17 — the contact has been erased. Fail-closed when `true`: the snapshot is
   * emitted empty (no cohort other than 'none', no monetary, no first/last order), so a
   * downstream NBA cannot build an audience row for an erased contact. The flag is also
   * carried on the snapshot so `decideNBA` can redundantly enforce the stop.
   * Caller contract: the field must come from an AUTHORITATIVE source (persisted DB flag),
   * never a literal; this library never reaches a DB.
   */
  gdprErased?:        boolean
}

// ── Snapshot shape ─────────────────────────────────────────────────────────────────────

export interface ConsumerRFMSnapshot {
  tenantRestaurantId: string
  contactId:          string
  nowMs:              number
  windowDays:         number
  /** Base RFM numbers (recencyDays / frequency / monetaryCents / 0..100 score). */
  rfm:                ConsumerRFM
  /** Lifetime (all-time) counts across COUNTABLE orders — not restricted to the window. */
  lifetimeOrders:         number
  lifetimeMonetaryCents:  number
  /** First / last countable order instants, or null if there are none. */
  firstOrderAtMs:  number | null
  lastOrderAtMs:   number | null
  /** The reorderMedianDays actually used (either provided or derived). */
  reorderMedianDays: number
  cohort:          ConsumerCohort
  /** Ordered, human-readable reasons that fed the cohort decision. Deterministic. */
  cohortReasons:   string[]
  /** Rows rejected by the money normaliser, kept for audit (not counted anywhere). */
  rejected:        ConsumerOrderNet[]
  /** GDPR Art. 17 — propagated from opts.gdprErased so decideNBA/planDryRun can enforce
   *  the stop at every layer. When true, every other field is normalised to the empty
   *  state (no cohort other than 'none', zero monetary, no first/last order). */
  gdprErased:      boolean
}

// ── Entry point ────────────────────────────────────────────────────────────────────────

export function buildRFMSnapshot(
  scope: { tenantRestaurantId: string; contactId: string },
  rows:  readonly ConsumerOrderInput[],
  nowMs: number,
  opts:  ConsumerRFMOptions = {},
): ConsumerRFMSnapshot {
  const windowDays     = opts.windowDays     ?? 365
  const newWindowDays  = opts.newWindowDays  ?? 14
  const highValueCents = opts.highValueCents ?? 15_000
  const winbackMaxDays = opts.winbackMaxDays ?? 365
  const gdprErased     = opts.gdprErased === true

  // ── GDPR Art. 17 fail-closed: emit an empty snapshot regardless of the input rows. ──
  if (gdprErased) {
    return {
      tenantRestaurantId: scope.tenantRestaurantId,
      contactId:          scope.contactId,
      nowMs,
      windowDays,
      rfm: { recencyDays: Number.POSITIVE_INFINITY, frequency: 0, monetaryCents: 0, score: 0 },
      lifetimeOrders:         0,
      lifetimeMonetaryCents:  0,
      firstOrderAtMs:         null,
      lastOrderAtMs:          null,
      reorderMedianDays:      opts.reorderMedianDays ?? 21,
      cohort:                 'none',
      cohortReasons:          ['gdpr_erased'],
      rejected:               [],
      gdprErased:             true,
    }
  }

  const normalised = normaliseOrderBatch(scope, rows, nowMs)
  const countable  = normalised.filter((n) => n.countable)
  const rejected   = normalised.filter((n) => !n.countable)

  // ── Base RFM ──
  const points = countable.map((n) => ({ atMs: n.atMs, valueCents: n.netCents }))
  const rfm = consumerRFM({ nowMs, orders: points, windowDays })

  // ── Lifetime counts (unbounded) ──
  const lifetimeOrders = countable.length
  const lifetimeMonetaryCents = countable.reduce((a, n) => a + n.netCents, 0)
  const firstOrderAtMs = countable.length === 0 ? null : countable.reduce((min, n) => n.atMs < min ? n.atMs : min, countable[0].atMs)
  const lastOrderAtMs  = countable.length === 0 ? null : countable.reduce((max, n) => n.atMs > max ? n.atMs : max, countable[0].atMs)

  // ── Reorder median: provided > derived > fallback ──
  const reorderMedianDays = opts.reorderMedianDays ?? reorderWindowDays(points)

  // ── Cohort ──
  const { cohort, cohortReasons } = assignCohort({
    rfm,
    lifetimeOrders,
    firstOrderAtMs,
    nowMs,
    newWindowDays,
    highValueCents,
    reorderMedianDays,
    winbackMaxDays,
  })

  return {
    tenantRestaurantId: scope.tenantRestaurantId,
    contactId:          scope.contactId,
    nowMs,
    windowDays,
    rfm,
    lifetimeOrders,
    lifetimeMonetaryCents,
    firstOrderAtMs,
    lastOrderAtMs,
    reorderMedianDays,
    cohort,
    cohortReasons,
    rejected,
    gdprErased:         false,
  }
}

// ── Cohort decision ────────────────────────────────────────────────────────────────────

interface CohortInput {
  rfm:                ConsumerRFM
  lifetimeOrders:     number
  firstOrderAtMs:     number | null
  nowMs:              number
  newWindowDays:      number
  highValueCents:     number
  reorderMedianDays:  number
  winbackMaxDays:     number
}

/**
 * Priority-ordered cohort decision. The first match wins. The reasons list records the
 * numeric comparisons that fed each check, so a dashboard can show WHY a contact is in
 * their cohort without re-running the function.
 */
function assignCohort(i: CohortInput): { cohort: ConsumerCohort; cohortReasons: string[] } {
  const reasons: string[] = []
  reasons.push(`lifetimeOrders=${i.lifetimeOrders}`)
  reasons.push(`recencyDays=${Number.isFinite(i.rfm.recencyDays) ? i.rfm.recencyDays.toFixed(2) : 'inf'}`)
  reasons.push(`frequencyInWindow=${i.rfm.frequency}`)
  reasons.push(`monetaryCentsInWindow=${i.rfm.monetaryCents}`)
  reasons.push(`reorderMedianDays=${i.reorderMedianDays}`)

  if (i.lifetimeOrders === 0 || i.firstOrderAtMs === null) {
    reasons.push('no_countable_orders')
    return { cohort: 'none', cohortReasons: reasons }
  }

  const firstOrderAgeDays = (i.nowMs - i.firstOrderAtMs) / 86_400_000

  if (i.lifetimeOrders === 1) {
    if (firstOrderAgeDays <= i.newWindowDays) {
      reasons.push(`firstOrderAgeDays=${firstOrderAgeDays.toFixed(2)} <= ${i.newWindowDays}`)
      return { cohort: 'new', cohortReasons: reasons }
    }
    reasons.push(`firstOrderAgeDays=${firstOrderAgeDays.toFixed(2)} > ${i.newWindowDays}`)
    return { cohort: 'first_time', cohortReasons: reasons }
  }

  // ≥ 2 lifetime orders — bucket by recency vs reorder median.
  const r = i.rfm.recencyDays
  const m = i.reorderMedianDays

  // 'lost' first so a very dormant high-spender still exits (we don't solicit them).
  if (!Number.isFinite(r) || r > i.winbackMaxDays) {
    reasons.push(`recency>${i.winbackMaxDays}`)
    return { cohort: 'lost', cohortReasons: reasons }
  }

  if (r <= m) {
    if (i.rfm.monetaryCents >= i.highValueCents && i.rfm.frequency >= 2) {
      reasons.push(`monetaryCents>=${i.highValueCents}`)
      return { cohort: 'high_value', cohortReasons: reasons }
    }
    reasons.push(`recency<=${m}`)
    return { cohort: 'regular', cohortReasons: reasons }
  }
  if (r <= 2 * m) {
    reasons.push(`${m}<recency<=${2 * m}`)
    return { cohort: 'at_risk', cohortReasons: reasons }
  }
  if (r <= 4 * m) {
    reasons.push(`${2 * m}<recency<=${4 * m}`)
    return { cohort: 'dormant', cohortReasons: reasons }
  }
  // r > 4m but r ≤ winbackMaxDays → one last reach.
  reasons.push(`${4 * m}<recency<=${i.winbackMaxDays}`)
  return { cohort: 'winback', cohortReasons: reasons }
}
