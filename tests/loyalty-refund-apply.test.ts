// tests/loyalty-refund-apply.test.ts — PHASE 1 reconciliation DB layer.
// Drives lib/loyalty-refund-apply.reconcileLoyaltyOnRefund against a faithful
// in-memory Prisma fake that enforces @@unique([sourceEventId,type]) and rolls the
// interactive transaction back on a unique violation — so the idempotency and
// offset guarantees are proven end-to-end, not just in the pure math.

import { describe, it, expect, beforeEach } from 'vitest'
import { reconcileLoyaltyOnRefund } from '@/lib/loyalty-refund-apply'

// ── Faithful minimal Prisma fake ─────────────────────────────────────────────
interface Tx { customerId: string; orderId: string | null; type: string; points: number; sourceEventId: string | null; actorId?: string | null }
function makeDb(seed: {
  order?: { pointsRedeemed: number; pointsEarned: number; consumerId: string } | null
  operatorEmail?: string | null
  customer?: { id: string; pointsBalance: number; recoveryOffsetPoints: number } | null
  earnTx?: boolean
  legacyRefund?: boolean
}) {
  const state = {
    txns: [] as Tx[],
    customer: seed.customer ? { ...seed.customer } : null,
  }
  if (seed.earnTx && state.customer && seed.order) {
    state.txns.push({ customerId: state.customer.id, orderId: 'o1', type: 'earn', points: seed.order.pointsEarned, sourceEventId: null })
  }
  if (seed.legacyRefund && state.customer) {
    // A pre-Phase-1 full re-credit row: type 'refund', sourceEventId NULL.
    state.txns.push({ customerId: state.customer.id, orderId: 'o1', type: 'refund', points: 8, sourceEventId: null })
  }
  const uniqueHit = (sourceEventId: string | null, type: string) =>
    sourceEventId != null && state.txns.some((t) => t.sourceEventId === sourceEventId && t.type === type)

  // Explicit annotation breaks the self-reference cycle ($transaction closes over `model`).
  const model: Record<string, { findUnique?: unknown; findFirst?: unknown; create?: unknown; update?: unknown }> & { $transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>; $queryRawUnsafe: (sql: string, ...a: unknown[]) => Promise<unknown> } = {
    order: { findUnique: async () => (seed.order ? { ...seed.order } : null) },
    operator: { findUnique: async () => (seed.operatorEmail ? { email: seed.operatorEmail } : null) },
    loyaltyCustomer: {
      findUnique: async () => (state.customer ? { ...state.customer } : null),
      update: async ({ data }: { data: { pointsBalance?: { increment?: number; decrement?: number }; recoveryOffsetPoints?: number | { increment?: number; decrement?: number } } }) => {
        if (!state.customer) throw new Error('no customer')
        if (data.pointsBalance?.increment) state.customer.pointsBalance += data.pointsBalance.increment
        if (data.pointsBalance?.decrement) state.customer.pointsBalance -= data.pointsBalance.decrement
        if (typeof data.recoveryOffsetPoints === 'number') state.customer.recoveryOffsetPoints = data.recoveryOffsetPoints
        else if (data.recoveryOffsetPoints?.increment) state.customer.recoveryOffsetPoints += data.recoveryOffsetPoints.increment
        else if (data.recoveryOffsetPoints?.decrement) state.customer.recoveryOffsetPoints -= data.recoveryOffsetPoints.decrement
        return { ...state.customer }
      },
    },
    loyaltyTransaction: {
      findFirst: async ({ where }: { where: { type?: string; sourceEventId?: unknown } }) =>
        state.txns.find((t) => (where.type == null || t.type === where.type)
          && (!('sourceEventId' in where) || t.sourceEventId === (where.sourceEventId as string | null))) ?? null,
      create: async ({ data }: { data: Tx }) => {
        if (uniqueHit(data.sourceEventId, data.type)) {
          const err = new Error('Unique constraint failed') as Error & { code: string }
          err.code = 'P2002'
          throw err
        }
        state.txns.push({ ...data })
        return { ...data }
      },
    },
    // FOR UPDATE lock read — returns the current locked balance (no real concurrency in-test).
    $queryRawUnsafe: async (_sql: string) => (state.customer ? [{ pointsBalance: state.customer.pointsBalance }] : []),
    // Interactive transaction with snapshot rollback on throw (faithful to Prisma).
    $transaction: async (fn: (tx: typeof model) => Promise<unknown>) => {
      const snapTxns = state.txns.map((t) => ({ ...t }))
      const snapCust = state.customer ? { ...state.customer } : null
      try {
        return await fn(model)
      } catch (e) {
        state.txns = snapTxns
        state.customer = snapCust
        throw e
      }
    },
  }
  return { db: model as never, state }
}

const CUST = { id: 'lc1', pointsBalance: 100, recoveryOffsetPoints: 0 }
const ORDER = { pointsRedeemed: 8, pointsEarned: 14, consumerId: 'op1' }
const re = (id: string, amountCents: number, createdUnix = 0) => ({ id, amountCents, createdUnix })

describe('reconcileLoyaltyOnRefund — full refund', () => {
  it('reverses 100% earned and restores 100% spent, one row each keyed by re_…', async () => {
    const { db, state } = makeDb({ order: ORDER, operatorEmail: 'c@x.fr', customer: { ...CUST }, earnTx: true })
    const r = await reconcileLoyaltyOnRefund(db, { orderId: 'o1', chargeAmountCents: 1410, refunds: [re('re_1', 1410)] })
    expect(r.earnReversed).toBe(14)
    expect(r.spentRestored).toBe(8)
    expect(state.customer!.pointsBalance).toBe(100 - 14 + 8) // 94
    expect(state.customer!.recoveryOffsetPoints).toBe(0)
    expect(state.txns.filter((t) => t.type === 'earn_reversal')).toHaveLength(1)
    expect(state.txns.filter((t) => t.type === 'refund')).toHaveLength(1)
    expect(state.txns.find((t) => t.type === 'earn_reversal')!.sourceEventId).toBe('re_1')
  })
})

describe('reconcileLoyaltyOnRefund — idempotent replay (Q/R)', () => {
  it('the same refund event processed twice applies once', async () => {
    const { db, state } = makeDb({ order: ORDER, operatorEmail: 'c@x.fr', customer: { ...CUST }, earnTx: true })
    const input = { orderId: 'o1', chargeAmountCents: 1410, refunds: [re('re_1', 1410)] }
    await reconcileLoyaltyOnRefund(db, input)
    const second = await reconcileLoyaltyOnRefund(db, input)
    expect(second.applied).toBe(0)
    expect(second.skipped).toBeGreaterThan(0)
    expect(state.customer!.pointsBalance).toBe(94) // unchanged by the replay
    expect(state.txns.filter((t) => t.type === 'earn_reversal')).toHaveLength(1) // not doubled
  })
})

describe('reconcileLoyaltyOnRefund — multiple partials cumulative (D/H)', () => {
  it('two 50% partials equal one full refund, no double effect', async () => {
    const { db, state } = makeDb({ order: ORDER, operatorEmail: 'c@x.fr', customer: { ...CUST }, earnTx: true })
    // First webhook: one partial present.
    await reconcileLoyaltyOnRefund(db, { orderId: 'o1', chargeAmountCents: 1410, refunds: [re('re_1', 705, 1)] })
    // Second webhook: both refunds now on the charge (Stripe lists all).
    await reconcileLoyaltyOnRefund(db, { orderId: 'o1', chargeAmountCents: 1410, refunds: [re('re_1', 705, 1), re('re_2', 705, 2)] })
    expect(state.customer!.pointsBalance).toBe(100 - 14 + 8) // exactly the full-refund state
    expect(state.txns.filter((t) => t.type === 'earn_reversal').reduce((s, t) => s - t.points, 0)).toBe(14)
    expect(state.txns.filter((t) => t.type === 'refund').reduce((s, t) => s + t.points, 0)).toBe(8)
  })
})

describe('reconcileLoyaltyOnRefund — D3 offset (L)', () => {
  it('clawback beyond available balance floors at 0 and books the remainder as offset', async () => {
    // Balance only 6, but full refund reverses 14 earned.
    const { db, state } = makeDb({ order: ORDER, operatorEmail: 'c@x.fr', customer: { id: 'lc1', pointsBalance: 6, recoveryOffsetPoints: 0 }, earnTx: true })
    const r = await reconcileLoyaltyOnRefund(db, { orderId: 'o1', chargeAmountCents: 1410, refunds: [re('re_1', 1410)] })
    // reverse 14 → balance 6→0 then +8 restored spent = 8; offset absorbs the 8 unrecovered.
    expect(state.customer!.pointsBalance).toBe(8)              // 6 −6 (floored) +8 restored, never negative
    expect(state.customer!.recoveryOffsetPoints).toBe(8)      // 14 − 6 recovered = 8 debt
    expect(r.offsetAdded).toBe(8)
  })
})

describe('reconcileLoyaltyOnRefund — grandfather (E-P1a/F-P1)', () => {
  it('an order with a legacy (NULL,refund) row is left untouched — no double credit/clawback', async () => {
    const { db, state } = makeDb({ order: ORDER, operatorEmail: 'c@x.fr', customer: { ...CUST }, earnTx: true, legacyRefund: true })
    const r = await reconcileLoyaltyOnRefund(db, { orderId: 'o1', chargeAmountCents: 1410, refunds: [re('re_new', 1410)] })
    expect(r.grandfathered).toBe(true)
    expect(r.applied).toBe(0)
    expect(state.customer!.pointsBalance).toBe(100) // untouched — legacy loyalty stands
    expect(state.txns.filter((t) => t.type === 'earn_reversal')).toHaveLength(0)
    expect(state.txns.filter((t) => t.sourceEventId === 're_new')).toHaveLength(0)
  })
})

describe('reconcileLoyaltyOnRefund — guards', () => {
  it('no earn transaction yet (refund before delivered) → no clawback, only spent restore', async () => {
    const { db, state } = makeDb({ order: ORDER, operatorEmail: 'c@x.fr', customer: { ...CUST }, earnTx: false })
    await reconcileLoyaltyOnRefund(db, { orderId: 'o1', chargeAmountCents: 1410, refunds: [re('re_1', 1410)] })
    expect(state.txns.filter((t) => t.type === 'earn_reversal')).toHaveLength(0) // no phantom clawback
    expect(state.txns.filter((t) => t.type === 'refund')).toHaveLength(1)        // spent still restored
    expect(state.customer!.pointsBalance).toBe(108)
  })
  it('no loyalty account → no-op', async () => {
    const { db, state } = makeDb({ order: ORDER, operatorEmail: 'c@x.fr', customer: null, earnTx: false })
    const r = await reconcileLoyaltyOnRefund(db, { orderId: 'o1', chargeAmountCents: 1410, refunds: [re('re_1', 1410)] })
    expect(r.applied).toBe(0)
    expect(state.txns).toHaveLength(0)
  })
  it('order without spent/earned → nothing to do', async () => {
    const { db } = makeDb({ order: { pointsRedeemed: 0, pointsEarned: 0, consumerId: 'op1' }, operatorEmail: 'c@x.fr', customer: { ...CUST }, earnTx: false })
    const r = await reconcileLoyaltyOnRefund(db, { orderId: 'o1', chargeAmountCents: 1410, refunds: [re('re_1', 1410)] })
    expect(r.applied).toBe(0)
  })
})
