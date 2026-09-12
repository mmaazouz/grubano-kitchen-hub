// tests/claims-closure-webhook.test.ts — T-49 round 13, slice W5: J-C28 (H09, R-D3, R-D8, F05 line 7).
//
// Nothing is sent to a customer from the Stripe webhook, the recovery sweep, POST reconcile-refunds or a reversal
// marking. A webhook or sweep settlement writes this build's closure record (H05 site 2, noNoticeSource); a reversal
// writes none. The only sends on these paths are the admin money-review alerts (I-05).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { payableWorld, wireWorld, refundRow, stripeRefund, claimOf, type World } from './support/claims-world'

const { db, stripe, st, mail } = vi.hoisted(() => ({
  st: { w: null as unknown as import('./support/claims-world').World, records: [] as Array<Record<string, unknown>> },
  mail: { sendTransactional: vi.fn(), sendOnce: vi.fn(), logEmailSkipped: vi.fn() },
  db: {
    claim:  { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    refund: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    order:  { findUnique: vi.fn() },
    operator: { findUnique: vi.fn() },
    franchiseRoyalty: { findFirst: vi.fn() },
    emailDispatch: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  stripe: {
    constructEvent: vi.fn(),
    paymentIntents: { retrieve: vi.fn() },
    refunds:        { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() },
    charges:        { retrieve: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/transactional-emails', () => mail)
vi.mock('next-intl/server', () => ({ getTranslations: async () => (k: string) => k }))
vi.mock('@/lib/stripe', () => ({
  getStripe: () => ({ webhooks: { constructEvent: stripe.constructEvent }, ...stripe }),
  retrieveChargeFacts: vi.fn(), mapAccountStatus: vi.fn(),
}))
vi.mock('@/lib/loyalty-refund-apply', () => ({ reconcileLoyaltyOnRefund: vi.fn(async () => ({ status: 'reconciled' })) }))
vi.mock('@/lib/refund', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // The engine's row writes, simulated on the world (the webhook calls them unchanged).
  finalizeRefundRowFromStripe: vi.fn(async (rowId: string) => {
    const r = st.w.refunds.find((x) => x.id === rowId)
    if (r) r.status = 'succeeded'
    return { ok: true, refundId: rowId }
  }),
  markRefundRowFailed: vi.fn(async (rowId: string, refund: { id: string }) => {
    const r = st.w.refunds.find((x) => x.id === rowId)
    if (r && r.status === 'pending') Object.assign(r, { status: 'failed', stripeRefundId: refund.id })
    return { ok: true }
  }),
}))
const { cronMock, adminMock, auditMock } = vi.hoisted(() => ({ cronMock: vi.fn(), adminMock: vi.fn(), auditMock: vi.fn() }))
vi.mock('@/lib/safe-compare', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), isInternalCronRequest: cronMock }))
vi.mock('@/lib/admin-guard', () => ({ resolveAdmin: adminMock }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: auditMock }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => null) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

import { POST as WEBHOOK } from '@/app/api/webhooks/stripe/route'
import { POST as RECONCILE_REFUNDS } from '@/app/api/admin/claims/reconcile-refunds/route'
import { recoverStrandedClaimReconciliations, reconcileClaimEvidence } from '@/lib/claims'
import { sendClaimDecisionEmail } from '@/lib/claim-emails'
import { customerClaimStatus, MARKERS } from '@/lib/claim-action-rules'

let w: World
function world(claim: Record<string, unknown>, row: Record<string, unknown>, stripeObj?: Record<string, unknown>) {
  w = payableWorld({ refundAttempted: true, refundId: 'rf_x', refundError: null, ...claim })
  w.refunds.push(refundRow('rf_x', { stripeRefundId: 're_x', reason: 'claim:cl1', ...row }))
  if (stripeObj) w.stripeRefunds.push(stripeRefund('re_x', stripeObj))
  wireWorld(w, db, stripe)
  st.w = w
  return w
}
const fire = async (type: string, obj: Record<string, unknown>) => {
  stripe.constructEvent.mockReturnValue({ type, data: { object: obj } })
  const res = await WEBHOOK(new Request('http://x/api/webhooks/stripe', { method: 'POST', body: 'raw', headers: { 'stripe-signature': 'sig' } }))
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}
const refundEvent = (status: string) => ({ id: 're_x', object: 'refund', status, amount: 300, payment_intent: 'pi_1', metadata: { grubano_refund_row: 'rf_x' }, failure_reason: null })
/** Every trigger the e-mail rail received. */
const triggers = () => [
  ...mail.sendTransactional.mock.calls.map((c) => String((c[0] as { trigger?: string }).trigger)),
  ...mail.sendOnce.mock.calls.map((c) => String(c[0])),
]
const customerSends = () => triggers().filter((t) => /^claim_(decision|closed)/.test(t))

let errSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.clearAllMocks()
  st.records.length = 0
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
  process.env.ALERT_EMAIL = 'ops@grubano.test'
  mail.sendOnce.mockImplementation(async () => ({ status: 'sent' }))
  mail.sendTransactional.mockImplementation(async () => ({ status: 'sent' }))
  db.emailDispatch.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => { st.records.push(data); return data })
  auditMock.mockResolvedValue(true)
  adminMock.mockResolvedValue({ id: 'op1', role: 'admin', name: 'A', email: 'a@x.test' })
  cronMock.mockReturnValue(true)
  // handleChargeRefunded: a charge without restaurant metadata — its plain PaymentIntent read acknowledges it.
  stripe.paymentIntents.retrieve.mockImplementation(async (id: string, opts?: unknown) => {
    if (opts === undefined) return { id, metadata: {} }
    return { id, status: 'succeeded', latest_charge: { id: 'ch_1', object: 'charge', amount: 2000, amount_refunded: 300, payment_intent: 'pi_1', metadata: {} } }
  })
  errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { delete process.env.STRIPE_WEBHOOK_SECRET; delete process.env.ALERT_EMAIL; errSpy.mockRestore() })

describe('J-C28 — nothing is sent to a customer from the webhook, the recovery, reconcile-refunds or a reversal', () => {
  it('webhook refund.updated succeeded settles a bound pending row → closure record (noNoticeSource), EMAIL MISS once, no customer send', async () => {
    world({ status: 'refunding' }, { status: 'pending' })
    const r = await fire('refund.updated', refundEvent('succeeded'))
    expect(r.status).toBe(200)
    expect(claimOf(w)).toMatchObject({ status: 'refunded', refundError: null })
    expect(st.records).toEqual([{ trigger: 'claim_closure_record', dedupeKey: 'claim:cl1' }])
    expect(errSpy.mock.calls.filter((c) => String(c[0]).startsWith('[EMAIL MISS] [claim_decision_refunded] claim cl1 settled by the Stripe webhook or the recovery sweep'))).toHaveLength(1)
    expect(customerSends()).toEqual([])
  })

  it('webhook refund.failed on a succeeded bound row (the helper marks) → no record, no customer send; the customer reads the manual review', async () => {
    world({ status: 'refunded', activeOrderKey: null }, { status: 'succeeded' })
    const r = await fire('refund.failed', refundEvent('failed'))
    expect(r.status).toBe(200)
    expect(String(claimOf(w).refundError).startsWith(MARKERS.REVERTED_AFTER_REFUND)).toBe(true)
    expect(st.records).toEqual([])
    expect(customerClaimStatus(claimOf(w) as never, null, true)).toBe('financial_verification')
    expect(customerSends()).toEqual([])
    // the only webhook sends are admin money-review alerts (I-05)
    expect(triggers().every((t) => t.startsWith('admin_money_review_'))).toBe(true)
    expect(triggers()).toContain('admin_money_review_refund_failed')
  })

  it('webhook redelivery on an already-failed row → no record, no customer send', async () => {
    world({ status: 'refunded', activeOrderKey: null }, { status: 'failed' })
    expect((await fire('refund.failed', refundEvent('failed'))).status).toBe(200)
    expect(st.records).toEqual([])
    expect(customerSends()).toEqual([])
  })

  it('recoverStrandedClaimReconciliations settles → a closure record, no customer send; POST reconcile-refunds has no closureEmails field', async () => {
    world({ status: 'refunding' }, { status: 'succeeded' }, { status: 'succeeded' })
    expect(await recoverStrandedClaimReconciliations()).toMatchObject({ reconciled: 1 })
    expect(st.records).toEqual([{ trigger: 'claim_closure_record', dedupeKey: 'claim:cl1' }])
    world({ status: 'refunding' }, { status: 'succeeded' }, { status: 'succeeded' })
    const res = await RECONCILE_REFUNDS(new Request('https://app.grubano.com/api/admin/claims/reconcile-refunds', { method: 'POST' }) as never)
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body).not.toHaveProperty('closureEmails')
    expect(customerSends()).toEqual([])
  })

  it('reconcile R0a / R0b / R0c marking → no record, no customer send, customer status financial_verification', async () => {
    for (const [row, s] of [[{ status: 'failed' }, undefined], [{ status: 'pending' }, { status: 'failed' }], [{ status: 'succeeded' }, { status: 'canceled' }]] as Array<[Record<string, unknown>, Record<string, unknown> | undefined]>) {
      world({ status: 'refunded', activeOrderKey: null }, row, s)
      expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ ok: true, outcome: 'reverted_after_refund' })
      expect(customerClaimStatus(claimOf(w) as never, null, true)).toBe('financial_verification')
    }
    expect(st.records).toEqual([])
    expect(customerSends()).toEqual([])
  })

  it('NEGATIVE CONTROL — the same spy records claim_decision_refunded when the decision sender runs (the spy works)', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'c1', email: 'client@x.test', name: 'Client', locale: 'fr', role: 'consumer' })
    await sendClaimDecisionEmail({ claimId: 'cl1', consumerId: 'c1', orderId: 'o1', decision: 'refunded', refundedCents: 300 })
    expect(customerSends()).toEqual(['claim_decision_refunded'])
  })
})
