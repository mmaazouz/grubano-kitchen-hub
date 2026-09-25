// tests/loyalty-refund-apply.test.ts — PHASE 1 reconciliation DB layer, L6.1 CONVERGENCE.
// Drives lib/loyalty-refund-apply.reconcileLoyaltyOnRefund against a faithful
// in-memory Prisma fake that enforces @@unique([sourceEventId,type]) and rolls the
// interactive transaction back on a unique violation — so the idempotency and
// offset guarantees are proven end-to-end, not just in the pure math.
//
// L6.1 (founder decision, option (a), 2026-09-25): the reconciliation no longer sums per-event deltas. It
// computes the cumulative target for the PROVEN set, reads the effect REALLY APPLIED, and writes only the
// difference. The founder's mandatory cases A–I are the second describe block below; each one drives the
// PRODUCT and reads the resulting rows and balance, so every number here was computed by the code.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const alertMock = vi.hoisted(() => vi.fn())
// The convergence reports an unreached target and a T-44 offset give-back. Mocked so the tests can ASSERT
// those alerts and so no test can reach a real sender.
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: alertMock }))

import { reconcileLoyaltyOnRefund, CONVERGENCE_ATTEMPTS } from '@/lib/loyalty-refund-apply'

// ── Faithful minimal Prisma fake ─────────────────────────────────────────────
interface Tx { customerId: string; orderId: string | null; type: string; points: number; sourceEventId: string | null; actorId?: string | null }
function makeDb(seed: {
  order?: { pointsRedeemed: number; pointsEarned: number; consumerId: string } | null
  operatorEmail?: string | null
  customer?: { id: string; pointsBalance: number; recoveryOffsetPoints: number } | null
  earnTx?: boolean
  legacyRefund?: boolean
  /** Rows already in the ledger — used to reproduce what the pre-L6.1 per-re_ code could leave behind. */
  seedTxns?: Array<{ type: string; points: number; sourceEventId: string | null }>
}) {
  const state = {
    txns: [] as Tx[],
    customer: seed.customer ? { ...seed.customer } : null,
  }
  if (seed.earnTx && state.customer && seed.order) {
    state.txns.push({ customerId: state.customer.id, orderId: 'o1', type: 'earn', points: seed.order.pointsEarned, sourceEventId: null })
  }
  if (seed.seedTxns && state.customer) {
    for (const t of seed.seedTxns) {
      state.txns.push({ customerId: state.customer.id, orderId: 'o1', type: t.type, points: t.points, sourceEventId: t.sourceEventId })
    }
  }
  if (seed.legacyRefund && state.customer) {
    // A pre-Phase-1 full re-credit row: type 'refund', sourceEventId NULL.
    state.txns.push({ customerId: state.customer.id, orderId: 'o1', type: 'refund', points: 8, sourceEventId: null })
  }
  const uniqueHit = (sourceEventId: string | null, type: string) =>
    sourceEventId != null && state.txns.some((t) => t.sourceEventId === sourceEventId && t.type === type)

  /** One matcher for findFirst and findMany, so they can never disagree about what a row is. */
  const matchTx = (where: { orderId?: string; type?: string | { in?: string[] }; sourceEventId?: unknown }, t: Tx): boolean => {
    if (where.orderId !== undefined && t.orderId !== where.orderId) return false
    if (where.type !== undefined) {
      if (typeof where.type === 'string') { if (t.type !== where.type) return false }
      else if (where.type?.in && !where.type.in.includes(t.type)) return false
    }
    if ('sourceEventId' in where && t.sourceEventId !== (where.sourceEventId as string | null)) return false
    return true
  }

  // Explicit annotation breaks the self-reference cycle ($transaction closes over `model`).
  const model: Record<string, { findUnique?: unknown; findFirst?: unknown; findMany?: unknown; create?: unknown; update?: unknown }> & { $transaction: (fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>; $queryRawUnsafe: (sql: string, ...a: unknown[]) => Promise<unknown> } = {
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
      findFirst: async ({ where }: { where: { orderId?: string; type?: string; sourceEventId?: unknown } }) =>
        state.txns.find((t) => matchTx(where, t)) ?? null,
      /**
       * L6.1 — the convergence reads the effect ALREADY APPLIED, which is a SUM over rows, so the fake has
       * to support findMany. It honours `orderId` too: a fake that ignored it would let one order's rows
       * count as another's, and the whole point of the target is that it is per-order.
       */
      findMany: async ({ where }: { where?: { orderId?: string; type?: string | { in?: string[] } } } = {}) =>
        state.txns.filter((t) => matchTx(where ?? {}, t)).map((t) => ({ ...t })),
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
    // FOR UPDATE lock read. Returns EXACTLY the columns the SQL names: a fake that always returned
    // pointsBalance would hide a caller that forgot to select recoveryOffsetPoints and then read the
    // customer's DEBT as undefined ⇒ 0.
    $queryRawUnsafe: async (sql: string, ...a: unknown[]) => {
      if (!state.customer) return []
      // The BOUND id is honoured, not ignored: a lock pointed at the wrong row would otherwise return this
      // customer's numbers and every test would stay green while the product locked nothing.
      if (a.length > 0 && a[0] !== state.customer.id) return []
      const row: Record<string, number> = {}
      if (/pointsBalance/.test(sql)) row.pointsBalance = state.customer.pointsBalance
      if (/recoveryOffsetPoints/.test(sql)) row.recoveryOffsetPoints = state.customer.recoveryOffsetPoints
      return Object.keys(row).length ? [row] : []
    },
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
/** A ready-to-reconcile world (earn credited), for the blocks that patch the fake mid-flight. */
const world2 = () => makeDb({ order: ORDER, operatorEmail: 'c@x.fr', customer: { ...CUST }, earnTx: true })
const ORDER = { pointsRedeemed: 8, pointsEarned: 14, consumerId: 'op1' }
const re = (id: string, amountCents: number, createdUnix = 0) => ({ id, amountCents, createdUnix })

beforeEach(() => {
  alertMock.mockReset()
  alertMock.mockResolvedValue({ status: 'skipped' })
})

describe('reconcileLoyaltyOnRefund — full refund', () => {
  it('reverses 100% earned and restores 100% spent, one row each — keyed by the TARGET, not by a re_', async () => {
    const { db, state } = makeDb({ order: ORDER, operatorEmail: 'c@x.fr', customer: { ...CUST }, earnTx: true })
    const r = await reconcileLoyaltyOnRefund(db, { orderId: 'o1', chargeAmountCents: 1410, refunds: [re('re_1', 1410)] })
    expect(r.earnReversed).toBe(14)
    expect(r.spentRestored).toBe(8)
    expect(state.customer!.pointsBalance).toBe(100 - 14 + 8) // 94
    expect(state.customer!.recoveryOffsetPoints).toBe(0)
    expect(state.txns.filter((t) => t.type === 'earn_reversal')).toHaveLength(1)
    expect(state.txns.filter((t) => t.type === 'refund')).toHaveLength(1)
    // L6.1: the key is derived from the observed state, not from the refund id. Under convergence the unit
    // of work is the TARGET — one refund can move it, two can, and a late-arriving older one can move it
    // again; a key naming a single event cannot express that without freezing the delta it was priced at.
    const key = state.txns.find((t) => t.type === 'earn_reversal')!.sourceEventId!
    // THE KEY IS THE PROOF STATE: the order and the cumulative refunded, nothing else. One adjustment can
    // exist per (order, side, cumulative) — which is what makes the whole thing terminate, because a second
    // pass that somehow computed a different target for the SAME proof is refused instead of flapping.
    expect(key).toBe('prorata:v1:o1:1410')
    expect(key).not.toMatch(/re_/)
    // No sequence number: a key that grew with each write would hand every repeat a fresh key, and two
    // callers disagreeing about the denominator would then write against each other for ever.
    expect(key.split(':')).toHaveLength(4)
    expect(r.converged).toBe(true)
    expect(r.targetEarnReversal).toBe(14)
    expect(r.targetSpentRestore).toBe(8)
    expect(r.cumRefundedCents).toBe(1410)
    expect(alertMock, 'a converged reconciliation alerts nobody').not.toHaveBeenCalled()
  })
})

describe('reconcileLoyaltyOnRefund — idempotent replay (Q/R)', () => {
  it('⭐ the same refund event processed twice applies once — and the replay writes NOTHING AT ALL', async () => {
    const { db, state } = makeDb({ order: ORDER, operatorEmail: 'c@x.fr', customer: { ...CUST }, earnTx: true })
    const input = { orderId: 'o1', chargeAmountCents: 1410, refunds: [re('re_1', 1410)] }
    await reconcileLoyaltyOnRefund(db, input)
    const second = await reconcileLoyaltyOnRefund(db, input)
    expect(second.applied).toBe(0)
    // L6.1: NOT « skipped » any more. The old model relied on the unique key throwing P2002 to stop a
    // replay; the convergence never gets that far — at the target the difference is 0, so there is nothing
    // to write and nothing to collide with. « skipped » now means only « a concurrent writer took this exact
    // transition », which is a different and rarer thing.
    expect(second.skipped).toBe(0)
    expect(second.converged).toBe(true)
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

// ══ L6.1 — THE FOUNDER'S MANDATORY CASES A–I ══════════════════════════════════════════════════════
//
// T = 1410 cents captured, E = 14 points earned, S = 8 points spent. Every expected number below is the
// §9 cumulative target for the proven set; none of them is restated from the old per-event model.

describe('L6.1 — convergence to the cumulative target (founder cases A–I)', () => {
  /** A world with the earn credited, ready to be reconciled. */
  const world = (over: Parameters<typeof makeDb>[0] = {}) => makeDb({
    order: ORDER, operatorEmail: 'c@x.fr', customer: { ...CUST }, earnTx: true, ...over,
  })
  /** The reversal actually booked, as a magnitude, read from the rows. */
  const reversed = (state: { txns: Array<{ type: string; points: number }> }) =>
    state.txns.filter((t) => t.type === 'earn_reversal').reduce((s, t) => s - t.points, 0)
  const restored = (state: { txns: Array<{ type: string; points: number }> }) =>
    state.txns.filter((t) => t.type === 'refund').reduce((s, t) => s + t.points, 0)
  const reconcile = (db: never, refunds: ReturnType<typeof re>[]) =>
    reconcileLoyaltyOnRefund(db, { orderId: 'o1', chargeAmountCents: 1410, refunds })

  it('⭐ A — 470 alone ⇒ total reversal 5', async () => {
    const { db, state } = world()
    const r = await reconcile(db, [re('re_a', 470, 10)])
    expect(reversed(state)).toBe(5)          // round(14 × 470 / 1410)
    expect(r.targetEarnReversal).toBe(5)
    expect(r.converged).toBe(true)
    expect(state.customer!.pointsBalance).toBe(100 - 5 + 3) // 3 = round(8 × 470 / 1410)
  })

  it('⭐⭐ B — 470 visible, then an OLDER 470 appears ⇒ total 9 and the second delta is 4, NOT another 5', async () => {
    // THIS IS THE DEFECT L6.1 CLOSES. The old code sorted by instant, gave the late-arriving OLDER refund
    // the first slot in the prefix, and booked 5 for it too — 10 where the target is 9.
    const { db, state } = world()
    await reconcile(db, [re('re_late', 470, 20)])
    expect(reversed(state)).toBe(5)

    const second = await reconcile(db, [re('re_late', 470, 20), re('re_early', 470, 10)])
    expect(second.targetEarnReversal, 'round(14 × 940 / 1410)').toBe(9)
    expect(second.appliedEarnReversalBefore).toBe(5)
    expect(reversed(state), 'the TOTAL is the target — not 10').toBe(9)
    // …and the second write is a delta of 4, not a second full 5.
    const points = state.txns.filter((t) => t.type === 'earn_reversal').map((t) => t.points)
    expect(points).toEqual([-5, -4])
  })

  it('⭐ C — 470 × 3 becoming visible one at a time ⇒ total exactly 14', async () => {
    const { db, state } = world()
    await reconcile(db, [re('re_1', 470, 10)])
    await reconcile(db, [re('re_1', 470, 10), re('re_2', 470, 20)])
    const last = await reconcile(db, [re('re_1', 470, 10), re('re_2', 470, 20), re('re_3', 470, 30)])
    expect(reversed(state)).toBe(14)
    expect(restored(state)).toBe(8)
    expect(last.converged).toBe(true)
    expect(state.customer!.pointsBalance).toBe(100 - 14 + 8)
  })

  it('⭐ D — the same set replayed TEN times ⇒ not one write after convergence', async () => {
    const { db, state } = world()
    const set = [re('re_1', 470, 10), re('re_2', 470, 20), re('re_3', 470, 30)]
    await reconcile(db, set)
    const rows = state.txns.length
    const balance = state.customer!.pointsBalance
    const offset = state.customer!.recoveryOffsetPoints
    for (let i = 0; i < 10; i++) {
      const r = await reconcile(db, set)
      expect(r.applied, 'replay ' + (i + 1)).toBe(0)
      expect(r.converged, 'replay ' + (i + 1)).toBe(true)
    }
    expect(state.txns).toHaveLength(rows)
    expect(state.customer!.pointsBalance).toBe(balance)
    expect(state.customer!.recoveryOffsetPoints).toBe(offset)
    expect(alertMock).not.toHaveBeenCalled()
  })

  it('⭐ E — becoming visible in the order C, A, B ⇒ the SAME final state as A, B, C', async () => {
    const A = re('re_A', 470, 10), B = re('re_B', 470, 20), C = re('re_C', 470, 30)
    const forward = world()
    await reconcile(forward.db, [A])
    await reconcile(forward.db, [A, B])
    await reconcile(forward.db, [A, B, C])

    const jumbled = world()
    await reconcile(jumbled.db, [C])
    await reconcile(jumbled.db, [C, A])
    await reconcile(jumbled.db, [C, A, B])

    expect(reversed(jumbled.state)).toBe(reversed(forward.state))
    expect(restored(jumbled.state)).toBe(restored(forward.state))
    expect(jumbled.state.customer!.pointsBalance).toBe(forward.state.customer!.pointsBalance)
    expect(jumbled.state.customer!.recoveryOffsetPoints).toBe(forward.state.customer!.recoveryOffsetPoints)
    expect(reversed(jumbled.state)).toBe(14)
  })

  it('⭐ F — a partial then a TOTAL refund ⇒ the exact final target, never past it', async () => {
    const { db, state } = world()
    await reconcile(db, [re('re_p', 353, 10)])           // 25 % ⇒ 4
    expect(reversed(state)).toBe(4)
    await reconcile(db, [re('re_p', 353, 10), re('re_rest', 1057, 20)])
    expect(reversed(state)).toBe(14)
    expect(restored(state)).toBe(8)
    // An overshooting cumulative (Stripe can never do this, but a bad amount could) changes nothing.
    const over = await reconcile(db, [re('re_p', 353, 10), re('re_rest', 1057, 20), re('re_x', 999, 30)])
    expect(over.applied).toBe(0)
    expect(reversed(state)).toBe(14)
  })

  it('⭐ G — the SAME re_ proven by both sources (our Refund row AND the ledger line) counts ONCE', async () => {
    const { db, state } = world()
    const r = await reconcile(db, [re('re_dup', 470, 10), re('re_dup', 470, 10)])
    expect(r.cumRefundedCents, 'not 940').toBe(470)
    expect(reversed(state)).toBe(5)
  })

  it('⭐ H — a PENDING refund is excluded by the set builder, and applied exactly once when it settles', async () => {
    // Asserted on a real `status: 'pending'` row, through buildDbKnownRefundSet — the function that decides
    // what « proven » means — and not merely on a one-element set standing in for it.
    const { buildDbKnownRefundSet } = await import('@/lib/loyalty-refund')
      .then(() => import('@/lib/loyalty-prorata'))
    const rows = [
      { stripeRefundId: 're_ok', amountCents: 470, status: 'succeeded', settledAt: new Date(1_000_000_000), createdAt: new Date(1_000_000_000) },
      { stripeRefundId: 're_wait', amountCents: 470, status: 'pending', settledAt: null, createdAt: new Date(1_000_100_000) },
    ]
    const tiny = {
      order: { findUnique: async () => ({ id: 'o1', total: 14.1, stripePaymentIntentId: null }) },
      refund: { findMany: async ({ where }: { where: { status?: string } }) => rows.filter((r) => !where?.status || r.status === where.status) },
      ledgerEntry: { findMany: async () => [], findFirst: async () => null },
    } as never
    const pendingExcluded = await buildDbKnownRefundSet(tiny, 'o1')
    expect(pendingExcluded!.refunds.map((r) => r.id), 'the pending one is not proven').toEqual(['re_ok'])

    // …and the settle applies its delta exactly once, then nothing however often it is replayed.
    const { db, state } = world()
    await reconcile(db, [re('re_ok', 470, 10)])
    expect(reversed(state)).toBe(5)
    rows[1].status = 'succeeded'
    rows[1].settledAt = new Date(1_000_100_000)
    const nowProven = await buildDbKnownRefundSet(tiny, 'o1')
    expect(nowProven!.refunds.map((r) => r.id).sort()).toEqual(['re_ok', 're_wait'])
    await reconcile(db, nowProven!.refunds)
    expect(reversed(state)).toBe(9)
    const again = await reconcile(db, nowProven!.refunds)
    expect(again.applied).toBe(0)
    expect(state.txns.filter((t) => t.type === 'earn_reversal')).toHaveLength(2)
  })

  it('⭐ I — the three callers converge on the same target because there is only ONE writer', async () => {
    // The webhook, the delivered replay and the admin repair all call THIS function; none of them writes a
    // loyalty row of its own. Proven at the source, because a second writer is exactly how the two paths
    // would drift apart again.
    const { readFileSync } = await import('node:fs')
    const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
    for (const f of [
      'app/api/webhooks/stripe/route.ts',
      'app/api/orders/[id]/status/route.ts',
      'app/api/admin/loyalty/reconcile/route.ts',
      'lib/loyalty-prorata.ts',
    ]) {
      const src = read(f).replace(/^[ \t]*\/\/.*$/gm, '')
      // The ban is on CREATING a reconciliation row, not on naming the type: lib/loyalty-prorata READS
      // earn_reversal rows to verify the target was reached, which is the opposite of a second writer.
      // So: take each loyaltyTransaction.create( call site and look at the payload that follows it.
      let at = src.indexOf('loyaltyTransaction.create(')
      while (at !== -1) {
        const payload = src.slice(at, at + 400)
        // BOTH sides of the reconciliation, not just D1: a second writer of the D2 `refund` row would drift
        // the spent-restore total apart exactly as a second `earn_reversal` writer would the clawback.
        expect(payload, f + ' creates a D1 reconciliation row of its own').not.toMatch(/earn_reversal/)
        expect(payload, f + ' creates a D2 reconciliation row of its own').not.toMatch(/type: 'refund'/)
        at = src.indexOf('loyaltyTransaction.create(', at + 1)
      }
    }
    // …and the same set through the same function from different call shapes lands identically — including
    // with and without `proofComplete`, because that flag gates only the DOWNWARD direction. Three callers
    // that agree about the refunds cannot land on different targets; when their sets DISAGREE they are not
    // supposed to agree, and the one with the weaker proof is the one that may not lower anything.
    const a = world(), b = world(), c = world()
    const set = [re('re_1', 705, 10), re('re_2', 705, 20)]
    await reconcile(a.db, set)                                    // the DB union, no completeness claim
    await reconcile(b.db, [set[1], set[0]])                        // the other order
    await reconcileLoyaltyOnRefund(c.db, { orderId: 'o1', chargeAmountCents: 1410, refunds: set, proofComplete: true })
    expect(reversed(b.state)).toBe(reversed(a.state))
    expect(reversed(c.state)).toBe(reversed(a.state))
    expect(restored(c.state)).toBe(restored(a.state))
    expect(reversed(a.state)).toBe(14)
  })
})

describe('L6.1 — PROPERTY: any amounts, any arrival order, always the cumulative target', () => {
  // The founder's cases A–I are specific sequences. This one generalises them: a deterministic pseudo-random
  // sweep over amounts AND arrival orders, asserting the only invariant that matters — the total applied on
  // each side equals the §9 cumulative target for the set proven at the end. No expected number is restated:
  // every one is recomputed with loyaltyPointsCumulative from the amounts the scenario generated.
  const rng = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)

  it('⭐ 40 pseudo-random scenarios all land exactly on the target', async () => {
    const { loyaltyPointsCumulative } = await import('@/lib/loyalty-refund')
    for (let s = 1; s <= 40; s++) {
      const rand = rng(s * 7919)
      const T = 500 + Math.floor(rand() * 4000)                 // charge captured, cents
      const E = Math.floor(rand() * 40)                          // points earned
      const S = Math.floor(rand() * 25)                          // points spent
      const n = 1 + Math.floor(rand() * 4)                       // 1..4 refunds
      let left = T
      const amounts: number[] = []
      for (let i = 0; i < n; i++) {
        const a = Math.max(1, Math.floor(left * (0.15 + rand() * 0.5)))
        amounts.push(a); left -= a
        if (left <= 0) break
      }
      const refunds = amounts.map((a, i) => re('re_' + s + '_' + i, a, 100 + Math.floor(rand() * 1000)))
      // A pseudo-random arrival order, and a reconciliation after each arrival.
      const arrival = refunds.map((r, i) => i).sort(() => rand() - 0.5)
      const { db, state } = makeDb({
        order: { pointsRedeemed: S, pointsEarned: E, consumerId: 'op1' }, operatorEmail: 'c@x.fr',
        customer: { id: 'lc1', pointsBalance: 1000, recoveryOffsetPoints: 0 }, earnTx: true,
      })
      const proven: ReturnType<typeof re>[] = []
      for (const i of arrival) {
        proven.push(refunds[i])
        await reconcileLoyaltyOnRefund(db, { orderId: 'o1', chargeAmountCents: T, refunds: [...proven] })
      }
      const cum = amounts.reduce((a, b) => a + b, 0)
      const label = 'seed ' + s + ' T=' + T + ' E=' + E + ' S=' + S + ' amounts=' + amounts.join('+')
      const reversed = state.txns.filter((t) => t.type === 'earn_reversal').reduce((a, t) => a - t.points, 0)
      const restored = state.txns.filter((t) => t.type === 'refund').reduce((a, t) => a + t.points, 0)
      expect(reversed, label).toBe(loyaltyPointsCumulative(E, T, cum))
      expect(restored, label).toBe(loyaltyPointsCumulative(S, T, cum))
      // …and one more pass writes nothing at all.
      const extra = await reconcileLoyaltyOnRefund(db, { orderId: 'o1', chargeAmountCents: T, refunds: [...proven] })
      expect(extra.applied, label).toBe(0)
      expect(extra.converged, label).toBe(true)
    }
  })

  it('⭐ NEGATIVE CONTROL — the OLD per-event model fails this property, which is why it exists', async () => {
    const { planLoyaltyRefund, loyaltyPointsCumulative } = await import('@/lib/loyalty-refund')
    // Reproduce what the pre-L6.1 writer did: price each refund's delta over the prefix VISIBLE AT THE TIME,
    // and freeze it. The later-then-earlier arrival is the case that drifts.
    const T = 1410, E = 14
    const late = re('re_late', 470, 20), early = re('re_early', 470, 10)
    const firstPass = planLoyaltyRefund({ refunds: [late], chargeAmountCents: T, earnedCredited: E, pointsRedeemed: 0 })
    const frozen = firstPass[0].earnReversal
    const secondPass = planLoyaltyRefund({ refunds: [late, early], chargeAmountCents: T, earnedCredited: E, pointsRedeemed: 0 })
    // The old writer skipped re_late (its key existed) and wrote re_early's delta as computed now.
    const added = secondPass.find((e) => e.sourceEventId === 're_early')!.earnReversal
    expect(frozen + added, 'the old model books 10').toBe(10)
    expect(loyaltyPointsCumulative(E, T, 940), 'the target is 9').toBe(9)
    expect(frozen + added).not.toBe(loyaltyPointsCumulative(E, T, 940))
  })
})

describe('L6.1 — a NEGATIVE delta: the over-application the old code could leave', () => {
  // A give-back needs COMPLETE proof (proofComplete: true — only the charge.refunded webhook has it). The two
  // tests below therefore pass it; the one after them proves what happens without it.
  it('⭐ two frozen per-re_ rows of 5 on a cumulative of 940 ⇒ ONE point given back, total 9', async () => {
    // Exactly the state the pre-L6.1 code produced when an older refund landed late: two rows of −5.
    const { db, state } = makeDb({
      order: ORDER, operatorEmail: 'c@x.fr', customer: { id: 'lc1', pointsBalance: 90, recoveryOffsetPoints: 0 },
      earnTx: true,
      seedTxns: [
        { type: 'earn_reversal', points: -5, sourceEventId: 're_late' },
        { type: 'earn_reversal', points: -5, sourceEventId: 're_early' },
      ],
    })
    const r = await reconcileLoyaltyOnRefund(db, {
      orderId: 'o1', chargeAmountCents: 1410,
      refunds: [re('re_late', 470, 20), re('re_early', 470, 10)],
      proofComplete: true,
    })
    expect(r.appliedEarnReversalBefore).toBe(10)
    expect(r.targetEarnReversal).toBe(9)
    expect(r.earnReversed, 'this call reversed MINUS one point — it gave one back').toBe(-1)
    // The give-back is a NEW row. The two old rows are untouched: the ledger stays append-only.
    const rows = state.txns.filter((t) => t.type === 'earn_reversal')
    expect(rows.map((t) => t.points)).toEqual([-5, -5, 1])
    expect(rows[0].sourceEventId).toBe('re_late')   // immutable
    expect(rows[1].sourceEventId).toBe('re_early')  // immutable
    expect(rows[2].sourceEventId).toBe('prorata:v1:o1:940')
    expect(state.customer!.pointsBalance).toBe(90 + 1 + 5) // +1 given back, +5 spent restored (round(8×940/1410))
    expect(r.converged).toBe(true)
    // No debt was involved, so T-44 is not engaged.
    expect(r.offsetDeferredT44).toBe(false)
    expect(alertMock).not.toHaveBeenCalled()
  })

  it('⭐ a give-back that must unwind a DEBT takes it off the offset first, and reports T-44', async () => {
    // The clawback had exceeded the balance, so 4 of it became debt. The correction must remove the debt
    // before crediting spendable points — otherwise the customer holds the point AND still owes it.
    const { db, state } = makeDb({
      order: { pointsRedeemed: 0, pointsEarned: 14, consumerId: 'op1' }, operatorEmail: 'c@x.fr',
      customer: { id: 'lc1', pointsBalance: 0, recoveryOffsetPoints: 4 }, earnTx: true,
      seedTxns: [
        { type: 'earn_reversal', points: -5, sourceEventId: 're_late' },
        { type: 'earn_reversal', points: -5, sourceEventId: 're_early' },
      ],
    })
    const r = await reconcileLoyaltyOnRefund(db, {
      orderId: 'o1', chargeAmountCents: 1410,
      refunds: [re('re_late', 470, 20), re('re_early', 470, 10)],
      proofComplete: true,
    })
    expect(r.targetEarnReversal).toBe(9)
    expect(r.offsetReleased).toBe(1)
    expect(state.customer!.recoveryOffsetPoints).toBe(3)
    expect(state.customer!.pointsBalance, 'the debt absorbed it — no spendable point appears').toBe(0)
    expect(r.offsetDeferredT44).toBe(true)
    const alert = alertMock.mock.calls.map((c) => c[0]).find((a) => a.kind === 'loyalty_offset_t44_review')
    expect(alert, 'the deferred composition is reported, never claimed certified').toBeTruthy()
    expect(alert.facts).toMatchObject({ orderId: 'o1', offsetReleased: 1, moneyMoved: false })
  })
})

/** The create hook of the in-memory fake, typed once so the two tests below need no casts. */
type CreateArgs = { data: Tx }
type CreateFn = (a: CreateArgs) => Promise<unknown>
const createHook = (db: unknown) =>
  (db as { loyaltyTransaction: { create: CreateFn } }).loyaltyTransaction

describe('L6.1 — a give-back needs COMPLETE proof', () => {
  it('⭐⭐ an INCOMPLETE set never hands points back — it HOLDS the give-back and says so', async () => {
    // The case: an order correctly clawed back for TWO refunds by the old code, reconciled again from a set
    // that proves only ONE (the other is a Dashboard refund with no row of ours and no ledger line yet). The
    // difference is negative, and honouring it would return points that were rightly taken. The D-15 replay
    // and the admin repair both derive their set from the database, so both land here.
    const { db, state } = makeDb({
      order: { pointsRedeemed: 0, pointsEarned: 14, consumerId: 'op1' }, operatorEmail: 'c@x.fr',
      customer: { id: 'lc1', pointsBalance: 5, recoveryOffsetPoints: 0 }, earnTx: true,
      seedTxns: [
        { type: 'earn_reversal', points: -5, sourceEventId: 're_a' },
        { type: 'earn_reversal', points: -4, sourceEventId: 're_b' },
      ],
    })
    const r = await reconcileLoyaltyOnRefund(db, {
      orderId: 'o1', chargeAmountCents: 1410, refunds: [re('re_a', 470, 10)],
      // no proofComplete ⇒ false by default: fail closed.
    })
    expect(r.targetEarnReversal, 'the target for the set it CAN prove').toBe(5)
    expect(r.appliedEarnReversalBefore).toBe(9)
    expect(r.heldGiveBack, 'four points it refused to return on incomplete evidence').toBe(4)
    expect(r.converged).toBe(false)
    expect(r.applied, 'not one row').toBe(0)
    expect(state.txns.filter((t) => t.type === 'earn_reversal')).toHaveLength(2)
    expect(state.customer!.pointsBalance, 'and not one point').toBe(5)
    const alert = alertMock.mock.calls.map((c) => c[0]).find((a) => a.kind === 'loyalty_target_unconverged')
    expect(alert, 'holding is not enough — it has to be said').toBeTruthy()
    expect(alert.facts).toMatchObject({ orderId: 'o1', heldGiveBack: 4, proofComplete: false, moneyMoved: false })
    expect(String(alert.facts.note)).toMatch(/preuve complète|BASE/)
  })

  it('⭐ the SAME state with complete proof DOES correct it — the guard is about evidence, not about direction', async () => {
    const { db, state } = makeDb({
      order: { pointsRedeemed: 0, pointsEarned: 14, consumerId: 'op1' }, operatorEmail: 'c@x.fr',
      customer: { id: 'lc1', pointsBalance: 5, recoveryOffsetPoints: 0 }, earnTx: true,
      seedTxns: [
        { type: 'earn_reversal', points: -5, sourceEventId: 're_a' },
        { type: 'earn_reversal', points: -4, sourceEventId: 're_b' },
      ],
    })
    const r = await reconcileLoyaltyOnRefund(db, {
      orderId: 'o1', chargeAmountCents: 1410, refunds: [re('re_a', 470, 10)], proofComplete: true,
    })
    expect(r.heldGiveBack).toBe(0)
    expect(r.earnReversed, 'four points returned, because Stripe itself says there is one refund').toBe(-4)
    expect(state.customer!.pointsBalance).toBe(9)
    expect(r.converged).toBe(true)
  })

  it('⭐ adding effect never needs complete proof — a set that is too small simply asks for less', async () => {
    const { db, state } = makeDb({
      order: { pointsRedeemed: 0, pointsEarned: 14, consumerId: 'op1' }, operatorEmail: 'c@x.fr',
      customer: { id: 'lc1', pointsBalance: 14, recoveryOffsetPoints: 0 }, earnTx: true,
    })
    const r = await reconcileLoyaltyOnRefund(db, { orderId: 'o1', chargeAmountCents: 1410, refunds: [re('re_a', 470, 10)] })
    expect(r.heldGiveBack).toBe(0)
    expect(r.converged).toBe(true)
    expect(state.txns.filter((t) => t.type === 'earn_reversal').map((t) => t.points)).toEqual([-5])
  })
})

describe('L6.1 / T-44 — the debt is never invented, and the deferred case is never silent', () => {
  it('⭐⭐ a D2 take-back NEVER creates a debt: it takes what the balance holds and HOLDS the rest', async () => {
    // An over-RESTORE is our own arithmetic error, not points the customer earned and spent. Turning the
    // part we cannot take into a debt would make them repay it out of a future earning — a debt they never
    // owed. So: take 2 (all the balance has), hold 1, and say so.
    const { db, state } = makeDb({
      order: { pointsRedeemed: 8, pointsEarned: 0, consumerId: 'op1' }, operatorEmail: 'c@x.fr',
      customer: { id: 'lc1', pointsBalance: 2, recoveryOffsetPoints: 0 }, earnTx: false,
      seedTxns: [{ type: 'refund', points: 6, sourceEventId: 're_old' }],
    })
    const r = await reconcileLoyaltyOnRefund(db, {
      orderId: 'o1', chargeAmountCents: 1410, refunds: [re('re_old', 470, 10)], proofComplete: true,
    })
    expect(r.targetSpentRestore, 'round(8 × 470 / 1410)').toBe(3)
    expect(r.appliedSpentRestoreBefore).toBe(6)
    expect(r.spentRestored, 'two points taken back — all the balance held').toBe(-2)
    expect(r.heldGiveBack, 'the third is HELD, not turned into a debt').toBe(1)
    expect(state.customer!.pointsBalance).toBe(0)
    expect(state.customer!.recoveryOffsetPoints, 'no debt was invented').toBe(0)
    // The ledger records what MOVED, not what was wished for.
    expect(state.txns.filter((t) => t.type === 'refund').map((t) => t.points)).toEqual([6, -2])
    expect(r.converged).toBe(false)
    const alert = alertMock.mock.calls.map((c) => c[0]).find((a) => a.kind === 'loyalty_target_unconverged')
    expect(alert.facts).toMatchObject({ orderId: 'o1', heldGiveBack: 1, moneyMoved: false })
  })

  it('⭐ a take-back with NOTHING to take writes no row at all', async () => {
    const { db, state } = makeDb({
      order: { pointsRedeemed: 8, pointsEarned: 0, consumerId: 'op1' }, operatorEmail: 'c@x.fr',
      customer: { id: 'lc1', pointsBalance: 0, recoveryOffsetPoints: 0 }, earnTx: false,
      seedTxns: [{ type: 'refund', points: 6, sourceEventId: 're_old' }],
    })
    const r = await reconcileLoyaltyOnRefund(db, {
      orderId: 'o1', chargeAmountCents: 1410, refunds: [re('re_old', 470, 10)], proofComplete: true,
    })
    expect(r.heldGiveBack).toBe(3)
    expect(r.applied).toBe(0)
    expect(state.txns.filter((t) => t.type === 'refund')).toHaveLength(1)
    expect(state.customer!.recoveryOffsetPoints).toBe(0)
  })

  it('⭐ a clawback landing on a customer who ALREADY carries a debt is reported to T-44', async () => {
    // §24 (8)'s own case. The debt is not this order's, so nothing about it is reinterpreted — but the
    // composition is deferred, so a human is told rather than left to find it in a balance.
    const { db } = makeDb({
      order: { pointsRedeemed: 0, pointsEarned: 14, consumerId: 'op1' }, operatorEmail: 'c@x.fr',
      customer: { id: 'lc1', pointsBalance: 14, recoveryOffsetPoints: 6 }, earnTx: true,
    })
    const r = await reconcileLoyaltyOnRefund(db, { orderId: 'o1', chargeAmountCents: 1410, refunds: [re('re_1', 470, 10)] })
    expect(r.earnReversed).toBe(5)
    expect(r.offsetDeferredT44, 'a pre-existing debt was in the room').toBe(true)
    const alert = alertMock.mock.calls.map((c) => c[0]).find((a) => a.kind === 'loyalty_offset_t44_review')
    expect(alert).toBeTruthy()
    expect(alert.facts).toMatchObject({ orderId: 'o1', moneyMoved: false })
    expect(String(alert.facts.note)).toMatch(/PAS certifiée|T-44/)
  })

  it('⭐ a clean order with no debt anywhere raises NO T-44 alert — the guard is not noise', async () => {
    const { db } = makeDb({
      order: { pointsRedeemed: 0, pointsEarned: 14, consumerId: 'op1' }, operatorEmail: 'c@x.fr',
      customer: { id: 'lc1', pointsBalance: 14, recoveryOffsetPoints: 0 }, earnTx: true,
    })
    const r = await reconcileLoyaltyOnRefund(db, { orderId: 'o1', chargeAmountCents: 1410, refunds: [re('re_1', 470, 10)] })
    expect(r.offsetDeferredT44).toBe(false)
    expect(alertMock).not.toHaveBeenCalled()
  })

  it('⭐ the delivered transition reports the composition §24 (8) names, from the one place that sees both halves', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('app/api/orders/[id]/status/route.ts', 'utf8').replace(/\r\n/g, '\n')
    // The earning repays a pre-existing debt BEFORE the clawback takes points out of the reduced balance.
    // Neither half knows the other: the earn transaction sees the repayment, the replay sees the clawback.
    // Captured inside the transaction, published only AFTER it resolves: a rollback must not leave a debt
    // repayment figure behind for the alert to claim.
    expect(src).toMatch(/repaidInThisTx = offsetRepaid/)
    const assignAt = src.indexOf('earnRepaidOffset = repaidInThisTx')
    const earnWriteAt = src.indexOf("type: 'earn', points: order.pointsEarned")
    expect(earnWriteAt).toBeGreaterThan(-1)
    expect(assignAt, 'the publication is after the earn write, outside the callback').toBeGreaterThan(earnWriteAt)
    const at = src.indexOf('earnRepaidOffset > 0')
    expect(at, 'the two halves are joined').toBeGreaterThan(-1)
    const block = src.slice(at, at + 1600)
    expect(block).toMatch(/prorata\.result\.earnReversed > 0/)
    expect(block).toMatch(/loyalty_offset_t44_review/)
    expect(block).toMatch(/moneyMoved:\s*false/)
  })
})

describe('L6.1 — the three guards the judge panel demanded', () => {
  // Each of these closes a concrete oscillation or give-away an adversarial panel constructed against an
  // earlier version of this file. They are not hypotheticals: the scenarios are reproduced here.

  it('⭐⭐ STALE BASE, BEHAVIOURALLY — the earn row materialises DURING the call and the base follows it', async () => {
    // The previous version of this test seeded `earnTx: true` and never changed it, so a base read placed
    // OUTSIDE the transaction would have passed it too: it guarded the panel's highest-severity finding with
    // an assertion that could not fail. Here the earn row does NOT exist when the call starts and appears
    // before the locked read — exactly the interleave (a webhook redelivery beside a courier tapping
    // delivered). A base captured on the root client would be 0, the target 0, the applied 9, and the pass
    // would hand nine points back.
    const { db, state } = makeDb({
      order: { pointsRedeemed: 0, pointsEarned: 14, consumerId: 'op1' }, operatorEmail: 'c@x.fr',
      customer: { id: 'lc1', pointsBalance: 5, recoveryOffsetPoints: 0 }, earnTx: false,
      seedTxns: [{ type: 'earn_reversal', points: -9, sourceEventId: 'prorata:v1:o1:940' }],
    })
    // The delivery commits its earn row the moment the reconciliation locks the customer.
    const table = createHook(db)
    const origRaw = (db as unknown as { $queryRawUnsafe: (s: string, ...a: unknown[]) => Promise<unknown> }).$queryRawUnsafe
    ;(db as unknown as { $queryRawUnsafe: (s: string, ...a: unknown[]) => Promise<unknown> }).$queryRawUnsafe =
      async (sql: string, ...a: unknown[]) => {
        if (!state.txns.some((t) => t.type === 'earn')) {
          state.txns.push({ customerId: 'lc1', orderId: 'o1', type: 'earn', points: 14, sourceEventId: null })
        }
        return origRaw(sql, ...a)
      }
    void table
    const r = await reconcileLoyaltyOnRefund(db, {
      orderId: 'o1', chargeAmountCents: 1410,
      refunds: [re('re_a', 470, 10), re('re_b', 470, 20)], proofComplete: true,
    })
    expect(r.targetEarnReversal, 'the base was read AFTER the lock, so it is 14 and the target is 9').toBe(9)
    expect(r.applied, 'already on target ⇒ nothing written').toBe(0)
    expect(r.earnReversed, 'and nothing given back').toBe(0)
    expect(state.customer!.pointsBalance).toBe(5)
  })

  it('⭐ STALE BASE, AT THE SOURCE — the base is read from the transaction client, after the lock', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('lib/loyalty-refund-apply.ts', 'utf8').replace(/\r\n/g, '\n')
    const lockAt = src.indexOf('FOR UPDATE')
    const orderReadAt = src.indexOf('tx.order.findUnique')
    const earnReadAt = src.indexOf("type: 'earn' }, select: { points: true }")
    const appliedReadAt = src.indexOf('tx.loyaltyTransaction.findMany')
    expect(lockAt).toBeGreaterThan(-1)
    expect(orderReadAt, 'the order is read through the transaction client').toBeGreaterThan(lockAt)
    expect(earnReadAt, 'and so is the earn row that decides the base').toBeGreaterThan(lockAt)
    expect(appliedReadAt, 'and the applied effect, from the same snapshot').toBeGreaterThan(lockAt)
    // Nothing may read the earn row or the order on the ROOT client inside this module except the
    // grandfather guard, which is a leave-it-alone check and cannot produce a number.
    expect(src).not.toMatch(/db\.loyaltyTransaction\.findFirst\(\{\s*\n?\s*where: \{ orderId: input\.orderId, type: 'earn' \}/)
  })

  it('the earn row present throughout: the ordinary case still converges', async () => {
    // The panel's scenario: a charge.refunded redelivery starts, reads no 'earn' row (base 0, target 0),
    // then the courier taps delivered, the earn commits and the replay converges to 9. If the base were read
    // OUTSIDE the transaction, the redelivery would then measure applied 9 against its stale target of 0 and
    // hand 9 points back on a two-thirds refunded order — and flap for ever. The base is read under the same
    // lock as the applied effect, so the redelivery recomputes a base of 14 and writes nothing.
    const { db, state } = makeDb({
      order: { pointsRedeemed: 0, pointsEarned: 14, consumerId: 'op1' }, operatorEmail: 'c@x.fr',
      customer: { id: 'lc1', pointsBalance: 5, recoveryOffsetPoints: 0 }, earnTx: true,
      seedTxns: [{ type: 'earn_reversal', points: -9, sourceEventId: 'prorata:v1:o1:940' }],
    })
    const r = await reconcileLoyaltyOnRefund(db, {
      orderId: 'o1', chargeAmountCents: 1410,
      refunds: [re('re_a', 470, 10), re('re_b', 470, 20)],
    })
    expect(r.targetEarnReversal, 'the base is re-read, so the target is 9 and not 0').toBe(9)
    expect(r.applied).toBe(0)
    expect(r.earnReversed, 'nothing was given back').toBe(0)
    expect(state.customer!.pointsBalance).toBe(5)
    expect(state.txns.filter((t) => t.type === 'earn_reversal')).toHaveLength(1)
  })

  it('⭐ the base is the earn ROW, not order.pointsEarned — a later edit of the column cannot over-claw', async () => {
    // The column says 40, the row that actually credited says 14. Only 14 was ever given to the customer.
    const { db, state } = makeDb({
      order: { pointsRedeemed: 0, pointsEarned: 40, consumerId: 'op1' }, operatorEmail: 'c@x.fr',
      customer: { id: 'lc1', pointsBalance: 14, recoveryOffsetPoints: 0 }, earnTx: false,
      seedTxns: [{ type: 'earn', points: 14, sourceEventId: null }],
    })
    const r = await reconcileLoyaltyOnRefund(db, { orderId: 'o1', chargeAmountCents: 1410, refunds: [re('re_1', 1410)] })
    expect(r.targetEarnReversal, 'the credit was 14, so 14 is the most that can come back').toBe(14)
    expect(state.customer!.pointsBalance).toBe(0)
    expect(state.customer!.recoveryOffsetPoints).toBe(0)
  })

  it('⭐⭐ A SHRINKING PROOF SET cannot hand points back — the cumulative is floored at its high-water', async () => {
    // The panel's scenario: Stripe stops reporting one of two refunds as succeeded, so the caller's proven Σ
    // drops from 940 to 470. Undoing an established clawback is not a decision this writer may take alone.
    const { db, state } = makeDb({
      order: { pointsRedeemed: 0, pointsEarned: 14, consumerId: 'op1' }, operatorEmail: 'c@x.fr',
      customer: { id: 'lc1', pointsBalance: 5, recoveryOffsetPoints: 0 }, earnTx: true,
      seedTxns: [{ type: 'earn_reversal', points: -9, sourceEventId: 'prorata:v1:o1:940' }],
    })
    const r = await reconcileLoyaltyOnRefund(db, { orderId: 'o1', chargeAmountCents: 1410, refunds: [re('re_a', 470, 10)] })
    expect(r.cumRefundedCents, 'what the caller proved').toBe(470)
    expect(r.cumEffectiveCents, 'what was used: the high-water, never lowered').toBe(940)
    expect(r.targetEarnReversal).toBe(9)
    expect(r.applied).toBe(0)
    expect(state.customer!.pointsBalance).toBe(5)
  })

  it('⭐⭐ A DENOMINATOR DISAGREEMENT is refused and reported, not flapped on', async () => {
    // The panel's scenario: the webhook passes T = charge.amount while the replay falls back to
    // round(order.total × 100), and the two round to different targets for the SAME proven set. A key that
    // carried a sequence number gave every repeat a fresh key and the balance flipped on every event.
    const { db, state } = makeDb({
      order: { pointsRedeemed: 8, pointsEarned: 0, consumerId: 'op1' }, operatorEmail: 'c@x.fr',
      customer: { id: 'lc1', pointsBalance: 100, recoveryOffsetPoints: 0 }, earnTx: false,
    })
    const set = [re('re_1', 470, 10)]
    const first = await reconcileLoyaltyOnRefund(db, { orderId: 'o1', chargeAmountCents: 1504, refunds: set, proofComplete: true })
    expect(first.targetSpentRestore, 'round(8 × 470 / 1504)').toBe(3)
    expect(first.converged).toBe(true)
    const rowsAfterFirst = state.txns.length
    const balanceAfterFirst = state.customer!.pointsBalance

    // The other caller, one cent of denominator apart: round(8 × 470 / 1505) = 2. It wants to take one back.
    const second = await reconcileLoyaltyOnRefund(db, { orderId: 'o1', chargeAmountCents: 1505, refunds: set, proofComplete: true })
    expect(second.targetSpentRestore).toBe(2)
    expect(second.blocked, 'the key for this cumulative is already used').toBe(true)
    expect(second.converged).toBe(false)
    expect(state.txns, 'not one row was written').toHaveLength(rowsAfterFirst)
    expect(state.customer!.pointsBalance, 'and the balance did not flip').toBe(balanceAfterFirst)
    const alert = alertMock.mock.calls.map((c) => c[0]).find((a) => a.kind === 'loyalty_target_unconverged')
    expect(alert, 'refusing is not enough — it has to be said').toBeTruthy()
    expect(alert.facts).toMatchObject({ orderId: 'o1', blocked: true, moneyMoved: false })
    // …and it stays refused however many times it is retried: no row grows, no balance moves.
    const third = await reconcileLoyaltyOnRefund(db, { orderId: 'o1', chargeAmountCents: 1505, refunds: set, proofComplete: true })
    expect(third.blocked).toBe(true)
    expect(state.txns).toHaveLength(rowsAfterFirst)
    expect(state.customer!.pointsBalance).toBe(balanceAfterFirst)
  })

  it('⭐ a pass that writes NOTHING does not consume the key — the D-15 order still gets its adjustment', async () => {
    // Before delivery the base is 0, so the target is 0 at a cumulative of 1410 and nothing is written. If
    // that no-op had burned the key, the clawback owed after delivery would have been refused for ever.
    const { db, state } = makeDb({
      order: { pointsRedeemed: 0, pointsEarned: 14, consumerId: 'op1' }, operatorEmail: 'c@x.fr',
      customer: { id: 'lc1', pointsBalance: 0, recoveryOffsetPoints: 0 }, earnTx: false,
    })
    const before = await reconcileLoyaltyOnRefund(db, { orderId: 'o1', chargeAmountCents: 1410, refunds: [re('re_1', 1410)] })
    expect(before.applied).toBe(0)
    expect(state.txns).toHaveLength(0)
    // The delivery credits the earning…
    state.txns.push({ customerId: 'lc1', orderId: 'o1', type: 'earn', points: 14, sourceEventId: null })
    state.customer!.pointsBalance = 14
    // …and the SAME cumulative now asks for the whole clawback, in one adjustment.
    const after = await reconcileLoyaltyOnRefund(db, { orderId: 'o1', chargeAmountCents: 1410, refunds: [re('re_1', 1410)] })
    expect(after.applied).toBe(1)
    expect(after.converged).toBe(true)
    expect(state.txns.filter((t) => t.type === 'earn_reversal').map((t) => t.points)).toEqual([-14])
    expect(state.customer!.pointsBalance).toBe(0)
  })

  it('⭐ this module NEVER writes a null-keyed refund row — that would install a permanent grandfather marker', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('lib/loyalty-refund-apply.ts', 'utf8').replace(/\r\n/g, '\n')
    // A `refund` row with sourceEventId NULL is the pre-Phase-1 marker: the grandfather guard would then
    // early-return on every future reconciliation and the order would be frozen out of convergence for ever
    // (and its earn credit killed too). Every row this module creates carries the derived key.
    // The ban is on what is CREATED. The grandfather guard legitimately READS `sourceEventId: null` — that
    // query is how the marker is detected in the first place.
    let at = src.indexOf('loyaltyTransaction.create(')
    let creates = 0
    while (at !== -1) {
      const payload = src.slice(at, at + 400)
      expect(payload, 'every created row carries the derived key').toMatch(/sourceEventId,/)
      expect(payload, 'never a null key on a created row').not.toMatch(/sourceEventId:\s*null/)
      creates++
      at = src.indexOf('loyaltyTransaction.create(', at + 1)
    }
    expect(creates, 'one writer, one create site').toBe(1)
  })

  it('⭐ the applied effect is read from the ROWS, never from pointsBalance', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('lib/loyalty-refund-apply.ts', 'utf8').replace(/\r\n/g, '\n')
    // LoyaltyCustomer.pointsBalance is NOT Σ(LoyaltyTransaction.points) and never was: /api/loyalty/validate
    // and /api/loyalty/register write the balance with no ledger row at all, and a floored clawback puts the
    // remainder in recoveryOffsetPoints. Measuring the applied effect from the balance would be wrong on
    // every such account.
    const fn = src.slice(src.indexOf('function appliedMagnitude'))
    const body = fn.slice(0, fn.indexOf('\n}\n') + 1)
    expect(body).toMatch(/r\.points/)
    expect(body).not.toMatch(/pointsBalance/)
  })
})

describe('L6.1 — what the completeness critic found on the committed code', () => {
  it('⭐⭐ AN EMPTY SUCCEEDED SET NEVER LOWERS ANYTHING, even when it claims complete proof', async () => {
    // The critic's P1, and it is reachable from the webhook: charge.refunded fires at refund CREATION, so a
    // list call that SUCCEEDS can return zero SUCCEEDED refunds while the charge already carries an applied
    // clawback. Without this guard that event reversed the whole clawback of a legacy order and reported a
    // clean success.
    const { db, state } = makeDb({
      order: { pointsRedeemed: 0, pointsEarned: 14, consumerId: 'op1' }, operatorEmail: 'c@x.fr',
      customer: { id: 'lc1', pointsBalance: 0, recoveryOffsetPoints: 0 }, earnTx: true,
      seedTxns: [{ type: 'earn_reversal', points: -14, sourceEventId: 're_old' }],
    })
    const r = await reconcileLoyaltyOnRefund(db, {
      orderId: 'o1', chargeAmountCents: 1410, refunds: [], proofComplete: true,
    })
    expect(r.cumRefundedCents).toBe(0)
    expect(r.appliedEarnReversalBefore).toBe(14)
    expect(r.heldGiveBack, 'fourteen points it refused to return on an empty set').toBe(14)
    expect(r.applied).toBe(0)
    expect(state.customer!.pointsBalance, 'not one point came back').toBe(0)
    expect(state.txns.filter((t) => t.type === 'earn_reversal')).toHaveLength(1)
    expect(r.converged).toBe(false)
    const alert = alertMock.mock.calls.map((c) => c[0]).find((a) => a.kind === 'loyalty_target_unconverged')
    expect(alert.facts).toMatchObject({ orderId: 'o1', heldGiveBack: 14, moneyMoved: false })
  })

  it('⭐ the webhook never claims complete proof on an empty succeeded set', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('app/api/webhooks/stripe/route.ts', 'utf8').replace(/\r\n/g, '\n')
    expect(src).toMatch(/proofComplete: !listFailed && refunds\.length > 0/)
  })

  it('⭐⭐ THE FLOOR ENGAGING IS REPORTED — a shrunken proof set is never a clean pass', async () => {
    // The critic's other P1: the high-water floor is evaluated BEFORE the proofComplete gate, so a genuine
    // shrink became delta 0 and returned converged:true with no word about it. The floor still holds (nothing
    // is handed back) but the shrink is now a named fact.
    const { db, state } = makeDb({
      order: { pointsRedeemed: 0, pointsEarned: 14, consumerId: 'op1' }, operatorEmail: 'c@x.fr',
      customer: { id: 'lc1', pointsBalance: 5, recoveryOffsetPoints: 0 }, earnTx: true,
      seedTxns: [{ type: 'earn_reversal', points: -9, sourceEventId: 'prorata:v1:o1:940' }],
    })
    const r = await reconcileLoyaltyOnRefund(db, {
      orderId: 'o1', chargeAmountCents: 1410, refunds: [re('re_a', 470, 10)], proofComplete: true,
    })
    expect(r.cumRefundedCents, 'what this caller proved').toBe(470)
    expect(r.cumEffectiveCents, 'what was used').toBe(940)
    expect(r.cumFlooredFromCents, 'and the fact that the floor had to engage').toBe(470)
    expect(r.applied, 'nothing written — the floor holds').toBe(0)
    expect(state.customer!.pointsBalance).toBe(5)
    const alert = alertMock.mock.calls.map((c) => c[0]).find((a) => a.kind === 'loyalty_proof_set_shrank')
    expect(alert, 'a refund that was once provable and no longer is, is a fact a human needs').toBeTruthy()
    expect(alert.facts).toMatchObject({ orderId: 'o1', provenCents: 470, reconciledAgainst: 940, moneyMoved: false })
  })

  it('a cumulative that did NOT shrink reports no floor and raises no shrink alert', async () => {
    const { db } = makeDb({
      order: { pointsRedeemed: 0, pointsEarned: 14, consumerId: 'op1' }, operatorEmail: 'c@x.fr',
      customer: { id: 'lc1', pointsBalance: 5, recoveryOffsetPoints: 0 }, earnTx: true,
      seedTxns: [{ type: 'earn_reversal', points: -9, sourceEventId: 'prorata:v1:o1:940' }],
    })
    const r = await reconcileLoyaltyOnRefund(db, {
      orderId: 'o1', chargeAmountCents: 1410, refunds: [re('re_a', 470, 10), re('re_b', 470, 20)],
    })
    expect(r.cumFlooredFromCents).toBe(null)
    expect(r.converged).toBe(true)
    expect(alertMock.mock.calls.map((c) => c[0]).find((a) => a.kind === 'loyalty_proof_set_shrank')).toBeUndefined()
  })

  it('⭐ a NEGATIVE delta produced by a moved BASE, not by legacy rows — the contract clause nothing pinned', async () => {
    // The clause: « the target itself moves when the base or the charge amount is corrected ». Every other
    // negative-delta test gets there through pre-L6.1 rows; this one moves the CREDIT instead. The earn row
    // says 6 while 9 was clawed back, so the target is round(6 × 940/1410) = 4 and three points are owed back.
    const { db, state } = makeDb({
      order: { pointsRedeemed: 0, pointsEarned: 14, consumerId: 'op1' }, operatorEmail: 'c@x.fr',
      customer: { id: 'lc1', pointsBalance: 0, recoveryOffsetPoints: 0 }, earnTx: false,
      seedTxns: [
        { type: 'earn', points: 6, sourceEventId: null },
        { type: 'earn_reversal', points: -9, sourceEventId: 'prorata:v1:o1:940' },
      ],
    })
    const r = await reconcileLoyaltyOnRefund(db, {
      orderId: 'o1', chargeAmountCents: 1410,
      refunds: [re('re_a', 470, 10), re('re_b', 470, 20)], proofComplete: true,
    })
    expect(r.targetEarnReversal, 'round(6 × 940 / 1410)').toBe(4)
    expect(r.appliedEarnReversalBefore).toBe(9)
    // And here is what the contract clause actually produces, which is worth pinning precisely BECAUSE it is
    // not what one would guess: the adjustment for cumulative 940 has already been written, so a DIFFERENT
    // target for the SAME proof state cannot be written without rewriting history. It is refused and
    // reported — never silently applied, and never silently dropped.
    expect(r.blocked, 'the key for this cumulative is already used').toBe(true)
    expect(r.converged).toBe(false)
    expect(r.earnReversed, 'not one point moved').toBe(0)
    expect(state.customer!.pointsBalance).toBe(0)
    expect(state.txns.filter((t) => t.type === 'earn_reversal')).toHaveLength(1)
    const alert = alertMock.mock.calls.map((c) => c[0]).find((a) => a.kind === 'loyalty_target_unconverged')
    expect(alert.facts).toMatchObject({ orderId: 'o1', blocked: true, targetEarnReversal: 4, moneyMoved: false })
  })

  it('⭐ the classic D-15 shape (base 0, only the SPENT side moves) meeting a debt reports T-44', async () => {
    // The critic's P2: the detector was D1-only, so the ordering D-15 is named after — a refund BEFORE
    // delivery, where there is no earn row at all — was silent about the deferred composition.
    const { db } = makeDb({
      order: { pointsRedeemed: 8, pointsEarned: 14, consumerId: 'op1' }, operatorEmail: 'c@x.fr',
      customer: { id: 'lc1', pointsBalance: 20, recoveryOffsetPoints: 5 }, earnTx: false,
    })
    const r = await reconcileLoyaltyOnRefund(db, { orderId: 'o1', chargeAmountCents: 1410, refunds: [re('re_1', 705, 10)] })
    expect(r.targetEarnReversal, 'no earn row ⇒ nothing to claw back').toBe(0)
    expect(r.spentRestored, 'round(8 × 705 / 1410)').toBe(4)
    expect(r.offsetDeferredT44, 'the debt was in the room and only D2 moved').toBe(true)
    const alert = alertMock.mock.calls.map((c) => c[0]).find((a) => a.kind === 'loyalty_offset_t44_review')
    expect(alert).toBeTruthy()
  })

  it('⭐ a NEGATIVE recoveryOffsetPoints is treated as a corrupt debt ledger, not as « no debt »', async () => {
    // Nothing floors that column and the waiver route decrements it without the lock, so it can go negative.
    // A detector that reads a corrupt ledger as « no debt » goes quiet exactly when it is needed.
    const { db } = makeDb({
      order: { pointsRedeemed: 0, pointsEarned: 14, consumerId: 'op1' }, operatorEmail: 'c@x.fr',
      customer: { id: 'lc1', pointsBalance: 14, recoveryOffsetPoints: -3 }, earnTx: true,
    })
    const r = await reconcileLoyaltyOnRefund(db, { orderId: 'o1', chargeAmountCents: 1410, refunds: [re('re_1', 470, 10)] })
    expect(r.offsetDeferredT44).toBe(true)
    expect(alertMock.mock.calls.map((c) => c[0]).find((a) => a.kind === 'loyalty_offset_t44_review')).toBeTruthy()
  })

  it('⭐ the key is built from the EFFECTIVE cumulative, not from what the caller proved', async () => {
    // If the key used cumProvenCents, a floored pass would mint a NEW key for a cumulative the order had
    // already been reconciled against — the oscillation the key exists to stop.
    const { db, state } = makeDb({
      order: { pointsRedeemed: 0, pointsEarned: 14, consumerId: 'op1' }, operatorEmail: 'c@x.fr',
      customer: { id: 'lc1', pointsBalance: 14, recoveryOffsetPoints: 0 }, earnTx: true,
      seedTxns: [{ type: 'earn_reversal', points: -1, sourceEventId: 'prorata:v1:o1:940' }],
    })
    // Proves only 470 but the order is floored to 940 ⇒ target 9, applied 1 ⇒ +8 at the key for 940.
    await reconcileLoyaltyOnRefund(db, { orderId: 'o1', chargeAmountCents: 1410, refunds: [re('re_a', 470, 10)] })
    const keys = state.txns.filter((t) => t.type === 'earn_reversal').map((t) => t.sourceEventId)
    expect(keys).toContain('prorata:v1:o1:940')
    expect(keys, 'never a key for the smaller cumulative').not.toContain('prorata:v1:o1:470')
  })

  it('⭐ past rows are IMMUTABLE — this module never updates or deletes a loyalty row', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('lib/loyalty-refund-apply.ts', 'utf8').replace(/\r\n/g, '\n')
    // Pinned at the SOURCE, not by the accident that neither fake implements update/delete.
    expect(src).not.toMatch(/loyaltyTransaction\.update/)
    expect(src).not.toMatch(/loyaltyTransaction\.delete/)
    expect(src).not.toMatch(/loyaltyTransaction\.upsert/)
    expect(src).not.toMatch(/loyaltyTransaction\.updateMany/)
    expect(src).not.toMatch(/loyaltyTransaction\.deleteMany/)
  })

  it('⭐ the L5 rail is untouched by this lot — all five files, not one', async () => {
    const { readFileSync } = await import('node:fs')
    for (const f of [
      'lib/claims-pay-rail.ts', 'lib/claims-pay-token.ts', 'lib/claims-payable-core.js',
      'app/api/admin/claims/pay-approved/route.ts', 'scripts/server/phase2-claims-pay-window.js',
    ]) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).not.toMatch(/loyalty-refund|loyaltyConvergenceDelta|prorata:v1:|cumulativeRefundedCents/)
    }
  })
})

describe('L6.1 — concurrency and the unreached target', () => {
  it('⭐ a concurrent writer that takes the exact transition ⇒ counted as skipped, then re-converged', async () => {
    const { db, state } = world2()
    // The fake writes the row the product was about to write, the instant the product reads the state.
    let hijacked = false
    const table = createHook(db)
    const orig = table.create
    table.create = async (args) => {
      const data = args.data
      if (!hijacked && data.type === 'earn_reversal') {
        hijacked = true
        // The competitor lands the SAME transition first, balance included.
        state.txns.push({ customerId: data.customerId, orderId: 'o1', type: data.type, points: data.points, sourceEventId: data.sourceEventId })
        state.customer!.pointsBalance -= Math.abs(data.points)
      }
      return orig(args)
    }
    const r = await reconcileLoyaltyOnRefund(db, { orderId: 'o1', chargeAmountCents: 1410, refunds: [re('re_1', 1410)] })
    expect(r.skipped, 'the duplicate was refused by the unique key').toBeGreaterThan(0)
    expect(state.txns.filter((t) => t.type === 'earn_reversal')).toHaveLength(1) // never doubled
    expect(r.converged).toBe(true)
    expect(state.customer!.pointsBalance).toBe(100 - 14 + 8)
  })

  it('⭐ a state that refuses to converge is ALERTED, never left silent', async () => {
    const { db } = world2()
    // A ledger that swallows writes: every row created vanishes, so the target is never reached.
    createHook(db).create = async (args) => ({ ...args.data })
    const r = await reconcileLoyaltyOnRefund(db, { orderId: 'o1', chargeAmountCents: 1410, refunds: [re('re_1', 1410)] })
    expect(r.converged).toBe(false)
    // TWO writes per side, not the full budget: a write that does not move the measured applied figure means
    // the row is not readable back, and repeating the same delta would move the balance once per attempt while
    // only one row is ever claimed. The loop stops instead — and CONVERGENCE_ATTEMPTS is a ceiling it never
    // needs to reach here.
    expect(r.applied).toBe(4)
    expect(r.applied).toBeLessThan(CONVERGENCE_ATTEMPTS * 2)
    const alert = alertMock.mock.calls.map((c) => c[0]).find((a) => a.kind === 'loyalty_target_unconverged')
    expect(alert).toBeTruthy()
    expect(alert.facts).toMatchObject({ orderId: 'o1', targetEarnReversal: 14, moneyMoved: false })
    expect(String(alert.facts.repair)).toContain('/api/admin/loyalty/reconcile')
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
