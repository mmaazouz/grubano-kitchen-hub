// tests/claims-t49-round13-r0.test.ts — T-49 round 13, slice W5: J-M36 (D7, G10, A-S10, A-S21, A-S31c, A-S31d,
// A-S31e-1, A-S31e-2, E-07, E-09, I-01 reverted_after_refund).
//
// A settled claim (refunded, no recorded error) bound to a row of its own order is re-read by « Réconcilier d’après la
// preuve », read-only toward Stripe. Only a failed / canceled refund — or our row failed with its Stripe id — marks the
// claim (G11, claim only). No webhook is delivered in these fixtures.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { payableWorld, wireWorld, refundRow, stripeRefund, claimOf, HOURS, type World } from './support/claims-world'

const { db } = vi.hoisted(() => ({
  db: {
    claim:  { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    refund: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    order:  { findUnique: vi.fn() },
    franchiseRoyalty: { findFirst: vi.fn() },
    emailDispatch: { create: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
const { engine } = vi.hoisted(() => ({ engine: { executeRefund: vi.fn(), markRefundRowFailed: vi.fn(), finalizeRefundRowFromStripe: vi.fn(), isRefundsEnabled: vi.fn() } }))
vi.mock('@/lib/refund', () => ({ ...engine, RESUME_CREATE_WINDOW_MS: 20 * 60 * 60 * 1000 }))
const { alertMock, auditMock, adminMock, sendTx } = vi.hoisted(() => ({ alertMock: vi.fn(), auditMock: vi.fn(), adminMock: vi.fn(), sendTx: vi.fn() }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: alertMock }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: auditMock }))
vi.mock('@/lib/admin-guard', () => ({ resolveAdmin: adminMock }))
vi.mock('@/lib/transactional-emails', () => ({ sendTransactional: sendTx, sendOnce: sendTx }))
const { stripeMock } = vi.hoisted(() => ({
  stripeMock: {
    paymentIntents: { retrieve: vi.fn() },
    refunds:        { list: vi.fn(), retrieve: vi.fn(), create: vi.fn(), update: vi.fn(), cancel: vi.fn() },
    transfers:      { createReversal: vi.fn() },
  },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

import { reconcileClaimEvidence, listActionableRefundClaims, listUnfinalizedClaimRefundRows } from '@/lib/claims'
import { POST as RECONCILE } from '@/app/api/admin/claims/[id]/reconcile/route'
import { MARKERS, R0_TOASTS, R0_DB_FAILED, customerClaimStatus, reconcileRefusal } from '@/lib/claim-action-rules'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

let w: World
const SETTLED = { status: 'refunded', refundAttempted: true, refundId: 'rf_b', refundError: null, activeOrderKey: null }
function settled(row: Record<string, unknown>, stripe: Array<ReturnType<typeof stripeRefund>> = []) {
  w = payableWorld(SETTLED)
  w.refunds.push(refundRow('rf_b', { reason: 'claim:cl1', idempotencyKey: 'refund:o1:0', ...row }))
  w.stripeRefunds.push(...stripe)
  wireWorld(w, db, stripeMock)
  return w
}
const reconcile = async () => {
  const res = await RECONCILE(new Request('https://app.grubano.com/x', { method: 'POST' }), { params: { id: 'cl1' } })
  return { status: res.status, body: await res.json() as { result?: Record<string, unknown>; error?: string } }
}
const rowsSnapshot = () => JSON.stringify(w.refunds)

beforeEach(() => {
  vi.clearAllMocks()
  for (const m of [...Object.values(engine), alertMock, auditMock, adminMock, sendTx, db.refund.update, db.refund.updateMany]) m.mockReset()
  alertMock.mockResolvedValue({ status: 'sent' })
  auditMock.mockResolvedValue(true)
  adminMock.mockResolvedValue({ id: 'op1', role: 'admin', name: 'Admin', email: 'a@x.test' })
  for (const m of [stripeMock.refunds.create, stripeMock.refunds.update, stripeMock.refunds.cancel, stripeMock.transfers.createReversal]) {
    m.mockImplementation(async () => { throw new Error('Stripe write attempted') })
  }
})

/** Across every fixture: no engine, no Stripe write, no Refund update, no customer e-mail. */
function expectNoMoney() {
  expect(engine.executeRefund).not.toHaveBeenCalled()
  expect(engine.markRefundRowFailed).not.toHaveBeenCalled()
  expect(engine.finalizeRefundRowFromStripe).not.toHaveBeenCalled()
  for (const m of [stripeMock.refunds.create, stripeMock.refunds.update, stripeMock.refunds.cancel, stripeMock.transfers.createReversal]) expect(m).not.toHaveBeenCalled()
  expect(db.refund.update).not.toHaveBeenCalled()
  expect(db.refund.updateMany).not.toHaveBeenCalled()
  expect(sendTx).not.toHaveBeenCalled()
}
function expectMarked(variant: 'failed' | 'pending' | 'succeeded', re: string) {
  const c = claimOf(w)
  expect(c.status).toBe('refunded')
  expect(String(c.refundError).startsWith(MARKERS.REVERTED_AFTER_REFUND)).toBe(true)
  const phrase = variant === 'failed' ? `notre ligne est désormais ÉCHOUÉE avec l’identifiant Stripe ${re}`
    : variant === 'pending' ? 'encore « en attente » dans notre base' : 'Notre ligne reste marquée ABOUTIE'
  expect(String(c.refundError)).toContain(phrase)
  // ONE claim write, on the exact pre-image; ALERT-B after it; the route's audit says no money moved.
  expect(w.writes).toEqual([{ where: { id: 'cl1', status: 'refunded', refundError: null }, data: { refundError: c.refundError }, count: 1 }])
  const blocked = alertMock.mock.calls.map((x) => x[0]).filter((a) => a.kind === 'claim_payment_blocked')
  expect(blocked).toHaveLength(1)
  expect(blocked[0]).toMatchObject({ dedupeKey: 'claim_blocked:cl1:reverted_after_refund', facts: { cause: 'reverted_after_refund', claimStatusAfter: 'refunded', engineCalled: false, registry: 'E-06' } })
  expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'claim.reconcile_evidence', metadata: expect.objectContaining({ outcome: 'reverted_after_refund', moneyMoved: false }) }))
  // F05: once marked, the customer reads the manual review, never « Remboursée ».
  expect(customerClaimStatus(c as never, null, true)).toBe('financial_verification')
}
function expectNothingWritten() {
  expect(w.writes).toEqual([])
  expect(alertMock.mock.calls.filter((x) => x[0].kind === 'claim_payment_blocked')).toEqual([])
}

describe('J-M36 — R0a: a settled claim on our row FAILED with its Stripe id (A-S31c)', () => {
  it('→ reverted_after_refund with the failed-row text; claim only, no Stripe read', async () => {
    settled({ status: 'failed', stripeRefundId: 're_b' })
    const r = await reconcile()
    // W6 (H07, H09 (4)): a reversal sends nothing — customerEmail null.
    expect(r).toEqual({ status: 200, body: { result: { ok: true, outcome: 'reverted_after_refund', refundId: 'rf_b' }, customerEmail: null } })
    expectMarked('failed', 're_b')
    expect(stripeMock.refunds.retrieve).not.toHaveBeenCalled()
    expectNoMoney()
  })

  it('C9 (f) / G10 — the claim’s refundError changes between the read and the CAS → 200 changed_during_read: the lost CAS writes nothing, no I-01 alert, no audit', async () => {
    settled({ status: 'failed', stripeRefundId: 're_b' })
    w.beforeClaimWrite = () => { claimOf(w).refundError = `${MARKERS.DECLARED_AFTER_REVERT} déclaration concurrente` }
    expect(await reconcile()).toEqual({ status: 200, body: { result: { ok: true, outcome: 'changed_during_read' }, customerEmail: null } })
    expect(w.writes.map((x) => x.count)).toEqual([0])
    expect(claimOf(w).refundError).toBe(`${MARKERS.DECLARED_AFTER_REVERT} déclaration concurrente`)
    expect(alertMock.mock.calls.filter((x) => x[0].kind === 'claim_payment_blocked')).toEqual([])
    expect(auditMock).not.toHaveBeenCalled()
    expectNoMoney()
    // NEGATIVE CONTROL — the same fixture with no concurrent change is marked (one CAS, count 1).
    settled({ status: 'failed', stripeRefundId: 're_b' })
    expect((await reconcile()).body.result).toEqual({ ok: true, outcome: 'reverted_after_refund', refundId: 'rf_b' })
  })

  it('the marking helper’s DB read throws → 409 « La base n’a pas pu être lue ou écrite : rien n’est établi. Réessayez. », nothing written, no alert', async () => {
    settled({ status: 'failed', stripeRefundId: 're_b' })
    w.fail.claimFindMany = true
    expect(await reconcile()).toEqual({ status: 409, body: { error: 'La base n’a pas pu être lue ou écrite : rien n’est établi. Réessayez.' } })
    expect(R0_DB_FAILED).toBe('La base n’a pas pu être lue ou écrite : rien n’est établi. Réessayez.')
    expectNothingWritten()
    expectNoMoney()
  })
})

describe('J-M36 — R0b: a settled claim on a PENDING row (A-S31d, A-S10, A-S21)', () => {
  for (const status of ['failed', 'canceled']) {
    it(`retrieve → ${status} → reverted_after_refund with the pending-row text; the row is byte-identical, markRefundRowFailed not called`, async () => {
      settled({ status: 'pending', stripeRefundId: 're_b', createdAt: new Date(Date.now() - 2 * HOURS) }, [stripeRefund('re_b', { status })])
      const before = rowsSnapshot()
      const r = await reconcile()
      expect(r.body.result).toEqual({ ok: true, outcome: 'reverted_after_refund', refundId: 'rf_b' })
      expectMarked('pending', 're_b')
      expect(rowsSnapshot()).toBe(before)
      expect(String(claimOf(w).refundError)).toContain('si le moteur reprend cette ligne (il reprend la plus ancienne ligne en attente d’une commande avant tout nouveau remboursement)')
      expectNoMoney()
    })
  }

  for (const status of ['succeeded', 'pending', 'requires_action']) {
    it(`retrieve → ${status} → refund_still_standing { stripeStatus: ${status} }, nothing written`, async () => {
      settled({ status: 'pending', stripeRefundId: 're_b' }, [stripeRefund('re_b', { status, amount: 450 })])
      expect((await reconcile()).body.result).toEqual({ ok: true, outcome: 'refund_still_standing', refundId: 'rf_b', stripeStatus: status, amountCents: 450 })
      expectNothingWritten()
      expectNoMoney()
    })
  }

  it('no refund yet carries the row’s tag, within the window → unconfirmed_within_window { until }, never refund_still_standing', async () => {
    settled({ status: 'pending', stripeRefundId: null, createdAt: new Date(Date.now() - 1 * HOURS) })
    const r = (await reconcile()).body.result!
    expect(r).toMatchObject({ ok: true, outcome: 'unconfirmed_within_window', refundId: 'rf_b' })
    expect(Date.parse(String(r.until))).toBeGreaterThan(Date.now())
    expect(r.outcome).not.toBe('refund_still_standing')
    expectNothingWritten()
    expectNoMoney()
  })

  it('the console renders unconfirmed_within_window with its own date toast, never « toujours ABOUTI ou en attente »', () => {
    const src = stripComments(read('components/claims/AdminFinancialVerification.tsx'))
    const branch = src.slice(src.indexOf("const text = outcome === 'unconfirmed_within_window'"), src.indexOf("said[outcome ?? '']"))
    expect(branch).toContain('Conclusion possible à partir du')
    expect(branch).not.toContain('toujours ce remboursement ABOUTI')
    expect(R0_TOASTS.refund_still_standing).toContain('toujours ce remboursement ABOUTI ou en attente')
    expect(src).toContain('reverted_after_refund:  R0_TOASTS.reverted_after_refund,')
  })

  it('no tagged refund at 22 h (window + margin passed) → refunded_row_unproven { detail }, nothing written', async () => {
    settled({ status: 'pending', stripeRefundId: null, createdAt: new Date(Date.now() - 22 * HOURS) })
    const r = (await reconcile()).body.result!
    expect(r).toMatchObject({ ok: true, outcome: 'refunded_row_unproven', refundId: 'rf_b' })
    expect(String(r.detail)).toContain('Stripe ne connaît aucun remboursement pour la ligne rf_b')
    expectNothingWritten()
    expectNoMoney()
  })

  it('the recorded refund is on another payment (pi_OTHER) → refunded_row_unproven with the contradiction detail', async () => {
    settled({ status: 'pending', stripeRefundId: 're_b' }, [stripeRefund('re_b', { status: 'failed', payment_intent: 'pi_OTHER' })])
    const r = (await reconcile()).body.result!
    expect(r).toMatchObject({ ok: true, outcome: 'refunded_row_unproven' })
    expect(String(r.detail)).toContain('ne porte pas sur le paiement de cette commande')
    expectNothingWritten()
    expectNoMoney()
  })

  it('Stripe unreachable (ETIMEDOUT) → stripe_unreadable_retry, nothing written', async () => {
    settled({ status: 'pending', stripeRefundId: 're_b' })
    w.fail.refundRetrieve = { re_b: 'throw' }
    expect((await reconcile()).body.result).toEqual({ ok: true, outcome: 'stripe_unreadable_retry', refundId: 'rf_b' })
    expectNothingWritten()
    expectNoMoney()
  })
})

describe('J-M36 — R0c: a settled claim on a SUCCEEDED row (A-S31e-1, A-S31e-2 — route only, E-09)', () => {
  it('retrieve → succeeded → refund_still_standing { stripeStatus: succeeded, amountCents: Stripe amount }, nothing written', async () => {
    settled({ status: 'succeeded', stripeRefundId: 're_b', amountCents: 300 }, [stripeRefund('re_b', { status: 'succeeded', amount: 280 })])
    expect((await reconcile()).body.result).toEqual({ ok: true, outcome: 'refund_still_standing', refundId: 'rf_b', stripeStatus: 'succeeded', amountCents: 280 })
    expectNothingWritten()
    expectNoMoney()
  })

  for (const [label, key] of [['key = current cursor (A-S31e-1)', 'refund:o1:0'], ['key ≠ current cursor (A-S31e-2)', 'refund:o1:900']]) {
    it(`retrieve → failed, ${label} → reverted_after_refund with the succeeded-row text`, async () => {
      settled({ status: 'succeeded', stripeRefundId: 're_b', idempotencyKey: key }, [stripeRefund('re_b', { status: 'failed' })])
      const before = rowsSnapshot()
      expect((await reconcile()).body.result).toEqual({ ok: true, outcome: 'reverted_after_refund', refundId: 'rf_b' })
      expectMarked('succeeded', 're_b')
      expect(rowsSnapshot()).toBe(before)
      expectNoMoney()
    })
  }

  it('retrieve → 404 → refunded_row_unproven with the key/mode detail, nothing written', async () => {
    settled({ status: 'succeeded', stripeRefundId: 're_b' })
    w.fail.refundRetrieve = { re_b: 'missing' }
    const r = (await reconcile()).body.result!
    expect(r).toMatchObject({ ok: true, outcome: 'refunded_row_unproven' })
    expect(String(r.detail)).toContain('que Stripe ne connaît pas avec la clé de ce serveur')
    expectNothingWritten()
    expectNoMoney()
  })
})

describe('J-M36 — the (iii) gate: negatives', () => {
  it('NEGATIVE CONTROL — the bound row is on ANOTHER order → 409, nothing read at Stripe, nothing written', async () => {
    settled({ status: 'failed', stripeRefundId: 're_b', orderId: 'o_other' })
    expect(await reconcile()).toEqual({ status: 409, body: { error: 'Cette réclamation n’est pas en attente de réconciliation.' } })
    expect(stripeMock.refunds.retrieve).not.toHaveBeenCalled()
    expectNothingWritten()
    expectNoMoney()
  })

  it('a recorded refundError (already marked, or a declaration) → 409, nothing written', async () => {
    for (const e of [`${MARKERS.REVERTED_AFTER_REFUND} déjà marquée`, `${MARKERS.DECLARED_AFTER_REVERT} déclaration`]) {
      settled({ status: 'failed', stripeRefundId: 're_b' })
      claimOf(w).refundError = e
      expect((await reconcile()).status).toBe(409)
      expectNothingWritten()
    }
  })

  it('our row failed WITHOUT a Stripe id → 409 (E-13, not E-07), nothing written', async () => {
    settled({ status: 'failed', stripeRefundId: null })
    expect((await reconcile()).status).toBe(409)
    expectNothingWritten()
  })

  it('BREAK/RESTORE witness — the (iii) pending clause is what admits A-S31d (the gate without it refuses)', () => {
    const claim = { id: 'cl1', orderId: 'o1', status: 'refunded', refundAttempted: true, refundId: 'rf_b', refundError: null }
    expect(reconcileRefusal({ ...claim, boundRow: { id: 'rf_b', orderId: 'o1', status: 'pending', stripeRefundId: 're_b' } })).toBeNull()
    expect(reconcileRefusal({ ...claim, boundRow: undefined })).not.toBeNull()
  })
})

describe('J-M36 — the controls live where the server admits them (D7 CONSOLE; E-09 negative pin)', () => {
  it('A-S31c is listed on listActionableRefundClaims, reconcilable; A-S31d on listUnfinalizedClaimRefundRows, reconcilable', async () => {
    settled({ status: 'failed', stripeRefundId: 're_b' })
    const actionable = await listActionableRefundClaims()
    expect(actionable.map((c) => [c.id, c.reconcilable, c.moneyState])).toEqual([['cl1', true, 'stripe_failed']])
    settled({ status: 'pending', stripeRefundId: 're_b' })
    expect((await listActionableRefundClaims()).map((c) => c.id)).toEqual([])
    const unfinalized = await listUnfinalizedClaimRefundRows()
    expect(unfinalized.map((u) => [u.refundRowId, u.claimId, u.reconcilable])).toEqual([['rf_b', 'cl1', true]])
  })

  it('E-09 — A-S31e-1 / A-S31e-2 (a settled claim on a SUCCEEDED row) appear on no list', async () => {
    for (const key of ['refund:o1:0', 'refund:o1:900']) {
      settled({ status: 'succeeded', stripeRefundId: 're_b', idempotencyKey: key }, [stripeRefund('re_b', { status: 'failed' })])
      expect(await listActionableRefundClaims()).toEqual([])
      expect(await listUnfinalizedClaimRefundRows()).toEqual([])
    }
  })

  it('a marked claim (E-06) is listed on listActionableRefundClaims, closable by declaration, not reconcilable', async () => {
    settled({ status: 'succeeded', stripeRefundId: 're_b' })
    claimOf(w).refundError = `${MARKERS.REVERTED_AFTER_REFUND} la réclamation a été soldée sur la ligne rf_b…`
    const listed = await listActionableRefundClaims()
    expect(listed.map((c) => [c.id, c.resolvable, c.reconcilable, c.moneyState, c.actualRefundedCents])).toEqual([['cl1', true, false, 'refund_error_recorded', null]])
  })
})
