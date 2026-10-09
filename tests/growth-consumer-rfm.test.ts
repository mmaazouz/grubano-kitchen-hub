// tests/growth-consumer-rfm.test.ts — tenant-isolated RFM + cohort assignment.
// Adversarial focus: A↔B leaks must NOT inflate B's RFM; refunds reduce monetary;
// recency boundaries pick the right cohort; `none`/`new`/`first_time`/`regular`/
// `high_value`/`at_risk`/`dormant`/`winback`/`lost` all reachable with explicit math.

import { describe, it, expect } from 'vitest'
import { buildRFMSnapshot } from '@/lib/growth/consumer/rfm'
import type { ConsumerOrderInput } from '@/lib/growth/consumer/money'

const DAY = 86_400_000
const NOW = 1_700_000_000_000

function paidOrder(partial: Partial<ConsumerOrderInput>): ConsumerOrderInput {
  return {
    orderId: partial.orderId ?? 'o?',
    tenantRestaurantId: partial.tenantRestaurantId ?? 'tenant-A',
    contactId: partial.contactId ?? 'contact-1',
    atMs: partial.atMs ?? NOW - 7 * DAY,
    status: partial.status ?? 'delivered',
    paymentStatus: partial.paymentStatus ?? 'paid',
    grossCents: partial.grossCents ?? 2_500,
    refundCentsList: partial.refundCentsList ?? [],
  }
}

const scope = { tenantRestaurantId: 'tenant-A', contactId: 'contact-1' }

describe('buildRFMSnapshot — tenant isolation (A↔B leak)', () => {
  it('does NOT fold tenant-B orders into tenant-A RFM', () => {
    const snap = buildRFMSnapshot(scope, [
      paidOrder({ orderId: 'A1', atMs: NOW - 3 * DAY, grossCents: 1_500 }),
      paidOrder({ orderId: 'B1', tenantRestaurantId: 'tenant-B', atMs: NOW - 1 * DAY, grossCents: 9_999 }),
    ], NOW)
    expect(snap.lifetimeOrders).toBe(1)
    expect(snap.rfm.frequency).toBe(1)
    expect(snap.rfm.monetaryCents).toBe(1_500)
    expect(snap.rejected.some((r) => r.reason === 'tenant_mismatch' && r.orderId === 'B1')).toBe(true)
  })

  it('does NOT fold a different contactId at the same tenant into this snapshot', () => {
    const snap = buildRFMSnapshot(scope, [
      paidOrder({ orderId: 'A1', atMs: NOW - 2 * DAY, grossCents: 1_000 }),
      paidOrder({ orderId: 'X1', contactId: 'contact-2', atMs: NOW - 1 * DAY, grossCents: 50_000 }),
    ], NOW)
    expect(snap.lifetimeMonetaryCents).toBe(1_000)
    expect(snap.rejected.some((r) => r.orderId === 'X1' && r.reason === 'tenant_mismatch')).toBe(true)
  })
})

describe('buildRFMSnapshot — refund handling', () => {
  it('partial refunds reduce monetary but keep the order countable', () => {
    const snap = buildRFMSnapshot(scope, [
      paidOrder({ orderId: 'o1', atMs: NOW - 5 * DAY, grossCents: 5_000, refundCentsList: [1_500] }),
    ], NOW)
    expect(snap.rfm.monetaryCents).toBe(3_500)
    expect(snap.lifetimeOrders).toBe(1)
  })

  it('fully refunded order is excluded (frequency = 0)', () => {
    const snap = buildRFMSnapshot(scope, [
      paidOrder({ orderId: 'o1', atMs: NOW - 5 * DAY, grossCents: 2_000, refundCentsList: [2_000] }),
    ], NOW)
    expect(snap.rfm.frequency).toBe(0)
    expect(snap.lifetimeOrders).toBe(0)
    expect(snap.cohort).toBe('none')
  })

  it('cancelled orders are excluded', () => {
    const snap = buildRFMSnapshot(scope, [
      paidOrder({ orderId: 'o1', status: 'cancelled', atMs: NOW - 5 * DAY, grossCents: 5_000 }),
    ], NOW)
    expect(snap.cohort).toBe('none')
  })
})

describe('buildRFMSnapshot — cohorts', () => {
  it('zero countable orders → cohort "none"', () => {
    const snap = buildRFMSnapshot(scope, [], NOW)
    expect(snap.cohort).toBe('none')
    expect(snap.rfm.recencyDays).toBe(Number.POSITIVE_INFINITY)
  })

  it('exactly 1 order within newWindowDays (default 14) → cohort "new"', () => {
    const snap = buildRFMSnapshot(scope, [
      paidOrder({ orderId: 'o1', atMs: NOW - 3 * DAY, grossCents: 2_000 }),
    ], NOW)
    expect(snap.cohort).toBe('new')
  })

  it('exactly 1 order older than newWindowDays → cohort "first_time"', () => {
    const snap = buildRFMSnapshot(scope, [
      paidOrder({ orderId: 'o1', atMs: NOW - 30 * DAY, grossCents: 2_000 }),
    ], NOW, { newWindowDays: 14, winbackMaxDays: 365 })
    expect(snap.cohort).toBe('first_time')
  })

  it('≥2 orders, recent, under threshold → cohort "regular"', () => {
    // reorderMedian = 14 (gap between the two orders), latest 1d old → r/m = 1/14 → regular
    const snap = buildRFMSnapshot(scope, [
      paidOrder({ orderId: 'o1', atMs: NOW - 15 * DAY, grossCents: 1_000 }),
      paidOrder({ orderId: 'o2', atMs: NOW -  1 * DAY, grossCents: 1_000 }),
    ], NOW)
    expect(snap.cohort).toBe('regular')
  })

  it('≥2 orders, recent, monetary ≥ highValueCents → cohort "high_value"', () => {
    const snap = buildRFMSnapshot(scope, [
      paidOrder({ orderId: 'o1', atMs: NOW - 15 * DAY, grossCents: 10_000 }),
      paidOrder({ orderId: 'o2', atMs: NOW -  1 * DAY, grossCents: 10_000 }),
    ], NOW, { highValueCents: 15_000 })
    expect(snap.cohort).toBe('high_value')
  })

  it('≥2 orders, m < recency ≤ 2m → cohort "at_risk"', () => {
    // Use explicit median=10d, recency=15d → 1x < 1.5 ≤ 2x → at_risk
    const snap = buildRFMSnapshot(scope, [
      paidOrder({ orderId: 'o1', atMs: NOW - 60 * DAY, grossCents: 1_000 }),
      paidOrder({ orderId: 'o2', atMs: NOW - 15 * DAY, grossCents: 1_000 }),
    ], NOW, { reorderMedianDays: 10 })
    expect(snap.cohort).toBe('at_risk')
  })

  it('≥2 orders, 2m < recency ≤ 4m → cohort "dormant"', () => {
    const snap = buildRFMSnapshot(scope, [
      paidOrder({ orderId: 'o1', atMs: NOW - 120 * DAY, grossCents: 1_000 }),
      paidOrder({ orderId: 'o2', atMs: NOW -  30 * DAY, grossCents: 1_000 }),
    ], NOW, { reorderMedianDays: 10 })
    expect(snap.cohort).toBe('dormant')
  })

  it('≥2 orders, 4m < recency ≤ winbackMaxDays → cohort "winback"', () => {
    const snap = buildRFMSnapshot(scope, [
      paidOrder({ orderId: 'o1', atMs: NOW - 200 * DAY, grossCents: 1_000 }),
      paidOrder({ orderId: 'o2', atMs: NOW - 100 * DAY, grossCents: 1_000 }),
    ], NOW, { reorderMedianDays: 10, winbackMaxDays: 365 })
    expect(snap.cohort).toBe('winback')
  })

  it('recency > winbackMaxDays → cohort "lost"', () => {
    const snap = buildRFMSnapshot(scope, [
      paidOrder({ orderId: 'o1', atMs: NOW - 1_000 * DAY, grossCents: 1_000 }),
      paidOrder({ orderId: 'o2', atMs: NOW -   900 * DAY, grossCents: 1_000 }),
    ], NOW, { winbackMaxDays: 365 })
    expect(snap.cohort).toBe('lost')
  })

  it('cohortReasons record the numeric comparisons for each decision', () => {
    const snap = buildRFMSnapshot(scope, [
      paidOrder({ orderId: 'o1', atMs: NOW - 3 * DAY, grossCents: 2_000 }),
    ], NOW)
    expect(snap.cohortReasons.some((r) => r.startsWith('lifetimeOrders=1'))).toBe(true)
    expect(snap.cohortReasons.some((r) => r.startsWith('firstOrderAgeDays='))).toBe(true)
  })
})

describe('buildRFMSnapshot — windowing and determinism', () => {
  it('frequency counts only orders inside windowDays; monetary matches', () => {
    const snap = buildRFMSnapshot(scope, [
      paidOrder({ orderId: 'o1', atMs: NOW - 400 * DAY, grossCents: 1_000 }), // outside 365d window
      paidOrder({ orderId: 'o2', atMs: NOW -  10 * DAY, grossCents: 2_000 }),
    ], NOW)
    expect(snap.rfm.frequency).toBe(1)
    expect(snap.rfm.monetaryCents).toBe(2_000)
    expect(snap.lifetimeOrders).toBe(2)
    expect(snap.lifetimeMonetaryCents).toBe(3_000)
  })

  it('a future-dated order (clock skew / malicious producer) is REJECTED entirely (invalid_atMs)', () => {
    // Doctrine update (b2c hardening): a future atMs is fail-closed — it cannot land in
    // either the window OR the lifetime count. It appears only in the `rejected` audit.
    const snap = buildRFMSnapshot(scope, [
      paidOrder({ orderId: 'o1', atMs: NOW + 5 * DAY, grossCents: 9_999 }),
    ], NOW)
    expect(snap.rfm.frequency).toBe(0)
    expect(snap.lifetimeOrders).toBe(0)
    expect(snap.rejected.some((r) => r.orderId === 'o1' && r.reason === 'invalid_atMs')).toBe(true)
  })

  it('calling twice with the same inputs returns identical results (pure)', () => {
    const inputs = [
      paidOrder({ orderId: 'o1', atMs: NOW - 10 * DAY, grossCents: 1_200 }),
      paidOrder({ orderId: 'o2', atMs: NOW -  2 * DAY, grossCents:   800 }),
    ]
    const a = buildRFMSnapshot(scope, inputs, NOW)
    const b = buildRFMSnapshot(scope, inputs, NOW)
    expect(a).toEqual(b)
  })
})
