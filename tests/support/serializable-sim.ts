// tests/support/serializable-sim.ts — a lock simulator for the C6 / C8 Serializable transactions (J-M23, J-M25).
//
// WHY. Vitest with a mocked Prisma cannot prove InnoDB lock behaviour: the exactly-one outcome is rehearsed on a real
// database (J-M24, C10). What a mock CAN pin is that the code puts the identity read and the write in ONE transaction.
// This simulator models what that buys under SERIALIZABLE on InnoDB (ARCHITECTURE DECISION, schema_reason):
//   • a plain SELECT inside a transaction takes SHARED locks on what it scans — Claim.refundId has no index, so the
//     binder read scans (and share-locks) every claim row; the stamped Refund read share-locks the order's range;
//   • a write needs an EXCLUSIVE lock (an insert: an insert-intention lock on the range), blocked by another
//     transaction's shared lock;
//   • a wait cycle is a deadlock: the transaction that closes it is rolled back completely (P2034).
// A read made OUTSIDE the transaction takes no lock — exactly the defect the J-M23 / J-M25 break/restore re-introduces.
import { Prisma } from '@prisma/client'
import { matchWhere } from './prisma-where'

/* eslint-disable @typescript-eslint/no-explicit-any -- a test double of Prisma payloads */
type Row = Record<string, any>
type Fn = { mockImplementation: (impl: (...args: any[]) => any) => unknown }

export const pick = (row: Row | null | undefined, select?: Row): Row | null => {
  if (!row) return null
  if (!select) return { ...row }
  return Object.fromEntries(Object.entries(row).filter(([k]) => select[k] === true))
}
/** A scalar id addresses the row (prisma-where skips it); an operator on id is evaluated by matchWhere. */
const byId = (where: Row | undefined, r: Row) => (typeof where?.id === 'string' ? r.id === where.id : true)
export const matches = (where: Row | undefined, r: Row) => byId(where, r) && matchWhere(where ?? {}, r)

export const deadlockError = () =>
  new Prisma.PrismaClientKnownRequestError('Transaction failed due to a write conflict or a deadlock. Please retry your transaction', { code: 'P2034', clientVersion: 'sim' })
export const uniqueError = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the constraint: `Refund_idempotencyKey_key`', { code: 'P2002', clientVersion: 'sim' })

export class LockSim {
  claims: Row[]
  refunds: Row[]
  /** Interleaved mode: every transaction's FIRST read waits until this many transactions have reached theirs. */
  barrier = 0
  /** Called after a commit was applied; a returned error is thrown to the caller (a commit reported lost). */
  afterCommit: ((txId: number) => Error | void) | null = null
  /** Called when a transaction starts, before its callback runs (a concurrent change landing first). */
  beforeCallback: ((txId: number) => void) | null = null
  deadlocks = 0
  commits = 0
  options: unknown[] = []
  private holders = new Map<string, { s: Set<number>; x: number | null }>()
  private waitingOn = new Map<number, string>()
  private wake: Array<() => void> = []
  private arrived = new Set<number>()
  private barrierWake: Array<() => void> = []
  private nextTx = 1
  private seq = 1

  constructor(claims: Row[], refunds: Row[]) {
    this.claims = claims
    this.refunds = refunds
  }

  private holds(tx: number, res: string) {
    const h = this.holders.get(res)
    return !!h && (h.x === tx || h.s.has(tx))
  }

  private async acquire(tx: number, res: string, mode: 'S' | 'X') {
    for (;;) {
      const h = this.holders.get(res) ?? { s: new Set<number>(), x: null }
      this.holders.set(res, h)
      const blockers = new Set<number>()
      if (h.x !== null && h.x !== tx) blockers.add(h.x)
      if (mode === 'X') h.s.forEach((s) => { if (s !== tx) blockers.add(s) })
      if (blockers.size === 0) {
        if (mode === 'S') h.s.add(tx)
        else h.x = tx
        this.waitingOn.delete(tx)
        return
      }
      // A blocker already waiting on a resource this transaction holds closes a cycle: this one is the victim.
      for (const b of Array.from(blockers)) {
        const r = this.waitingOn.get(b)
        if (r && this.holds(tx, r)) {
          this.waitingOn.delete(tx)
          this.deadlocks++
          throw deadlockError()
        }
      }
      this.waitingOn.set(tx, res)
      await new Promise<void>((resolve) => this.wake.push(resolve))
    }
  }

  private release(tx: number) {
    this.holders.forEach((h) => { h.s.delete(tx); if (h.x === tx) h.x = null })
    this.waitingOn.delete(tx)
    const w = this.wake
    this.wake = []
    for (const f of w) f()
  }

  private async passBarrier(tx: number) {
    this.arrived.add(tx)
    if (this.arrived.size >= this.barrier) {
      const w = this.barrierWake
      this.barrierWake = []
      for (const f of w) f()
      return
    }
    await new Promise<void>((resolve) => this.barrierWake.push(resolve))
  }

  /** prisma.$transaction(fn, options) under SERIALIZABLE: buffered writes, applied at commit, released on abort. */
  transaction = async (fn: (tx: any) => Promise<unknown>, options?: unknown): Promise<unknown> => {
    const id = this.nextTx++
    this.options.push(options)
    const claimWrites = new Map<string, Row>()
    const creates: Row[] = []
    const viewClaims = () => this.claims.map((c) => (claimWrites.has(c.id) ? { ...c, ...claimWrites.get(c.id) } : c))
    const viewRefunds = () => [...this.refunds, ...creates]
    let firstRead = true
    // The barrier is passed AFTER the share-locked read: every transaction holds its shared locks before any writes.
    const onRead = async () => { if (firstRead) { firstRead = false; await this.passBarrier(id) } }
    const tx = {
      claim: {
        findFirst: async ({ where, select }: { where: Row; select?: Row }) => {
          for (const c of this.claims) await this.acquire(id, `claim:${c.id}`, 'S') // no index on refundId: a full scan
          const hit = pick(viewClaims().find((c) => matches(where, c)), select)
          await onRead()
          return hit
        },
        updateMany: async ({ where, data }: { where: Row; data: Row }) => {
          const targets = viewClaims().filter((c) => matches(where, c))
          for (const t of targets) await this.acquire(id, `claim:${t.id}`, 'X')
          let count = 0
          for (const t of viewClaims().filter((c) => matches(where, c))) {
            claimWrites.set(t.id, { ...(claimWrites.get(t.id) ?? {}), ...data })
            count++
          }
          return { count }
        },
      },
      refund: {
        findFirst: async ({ where, select }: { where: Row; select?: Row }) => {
          await this.acquire(id, `refunds:${where.orderId}`, 'S') // the order's Refund range
          const hit = pick(viewRefunds().find((r) => matches(where, r)), select)
          await onRead()
          return hit
        },
        create: async ({ data, select }: { data: Row; select?: Row }) => {
          await this.acquire(id, `refunds:${data.orderId}`, 'X')
          if (viewRefunds().some((r) => r.idempotencyKey === data.idempotencyKey)) throw uniqueError()
          const row = { id: `rf_mirror_${this.seq++}`, createdAt: new Date(), ...data }
          creates.push(row)
          return pick(row, select)
        },
      },
    }
    let committed = false
    try {
      this.beforeCallback?.(id)
      const out = await fn(tx)
      claimWrites.forEach((d, cid) => { const c = this.claims.find((x) => x.id === cid); if (c) Object.assign(c, d) })
      this.refunds.push(...creates)
      committed = true
      this.commits++
      this.release(id)
      const lost = this.afterCommit?.(id)
      if (lost) throw lost
      return out
    } catch (e) {
      if (!committed) this.release(id)
      throw e
    }
  }
}

export type SimState = {
  sim: LockSim
  orders: Row[]
  pis: Record<string, Row>
  stripeRefunds: Row[]
  /** refunds.retrieve(id): 'missing' → Stripe 404; 'throw' → a transient error. */
  retrieveFail: Record<string, 'missing' | 'throw'>
  calls: string[]
}

export const missingAtStripe = () => Object.assign(new Error('No such refund'), { statusCode: 404, code: 'resource_missing' })

/** Wires the non-transaction Prisma mocks, $transaction and the Stripe reads to one simulated state. */
export function wireSim(
  s: SimState,
  db: { claim: Record<string, Fn>; refund: Record<string, Fn>; order: Record<string, Fn>; emailDispatch: Record<string, Fn>; $transaction: Fn },
  stripe: { paymentIntents: Record<string, Fn>; refunds: Record<string, Fn> },
): void {
  const { sim, calls } = s
  db.claim.findUnique.mockImplementation(async ({ where, select }: { where: Row; select?: Row }) => {
    calls.push('claim.findUnique')
    return pick(sim.claims.find((c) => c.id === where.id), select)
  })
  db.claim.findFirst.mockImplementation(async ({ where, select }: { where: Row; select?: Row }) => {
    calls.push('claim.findFirst')
    return pick(sim.claims.find((c) => matches(where, c)), select)
  })
  db.claim.findMany.mockImplementation(async ({ where, select }: { where?: Row; select?: Row }) =>
    sim.claims.filter((c) => matches(where, c)).map((c) => pick(c, select)))
  db.claim.count?.mockImplementation(async ({ where }: { where?: Row }) => sim.claims.filter((c) => matches(where, c)).length)
  db.claim.updateMany.mockImplementation(async ({ where, data }: { where: Row; data: Row }) => {
    calls.push('claim.updateMany')
    const hits = sim.claims.filter((c) => matches(where, c))
    for (const h of hits) Object.assign(h, data)
    return { count: hits.length }
  })
  db.refund.findUnique.mockImplementation(async ({ where, select }: { where: Row; select?: Row }) =>
    pick(sim.refunds.find((r) => r.id === where.id), select))
  db.refund.findFirst.mockImplementation(async ({ where, select }: { where: Row; select?: Row }) => {
    calls.push('refund.findFirst')
    return pick(sim.refunds.find((r) => matches(where, r)), select)
  })
  db.refund.findMany.mockImplementation(async ({ where, select }: { where?: Row; select?: Row }) =>
    sim.refunds.filter((r) => matches(where, r)).map((r) => pick(r, select)))
  db.refund.create.mockImplementation(async () => { throw new Error('refund.create outside a transaction') })
  db.order.findUnique.mockImplementation(async ({ where, select }: { where: Row; select?: Row }) => pick(s.orders.find((o) => o.id === where.id), select))
  db.order.findMany?.mockImplementation(async () => s.orders.map((o) => ({ ...o })))
  db.emailDispatch.create.mockImplementation(async () => { calls.push('emailDispatch.create'); return {} })
  db.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>, options?: unknown) => {
    calls.push('$transaction')
    return sim.transaction(fn as (tx: any) => Promise<unknown>, options)
  })
  stripe.paymentIntents.retrieve.mockImplementation(async (id: string) => {
    calls.push('stripe.paymentIntents.retrieve')
    const pi = s.pis[id]
    if (!pi) throw missingAtStripe()
    return JSON.parse(JSON.stringify(pi))
  })
  stripe.refunds.retrieve.mockImplementation(async (id: string) => {
    calls.push('stripe.refunds.retrieve')
    const f = s.retrieveFail[id]
    if (f === 'throw') throw new Error('ETIMEDOUT')
    if (f === 'missing') throw missingAtStripe()
    const r = s.stripeRefunds.find((x) => x.id === id)
    if (!r) throw missingAtStripe()
    return { ...r }
  })
  stripe.refunds.list.mockImplementation(async (args?: { payment_intent?: string }) => {
    calls.push('stripe.refunds.list')
    const pi = args?.payment_intent
    return { data: s.stripeRefunds.filter((x) => !pi || !x.payment_intent || x.payment_intent === pi).map((x) => ({ ...x })), has_more: false }
  })
  stripe.refunds.create?.mockImplementation(async () => { throw new Error('Claims never creates a Stripe refund') })
}

export const stripeCalls = (calls: string[]) => calls.filter((c) => c.startsWith('stripe.'))
