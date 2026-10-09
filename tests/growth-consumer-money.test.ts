// tests/growth-consumer-money.test.ts — net-cents normaliser for consumer orders.
// Adversarial focus: partial/full refunds, cancelled/non-paid orders, duplicate orderIds
// across the same batch, tenant/contact mismatch (A→B leak), negative or non-integer cents.

import { describe, it, expect } from 'vitest'
import {
  orderNet,
  normaliseOrderBatch,
  type ConsumerOrderInput,
} from '@/lib/growth/consumer/money'

const base: ConsumerOrderInput = {
  orderId: 'o1',
  tenantRestaurantId: 'tenant-A',
  contactId: 'contact-1',
  atMs: 1_700_000_000_000,
  status: 'delivered',
  paymentStatus: 'paid',
  grossCents: 2_500,
  refundCentsList: [],
}

describe('orderNet — core rules', () => {
  it('a delivered + paid + no-refund order is countable at full gross cents', () => {
    const n = orderNet(base)
    expect(n.countable).toBe(true)
    expect(n.reason).toBe('ok')
    expect(n.netCents).toBe(2_500)
  })

  it('cancelled → not countable regardless of paymentStatus', () => {
    const n = orderNet({ ...base, status: 'cancelled', paymentStatus: 'paid' })
    expect(n.countable).toBe(false)
    expect(n.reason).toBe('cancelled')
    expect(n.netCents).toBe(0)
  })

  it('status reached delivered but paymentStatus never paid → not countable (orphan)', () => {
    const n = orderNet({ ...base, paymentStatus: 'pending' })
    expect(n.countable).toBe(false)
    expect(n.reason).toBe('not_paid')
  })

  it('paymentStatus null → not countable', () => {
    const n = orderNet({ ...base, paymentStatus: null })
    expect(n.countable).toBe(false)
    expect(n.reason).toBe('not_paid')
  })

  it('status "received" + paid → not completed → not countable (abandoned-flow guard)', () => {
    const n = orderNet({ ...base, status: 'received' })
    expect(n.countable).toBe(false)
    expect(n.reason).toBe('not_completed')
  })

  it('status "preparing" + paid → not completed → not countable', () => {
    const n = orderNet({ ...base, status: 'preparing' })
    expect(n.countable).toBe(false)
    expect(n.reason).toBe('not_completed')
  })

  it('status "ready" / "picked_up" / "delivered" all count when paid', () => {
    for (const status of ['ready', 'picked_up', 'delivered'] as const) {
      expect(orderNet({ ...base, status }).countable).toBe(true)
    }
  })
})

describe('orderNet — refunds', () => {
  it('partial refund subtracts from gross (no double counting across the list)', () => {
    const n = orderNet({ ...base, grossCents: 2_500, refundCentsList: [500, 300] })
    expect(n.countable).toBe(true)
    expect(n.netCents).toBe(1_700)
  })

  it('full refund (sum === gross) → not countable, reason "fully_refunded"', () => {
    const n = orderNet({ ...base, grossCents: 2_500, refundCentsList: [2_000, 500] })
    expect(n.countable).toBe(false)
    expect(n.reason).toBe('fully_refunded')
  })

  it('over-refund (sum > gross) → not countable "fully_refunded", net clamps to 0', () => {
    const n = orderNet({ ...base, grossCents: 2_500, refundCentsList: [3_000] })
    expect(n.countable).toBe(false)
    expect(n.reason).toBe('fully_refunded')
    expect(n.netCents).toBe(0)
  })

  it('negative refund in list → invalid_amount (fail-closed, not silent clamp)', () => {
    const n = orderNet({ ...base, refundCentsList: [-100] })
    expect(n.countable).toBe(false)
    expect(n.reason).toBe('invalid_amount')
  })

  it('non-integer refund (float cents) → invalid_amount', () => {
    const n = orderNet({ ...base, refundCentsList: [12.5] })
    expect(n.countable).toBe(false)
    expect(n.reason).toBe('invalid_amount')
  })

  it('NaN refund → invalid_amount', () => {
    const n = orderNet({ ...base, refundCentsList: [Number.NaN] })
    expect(n.countable).toBe(false)
    expect(n.reason).toBe('invalid_amount')
  })

  it('zero refund entries are ignored (no-op)', () => {
    const n = orderNet({ ...base, grossCents: 1_000, refundCentsList: [0, 0] })
    expect(n.countable).toBe(true)
    expect(n.netCents).toBe(1_000)
  })

  it('cancelled wins over fully_refunded (cancelled check runs first)', () => {
    const n = orderNet({ ...base, status: 'cancelled', refundCentsList: [2_500] })
    expect(n.reason).toBe('cancelled')
  })
})

describe('orderNet — invalid amounts', () => {
  it('gross = 0 → invalid_amount', () => {
    expect(orderNet({ ...base, grossCents: 0 }).reason).toBe('invalid_amount')
  })

  it('gross negative → invalid_amount, cannot be rescued by a refund', () => {
    const n = orderNet({ ...base, grossCents: -500, refundCentsList: [100] })
    expect(n.reason).toBe('invalid_amount')
  })

  it('gross non-integer (float euros slipped in) → invalid_amount', () => {
    expect(orderNet({ ...base, grossCents: 12.99 }).reason).toBe('invalid_amount')
  })
})

describe('normaliseOrderBatch — scope + duplicates', () => {
  const scope = { tenantRestaurantId: 'tenant-A', contactId: 'contact-1' }

  it('a row from tenant B is stamped tenant_mismatch (no leak into A/contact-1 totals)', () => {
    const out = normaliseOrderBatch(scope, [
      { ...base },
      { ...base, orderId: 'o2', tenantRestaurantId: 'tenant-B' },
    ])
    expect(out[0].countable).toBe(true)
    expect(out[1].countable).toBe(false)
    expect(out[1].reason).toBe('tenant_mismatch')
  })

  it('a row for a different contactId at the same tenant is stamped tenant_mismatch', () => {
    const out = normaliseOrderBatch(scope, [
      { ...base, orderId: 'o-other', contactId: 'contact-2' },
    ])
    expect(out[0].reason).toBe('tenant_mismatch')
  })

  it('duplicate orderId: first wins, second stamped duplicate (no inflation)', () => {
    const out = normaliseOrderBatch(scope, [
      { ...base, orderId: 'o-dup', grossCents: 1_000 },
      { ...base, orderId: 'o-dup', grossCents: 1_000 },
    ])
    expect(out[0].countable).toBe(true)
    expect(out[1].countable).toBe(false)
    expect(out[1].reason).toBe('duplicate')
  })

  it('a tenant_mismatch row is NOT consumed by the dedupe set — a legitimate same-id row later still wins', () => {
    // Doctrine: if B leaked a row with orderId "x", a legitimate A row with the same id
    // (unlikely but possible across tenants, since orderIds are per-DB-row) must still
    // be countable. The dedupe set only tracks SUCCESSFULLY-scoped rows.
    const out = normaliseOrderBatch(scope, [
      { ...base, orderId: 'o-x', tenantRestaurantId: 'tenant-B' },
      { ...base, orderId: 'o-x' },
    ])
    expect(out[0].reason).toBe('tenant_mismatch')
    expect(out[1].countable).toBe(true)
  })
})
