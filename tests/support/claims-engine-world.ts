// tests/support/claims-engine-world.ts — the claims world extended so the REAL lib/refund.ts executeRefund runs on it.
//
// WHY. J-M03 / J-M04 / J-M05 pin that the pure mirror (G5) and the reconcile derivation read the same state the
// engine refuses or accepts. A mocked engine cannot prove that: the engine itself runs here, unchanged, against
// the same in-memory order, rows, royalty and Stripe objects the loader reads (tests/support/claims-world).
// Every Prisma call lib/refund.ts makes is modelled; every Stripe call is recorded. Nothing reaches Stripe.
import { Prisma } from '@prisma/client'
import { matchWhere } from './prisma-where'
import { wireWorld, type World } from './claims-world'

/* eslint-disable @typescript-eslint/no-explicit-any -- a test double of Prisma and Stripe payloads */
type Row = Record<string, any>
type Fn = { mockImplementation: (impl: (...args: any[]) => any) => unknown }

export type EngineExtras = {
  /** transfers.list returns this settlement transfer (locateSettlementTransfer); null → none. */
  settlementTransfer?: string | null
  /** transfers.listReversals answer. */
  reversals?: { data: Row[]; has_more: boolean }
  /** refunds.create throws after the engine's row insert (CX). */
  createThrows?: boolean
}
export type EngineWorld = World & { engine?: EngineExtras }

/** A royalty row with every field lib/refund.ts selects (the loader reads only `status`). */
export const royaltyRow = (status: string, o: Row = {}): Row => ({
  id: 'roy_1', orderId: 'o1', royaltyCents: 1000, refundedCents: 0, status, payoutId: null, settlementId: 'set_1', franchisorOperatorId: 'op_f', ...o,
})

const p2002 = () => new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' })

export function wireEngineWorld(
  w: EngineWorld,
  db: {
    claim: Record<string, Fn>; refund: Record<string, Fn>; order: Record<string, Fn>
    franchiseRoyalty: Record<string, Fn>; dispute: Record<string, Fn>; payout: Record<string, Fn>
  },
  stripe: { paymentIntents: Record<string, Fn>; refunds: Record<string, Fn>; transfers: Record<string, Fn>; applicationFees: Record<string, Fn> },
): void {
  wireWorld(w, db, stripe)
  let created = 0
  db.refund.create.mockImplementation(async ({ data }: { data: Row }) => {
    if (w.refunds.some((r) => r.idempotencyKey === data.idempotencyKey)) throw p2002()
    created++
    const row = { id: created === 1 ? 'rf_new' : `rf_new${created}`, stripeRefundId: null, createdAt: new Date(), royaltyRefundCents: 0, ...data }
    w.refunds.push(row)
    return { ...row }
  })
  db.refund.update.mockImplementation(async ({ where, data }: { where: Row; data: Row }) => {
    const r = w.refunds.find((x) => x.id === where.id)
    if (!r) throw new Error(`refund.update: no row ${where.id}`)
    Object.assign(r, data)
    return { ...r }
  })
  db.refund.aggregate.mockImplementation(async ({ where }: { where: Row }) => {
    const rows = w.refunds.filter((r) => matchWhere(where, r))
    return { _sum: { royaltyRefundCents: rows.reduce((s, r) => s + (r.royaltyRefundCents ?? 0), 0), royaltyClawbackCents: rows.reduce((s, r) => s + (r.royaltyClawbackCents ?? 0), 0) } }
  })
  db.dispute.aggregate.mockImplementation(async () => ({ _sum: { royaltyRefundedCents: 0, royaltyClawbackCents: 0 } }))
  db.payout.findUnique.mockImplementation(async () => null)
  db.franchiseRoyalty.findUnique.mockImplementation(async () => (w.royalty ? { ...w.royalty } : null))
  db.franchiseRoyalty.update.mockImplementation(async ({ data }: { data: Row }) => { if (w.royalty) Object.assign(w.royalty, data); return { ...w.royalty } })

  // The engine and the loader both list a PaymentIntent's refunds; Stripe paginates by 100.
  stripe.refunds.list.mockImplementation(async (args: { payment_intent?: string; limit?: number; starting_after?: string }) => {
    if (w.fail.refundList) throw new Error('stripe unreachable')
    const all = w.stripeRefunds.filter((s) => !args?.payment_intent || !s.payment_intent || s.payment_intent === args.payment_intent)
    if (w.fail.listOverCap) return { data: all.length ? all.slice(0, 1) : [{ id: `re_page_${Math.random()}`, status: 'succeeded', amount: 1 }], has_more: true }
    const limit = args?.limit ?? 10
    const from = args?.starting_after ? all.findIndex((s) => s.id === args.starting_after) + 1 : 0
    const page = all.slice(from, from + limit)
    return { data: page.map((s) => ({ ...s })), has_more: from + limit < all.length }
  })
  stripe.refunds.create.mockImplementation(async (params: Row, opts: Row) => {
    if (w.engine?.createThrows) throw new Error('Stripe refused the refund')
    const s = { id: 're_new', object: 'refund', status: 'succeeded', amount: params.amount, currency: 'eur', created: 1_700_000_000, payment_intent: params.payment_intent, charge: 'ch_1', metadata: params.metadata, transfer_reversal: null, _idempotencyKey: opts?.idempotencyKey }
    return s
  })
  stripe.transfers.list.mockImplementation(async () => ({ data: w.engine?.settlementTransfer ? [{ id: w.engine.settlementTransfer }] : [] }))
  stripe.transfers.listReversals.mockImplementation(async () => w.engine?.reversals ?? { data: [], has_more: false })
  stripe.transfers.createReversal.mockImplementation(async () => ({ id: 'trr_new', amount: 300 }))
  stripe.applicationFees.listRefunds.mockImplementation(async () => ({ data: [] }))
}
