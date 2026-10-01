// tests/claims-t49-round13-reversal.test.ts — T-49 round 13, slice W5: J-M40 (D12, G11, I-05, A-S24-1, A-S24-2,
// A-S31-1, A-S31b, A-S31f-1, A-S31f-2, A-S31f-3, E-08).
//
// markClaimsForRevertedRefundRow writes Claim rows only, on the exact pre-image, and only when the FRESH row read
// satisfies the evidence. The webhook calls it AFTER its unchanged money writes, in the failed / canceled branch, and
// answers 503 only when one of its DB calls threw (Stripe redelivers: the next delivery marks the claim once).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { payableWorld, wireWorld, refundRow, claimOf, type World } from './support/claims-world'

const { db, stripe, st } = vi.hoisted(() => ({
  st: { w: null as unknown as import('./support/claims-world').World, log: [] as string[] },
  db: {
    claim:  { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    refund: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    order:  { findUnique: vi.fn() },
    franchiseRoyalty: { findFirst: vi.fn() },
    emailDispatch: { create: vi.fn() },
    $transaction: vi.fn(),
  },
  stripe: {
    constructEvent: vi.fn(),
    paymentIntents: { retrieve: vi.fn() },
    refunds:        { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/stripe', () => ({
  getStripe: () => ({ webhooks: { constructEvent: stripe.constructEvent }, ...stripe }),
  retrieveChargeFacts: vi.fn(), mapAccountStatus: vi.fn(),
}))
vi.mock('@/lib/loyalty-refund-apply', () => ({ reconcileLoyaltyOnRefund: vi.fn(async () => ({ status: 'reconciled' })) }))
const { alertMock } = vi.hoisted(() => ({ alertMock: vi.fn() }))
vi.mock('@/lib/admin-alerts', () => ({
  sendAdminGhostOrderAlert: vi.fn(async () => ({ status: 'sent' })),
  sendAdminStalePiAlert:    vi.fn(async () => ({ status: 'sent' })),
  sendAdminMoneyReviewAlert: alertMock,
}))
vi.mock('@/lib/refund', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  finalizeRefundRowFromStripe: vi.fn(async () => { st.log.push('finalizeRefundRowFromStripe'); return { ok: true, refundId: 'rf1' } }),
  // The engine's failed-row write, simulated on the world: status failed, the Stripe id recorded, the key renamed.
  markRefundRowFailed: vi.fn(async (rowId: string, refund: { id: string }) => {
    st.log.push('markRefundRowFailed')
    const r = st.w.refunds.find((x) => x.id === rowId)
    if (r && r.status === 'pending') Object.assign(r, { status: 'failed', stripeRefundId: refund.id, idempotencyKey: `${r.idempotencyKey}:failed:${refund.id}` })
    return { ok: true }
  }),
}))
vi.mock('@/lib/claims', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/claims')>()
  return {
    ...actual,
    reconcileClaimForRefund: vi.fn(async (i: Parameters<typeof actual.reconcileClaimForRefund>[0]) => { st.log.push(`reconcileClaimForRefund:${i.status}`); return actual.reconcileClaimForRefund(i) }),
    markClaimsForRevertedRefundRow: vi.fn(async (i: Parameters<typeof actual.markClaimsForRevertedRefundRow>[0]) => {
      st.log.push(`helper:${i.evidence.kind}`)
      const out = await actual.markClaimsForRevertedRefundRow(i)
      st.log.push(`helper→${JSON.stringify(out)}`)
      return out
    }),
  }
})

import { POST } from '@/app/api/webhooks/stripe/route'
import { markClaimsForRevertedRefundRow } from '@/lib/claims'
import { MARKERS, reversalMarkerText, customerClaimStatus } from '@/lib/claim-action-rules'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
let w: World
const refundObj = (id: string, status: string, o: Record<string, unknown> = {}) =>
  ({ id, object: 'refund', status, amount: 300, payment_intent: 'pi_1', metadata: {}, failure_reason: null, ...o }) as never
const helper = markClaimsForRevertedRefundRow as unknown as (i: Parameters<typeof markClaimsForRevertedRefundRow>[0]) => ReturnType<typeof markClaimsForRevertedRefundRow>

function world(claim: Record<string, unknown>, row: Record<string, unknown>) {
  w = payableWorld({ refundAttempted: true, refundId: 'rf_x', refundError: null, ...claim })
  w.refunds.push(refundRow('rf_x', { idempotencyKey: 'refund:o1:0', ...row }))
  wireWorld(w, db, stripe)
  st.w = w
  return w
}
const fire = async (obj: Record<string, unknown>) => {
  stripe.constructEvent.mockReturnValue({ type: 'refund.failed', data: { object: obj } })
  const res = await POST(new Request('http://x/api/webhooks/stripe', { method: 'POST', body: 'raw', headers: { 'stripe-signature': 'sig' } }))
  return { status: res.status, body: await res.json() as Record<string, unknown> }
}
const SETTLED = { status: 'refunded', activeOrderKey: null }

beforeEach(() => {
  vi.clearAllMocks()
  st.log.length = 0
  alertMock.mockReset()
  alertMock.mockImplementation(async (a: { kind: string }) => { st.log.push(`alert:${a.kind}`); return { status: 'sent' } })
  for (const m of [db.refund.update, db.refund.updateMany]) { m.mockReset(); m.mockImplementation(async () => { throw new Error('Refund update attempted') }) }
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test'
})
afterEach(() => { delete process.env.STRIPE_WEBHOOK_SECRET })

describe('J-M40 — G11 evidence preconditions, on the FRESH row read', () => {
  it('stripe_object: a succeeded row whose recorded id equals the refund, Stripe failed → written; an id mismatch or a succeeded refund → nothing', async () => {
    world(SETTLED, { status: 'succeeded', stripeRefundId: 're_s' })
    expect(await helper({ rowId: 'rf_x', evidence: { kind: 'stripe_object', refund: refundObj('re_OTHER', 'failed') } })).toEqual({ claimIds: [], written: false, failed: false })
    expect(await helper({ rowId: 'rf_x', evidence: { kind: 'stripe_object', refund: refundObj('re_s', 'succeeded') } })).toEqual({ claimIds: [], written: false, failed: false })
    expect(w.writes).toEqual([])
    expect(await helper({ rowId: 'rf_x', evidence: { kind: 'stripe_object', refund: refundObj('re_s', 'canceled') } })).toEqual({ claimIds: ['cl1'], written: true, failed: false })
    expect(claimOf(w)).toMatchObject({ status: 'refunded' })
    expect(String(claimOf(w).refundError)).toContain('Stripe rapporte aujourd’hui son remboursement re_s « canceled »')
  })

  // IMPLEMENTATION NOTE (W5) on G11 (3) — regression pin (W5 fixer): stripe_object also identifies an id-less SUCCEEDED row by
  // the engine tag, but only on the order's PaymentIntent and only for this row.
  it('stripe_object on an id-less succeeded row: the tag of THIS row on pi_1 → written; on pi_OTHER → nothing; the tag of another row → nothing', async () => {
    for (const refund of [
      refundObj('re_t', 'failed', { metadata: { grubano_refund_row: 'rf_x' }, payment_intent: 'pi_OTHER' }),
      refundObj('re_t', 'failed', { metadata: { grubano_refund_row: 'rf_OTHER' } }),
      refundObj('re_t', 'failed'),
    ]) {
      world(SETTLED, { status: 'succeeded', stripeRefundId: null })
      expect(await helper({ rowId: 'rf_x', evidence: { kind: 'stripe_object', refund } })).toEqual({ claimIds: [], written: false, failed: false })
      expect(w.writes).toEqual([])
    }
    world(SETTLED, { status: 'succeeded', stripeRefundId: null })
    const before = JSON.stringify(w.refunds)
    expect(await helper({ rowId: 'rf_x', evidence: { kind: 'stripe_object', refund: refundObj('re_t', 'failed', { metadata: { grubano_refund_row: 'rf_x' } }) } })).toEqual({ claimIds: ['cl1'], written: true, failed: false })
    expect(String(claimOf(w).refundError)).toContain('Stripe rapporte aujourd’hui son remboursement re_t « failed »')
    expect(JSON.stringify(w.refunds)).toBe(before)
  })

  it('failed_row: failed WITH an id → written; failed WITHOUT an id → nothing', async () => {
    world(SETTLED, { status: 'failed', stripeRefundId: null })
    expect(await helper({ rowId: 'rf_x', evidence: { kind: 'failed_row' } })).toEqual({ claimIds: [], written: false, failed: false })
    world(SETTLED, { status: 'failed', stripeRefundId: 're_f' })
    expect(await helper({ rowId: 'rf_x', evidence: { kind: 'failed_row' } })).toEqual({ claimIds: ['cl1'], written: true, failed: false })
    expect(String(claimOf(w).refundError)).toContain('notre ligne est désormais ÉCHOUÉE avec l’identifiant Stripe re_f')
  })

  it('pending_row_stripe: matching id, or an id-less row with a matching tag, on the order’s PI and failed → written, the row byte-identical', async () => {
    world(SETTLED, { status: 'pending', stripeRefundId: 're_p' })
    let before = JSON.stringify(w.refunds)
    expect(await helper({ rowId: 'rf_x', evidence: { kind: 'pending_row_stripe', refund: refundObj('re_p', 'failed') } })).toMatchObject({ written: true, failed: false })
    expect(JSON.stringify(w.refunds)).toBe(before)
    world(SETTLED, { status: 'pending', stripeRefundId: null })
    before = JSON.stringify(w.refunds)
    expect(await helper({ rowId: 'rf_x', evidence: { kind: 'pending_row_stripe', refund: refundObj('re_t', 'failed', { metadata: { grubano_refund_row: 'rf_x' } }) } })).toMatchObject({ written: true })
    expect(JSON.stringify(w.refunds)).toBe(before)
  })

  it('pending_row_stripe refuses: a tag of another row, another PaymentIntent, a refund Stripe reports succeeded', async () => {
    for (const refund of [
      refundObj('re_t', 'failed', { metadata: { grubano_refund_row: 'rf_OTHER' } }),
      refundObj('re_t', 'failed', { metadata: { grubano_refund_row: 'rf_x' }, payment_intent: 'pi_OTHER' }),
      refundObj('re_t', 'succeeded', { metadata: { grubano_refund_row: 'rf_x' } }),
    ]) {
      world(SETTLED, { status: 'pending', stripeRefundId: null })
      expect(await helper({ rowId: 'rf_x', evidence: { kind: 'pending_row_stripe', refund } })).toEqual({ claimIds: [], written: false, failed: false })
      expect(w.writes).toEqual([])
    }
  })
})

describe('J-M40 — G11 targets', () => {
  it('resume_mismatch → skipped; refunded null → the text only, status unchanged', async () => {
    world({ status: 'refunding', refundError: 'resume_mismatch: le moteur a repris …' }, { status: 'succeeded', stripeRefundId: 're_s' })
    expect(await helper({ rowId: 'rf_x', evidence: { kind: 'stripe_object', refund: refundObj('re_s', 'failed') } })).toEqual({ claimIds: ['cl1'], written: false, failed: false })
    expect(w.writes).toEqual([])
    world(SETTLED, { status: 'succeeded', stripeRefundId: 're_s' })
    await helper({ rowId: 'rf_x', evidence: { kind: 'stripe_object', refund: refundObj('re_s', 'failed') } })
    expect(w.writes).toEqual([{ where: { id: 'cl1', status: 'refunded', refundError: null }, data: { refundError: claimOf(w).refundError }, count: 1 }])
  })

  for (const status of ['approved', 'refunding']) {
    it(`${status} with a null error: stripe_object → approved + STRIPE_REVERTED (A-S24-1); failed_row → skipped`, async () => {
      world({ status }, { status: 'succeeded', stripeRefundId: 're_s' })
      await helper({ rowId: 'rf_x', evidence: { kind: 'stripe_object', refund: refundObj('re_s', 'failed') } })
      expect(w.writes[0]).toMatchObject({ where: { id: 'cl1', status, refundError: null }, count: 1 })
      expect(claimOf(w).status).toBe('approved')
      expect(String(claimOf(w).refundError).startsWith(MARKERS.STRIPE_REVERTED)).toBe(true)
      world({ status }, { status: 'failed', stripeRefundId: 're_f' })
      expect(await helper({ rowId: 'rf_x', evidence: { kind: 'failed_row' } })).toEqual({ claimIds: ['cl1'], written: false, failed: false })
      expect(w.writes).toEqual([])
    })
  }

  it('a DB throw → { failed: true }; a lost CAS → { written: false, failed: false }', async () => {
    world(SETTLED, { status: 'failed', stripeRefundId: 're_f' })
    w.fail.claimFindMany = true
    expect(await helper({ rowId: 'rf_x', evidence: { kind: 'failed_row' } })).toMatchObject({ written: false, failed: true })
    world(SETTLED, { status: 'failed', stripeRefundId: 're_f' })
    w.beforeClaimWrite = () => { claimOf(w).refundError = 'declared_settled_after_revert: concurrent' }
    expect(await helper({ rowId: 'rf_x', evidence: { kind: 'failed_row' } })).toEqual({ claimIds: ['cl1'], written: false, failed: false })
    expect(db.refund.update).not.toHaveBeenCalled()
    expect(db.refund.updateMany).not.toHaveBeenCalled()
  })

  it('the three texts: the customer sentence and the ledger check; no « déjà comptabilis », no « Le client lit désormais », no « la reprend »; ROUTED true / false / unknown', () => {
    for (const v of ['succeeded', 'failed', 'pending'] as const) {
      for (const routed of [true, false, null]) {
        const t = reversalMarkerText(v, 'rf_x', 're_x', 'failed', routed)
        expect(t.startsWith(MARKERS.REVERTED_AFTER_REFUND)).toBe(true)
        expect(t).toContain('Quand les réclamations sont ouvertes, le client lit « vérification manuelle » ; sinon il ne voit aucune réclamation.')
        expect(t).toContain('Vérifiez dans le ledger et la reprise de royalty ce qui a pu être écrit')
        expect(t).not.toMatch(/déjà comptabilis|Le client lit désormais|la reprend/)
        // IMPLEMENTATION NOTE (W5) on G11 (1) — regression pin (W5 fixer): the reworded tail, verbatim, and the round-7
        // FORBIDDEN pattern the frozen « si le client a été payé autrement » would match.
        expect(t.endsWith('Aucune action ici ne déplace d’argent : si le client a reçu un paiement par un autre moyen (Dashboard Stripe), déclarez-le ; sinon clôturez sans paiement.')).toBe(true)
        expect(t).not.toMatch(/le client a été (remboursé|payé)/i)
        expect('si le client a été payé autrement (Dashboard Stripe)').toMatch(/le client a été (remboursé|payé)/i)
        expect(t.includes('Ce paiement est routé :')).toBe(routed === true)
        expect(t.includes('Si ce paiement est routé,')).toBe(routed === null)
      }
    }
  })
})

describe('J-M40 — the webhook failed / canceled branches (D12)', () => {
  it('(a) failed on a PENDING row bound to a settled claim → markRefundRowFailed → reconcileClaimForRefund → helper(failed_row): marked, 200', async () => {
    world(SETTLED, { status: 'pending', stripeRefundId: null })
    const r = await fire(refundObj('re_p', 'failed', { metadata: { grubano_refund_row: 'rf_x' } }))
    expect(r.status).toBe(200)
    expect(st.log.filter((l) => !l.startsWith('helper→'))).toEqual(['markRefundRowFailed', 'reconcileClaimForRefund:failed', 'helper:failed_row'])
    expect(String(claimOf(w).refundError)).toContain('notre ligne est désormais ÉCHOUÉE avec l’identifiant Stripe re_p')
    expect(customerClaimStatus(claimOf(w) as never, null, true)).toBe('financial_verification')
    // (b) the redelivery on the now-failed row: the helper ONLY — and it writes nothing more.
    st.log.length = 0
    const writes = w.writes.length
    expect((await fire(refundObj('re_p', 'failed', { metadata: { grubano_refund_row: 'rf_x' } }))).status).toBe(200)
    expect(st.log.filter((l) => !l.startsWith('helper→'))).toEqual(['helper:failed_row'])
    expect(w.writes.length).toBe(writes)
  })

  for (const [label, key] of [['key = cursor (A-S31-1 / A-S31f-2)', 'refund:o1:300'], ['key ≠ cursor (A-S31-2 / A-S31f-3)', 'refund:o1:0']]) {
    it(`(c) failed on a SUCCEEDED row, ${label} → the refund:<re> alert FIRST with claimIds, then helper(stripe_object): marked, 200`, async () => {
      world(SETTLED, { status: 'succeeded', stripeRefundId: 're_s', idempotencyKey: key })
      const r = await fire(refundObj('re_s', 'failed', { metadata: { grubano_refund_row: 'rf_x' } }))
      expect(r.status).toBe(200)
      expect(st.log.filter((l) => !l.startsWith('helper→'))).toEqual(['alert:refund_failed', 'helper:stripe_object'])
      expect(alertMock.mock.calls[0][0]).toMatchObject({ kind: 'refund_failed', dedupeKey: 'refund:re_s', facts: { claimIds: 'cl1' } })
      expect(String(claimOf(w).refundError)).toContain('Notre ligne reste marquée ABOUTIE (le webhook ne la modifie pas)')
      expect(r.body).not.toHaveProperty('revertedClaims')
    })
  }

  it('(c) on an approved claim with a null error (A-S24-1) → approved + STRIPE_REVERTED', async () => {
    world({ status: 'approved' }, { status: 'succeeded', stripeRefundId: 're_s' })
    expect((await fire(refundObj('re_s', 'failed', { metadata: { grubano_refund_row: 'rf_x' } }))).status).toBe(200)
    expect(String(claimOf(w).refundError).startsWith(MARKERS.STRIPE_REVERTED)).toBe(true)
  })

  it('NEGATIVE CONTROL — the event’s refund id differs from row.stripeRefundId → no write, 200', async () => {
    world(SETTLED, { status: 'succeeded', stripeRefundId: 're_s' })
    const r = await fire(refundObj('re_OTHER', 'failed', { metadata: { grubano_refund_row: 'rf_x' } }))
    expect(r.status).toBe(200)
    expect(w.writes).toEqual([])
    expect(claimOf(w).refundError).toBeNull()
  })

  it('E-08 — a helper DB throw → 503 {received:false} (claimIds « unread »); the next delivery marks the claim exactly once', async () => {
    world(SETTLED, { status: 'succeeded', stripeRefundId: 're_s' })
    w.fail.claimFindMany = true
    const first = await fire(refundObj('re_s', 'failed', { metadata: { grubano_refund_row: 'rf_x' } }))
    expect(first).toEqual({ status: 503, body: { received: false } })
    expect(alertMock.mock.calls[0][0].facts.claimIds).toBe('unread')
    // E-08: the claim still reads « Remboursée » until the redelivery — the documented C6 breach, bounded by redelivery.
    expect(claimOf(w).refundError).toBeNull()
    w.fail.claimFindMany = false
    const second = await fire(refundObj('re_s', 'failed', { metadata: { grubano_refund_row: 'rf_x' } }))
    expect(second.status).toBe(200)
    expect(w.writes.filter((x) => x.count === 1)).toHaveLength(1)
    const third = await fire(refundObj('re_s', 'failed', { metadata: { grubano_refund_row: 'rf_x' } }))
    expect(third.status).toBe(200)
    expect(w.writes.filter((x) => x.count === 1)).toHaveLength(1)
  })

  it('J-C43 (b) — on a FAILED row (redelivery) a helper DB throw → 503 {received:false}, the claim unchanged; the next delivery marks it exactly once (certification audit c32d8d3, P1)', async () => {
    world(SETTLED, { status: 'failed', stripeRefundId: 're_f' })
    w.fail.claimFindMany = true
    const first = await fire(refundObj('re_f', 'failed', { metadata: { grubano_refund_row: 'rf_x' } }))
    expect(first).toEqual({ status: 503, body: { received: false } })
    // The failed-row branch is the helper ONLY: no markRefundRowFailed, no reconcileClaimForRefund, no alert.
    expect(st.log.filter((l) => !l.startsWith('helper→'))).toEqual(['helper:failed_row'])
    expect(claimOf(w).refundError).toBeNull()
    expect(w.writes.filter((x) => x.count === 1)).toHaveLength(0)
    w.fail.claimFindMany = false
    const second = await fire(refundObj('re_f', 'failed', { metadata: { grubano_refund_row: 'rf_x' } }))
    expect(second.status).toBe(200)
    expect(String(claimOf(w).refundError)).toContain('notre ligne est désormais ÉCHOUÉE')
    expect(String(claimOf(w).refundError)).toContain('re_f')
    expect(w.writes.filter((x) => x.count === 1)).toHaveLength(1)
    const third = await fire(refundObj('re_f', 'failed', { metadata: { grubano_refund_row: 'rf_x' } }))
    expect(third.status).toBe(200)
    expect(w.writes.filter((x) => x.count === 1)).toHaveLength(1)
  })

  it('a lost CAS on the redelivery → written false, failed false → 200, never 503', async () => {
    world(SETTLED, { status: 'failed', stripeRefundId: 're_f' })
    w.beforeClaimWrite = () => { claimOf(w).status = 'refused_final' }
    expect((await fire(refundObj('re_f', 'failed', { metadata: { grubano_refund_row: 'rf_x' } }))).status).toBe(200)
  })

  it('source: no new response key, no claim e-mail import; refund.update never called across the branches', () => {
    const src = stripComments(read('app/api/webhooks/stripe/route.ts'))
    expect(src).not.toMatch(/revertedClaims|refund_reverted_claim|claim-emails|sendClaimClosureEmail|sendClaimDecisionEmail/)
    expect(db.refund.update).not.toHaveBeenCalled()
  })
})
