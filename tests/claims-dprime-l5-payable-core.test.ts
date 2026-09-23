// tests/claims-dprime-l5-payable-core.test.ts — D′ lot L5 (spec v2 §8.5 / §8.8): ONE definition of « payable ».
//
// THE DEFECT THIS FILE EXISTS TO PREVENT. Three places ask « which claims may the financial rail pay? »: the
// admin queue an operator reads, the rail's dryRun, and the pay-window operator that decides whether to OPEN a
// refund window at all. If any two of them disagreed, a window could be opened for a set the rail then refuses
// — or, worse, closed while the rail still had work and an approved customer still had no money. So there is one
// sentence, in lib/claims-payable-core.js, and this file proves all three read THAT one.
//
// The core is plain CommonJS on purpose: the server has no TypeScript build, so the operator must be able to
// require the very same file the bundled route uses. That is also why it ships in the deploy.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

import {
  MAX_BATCH, PAYABLE_WHERE, PAYABLE_ORDER_BY, PAYABLE_SELECT, clampTake, selectPayableClaims,
  approvedAmountRefusal, sumApprovedCents, itemIdentity, sameIdentity,
} from '@/lib/claims-payable-core'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const CORE = 'lib/claims-payable-core.js'
const RAIL = 'app/api/admin/claims/pay-approved/route.ts'
const OPERATOR = 'scripts/server/phase2-claims-pay-window.js'

describe('D′ L5 — the selection itself (spec v2 §8.5)', () => {
  it('the WHERE is exactly the six clauses of APPROVED_AWAITING_PAYMENT, and it is frozen', () => {
    expect(PAYABLE_WHERE).toEqual({
      status:              'approved',
      arbitrationDecision: 'approved',
      refundAttempted:     false,
      refundId:            null,
      refundError:         null,
      approvedAmountCents: { not: null },
    })
    // Frozen: a caller cannot widen the selection by mutating the shared object it was handed.
    expect(Object.isFrozen(PAYABLE_WHERE)).toBe(true)
    expect(() => { (PAYABLE_WHERE as unknown as Record<string, unknown>).refundError = undefined }).toThrow()
    expect(PAYABLE_WHERE.refundError).toBeNull()
  })

  it('⭐ refundError: null is load-bearing — a recorded money state is NEVER in the automatic batch (S-14b)', () => {
    // The clause that keeps a v13 payable proof, a lock, a safety hold and a failed attempt out of a batch an
    // admin did not name claim by claim. Dropping it is how a batch would silently pay a parked claim.
    expect(PAYABLE_WHERE.refundError).toBeNull()
    expect(Object.keys(PAYABLE_WHERE)).toContain('refundError')
  })

  it('FIFO by the decision instant, ties broken deterministically, capped at 20', () => {
    expect(PAYABLE_ORDER_BY).toEqual([{ arbitratedAt: 'asc' }, { createdAt: 'asc' }])
    expect(MAX_BATCH).toBe(20)
    expect(clampTake(0)).toBe(1)
    expect(clampTake(1)).toBe(1)
    expect(clampTake(20)).toBe(20)
    expect(clampTake(21)).toBe(20)
    expect(clampTake(1e9)).toBe(20)
    expect(clampTake(undefined)).toBe(20)
    expect(clampTake('abc')).toBe(20)
    expect(clampTake(-5)).toBe(1)
    expect(clampTake(3.7)).toBe(3)
  })

  it('the projection carries money and instants — never the consumer, the description or the photo', () => {
    expect(Object.keys(PAYABLE_SELECT).sort()).toEqual(
      ['approvedAmountCents', 'arbitratedAt', 'arbitrationReason', 'createdAt', 'id', 'orderId', 'requestedAmountCents'].sort(),
    )
    for (const forbidden of ['consumerId', 'description', 'photoUrl', 'restaurantResponse', 'refundError']) {
      expect(Object.keys(PAYABLE_SELECT), forbidden).not.toContain(forbidden)
    }
  })

  it('the one query asks exactly that, on any client exposing claim.findMany', async () => {
    const calls: unknown[] = []
    const client = { claim: { findMany: async (args: unknown) => { calls.push(args); return [] } } }
    await selectPayableClaims(client, { take: 5 })
    expect(calls).toEqual([{ where: PAYABLE_WHERE, orderBy: PAYABLE_ORDER_BY, take: 5, select: PAYABLE_SELECT }])
    calls.length = 0
    await selectPayableClaims(client)
    expect((calls[0] as { take: number }).take).toBe(20)
  })

  it('S-10 re-checked on a row: 1 ≤ approved ≤ requested, integers only', () => {
    expect(approvedAmountRefusal({ approvedAmountCents: 500, requestedAmountCents: 500 })).toBeNull()
    expect(approvedAmountRefusal({ approvedAmountCents: 1, requestedAmountCents: 500 })).toBeNull()
    expect(approvedAmountRefusal({ approvedAmountCents: null, requestedAmountCents: 500 })).toBe('amount_not_ratified')
    expect(approvedAmountRefusal({ approvedAmountCents: 0, requestedAmountCents: 500 })).toBe('amount_not_ratified')
    expect(approvedAmountRefusal({ approvedAmountCents: -5, requestedAmountCents: 500 })).toBe('amount_not_ratified')
    expect(approvedAmountRefusal({ approvedAmountCents: 4.5, requestedAmountCents: 500 })).toBe('amount_not_ratified')
    expect(approvedAmountRefusal({ approvedAmountCents: 501, requestedAmountCents: 500 })).toBe('amount_above_requested')
    expect(approvedAmountRefusal(null)).toBe('missing')
  })

  it('the sum is integer cents, and a missing amount contributes nothing rather than NaN', () => {
    expect(sumApprovedCents([{ approvedAmountCents: 500 }, { approvedAmountCents: 1 }])).toBe(501)
    expect(sumApprovedCents([{ approvedAmountCents: null }, { approvedAmountCents: 300 }])).toBe(300)
    expect(sumApprovedCents([])).toBe(0)
  })

  it('⭐ the signed identity is the claim, the amount AND the decision instant — any of the three moving breaks it', () => {
    const at = new Date('2026-09-23T10:00:00.000Z')
    const row = { id: 'cl1', approvedAmountCents: 500, arbitratedAt: at }
    expect(itemIdentity(row)).toEqual({ claimId: 'cl1', approvedAmountCents: 500, arbitratedAt: '2026-09-23T10:00:00.000Z' })
    const signed = itemIdentity(row)
    expect(sameIdentity(signed, row)).toBe(true)
    expect(sameIdentity(signed, { ...row, approvedAmountCents: 400 })).toBe(false)
    expect(sameIdentity(signed, { ...row, arbitratedAt: new Date('2026-09-23T10:00:01.000Z') })).toBe(false)
    expect(sameIdentity(signed, { ...row, id: 'cl2' })).toBe(false)
    expect(sameIdentity(signed, { ...row, arbitratedAt: null })).toBe(false)
    expect(sameIdentity(null, row)).toBe(false)
    expect(sameIdentity(signed, null)).toBe(false)
    // A claim decided with no instant at all still has a stable identity.
    const noAt = { id: 'cl1', approvedAmountCents: 500, arbitratedAt: null }
    expect(sameIdentity(itemIdentity(noAt), noAt)).toBe(true)
  })
})

describe('D′ L5 — the THREE readers ask the one definition (the differential control)', () => {
  it('⭐ lib/claims uses the core for the admin queue: the queue and the rail cannot drift apart', () => {
    const src = read('lib/claims.ts')
    expect(src).toMatch(/import \{ PAYABLE_WHERE \} from '@\/lib\/claims-payable-core'/)
    expect(src).toMatch(/const AWAITING_PAYMENT_WHERE = PAYABLE_WHERE/)
    // NEGATIVE CONTROL — the queue no longer carries its own literal of the selection. (The T1 attempt CAS of
    // triggerClaimRefund legitimately pins the same two fields; what must not exist is a second findMany WHERE.)
    const queueWheres = Array.from(src.matchAll(/findMany\(\{\s*\n?\s*where:\s*([A-Za-z_][\w.]*)/g)).map((m) => m[1])
    expect(queueWheres).toContain('AWAITING_PAYMENT_WHERE')
  })

  it('⭐ the rail uses the core for its dryRun', () => {
    const src = read(RAIL)
    expect(src).toMatch(/from '@\/lib\/claims-payable-core'/)
    expect(src).toMatch(/where:\s*PAYABLE_WHERE/)
    // The rail never writes its own version of the clauses.
    expect(src).not.toMatch(/refundAttempted:\s*false,\s*\n\s*refundId:\s*null,\s*\n\s*refundError:\s*null/)
  })

  it('⭐ the pay-window operator requires the SHIPPED core rather than carrying its own copy', () => {
    const src = read(OPERATOR)
    expect(src).toMatch(/claims-payable-core/)
    // It must go through the core's function or its constants, never re-state the clauses itself.
    expect(src).not.toMatch(/arbitrationDecision:\s*'approved'/)
    expect(src).not.toMatch(/approvedAmountCents:\s*\{\s*not:\s*null\s*\}/)
  })

  it('⭐ the deploy ships the core to the server, or the operator could never require it', () => {
    const wf = read('.github/workflows/deploy-staging.yml')
    expect(wf).toMatch(/cp lib\/claims-payable-core\.js deploy-temp\/lib\/claims-payable-core\.js/)
  })

  it('the core is pure: no prisma import, no env read, no Stripe, no write, no auth', () => {
    const src = read(CORE)
    expect(src).not.toMatch(/require\(/)
    expect(src).not.toMatch(/process\.env/)
    // « Stripe » appears in the header saying what the core never does; what must not exist is a USE of it.
    expect(src).not.toMatch(/getStripe|require\(['"]stripe|paymentIntents|refunds\.(list|retrieve|create)/)
    expect(src).not.toMatch(/\.(create|update|updateMany|upsert|delete|deleteMany)\(/)
    expect(src).not.toMatch(/resolveAdmin|getServerSession|NEXTAUTH/)
    // Its ONLY database verb is a read.
    expect(src.match(/prisma\.claim\.\w+/g) ?? []).toEqual(['prisma.claim.findMany'])
  })

  it('the type surface beside the core declares the same names it exports', () => {
    const dts = read('lib/claims-payable-core.d.ts')
    for (const name of ['MAX_BATCH', 'PAYABLE_WHERE', 'PAYABLE_ORDER_BY', 'PAYABLE_SELECT', 'clampTake',
      'selectPayableClaims', 'approvedAmountRefusal', 'sumApprovedCents', 'itemIdentity', 'sameIdentity']) {
      expect(dts, name).toMatch(new RegExp(`export (const|function) ${name}\\b`))
    }
  })
})
