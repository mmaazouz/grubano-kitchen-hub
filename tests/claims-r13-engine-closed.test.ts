// tests/claims-r13-engine-closed.test.ts — T-49 round 13, J-M06 (C11, B4, D12, G11): the engine and the webhook's
// money writes stay closed.
//
// lib/refund.ts is byte-identical to its 40da45e blob (CRLF normalized), the withdrawn engine guard is named nowhere,
// and the webhook's refund-status handler calls its money collaborators in the HEAD order on every event. The
// claim-only reversal helper (G11) belongs to the webhook slice: until it lands it must not exist; once it does, it
// may only appear AFTER the unchanged money calls, in the failed / canceled branch.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

/** Computed once from `git show 40da45e:lib/refund.ts` with CRLF normalized to LF. */
const SHA256_REFUND_40DA45E = '1745dee70e936871beb23608b3bdf024ec4b0eae23c42ed1e98849108bd3a252'
const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

const { db, stripe, log } = vi.hoisted(() => {
  const log: string[] = []
  return {
    log,
    db: {
      ledgerEntry:      { create: vi.fn() },
      franchiseRoyalty: { findUnique: vi.fn(), update: vi.fn() },
      refund:           { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), aggregate: vi.fn() },
      dispute:          { aggregate: vi.fn() },
      courierEarning:   { findMany: vi.fn(), updateMany: vi.fn() },
      order:            { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
      payout:           { findUnique: vi.fn() },
      claim:            { findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
      $transaction:     vi.fn(),
    },
    stripe: {
      constructEvent: vi.fn(),
      refunds:        { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() },
      paymentIntents: { retrieve: vi.fn() },
      charges:        { retrieve: vi.fn() },
      transfers:      { list: vi.fn(), createReversal: vi.fn(), listReversals: vi.fn() },
      applicationFees:{ listRefunds: vi.fn() },
    },
  }
})
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/stripe', () => ({
  getStripe: () => ({ webhooks: { constructEvent: stripe.constructEvent }, ...stripe }),
  retrieveChargeFacts: vi.fn(), mapAccountStatus: vi.fn(),
}))
vi.mock('@/lib/loyalty-refund-apply', () => ({ reconcileLoyaltyOnRefund: vi.fn(async () => ({ status: 'reconciled' })) }))
vi.mock('@/lib/admin-alerts', () => ({
  sendAdminGhostOrderAlert: vi.fn(async () => ({ status: 'sent' })),
  sendAdminStalePiAlert:    vi.fn(async () => ({ status: 'sent' })),
  sendAdminMoneyReviewAlert: vi.fn(async (a: { kind: string }) => { log.push(`alert:${a.kind}`); return { status: 'sent' } }),
}))
vi.mock('@/lib/refund', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  finalizeRefundRowFromStripe: vi.fn(async () => { log.push('finalizeRefundRowFromStripe'); return { ok: true, refundId: 'rf1' } }),
  markRefundRowFailed:         vi.fn(async () => { log.push('markRefundRowFailed'); return { ok: false, status: 409, error: 'x' } }),
}))
vi.mock('@/lib/claims', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  reconcileClaimForRefund: vi.fn(async (i: { status: string }) => { log.push(`reconcileClaimForRefund:${i.status}`); return { reconciled: false, reason: 'no_claim' } }),
}))

import { POST } from '@/app/api/webhooks/stripe/route'

const fire = (obj: Record<string, unknown>) => {
  stripe.constructEvent.mockReturnValue({ type: 'refund.updated', data: { object: obj } })
  return POST(new Request('http://x/api/webhooks/stripe', { method: 'POST', body: 'raw', headers: { 'stripe-signature': 'sig' } }))
}
const refundEvent = (status: string) => ({ id: 're_1', object: 'refund', status, amount: 300, payment_intent: 'pi_1', metadata: { grubano_refund_row: 'rf1' }, failure_reason: null })

beforeEach(() => {
  vi.clearAllMocks()
  log.length = 0
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
  db.order.findUnique.mockResolvedValue({ stripePaymentIntentId: 'pi_1' })
  // ROUND 13 (G11 / D12, slice W5): the claim-only helper reads the claims bound to the row; none in these fixtures.
  db.claim.findMany.mockResolvedValue([])
  // handleChargeRefunded is internal: its first collaborator on a charge without restaurant metadata is the plain
  // PaymentIntent read (no expand) — that call marks it in the log, then it acknowledges with no ledger line.
  stripe.paymentIntents.retrieve.mockImplementation(async (id: string, opts?: unknown) => {
    if (opts === undefined) { log.push('handleChargeRefunded'); return { id, metadata: {} } }
    return { id, latest_charge: { id: 'ch_1', object: 'charge', amount: 2000, amount_refunded: 300, payment_intent: 'pi_1', metadata: {} } }
  })
})
afterEach(() => { delete process.env.STRIPE_WEBHOOK_SECRET })

/** HEAD (40da45e) call order of handleRefundStatusEvent's money collaborators, per event. */
const HEAD_SNAPSHOT: Record<string, string[]> = {
  'succeeded, row pending':          ['handleChargeRefunded', 'finalizeRefundRowFromStripe', 'reconcileClaimForRefund:succeeded'],
  'failed, row pending':             ['markRefundRowFailed', 'reconcileClaimForRefund:failed'],
  'failed, row succeeded':           ['alert:refund_failed'],
  'failed redelivery, row failed':   [],
}
const ROWS: Record<string, { status: string; event: string }> = {
  'succeeded, row pending':        { status: 'pending', event: 'succeeded' },
  'failed, row pending':           { status: 'pending', event: 'failed' },
  'failed, row succeeded':         { status: 'succeeded', event: 'failed' },
  'failed redelivery, row failed': { status: 'failed', event: 'failed' },
}

describe('J-M06 — lib/refund.ts is byte-identical and the withdrawn guard exists nowhere', () => {
  it('sha256(lib/refund.ts, LF) equals the 40da45e blob', () => {
    expect(createHash('sha256').update(read('lib/refund.ts')).digest('hex')).toBe(SHA256_REFUND_40DA45E)
  })

  it('NEGATIVE CONTROL — adding `exclusiveReason?: boolean` to the executeRefund input changes the hash', () => {
    const src = read('lib/refund.ts')
    const broken = src.replace('  reason?: string\n}): Promise<RefundOutcome> {', '  reason?: string\n  exclusiveReason?: boolean\n}): Promise<RefundOutcome> {')
    expect(broken).not.toBe(src)
    expect(createHash('sha256').update(broken).digest('hex')).not.toBe(SHA256_REFUND_40DA45E)
  })

  it('« exclusiveReason » and « E5b » occur nowhere in lib/, app/, scripts/ or messages/', () => {
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
      const p = join(dir, n)
      return statSync(p).isDirectory() ? walk(p) : [p]
    })
    const files = ['lib', 'app', 'scripts', 'messages'].flatMap(walk).filter((f) => /\.(ts|tsx|js|mjs|cjs|json)$/.test(f))
    expect(files.length).toBeGreaterThan(100)
    const hits = files.filter((f) => /exclusiveReason|E5b/.test(readFileSync(f, 'utf8')))
    expect(hits).toEqual([])
  })
})

describe('J-M06 — the webhook refund-status handler keeps its HEAD money-call order', () => {
  for (const name of Object.keys(HEAD_SNAPSHOT)) {
    it(name, async () => {
      db.refund.findUnique.mockResolvedValue({ id: 'rf1', status: ROWS[name].status, orderId: 'o1' })
      const res = await fire(refundEvent(ROWS[name].event))
      expect(res.status).toBe(200)
      expect(log).toEqual(HEAD_SNAPSHOT[name])
    })
  }

  it('NEGATIVE CONTROL — the redelivery on a failed row runs neither markRefundRowFailed nor reconcileClaimForRefund', async () => {
    db.refund.findUnique.mockResolvedValue({ id: 'rf1', status: 'failed', orderId: 'o1' })
    await fire(refundEvent('canceled'))
    expect(log.filter((c) => c === 'markRefundRowFailed' || c.startsWith('reconcileClaimForRefund'))).toEqual([])
  })

  const handlerSrc = () => {
    const src = stripComments(read('app/api/webhooks/stripe/route.ts'))
    const a = src.indexOf('async function handleRefundStatusEvent(')
    return src.slice(a, src.indexOf('\n}\n', a))
  }
  /** The ordered money-collaborator calls of a branch, and where the G11 helper sits. */
  function orderViolations(body: string): string[] {
    const v: string[] = []
    const succ = body.slice(body.indexOf("if (status === 'succeeded') {"), body.indexOf("if (status === 'failed' || status === 'canceled') {"))
    const failed = body.slice(body.indexOf("if (status === 'failed' || status === 'canceled') {"))
    const seq = (s: string) => Array.from(s.matchAll(/\b(handleChargeRefunded|finalizeRefundRowFromStripe|markRefundRowFailed|reconcileClaimForRefund|markClaimsForRevertedRefundRow)\(/g)).map((m) => m[1])
    if (seq(succ).join(',') !== 'handleChargeRefunded,finalizeRefundRowFromStripe,reconcileClaimForRefund') v.push(`succeeded order: ${seq(succ).join(',')}`)
    const f = seq(failed).filter((x) => x !== 'markClaimsForRevertedRefundRow')
    if (f.join(',') !== 'markRefundRowFailed,reconcileClaimForRefund') v.push(`failed order: ${f.join(',')}`)
    // D12: the succeeded branch gets no NEW 5xx — exactly its three HEAD 503 exits.
    if ((succ.match(/status: 503/g) ?? []).length !== 3) v.push('succeeded branch 5xx exits changed')
    // G11: the claim-only helper never in the succeeded branch; in the failed branch only after the money calls.
    if (succ.includes('markClaimsForRevertedRefundRow(')) v.push('helper in the succeeded branch')
    const helperAt = failed.indexOf('markClaimsForRevertedRefundRow(')
    if (helperAt >= 0 && helperAt < failed.lastIndexOf('reconcileClaimForRefund(')) v.push('helper before the money calls')
    return v
  }

  it('source order: succeeded = handleChargeRefunded → finalize → reconcile; failed = markRefundRowFailed → reconcile; no new 5xx; the helper after them', () => {
    expect(orderViolations(handlerSrc())).toEqual([])
  })

  it('NEGATIVE CONTROL — moving a helper call above markRefundRowFailed is caught', () => {
    const body = handlerSrc()
    const moved = body.replace('await markRefundRowFailed(row.id, refund)', 'await markClaimsForRevertedRefundRow({ rowId: row.id })\n          await markRefundRowFailed(row.id, refund)')
    expect(moved).not.toBe(body)
    expect(orderViolations(moved)).toEqual(['helper before the money calls'])
    const reordered = body.replace('const rec = await handleChargeRefunded(charge)', 'const early = await finalizeRefundRowFromStripe(row!.id)\n      const rec = await handleChargeRefunded(charge)')
    expect(orderViolations(reordered)).toContain('succeeded order: finalizeRefundRowFromStripe,handleChargeRefunded,finalizeRefundRowFromStripe,reconcileClaimForRefund')
  })
})
