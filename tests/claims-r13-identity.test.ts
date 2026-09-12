// tests/claims-r13-identity.test.ts — T-49 round 13, slice W2: J-M12 (B8) and J-M16 (B12).
//
// A legacy resume_mismatch on the claim's OWN stamped row is identity-established: reconcile applies the row,
// a declaration is refused, the webhook reconciler counts it. A failed identity read is never a negative
// identity: it refuses, reverts or is 'unknown' — never not_ours, bound_to_other_claim or a proof of absence.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { payableWorld, wireWorld, refundRow, stripeRefund, claimOf, engineOk, type World } from './support/claims-world'

const { db } = vi.hoisted(() => ({
  db: {
    claim:  { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    refund: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    order:  { findUnique: vi.fn() },
    franchiseRoyalty: { findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
const { execMock, refundsFlag } = vi.hoisted(() => ({ execMock: vi.fn(), refundsFlag: vi.fn() }))
vi.mock('@/lib/refund', () => ({ executeRefund: execMock, isRefundsEnabled: refundsFlag, RESUME_CREATE_WINDOW_MS: 20 * 60 * 60 * 1000 }))
const { alertMock, auditMock } = vi.hoisted(() => ({ alertMock: vi.fn(), auditMock: vi.fn() }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: alertMock }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: auditMock }))
const { stripeMock } = vi.hoisted(() => ({
  stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() } },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

import {
  reconcileClaimEvidence, resolveStuckClaim, reconcileClaimForRefund, refundRowIdentity, loadOrderMoneyFacts, triggerClaimRefund,
  attributeClaimRefund, listActionableRefundClaims, adoptStripeRefundForClaim,
} from '@/lib/claims'
import { ownRowMismatch, reconcileRefusal, isStuckResolvable } from '@/lib/claim-action-rules'
import { moneyLineFor } from '@/lib/claim-money-line'

const B12 = 'La base n’a pas pu être lue : l’identité du remboursement n’est pas établie et rien n’a été modifié. Réessayez.'
const MISMATCH = 'resume_mismatch: le moteur a abouti sur un remboursement (R) qui n’appartient PAS à cette réclamation — texte hérité.'

let w: World
const setWorld = (x: World) => { w = x; wireWorld(w, db, stripeMock) }
beforeEach(() => {
  vi.clearAllMocks()
  for (const m of [execMock, refundsFlag, alertMock, auditMock]) m.mockReset()
  refundsFlag.mockReturnValue(true)
  alertMock.mockResolvedValue({ status: 'sent' })
  execMock.mockResolvedValue(engineOk())
  setWorld(payableWorld())
})

/** Claim C refunding, bound to R with a legacy resume_mismatch; R stamped for `stamp`. */
const mismatchWorld = (stamp: string, row: Record<string, unknown> = {}) => {
  const x = payableWorld({ status: 'refunding', refundAttempted: true, refundId: 'R', refundError: MISMATCH })
  x.refunds.push(refundRow('R', { reason: stamp, stripeRefundId: 're_R', ...row }))
  return x
}

describe('J-M12 — legacy resume_mismatch on the claim’s OWN row (B8)', () => {
  const facts = (reason: string) => ({ id: 'cl1', orderId: 'o1', status: 'refunding', refundAttempted: true, refundId: 'R', refundError: MISMATCH, boundRow: { id: 'R', orderId: 'o1', reason } })

  it('the pure rules: ownRowMismatch true, reconcile admitted, declaration refused, money line identity_unread', () => {
    const c = facts('claim:cl1')
    expect(ownRowMismatch(c)).toBe(true)
    expect(reconcileRefusal(c)).toBeNull()
    expect(isStuckResolvable(c)).toBe(false)
    expect(moneyLineFor({ kind: 'other_unsettled', refundId: 'R', refundError: MISMATCH, claimId: 'cl1', boundRow: { reason: 'claim:cl1' }, reconcilable: true }).certainty).toBe('identity_unread')
  })

  it('(a) R succeeded and Stripe reads its refund succeeded → reconcile takes the mine path and settles on R, evidence stripe_read', async () => {
    const x = mismatchWorld('claim:cl1')
    x.stripeRefunds.push(stripeRefund('re_R'))
    setWorld(x)
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(r).toEqual({ ok: true, outcome: 'refunded', refundId: 'R', amountCents: 300, evidence: 'stripe_read' })
    expect(claimOf(w)).toMatchObject({ status: 'refunded', refundId: 'R', refundError: null })
    expect(stripeMock.refunds.retrieve).toHaveBeenCalledWith('re_R')
  })

  it('(a) G4 on the newly admitted (ii): our row succeeded but Stripe reports its refund FAILED → never settled; marked stripe_reverted + ALERT-B', async () => {
    const x = mismatchWorld('claim:cl1')
    x.stripeRefunds.push(stripeRefund('re_R', { status: 'failed' }))
    setWorld(x)
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(r).toEqual({ ok: true, outcome: 'refund_failed', refundId: 'R' })
    const c = claimOf(w)
    expect(c).toMatchObject({ status: 'approved', refundId: 'R' })
    expect(String(c.refundError)).toBe('stripe_reverted: la ligne R est marquée ABOUTIE dans notre base, mais Stripe rapporte aujourd’hui son remboursement re_R « failed » : il ne verse rien au titre de cette ligne. Notre base la compte toujours comme remboursée ; le webhook laisse ce cas à une révision humaine, sans action automatique. Si ce paiement est routé, un remboursement échoué a pu laisser le transfert du restaurant inversé (Stripe ne le restaure pas) — vérifiez-le dans le Dashboard Stripe. Cela ne dit RIEN des autres remboursements de la commande : vérifiez la commande dans Stripe avant tout paiement. Décision admin requise, aucun nouvel essai automatique.')
    expect(alertMock.mock.calls.map((a) => a[0].dedupeKey)).toEqual(['claim_blocked:cl1:stripe_reverted'])
  })

  it('(a) NEGATIVE CONTROL — Stripe does not know the refund (404) → contradiction park, never refunded on our row alone', async () => {
    const x = mismatchWorld('claim:cl1')
    x.fail.refundRetrieve = { re_R: 'missing' }
    setWorld(x)
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(r).toMatchObject({ ok: true, outcome: 'financial_verification', reason: 'stripe_refund_contradiction' })
    expect(claimOf(w).status).toBe('financial_verification')
  })

  it('B9 (a)/(b) interim — R bound to the own-stamp mismatch AND to a second (null-error) binder: the webhook settles neither, reconcile parks, nothing settles', async () => {
    const x = mismatchWorld('claim:cl1')
    x.stripeRefunds.push(stripeRefund('re_R'))
    x.claims.push({ id: 'clB', orderId: 'o1', status: 'refunding', refundAttempted: true, refundId: 'R', refundError: null })
    setWorld(x)
    expect(await reconcileClaimForRefund({ refundRowId: 'R', status: 'succeeded', stripeRefundId: 're_R' })).toEqual({ reconciled: false, reason: 'not_bound' })
    expect(w.writes).toEqual([])
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(r).toMatchObject({ ok: true, outcome: 'financial_verification', reason: 'reconcile_not_applied' })
    expect((r as { detail: string }).detail).toBe('La ligne R est liée à au moins une autre réclamation : cette réclamation ne peut pas être soldée sur elle sans décision humaine. Aucune conclusion tirée.')
    expect(claimOf(w, 'clB')).toMatchObject({ status: 'refunding', refundError: null })
    expect(w.claims.filter((c) => c.status === 'refunded')).toEqual([])
    // NEGATIVE CONTROL: without the second binder the same row settles the own-stamp claim.
    const y = mismatchWorld('claim:cl1')
    y.stripeRefunds.push(stripeRefund('re_R'))
    setWorld(y)
    expect(await reconcileClaimForRefund({ refundRowId: 'R', status: 'succeeded', stripeRefundId: 're_R' })).toMatchObject({ reconciled: true, claimId: 'cl1' })
  })

  it('a legacy row whose reconciler settles ANOTHER binder is never reported as this claim’s settlement (applyRowTruth parks, never « refunded »)', async () => {
    // cl1 (FV) owns the stamped row R; a legacy claim clB is ALSO bound to R and is the one the reconciler finds first.
    const x = payableWorld({ status: 'financial_verification', refundAttempted: true, refundError: 'financial_verification:refund_moved_unattributed: x' })
    x.refunds.push(refundRow('R', { reason: 'claim:cl1', stripeRefundId: 're_R' }))
    x.claims.unshift({ id: 'clB', orderId: 'o1', status: 'refunding', refundAttempted: true, refundId: 'R', refundError: null })
    setWorld(x)
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(r).toMatchObject({ ok: true, outcome: 'financial_verification', reason: 'reconcile_not_applied' })
    expect((r as { detail: string }).detail).toContain('a été appliquée à une autre réclamation liée à cette ligne (clB)')
    expect(claimOf(w).status).toBe('financial_verification')
    expect(JSON.stringify(r)).not.toContain('"refunded"')
    // NEGATIVE CONTROL: with no other binder the same reconcile settles cl1 on R.
    const y = payableWorld({ status: 'financial_verification', refundAttempted: true, refundError: 'financial_verification:refund_moved_unattributed: x' })
    y.refunds.push(refundRow('R', { reason: 'claim:cl1', stripeRefundId: 're_R' }))
    setWorld(y)
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ ok: true, outcome: 'refunded', refundId: 'R' })
  })

  it('(b) R failed with a Stripe id → approved + stripe_failed', async () => {
    setWorld(mismatchWorld('claim:cl1', { status: 'failed' }))
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(r).toMatchObject({ ok: true, outcome: 'refund_failed', refundId: 'R' })
    expect(claimOf(w).status).toBe('approved')
    expect(String(claimOf(w).refundError).startsWith('stripe_failed:')).toBe(true)
  })

  it('(c) R pending → applyRowTruth per the Stripe truth (pending at Stripe → bound, still pending)', async () => {
    const x = mismatchWorld('claim:cl1', { status: 'pending' })
    x.stripeRefunds.push(stripeRefund('re_R', { status: 'pending' }))
    setWorld(x)
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ ok: true, outcome: 'still_pending', refundId: 'R' })
  })

  it('the webhook reconciler counts it as a candidate; the declaration is refused; the console flags agree with the server', async () => {
    setWorld(mismatchWorld('claim:cl1'))
    expect(await reconcileClaimForRefund({ refundRowId: 'R', status: 'succeeded', stripeRefundId: 're_R' })).toMatchObject({ reconciled: true, claimId: 'cl1' })
    setWorld(mismatchWorld('claim:cl1'))
    expect(await resolveStuckClaim({ claimId: 'cl1', adminId: 'admin1', resolution: 'closed_no_payment' })).toEqual({ ok: false, status: 409, error: 'Cette réclamation n’est pas bloquée sur un remboursement — utilisez l’arbitrage.' })
    const rows = await listActionableRefundClaims()
    expect(rows[0]).toMatchObject({ reconcilable: true, resolvable: false })
  })

  it('NEGATIVE CONTROL — R stamped claim:OTHER: not own-row, reconcile refused, stuck_close accepted, the webhook reconciler not_bound', async () => {
    expect(ownRowMismatch(facts('claim:OTHER'))).toBe(false)
    setWorld(mismatchWorld('claim:OTHER'))
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ ok: false, status: 409 })
    expect(await reconcileClaimForRefund({ refundRowId: 'R', status: 'succeeded', stripeRefundId: 're_R' })).toEqual({ reconciled: false, reason: 'not_bound' })
    expect((await listActionableRefundClaims())[0]).toMatchObject({ reconcilable: false, resolvable: true })
    expect(await resolveStuckClaim({ claimId: 'cl1', adminId: 'admin1', resolution: 'closed_no_payment' })).toMatchObject({ ok: true })
  })

  it('NEGATIVE CONTROL — the bound-row read rejects: both reconcile and stuck_close answer the B12 409, nothing written', async () => {
    setWorld(mismatchWorld('claim:cl1'))
    w.fail.refundFindUnique = true
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: false, status: 409, error: B12 })
    expect(await resolveStuckClaim({ claimId: 'cl1', adminId: 'admin1', resolution: 'closed_no_payment' })).toEqual({ ok: false, status: 409, error: B12 })
    expect(w.writes).toEqual([])
    expect(alertMock).not.toHaveBeenCalled()
  })
})

describe('J-M16 — a failed identity read is never a negative identity (B12)', () => {
  const NEGATIVE = /not_ours|bound_to_other_claim|relève d’une autre réclamation|no_refund_proven/

  it('T3: a rejecting reason read → unknown (never not_ours); a missing row → unknown', async () => {
    w.fail.refundFindUnique = true
    expect(await refundRowIdentity('rf9', 'cl1', { ok: true, resumed: true })).toBe('unknown')
    w.fail.refundFindUnique = false
    expect(await refundRowIdentity('rf_missing', 'cl1', { ok: false })).toBe('unknown')
    // NEGATIVE CONTROL: the same read resolving → the normal answers
    w.refunds.push(refundRow('rf9', { reason: 'claim:OTHER' }), refundRow('rf_own', { reason: 'claim:cl1' }))
    expect(await refundRowIdentity('rf9', 'cl1', { ok: true, resumed: true })).toBe('not_ours')
    expect(await refundRowIdentity('rf_own', 'cl1', { ok: false })).toBe('ours')
  })

  it('loadOrderMoneyFacts: the stamped rows, the binders and the stamped-claim reads rejecting → transient, never a proof', async () => {
    for (const fail of [{ refundFindMany: true }, { claimFindMany: true }]) {
      const x = payableWorld()
      x.refunds.push(refundRow('rf_X', { stripeRefundId: 're_X', reason: 'claim:cl_Y' }))
      x.stripeRefunds.push(stripeRefund('re_X'))
      x.fail = fail
      setWorld(x)
      expect(await loadOrderMoneyFacts('o1', 'cl1', 500), JSON.stringify(fail)).toEqual({ readable: false, permanent: null, ...(fail.claimFindMany ? { } : {}) })
    }
  })

  it('T2 (a): a rejecting stamped query → the transient revert (C3 (b)), never the engine, never a proof', async () => {
    w.fail.refundFindFirst = true
    expect(await triggerClaimRefund('cl1')).toEqual({ state: 'failed', error: 'safety_check_unreadable' })
    expect(claimOf(w)).toMatchObject({ status: 'approved', refundAttempted: false, refundError: null })
    expect(execMock).not.toHaveBeenCalled()
    expect(JSON.stringify(claimOf(w))).not.toMatch(NEGATIVE)
  })

  it('attributeClaimRefund: a rejecting binder read → the B12 409, 0 claim writes, 0 audit, 0 alert', async () => {
    setWorld(payableWorld({ status: 'financial_verification', refundError: 'financial_verification:refund_moved_unattributed: x' }))
    w.refunds.push(refundRow('R2', { stripeRefundId: 're_R2' }))
    db.claim.findFirst.mockRejectedValueOnce(new Error('db down'))
    const out = await attributeClaimRefund({ claimId: 'cl1', refundRowId: 'R2', adminId: 'admin1' })
    expect(out).toEqual({ ok: false, status: 409, error: B12 })
    expect(w.writes).toEqual([])
    expect(auditMock).not.toHaveBeenCalled()
    expect(alertMock).not.toHaveBeenCalled()
    expect(JSON.stringify(out)).not.toMatch(NEGATIVE)
  })

  it('adoptStripeRefundInner: the existing-mirror read or the stamped-row read rejecting → the B12 409, wrote false, 0 claim writes, 0 refund.create, 0 audit, 0 alert', async () => {
    for (const reject of ['mirror', 'stamped'] as const) {
      setWorld(payableWorld({ status: 'financial_verification', refundError: 'financial_verification:refund_moved_unattributed: x' }))
      w.stripeRefunds.push(stripeRefund('re_Dashboard1'))
      auditMock.mockClear()
      if (reject === 'mirror') db.refund.findFirst.mockRejectedValueOnce(new Error('db down'))
      else db.refund.findFirst.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('db down'))
      const out = await adoptStripeRefundForClaim({ claimId: 'cl1', stripeRefundId: 're_Dashboard1', adminId: 'admin1' })
      expect(out, reject).toEqual({ ok: false, status: 409, error: B12, wrote: false })
      expect(w.writes, reject).toEqual([])
      expect(db.refund.create, reject).not.toHaveBeenCalled()
      expect(auditMock, reject).not.toHaveBeenCalled()
      expect(alertMock, reject).not.toHaveBeenCalled()
      expect(stripeMock.refunds.retrieve, reject).not.toHaveBeenCalled()
      expect(JSON.stringify(out)).not.toMatch(NEGATIVE)
    }
    // NEGATIVE CONTROL: both reads resolving → past the guards to the Stripe anchors (a dry-run preview, nothing written).
    setWorld(payableWorld({ status: 'financial_verification', refundError: 'financial_verification:refund_moved_unattributed: x' }))
    w.stripeRefunds.push(stripeRefund('re_Dashboard1'))
    expect(await adoptStripeRefundForClaim({ claimId: 'cl1', stripeRefundId: 're_Dashboard1', adminId: 'admin1', dryRun: true })).toMatchObject({ ok: true, outcome: 'preview', wouldWrite: true })
  })

  it('NEGATIVE CONTROL — the same reads resolving empty → the normal outcomes (payable → engine; no binder → attribution proceeds)', async () => {
    expect(await triggerClaimRefund('cl1')).toMatchObject({ state: 'refunded' })
    setWorld(payableWorld({ status: 'financial_verification', refundError: 'financial_verification:refund_moved_unattributed: x' }))
    w.refunds.push(refundRow('R2', { stripeRefundId: 're_R2' }))
    const out = await attributeClaimRefund({ claimId: 'cl1', refundRowId: 'R2', adminId: 'admin1' })
    expect(out).toMatchObject({ ok: true, outcome: 'refunded', refundId: 'R2' })
  })
})
