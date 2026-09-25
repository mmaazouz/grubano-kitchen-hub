// tests/support/loyalty-world.ts — an in-memory database for the D-15 loyalty prorata (D′ lot L6).
//
// WHY A WORLD RATHER THAN MOCKS. The numbers D-15 pins (T = 1410, E = 14, 470×3 ⇒ −5/−4/−5) only mean
// something if the PRODUCT computed them: `buildDbKnownRefundSet` assembles the set, `reconcileLoyaltyOnRefund`
// applies it, `planLoyaltyRefund` does the arithmetic. So this file models the four tables they read and
// write — orders, refunds, ledger lines, loyalty rows — with the two behaviours that decide the outcome:
//   • the UNIQUE (sourceEventId, type) index, which is the whole idempotency of the model: a replayed effect
//     must throw P2002 and roll its transaction back, not quietly write a second row ;
//   • an interactive transaction that is ATOMIC, so a P2002 on the keyed row leaves the balance untouched.
// Everything else is a plain array, and every assertion in the test reads these arrays.
import { Prisma } from '@prisma/client'

export interface LoyaltyRow {
  id: string
  customerId: string
  orderId: string | null
  type: string
  points: number
  sourceEventId: string | null
}

export interface RefundRow {
  stripeRefundId: string | null
  amountCents: number
  status: string
  settledAt: Date | null
  createdAt: Date
}

export interface LedgerRow {
  type: string
  sourceEventId: string
  grossAmount: number
  stripePaymentIntentId: string | null
  createdAt: Date
}

export interface LoyaltyWorld {
  orderId: string
  order: { id: string; total: number; stripePaymentIntentId: string | null; pointsEarned: number; pointsRedeemed: number; consumerId: string }
  customer: { id: string; email: string; pointsBalance: number; recoveryOffsetPoints: number }
  refunds: RefundRow[]
  ledger: LedgerRow[]
  loyaltyTransactions: LoyaltyRow[]
  /** The Prisma surface lib/loyalty-prorata and lib/loyalty-refund-apply read. */
  db: LoyaltyDb
  /** A succeeded refund row of this order. `atUnix` sets the instant used for the stable sort. */
  refundRow: (re: string, amountCents: number, atUnix?: number) => RefundRow
  /** A ledger refund line — written NEGATIVE, as lib/ledger writes it. */
  ledgerRefund: (re: string, amountCents: number, atUnix?: number) => LedgerRow
  /** The ledger PAYMENT line of the order's PaymentIntent: the measured cash captured. */
  ledgerPayment: (grossCents: number) => LedgerRow
  /** What the delivered transition does before the replay: one `earn` row plus the balance. */
  creditEarn: () => void
  /**
   * A fault injector called at the START of every `loyaltyTransaction.create`, INSIDE the transaction.
   * It lives in the world rather than in a wrapper around `db` because `$transaction` hands the callback
   * the world's own client: a test that patched `db.loyaltyTransaction.create` from outside would be
   * bypassed by every write that matters, and would « pass » while injecting nothing.
   */
  onLoyaltyCreate: ((data: { type: string; sourceEventId: string | null; points: number }) => void) | null
}

/* eslint-disable @typescript-eslint/no-explicit-any -- a test double of the Prisma client surface */
type Any = any
export type LoyaltyDb = Any

const p2002 = () => new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' })

export function makeLoyaltyWorld(opts: {
  orderId?: string
  chargeCents?: number
  pointsEarned?: number
  pointsRedeemed?: number
  balance?: number
  offset?: number
} = {}): LoyaltyWorld {
  const orderId = opts.orderId ?? 'o_loyalty'
  const chargeCents = opts.chargeCents ?? 1410
  const w: LoyaltyWorld = {
    orderId,
    order: {
      id: orderId,
      // The order total is stored in EUROS; the cents are the fallback denominator.
      total: chargeCents / 100,
      stripePaymentIntentId: 'pi_loyalty',
      pointsEarned: opts.pointsEarned ?? 14,
      pointsRedeemed: opts.pointsRedeemed ?? 0,
      consumerId: 'u_loyalty',
    },
    customer: { id: 'lc_1', email: 'client@grubano.test', pointsBalance: opts.balance ?? 0, recoveryOffsetPoints: opts.offset ?? 0 },
    refunds: [],
    ledger: [],
    loyaltyTransactions: [],
    db: null as unknown as LoyaltyDb,
    refundRow: (re, amountCents, atUnix = 1_000_000) => ({
      stripeRefundId: re, amountCents, status: 'succeeded',
      settledAt: new Date(atUnix * 1000), createdAt: new Date(atUnix * 1000),
    }),
    ledgerRefund: (re, amountCents, atUnix = 1_000_000) => ({
      type: 'refund', sourceEventId: re, grossAmount: -amountCents,
      stripePaymentIntentId: 'pi_loyalty', createdAt: new Date(atUnix * 1000),
    }),
    ledgerPayment: (grossCents) => ({
      type: 'payment', sourceEventId: 'pi_loyalty', grossAmount: grossCents,
      stripePaymentIntentId: 'pi_loyalty', createdAt: new Date(500_000 * 1000),
    }),
    creditEarn: () => {
      // The [orderId,'earn'] guard the route applies: one earning per order, whatever happens upstream.
      if (w.loyaltyTransactions.some((r) => r.orderId === orderId && r.type === 'earn')) return
      w.loyaltyTransactions.push({ id: `lt_${w.loyaltyTransactions.length + 1}`, customerId: w.customer.id, orderId, type: 'earn', points: w.order.pointsEarned, sourceEventId: null })
      w.customer.pointsBalance += w.order.pointsEarned
    },
    onLoyaltyCreate: null,
  }

  const matchLoyalty = (where: Any, r: LoyaltyRow): boolean => {
    if (!where) return true
    if (where.orderId !== undefined && r.orderId !== where.orderId) return false
    if (where.sourceEventId !== undefined && r.sourceEventId !== where.sourceEventId) return false
    if (where.type !== undefined) {
      if (typeof where.type === 'string') { if (r.type !== where.type) return false }
      else if (where.type.in && !where.type.in.includes(r.type)) return false
    }
    return true
  }

  const client = {
    order: {
      findUnique: async ({ where }: Any) => (where?.id === orderId ? { ...w.order } : null),
    },
    refund: {
      findMany: async ({ where }: Any) => w.refunds
        .filter((r) => (!where?.status || r.status === where.status))
        .map((r) => ({ ...r })),
    },
    ledgerEntry: {
      findMany: async ({ where }: Any) => w.ledger
        .filter((l) => (!where?.type || l.type === where.type)
          && (!where?.stripePaymentIntentId || l.stripePaymentIntentId === where.stripePaymentIntentId))
        .map((l) => ({ ...l })),
      findFirst: async ({ where }: Any) => {
        const hit = w.ledger.find((l) => (!where?.type || l.type === where.type)
          && (!where?.stripePaymentIntentId || l.stripePaymentIntentId === where.stripePaymentIntentId))
        return hit ? { ...hit } : null
      },
    },
    operator: {
      findUnique: async ({ where }: Any) => (where?.id === w.order.consumerId ? { email: w.customer.email } : null),
    },
    loyaltyCustomer: {
      findUnique: async ({ where }: Any) =>
        (where?.email === w.customer.email || where?.id === w.customer.id ? { ...w.customer } : null),
      update: async ({ where, data }: Any) => {
        if (where?.id !== w.customer.id) throw new Error('unknown customer')
        // RELATIVE deltas only — the product never writes an absolute balance here.
        if (data.pointsBalance?.increment !== undefined) w.customer.pointsBalance += data.pointsBalance.increment
        if (data.pointsBalance?.decrement !== undefined) w.customer.pointsBalance -= data.pointsBalance.decrement
        if (data.recoveryOffsetPoints?.increment !== undefined) w.customer.recoveryOffsetPoints += data.recoveryOffsetPoints.increment
        if (data.recoveryOffsetPoints?.decrement !== undefined) w.customer.recoveryOffsetPoints -= data.recoveryOffsetPoints.decrement
        return { ...w.customer }
      },
    },
    loyaltyTransaction: {
      findFirst: async ({ where }: Any) => {
        const hit = w.loyaltyTransactions.find((r) => matchLoyalty(where, r))
        return hit ? { ...hit } : null
      },
      /** Read by the D′ L6 partial-failure count and by the §9 drift detection. */
      findMany: async ({ where }: Any) => w.loyaltyTransactions.filter((r) => matchLoyalty(where, r)).map((r) => ({ ...r })),
      create: async ({ data }: Any) => {
        // Fault injection point (see onLoyaltyCreate): before the index, so a throw here is a write that
        // never happened — exactly what a dead connection looks like.
        w.onLoyaltyCreate?.({ type: data.type, sourceEventId: data.sourceEventId ?? null, points: data.points })
        // THE UNIQUE INDEX (sourceEventId, type) — the whole idempotency of the model.
        if (data.sourceEventId != null
          && w.loyaltyTransactions.some((r) => r.sourceEventId === data.sourceEventId && r.type === data.type)) {
          throw p2002()
        }
        const row: LoyaltyRow = {
          id: `lt_${w.loyaltyTransactions.length + 1}`,
          customerId: data.customerId, orderId: data.orderId ?? null,
          type: data.type, points: data.points, sourceEventId: data.sourceEventId ?? null,
        }
        w.loyaltyTransactions.push(row)
        return { ...row }
      },
    },
    /** ATOMIC: a throw inside rolls the arrays back, so a P2002 on the keyed row leaves no balance change. */
    $transaction: async (fn: (tx: Any) => Promise<Any>) => {
      const snapRows = w.loyaltyTransactions.map((r) => ({ ...r }))
      const snapCustomer = { ...w.customer }
      try {
        return await fn(client)
      } catch (e) {
        w.loyaltyTransactions.length = 0
        w.loyaltyTransactions.push(...snapRows)
        Object.assign(w.customer, snapCustomer)
        throw e
      }
    },
    /** The FOR UPDATE read the clawback does. Returns the live balance. */
    $queryRawUnsafe: async (sql: string) => {
      if (/pointsBalance/.test(sql)) return [{ pointsBalance: w.customer.pointsBalance }]
      if (/recoveryOffsetPoints/.test(sql)) return [{ recoveryOffsetPoints: w.customer.recoveryOffsetPoints }]
      return []
    },
  }
  w.db = client as unknown as LoyaltyDb
  return w
}
