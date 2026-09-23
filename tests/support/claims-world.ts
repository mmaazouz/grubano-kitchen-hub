// tests/support/claims-world.ts — an in-memory order / refunds / claims / Stripe world for the round-13 T1-T4 tests.
//
// WHY. triggerClaimRefund now reads the stamped rows, the order, the royalty, the PaymentIntent, the complete
// refund list and every row's Stripe refund before it may call the engine (C3), and every claim write is a
// compare-and-set (C1/C5). A mock that returns fixed values per call cannot say whether a CAS matched. This
// world keeps ONE mutable state: every read returns what the state holds now and every updateMany evaluates
// its where clause against it (tests/support/prisma-where), so a concurrent change is just a state mutation.
// It never calls Stripe: the Stripe object is a plain mock whose methods read the same state.
import { matchWhere } from './prisma-where'

/* eslint-disable @typescript-eslint/no-explicit-any -- a test double of Prisma and Stripe payloads */
type Row = Record<string, any>
type Fn = { mockImplementation: (impl: (...args: any[]) => any) => unknown; mockReset?: () => unknown }

export type WorldStripeRefund = {
  id: string
  status: string
  amount: number
  charge?: string | null
  payment_intent?: string | null
  metadata?: Record<string, string | null>
}

export type World = {
  claims: Row[]
  refunds: Row[]
  orders: Row[]
  royalty: Row | null
  pis: Record<string, Row>
  /** The complete refund list of the order's PaymentIntent (and what refunds.retrieve finds). */
  stripeRefunds: WorldStripeRefund[]
  fail: {
    piRetrieve?: boolean
    refundList?: boolean
    listOverCap?: boolean
    /** refunds.retrieve(id): 'missing' → Stripe 404; 'throw' → a transient error. */
    refundRetrieve?: Record<string, 'missing' | 'throw'>
    /** prisma.refund.findUnique rejects (the T3 identity read, the bound-row read). */
    refundFindUnique?: boolean
    /** prisma.refund.findFirst rejects (the T2 (a)/(f) stamped query, the own-row read). */
    refundFindFirst?: boolean
    refundFindMany?: boolean
    orderFindUnique?: boolean
    royaltyFindFirst?: boolean
    claimFindMany?: boolean
  }
  /** Called before each claim.updateMany is evaluated, with its 1-based index. */
  beforeClaimWrite?: (n: number, args: { where: Row; data: Row }) => void
  /** Called before each claim.findUnique returns, with its 1-based index. */
  beforeClaimRead?: (n: number, args: { where: Row }) => void
  writes: Array<{ where: Row; data: Row; count: number }>
  reads: number
}

export const T_NOW = () => Date.now()
const HOUR = 3_600_000

/** The canonical payable world: a paid order, a succeeded PaymentIntent and charge, no refund anywhere, one approved claim. */
export function payableWorld(claim: Row = {}): World {
  return {
    claims: [{
      id: 'cl1', orderId: 'o1', consumerId: 'c1', restaurantId: 'r1', status: 'approved', refundAttempted: false, refundId: null,
      refundError: null, requestedAmountCents: 500, arbitrationDecision: 'approved', responseDeadlineAt: null, activeOrderKey: 'o1',
      // D′ L4 (spec v2 §8.3): the engine pays the RATIFIED amount, so the canonical payable claim carries one.
      // A world that omits it is the amount_not_ratified fixture, and states that explicitly by passing null.
      approvedAmountCents: 500,
      ...claim,
    }],
    refunds: [],
    orders: [{ id: 'o1', restaurantId: 'r1', paymentStatus: 'paid', stripePaymentIntentId: 'pi_1' }],
    royalty: null,
    pis: {
      pi_1: {
        id: 'pi_1', status: 'succeeded', transfer_data: null, metadata: {},
        latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 0, disputed: false },
      },
    },
    stripeRefunds: [],
    fail: {},
    writes: [],
    reads: 0,
  }
}

/** A Refund row with the G2 select fields. */
export const refundRow = (id: string, o: Row = {}): Row => ({
  id, orderId: 'o1', status: 'succeeded', amountCents: 300, stripeRefundId: null, reason: null,
  idempotencyKey: `refund:o1:k_${id}`, createdAt: new Date(Date.now() - 2 * HOUR), royaltyRefundCents: 0, ...o,
})
/** A Stripe refund on the order's payment. */
export const stripeRefund = (id: string, o: Partial<WorldStripeRefund> = {}): WorldStripeRefund => ({
  id, status: 'succeeded', amount: 300, charge: 'ch_1', payment_intent: 'pi_1', metadata: {}, ...o,
})

export const claimOf = (w: World, id = 'cl1'): Row => w.claims.find((c) => c.id === id)!

const byId = (where: Row, r: Row) => (typeof where?.id === 'string' ? r.id === where.id : true)
const sortBy = (rows: Row[], orderBy?: Row) => {
  const dir = orderBy?.createdAt === 'desc' ? -1 : 1
  return orderBy?.createdAt ? [...rows].sort((a, b) => dir * (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())) : rows
}
const missing = () => Object.assign(new Error('No such refund'), { statusCode: 404, code: 'resource_missing' })

/** Wires the Prisma and Stripe mocks of a test file to the world. Every mock the test declares is optional. */
export function wireWorld(
  w: World,
  db: { claim: Record<string, Fn>; refund: Record<string, Fn>; order?: Record<string, Fn>; franchiseRoyalty?: Record<string, Fn> },
  stripe?: { paymentIntents: Record<string, Fn>; refunds: Record<string, Fn> },
): void {
  let claimWrites = 0
  let claimReads = 0
  db.claim.findUnique?.mockImplementation(async ({ where }: { where: Row }) => {
    claimReads++
    w.reads = claimReads
    w.beforeClaimRead?.(claimReads, { where })
    const c = w.claims.find((x) => x.id === where.id)
    return c ? { ...c } : null
  })
  db.claim.findFirst?.mockImplementation(async ({ where }: { where: Row }) => {
    const c = w.claims.find((x) => byId(where, x) && matchWhere(where, x))
    return c ? { ...c } : null
  })
  db.claim.findMany?.mockImplementation(async ({ where }: { where: Row }) => {
    if (w.fail.claimFindMany) throw new Error('db down')
    return w.claims.filter((x) => byId(where, x) && matchWhere(where ?? {}, x)).map((x) => ({ ...x }))
  })
  db.claim.count?.mockImplementation(async ({ where }: { where: Row }) => w.claims.filter((x) => byId(where, x) && matchWhere(where ?? {}, x)).length)
  db.claim.updateMany?.mockImplementation(async ({ where, data }: { where: Row; data: Row }) => {
    claimWrites++
    w.beforeClaimWrite?.(claimWrites, { where, data })
    const hits = w.claims.filter((x) => byId(where, x) && matchWhere(where, x))
    for (const h of hits) Object.assign(h, data)
    w.writes.push({ where, data, count: hits.length })
    return { count: hits.length }
  })
  db.claim.update?.mockImplementation(async ({ where, data }: { where: Row; data: Row }) => {
    const c = w.claims.find((x) => x.id === where.id)
    if (c) Object.assign(c, data)
    w.writes.push({ where, data, count: c ? 1 : 0 })
    return c ? { ...c } : null
  })
  db.refund.findUnique?.mockImplementation(async ({ where }: { where: Row }) => {
    if (w.fail.refundFindUnique) throw new Error('db down')
    const r = w.refunds.find((x) => x.id === where.id)
    return r ? { ...r } : null
  })
  db.refund.findFirst?.mockImplementation(async ({ where, orderBy }: { where: Row; orderBy?: Row }) => {
    if (w.fail.refundFindFirst) throw new Error('db down')
    const r = sortBy(w.refunds.filter((x) => byId(where, x) && matchWhere(where, x)), orderBy)[0]
    return r ? { ...r } : null
  })
  db.refund.findMany?.mockImplementation(async ({ where, orderBy }: { where: Row; orderBy?: Row }) => {
    if (w.fail.refundFindMany) throw new Error('db down')
    return sortBy(w.refunds.filter((x) => byId(where, x) && matchWhere(where ?? {}, x)), orderBy).map((x) => ({ ...x }))
  })
  db.refund.create?.mockImplementation(async () => { throw new Error('refund.create must not be called by Claims') })
  db.order?.findUnique?.mockImplementation(async ({ where }: { where: Row }) => {
    if (w.fail.orderFindUnique) throw new Error('db down')
    const o = w.orders.find((x) => x.id === where.id)
    return o ? { ...o } : null
  })
  db.franchiseRoyalty?.findFirst?.mockImplementation(async () => {
    if (w.fail.royaltyFindFirst) throw new Error('db down')
    return w.royalty ? { ...w.royalty } : null
  })
  if (!stripe) return
  stripe.paymentIntents.retrieve.mockImplementation(async (id: string) => {
    if (w.fail.piRetrieve) throw new Error('stripe unreachable')
    const pi = w.pis[id]
    if (!pi) throw missing()
    return JSON.parse(JSON.stringify(pi))
  })
  stripe.refunds.list.mockImplementation(async (args?: { payment_intent?: string }) => {
    if (w.fail.refundList) throw new Error('stripe unreachable')
    if (w.fail.listOverCap) return { data: [{ id: `re_page_${Math.random()}` }], has_more: true }
    // W3: the list of a PaymentIntent holds only the refunds of that payment (a refund on pi_OTHER is not listed).
    const pi = args?.payment_intent
    return { data: w.stripeRefunds.filter((s) => !pi || !s.payment_intent || s.payment_intent === pi).map((s) => ({ ...s })), has_more: false }
  })
  stripe.refunds.retrieve.mockImplementation(async (id: string) => {
    const f = w.fail.refundRetrieve?.[id]
    if (f === 'throw') throw new Error('ETIMEDOUT')
    if (f === 'missing') throw missing()
    const s = w.stripeRefunds.find((x) => x.id === id)
    if (!s) throw missing()
    return { ...s }
  })
  stripe.refunds.create?.mockImplementation(async () => { throw new Error('Claims never creates a Stripe refund') })
}

/** An engine success on a fresh create of THIS claim's row. */
export const engineOk = (o: Row = {}) => ({
  ok: true, resumed: false, refundId: 'rf_new', stripeRefundId: 're_new', amountCents: 500, restaurantReverseCents: 0,
  applicationFeeRefundCents: 0, royaltyRefundCents: 0, royaltyClawbackCents: 0, cumulativeRefundedCents: 500,
  remainingRefundableCents: 1500, routed: false, ...o,
})
export const engine202 = (o: Row = {}) => ({ ok: false, status: 202, pending: true, refundId: 'rf_new', stripeRefundId: 're_new', amountCents: 500, stripeStatus: 'pending', error: 'pending', ...o })
export const engineRefusal = (error = 'Un remboursement est déjà en cours sur ce montant cumulé.', status = 409) => ({ ok: false, status, error })

export const HOURS = HOUR
