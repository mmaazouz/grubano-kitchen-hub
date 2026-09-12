// tests/claims-t49-round12.test.ts — T-49, round-12 fixes for the round-11 adversarial audit
//
// Round 11 ran to completion on 76d2086: P0 0, P1 2, P2 5, P3 9; 3 of 19 findings refuted.
//   P1 (1): a claim that was APPROVED and then closed unpaid on the operator's declaration told the
//           customer « Refus confirmé » — nobody refused it. It now reads as a closure by the team.
//   P1 (2): a claim parked because an ENGINE row's refund had in fact succeeded at Stripe had no exit:
//           attribution refused the pending row, adoption refused the engine refund. Attributing a pending
//           row now lets Stripe's evidence for that row decide.
// Plus the round's P2/P3 fixes. Reads the customer status depends on are mocked SELECT-AWARE.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync as readRaw } from 'node:fs'
import { updateManyMock, matchWhere } from './support/prisma-where'

/** CRLF-safe: the founder's checkout has core.autocrlf=true. */
const read = (p: string) => readRaw(p, 'utf8').replace(/\r\n/g, '\n')
const WINDOW = 20 * 60 * 60 * 1000
const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

const { db } = vi.hoisted(() => ({
  db: {
    claim:  { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    refund: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), aggregate: vi.fn() },
    order:  { findUnique: vi.fn(), findMany: vi.fn() },
    // ROUND 13 (G2 (3), W3): the no-row branch reads the ONE loader (G3), which reads the royalty status.
    franchiseRoyalty: { findFirst: vi.fn() },
    // ROUND 13 (C6, slice W4): attribution binds in ONE Serializable transaction (run here on the same mocks).
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { execMock, refundsFlag } = vi.hoisted(() => ({ execMock: vi.fn(), refundsFlag: vi.fn() }))
vi.mock('@/lib/refund', () => ({ executeRefund: execMock, isRefundsEnabled: refundsFlag, RESUME_CREATE_WINDOW_MS: 20 * 60 * 60 * 1000 }))

const { alertMock } = vi.hoisted(() => ({ alertMock: vi.fn() }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: alertMock }))

const { auditMock } = vi.hoisted(() => ({ auditMock: vi.fn() }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: auditMock }))

const { adminMock } = vi.hoisted(() => ({ adminMock: vi.fn() }))
vi.mock('@/lib/admin-guard', () => ({ resolveAdmin: adminMock }))

const { stripeMock } = vi.hoisted(() => ({
  stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() } },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

const { cronMock } = vi.hoisted(() => ({ cronMock: vi.fn() }))
vi.mock('@/lib/safe-compare', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isInternalCronRequest: cronMock,
}))

import {
  reconcileClaimEvidence, attributeClaimRefund, getClaimEligibility, claimRefundReason,
  FINANCIAL_VERIFICATION, RECONCILE_REQUIRED, ENGINE_DEAD_MARGIN_MS,
} from '@/lib/claims'
import { customerClaimStatus, isStuckResolvable, acceptedExits, type ClaimFacts } from '@/lib/claim-action-rules'

/** ROUND 13 (D1 row 4): a lock written by reconcile keeps reconcile AND the declaration close. */
const isStuckResolvableFacts = (e: string) => {
  const c = { id: 'cl1', orderId: 'o1', status: 'approved', refundAttempted: false, refundId: null, refundError: e }
  return isStuckResolvable(c) && acceptedExits({ claim: c, now: new Date() }).join(',') === 'reconcile,stuck_close'
}
import { attributionRefusal } from '@/lib/claim-attribution-rules'
import { financialVerificationCardVisible } from '@/lib/claim-money-line'
import { GET as CENSUS } from '@/app/api/admin/claims/census/route'
import { POST as RESOLVE_STUCK } from '@/app/api/admin/claims/[id]/resolve-stuck/route'

/** Returns only the selected fields, as Prisma does. */
function pick(row: Record<string, unknown> | null | undefined, select?: Record<string, unknown>): Record<string, unknown> | null {
  if (!row) return null
  if (!select) return row
  return Object.fromEntries(Object.entries(row).filter(([k]) => select[k] === true))
}

const fx: { row: Record<string, unknown> | null; forcedCount: number | null; applyWrites: boolean } =
  { row: null, forcedCount: null, applyWrites: true }

const OLD_MARKER = `${RECONCILE_REQUIRED}: tentative de remboursement démarrée à 2026-09-10T00:00:00.000Z — identité pas encore liée.`
const tagged = (rowId: string, status: string, o: Record<string, unknown> = {}) =>
  ({ id: 're_' + rowId, status, amount: 300, payment_intent: 'pi_1', metadata: { grubano_refund_row: rowId }, ...o })
const engineRow = (id: string, o: Record<string, unknown> = {}) => ({
  id, orderId: 'o1', status: 'pending', amountCents: 300, stripeRefundId: null as string | null,
  reason: 'admin:x', createdAt: new Date(Date.now() - 3_600_000), ...o,
})

beforeEach(() => {
  vi.clearAllMocks()
  for (const m of [
    db.claim.findUnique, db.claim.findFirst, db.claim.findMany, db.claim.count, db.claim.groupBy,
    db.refund.findFirst, db.refund.findUnique, db.refund.findMany, db.order.findUnique,
    stripeMock.refunds.list, stripeMock.refunds.retrieve, stripeMock.paymentIntents.retrieve, auditMock,
  ]) m.mockReset()
  fx.row = null; fx.forcedCount = null; fx.applyWrites = true
  db.claim.findUnique.mockResolvedValue(null)
  db.claim.findFirst.mockResolvedValue(null)
  db.claim.updateMany.mockImplementation(updateManyMock(fx))
  db.claim.update.mockResolvedValue({})
  db.claim.findMany.mockResolvedValue([])
  db.claim.count.mockResolvedValue(0)
  db.claim.groupBy.mockResolvedValue([])
  db.refund.findMany.mockResolvedValue([])
  db.refund.findUnique.mockResolvedValue(null)
  db.refund.findFirst.mockResolvedValue(null)
  db.refund.aggregate.mockResolvedValue({ _sum: { amountCents: 0 } })
  // ROUND 13 (G3 / G5 E1, W3): the loader reads the order's payment status; a claim's order is paid.
  db.order.findUnique.mockResolvedValue({ id: 'o1', restaurantId: 'r1', paymentStatus: 'paid', stripePaymentIntentId: 'pi_1' })
  db.franchiseRoyalty.findFirst.mockResolvedValue(null)
  // ROUND 13 (G3, W3): the loader reads the intent status (E1b) — a paid order's intent is 'succeeded'.
  stripeMock.paymentIntents.retrieve.mockResolvedValue({ status: 'succeeded', latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 0 } })
  stripeMock.refunds.list.mockResolvedValue({ data: [], has_more: false })
  alertMock.mockResolvedValue({ status: 'sent' })
  auditMock.mockResolvedValue(undefined)
  adminMock.mockResolvedValue({ id: 'op1', role: 'restaurant', name: 'Founder', email: 'f@x.test' })
  refundsFlag.mockReturnValue(false)
  cronMock.mockReturnValue(true)
})

// ══ P1 (1) — a declaration close is not a refusal ═══════════════════════════════════════════
describe('CUSTOMER — a claim closed unpaid on the operator’s declaration is not « refused »', () => {
  it('the rule: only arbitrateClaim’s refusal reads as a refusal', () => {
    const T: Array<[ClaimFacts, string]> = [
      // ROUND 13 (F02/F04): « Refus confirmé » needs the restaurant's refusal on record; otherwise the refusal is Grubano's own.
      [{ status: 'refused_final', arbitrationDecision: 'refused_final', restaurantResponse: 'refused' }, 'refused_final'],
      [{ status: 'refused_final', arbitrationDecision: 'refused_final' }, 'refused_by_grubano'],
      [{ status: 'refused_final', arbitrationDecision: 'approved' }, 'closed_by_support'],
      [{ status: 'refused_final', arbitrationDecision: null }, 'closed_by_support'],
      [{ status: 'refused', arbitrationDecision: null }, 'refused'],
    ]
    for (const [c, want] of T) expect(customerClaimStatus(c, null), JSON.stringify(c)).toBe(want)
  })

  const CLAIM = {
    id: 'cl1', status: 'refused_final', decidedAt: new Date(), restaurantResponseReason: 'Plat conforme', arbitrationReason: null,
    refundError: null, refundId: null, refundAttempted: true, arbitrationDecision: 'approved', activeOrderKey: null, consumerId: 'u1',
  }

  it('eligibility behind the help page — SELECT-AWARE claim read: approved then closed unpaid → closed_by_support', async () => {
    db.order.findUnique.mockResolvedValue({ consumerId: 'u1', paymentStatus: 'paid', total: 20, updatedAt: new Date(), items: [], stripePaymentIntentId: 'pi_1' })
    db.claim.findFirst.mockImplementation(async ({ select }: { select?: Record<string, unknown> }) => pick(CLAIM, select))
    expect((await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })).existingClaim?.status).toBe('closed_by_support')
    // ROUND 13 (F02/F04): « Refus confirmé » only with the restaurant's refusal on record; the eligibility select carries it.
    db.claim.findFirst.mockImplementation(async ({ select }: { select?: Record<string, unknown> }) => pick({ ...CLAIM, arbitrationDecision: 'refused_final', restaurantResponse: 'refused' }, select))
    expect((await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })).existingClaim?.status).toBe('refused_final')
    db.claim.findFirst.mockImplementation(async ({ select }: { select?: Record<string, unknown> }) => pick({ ...CLAIM, arbitrationDecision: 'refused_final', restaurantResponse: null }, select))
    expect((await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })).existingClaim?.status).toBe('refused_by_grubano')
  })

  it('eligibility — SELECT-AWARE claim read: a resume-mismatch refunding claim is never « en cours » (round-11 P3)', async () => {
    db.order.findUnique.mockResolvedValue({ consumerId: 'u1', paymentStatus: 'paid', total: 20, updatedAt: new Date(), items: [], stripePaymentIntentId: 'pi_1' })
    db.claim.findFirst.mockImplementation(async ({ select }: { select?: Record<string, unknown> }) =>
      pick({ ...CLAIM, status: 'refunding', refundId: 'rf9', refundError: 'resume_mismatch: x', arbitrationDecision: null }, select))
    db.refund.findUnique.mockImplementation(async ({ select }: { select?: Record<string, unknown> }) => pick({ id: 'rf9', status: 'pending', stripeRefundId: 're_9' }, select))
    expect((await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })).existingClaim?.status).toBe(FINANCIAL_VERIFICATION)
  })

  it('every locale has the status line and the help line, and neither speaks of a refusal', () => {
    for (const loc of LOCALES) {
      const m = JSON.parse(read(`messages/${loc}.json`))
      for (const s of [m.claims.status.closed_by_support, m.eat.help.claimClosedBySupport] as string[]) {
        expect(typeof s, loc).toBe('string')
        expect(s, loc).not.toMatch(/refus|refusal|declin|rechaz|rifiut|رفض/i)
      }
    }
    expect(read('app/[locale]/eat/order/[orderId]/help/page.tsx')).toContain("if (ex.status === 'closed_by_support') return t('claimClosedBySupport')")
  })
})

// ══ P1 (2) — a pending engine row whose refund succeeded at Stripe is an exit, through evidence ═══
describe('ATTRIBUTION OF A PENDING ROW — Stripe’s evidence for that row decides (no more dead end)', () => {
  const FV_CLAIM = { id: 'cl1', orderId: 'o1', status: FINANCIAL_VERIFICATION }

  beforeEach(() => {
    db.claim.findUnique.mockResolvedValue({ ...FV_CLAIM })
    fx.row = { status: FINANCIAL_VERIFICATION, refundId: null, refundError: 'financial_verification:refund_moved_unattributed: x', activeOrderKey: 'o1' }
  })

  it('the rule no longer refuses a pending row without a Stripe id', () => {
    expect(attributionRefusal({ claimId: 'cl1', row: { id: 'rf_e', status: 'pending', reason: 'admin:x', stripeRefundId: null }, orderRows: [{ id: 'rf_e', reason: 'admin:x' }], boundToOtherClaimId: null })).toBeNull()
  })

  it('the engine row’s tagged refund SUCCEEDED → the claim is refunded, bound to that row', async () => {
    const row = engineRow('rf_e')
    db.refund.findUnique.mockResolvedValue(row)
    db.refund.findMany.mockResolvedValue([row])
    stripeMock.refunds.list.mockResolvedValue({ data: [tagged('rf_e', 'succeeded')], has_more: false })
    // ROUND 13 (G12 / C6, slice W4): the evidence is read first, then ONE Serializable transaction binds and settles.
    expect(await attributeClaimRefund({ claimId: 'cl1', refundRowId: 'rf_e', adminId: 'op1' })).toMatchObject({ ok: true, outcome: 'refunded', refundId: 'rf_e', rowStatusBefore: 'pending', evidence: 'stripe_read', amountCents: 300 })
    expect(fx.row).toMatchObject({ status: 'refunded', refundId: 'rf_e', activeOrderKey: null })
    expect(db.$transaction).toHaveBeenCalledTimes(1)
  })

  it('ROUND 13 (G12): …FAILED at Stripe, or not at Stripe yet → NOT PROVEN, a 409 that says so; nothing is written (no bind-first write any more)', async () => {
    const row = engineRow('rf_e')
    db.refund.findUnique.mockResolvedValue(row)
    db.refund.findMany.mockResolvedValue([row])
    stripeMock.refunds.list.mockResolvedValue({ data: [tagged('rf_e', 'failed')], has_more: false })
    expect(await attributeClaimRefund({ claimId: 'cl1', refundRowId: 'rf_e', adminId: 'op1' })).toEqual({
      ok: false, status: 409,
      error: 'Stripe rapporte le remboursement re_rf_e de la ligne rf_e « failed » : cette ligne ne verse rien et ne peut solder aucune réclamation. La réclamation n’a pas été modifiée. « Réconcilier d’après la preuve » tient compte de cette ligne pour toute la commande.',
    })
    expect(fx.row).toMatchObject({ status: FINANCIAL_VERIFICATION, refundId: null })

    stripeMock.refunds.list.mockResolvedValue({ data: [], has_more: false })
    const until = new Date(row.createdAt.getTime() + WINDOW + ENGINE_DEAD_MARGIN_MS).toISOString()
    expect(await attributeClaimRefund({ claimId: 'cl1', refundRowId: 'rf_e', adminId: 'op1' })).toEqual({
      ok: false, status: 409,
      error: `Stripe ne connaît pas encore de remboursement pour la ligne rf_e. La réclamation n’a pas été modifiée. Conclusion possible à partir du ${until} (UTC).`,
    })
    expect(fx.row).toMatchObject({ status: FINANCIAL_VERIFICATION, refundId: null })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })

  it('ROUND 13 (G12 / D8): the ATTRIBUTE handler renders the server text of every refusal and a success only for « refunded »', () => {
    const fv = read('components/claims/AdminFinancialVerification.tsx')
    // Scoped to the attribute handler: the reconcile handler names the evidence outcomes, which attribution no longer returns.
    const handler = fv.slice(fv.indexOf('const attribute = useCallback'), fv.indexOf('type StripeFacts'))
    expect(handler.length).toBeGreaterThan(200)
    expect(handler).toContain("if (!res.ok) { toast.error((body as { error?: string }).error || 'Attribution refusée.'); return }")
    expect(handler).toContain("if (result?.outcome !== 'refunded') {")
    // NEGATIVE CONTROL: the round-12 outcome branches are gone from the handler (a dead success toast for a 409 world).
    for (const o of ['still_pending', 'unconfirmed_within_window', 'engine_row_dead', 'stripe_unreadable_retry', 'financial_verification']) {
      expect(handler, o).not.toMatch(new RegExp(`outcome === '${o}'`))
    }
    expect(fv).not.toContain('pending_unconfirmed:')
  })
})

// ══ P2 — Stripe 0/0 and rows of OTHER claims ═════════════════════════════════════════════════
describe('STRIPE 0 / 0 — a row marked succeeded for ANOTHER claim cannot have paid this one', () => {
  const FV_CLAIM = { id: 'cl1', orderId: 'o1', status: FINANCIAL_VERIFICATION, refundId: null, refundAttempted: true, requestedAmountCents: 500, refundError: 'financial_verification:stripe_refund_contradiction: x' }
  beforeEach(() => {
    db.claim.findUnique.mockResolvedValue({ ...FV_CLAIM })
    fx.row = { status: FINANCIAL_VERIFICATION, refundAttempted: true, refundId: null, refundError: FV_CLAIM.refundError }
  })

  // ROUND 13 (G2, A-S03 / A-S04, W3): the round-12 « relèvent d’AUTRES réclamations » proof is DELETED — it wrote a
  // payable legacy proof without checking the engine or the holds. The row's refund is re-read at Stripe: failed
  // there, it is H1 (reverted) and the claim gets a LOCK whose exits are reconcile and the declaration close (REG-1).
  const reverted = { id: 're_O', status: 'failed', amount: 300, charge: 'ch_1', payment_intent: 'pi_1', metadata: {} }

  it('stamped for another claim, its refund failed at Stripe → H1 lock FOR THIS CLAIM (reconcile + declaration), never a payable proof', async () => {
    db.refund.findMany.mockResolvedValue([engineRow('rf_o', { status: 'succeeded', stripeRefundId: 're_O', reason: claimRefundReason('cl_OTHER') })])
    stripeMock.refunds.retrieve.mockResolvedValue(reverted)
    stripeMock.refunds.list.mockResolvedValue({ data: [reverted], has_more: false })
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'no_refund_proven_rail_locked' })
    expect(fx.row).toMatchObject({ status: 'approved', refundAttempted: false, refundId: null })
    const e = String(fx.row!.refundError)
    expect(e.startsWith('no_refund_proven_rail_locked: ')).toBe(true)
    expect(e).toContain('la ligne rf_o est marquée ABOUTIE dans notre base, mais Stripe ne la compte pas sur ce paiement (son remboursement re_O est « failed » chez Stripe)')
    expect(e).toContain('blocage de sûreté')
    expect(e).not.toContain('relèvent d’AUTRES réclamations')
    expect(isStuckResolvableFacts(e)).toBe(true)
  })

  it('bound to another claim (unstamped), its refund failed at Stripe → the same lock', async () => {
    db.refund.findMany.mockResolvedValue([engineRow('rf_o', { status: 'succeeded', stripeRefundId: 're_O' })])
    stripeMock.refunds.retrieve.mockResolvedValue(reverted)
    stripeMock.refunds.list.mockResolvedValue({ data: [reverted], has_more: false })
    const CLAIMS = [{ id: 'cl_Z', refundId: 'rf_o' }, { id: 'cl1', refundId: null }]
    db.claim.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => CLAIMS.filter((c) => matchWhere(where, c)))
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'no_refund_proven_rail_locked' })
    expect(String(fx.row!.refundError)).toContain('blocage de sûreté')
  })

  it('NEGATIVE CONTROL — an admin row whose refund Stripe lists as succeeded while it counts 0 c refunded is parked as a contradiction', async () => {
    const reA = { id: 're_A', status: 'succeeded', amount: 300, charge: 'ch_1', payment_intent: 'pi_1', metadata: {} }
    db.refund.findMany.mockResolvedValue([engineRow('rf_a', { status: 'succeeded', stripeRefundId: 're_A' })])
    stripeMock.refunds.retrieve.mockResolvedValue(reA)
    stripeMock.refunds.list.mockResolvedValue({ data: [reA], has_more: false })
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ outcome: 'financial_verification', reason: 'stripe_refund_contradiction' })
  })
})

// ══ P3 — precedence with MIXED rows ═════════════════════════════════════════════════════════
describe('PRECEDENCE — pinned with mixed rows, not single ones', () => {
  beforeEach(() => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', orderId: 'o1', status: 'refunding', refundAttempted: true, refundId: null, requestedAmountCents: 500, refundError: OLD_MARKER })
    fx.row = { status: 'refunding', refundAttempted: true, refundId: null, refundError: OLD_MARKER }
  })

  it('Stripe 0 / 0 with an unreadable pending row AND a succeeded row → retry first, nothing written', async () => {
    db.refund.findMany.mockResolvedValue([engineRow('rf_p', { stripeRefundId: 're_P' }), engineRow('rf_s', { status: 'succeeded', stripeRefundId: 're_S' })])
    stripeMock.refunds.retrieve.mockRejectedValue(new Error('ETIMEDOUT'))
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'stripe_unreadable_retry', refundId: null })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })

  it('a failed-at-Stripe row AND an OLDER dead row → the E3 sentence names the oldest row, as the engine resumes it (precedence pinned)', async () => {
    db.refund.findMany.mockResolvedValue([
      engineRow('rf_fail'),
      engineRow('rf_dead', { createdAt: new Date(Date.now() - WINDOW - ENGINE_DEAD_MARGIN_MS - 60_000) }),
    ])
    stripeMock.refunds.list.mockResolvedValue({ data: [tagged('rf_fail', 'failed')], has_more: false })
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'no_refund_proven_rail_locked' })
    const e = String(fx.row!.refundError)
    // ROUND 13 (G5 / G8, W3): the precedence is the ENGINE's (refund.ts 765-780: the oldest pending row first), not
    // the round-12 ladder's: rf_dead is resumed first, and rf_fail is named as another pending row.
    expect(e).toContain('la plus ancienne ligne en attente de la commande, rf_dead, est reprise par le moteur avant tout nouveau remboursement')
    expect(e).toContain('fenêtre d’idempotence expirée')
    expect(e).toContain('(ligne(s) aussi en attente : rf_fail)')
  })
})

// ══ P3 — census counts, each clause discriminated ═══════════════════════════════════════════
describe('CENSUS — every count clause changes a number', () => {
  it('a fixture where each dropped clause is visible', async () => {
    const PAST = new Date(Date.now() - 3_600_000), FUTURE = new Date(Date.now() + 3_600_000)
    const R = (status: string, o: Record<string, unknown> = {}) => ({ status, refundId: null, refundError: null, responseDeadlineAt: FUTURE, ...o })
    const ROWS = [
      R('refused'), R('refunded', { refundId: 'rf' }), R('refused_final'), R('arbitration'), R('legacy_unknown'),
      R('refunding', { refundError: OLD_MARKER }), R('refunding', { refundId: 'rf2' }), R('refunding'),
      R('restaurant_review', { responseDeadlineAt: PAST }), R('approved', { responseDeadlineAt: PAST }), R(FINANCIAL_VERIFICATION),
      // Round 13 (round-12 audit, P3): a restaurant_review whose delay is still RUNNING — dropping the
      // deadline clause from silenceExpired now changes a number.
      R('restaurant_review'),
    ]
    db.claim.count.mockImplementation(async (args?: { where?: Record<string, unknown> }) => ROWS.filter((r) => !args?.where || matchWhere(args.where, r)).length)
    db.claim.groupBy.mockImplementation(async () =>
      Object.entries(ROWS.reduce<Record<string, number>>((m, r) => { m[r.status] = (m[r.status] ?? 0) + 1; return m }, {})).map(([status, _count]) => ({ status, _count })))
    const c = (await (await CENSUS(new Request('https://app.grubano.com/api/admin/claims/census') as never)).json()).claims
    expect(c.total).toBe(12)
    expect(c.nonTerminal).toBe(10)
    expect(c.active).toBe(8)          // arbitration, refunding ×3, restaurant_review ×2, approved, financial_verification
    expect(c.refunding).toBe(3)
    expect(c.t49Shape).toBe(1)        // refunding, no binding, no error
    expect(c.reconcileMarked).toBe(1)
    expect(c.silenceExpired).toBe(1)  // restaurant_review past deadline — NOT the approved row with a past deadline
    expect(c.financialVerification).toBe(1)
  })
})

// ══ P3 — promise pin, per locale ═══════════════════════════════════════════════════════════
// Round 13 (round-12 audit, P3): built from the vocabulary each locale really uses — a webhook, engine or
// sweep that WILL act; a refund applied / refunded / paid by the system; « automatically » tied to a payment.
// Negations present in the copy (« No automatic action will be taken ») stay uncaught on purpose.
const PROMISES_BY_LOCALE: Record<string, RegExp[]> = {
  fr: [/l[’']appliquera/i, /sera appliqu[ée]e? par/i, /la reprend\b/i, /son webhook/i, /balayage de récupération/i, /sera (appliqué|remboursé|payé)e? automatiquement/i],
  en: [/\b(webhook|engine|sweep)\b[^.]{0,60}\bwill\b/i, /\bwill (apply|pick (it|this) up|refund|pay)\b/i, /\bwill be (applied|refunded|paid|reimbursed)\b/i, /\bautomatically (refund|pa(y|id)|appl)/i],
  // `\b` is ASCII-only: after an accented ending (aplicará, applicherà) it never matches, so accented endings
  // use a Unicode letter lookahead instead; Arabic accepts both word orders (verb first is the natural one).
  // The `u` flag is built through RegExp: tsconfig sets no target, and tsc rejects a `u` regex literal below es6 (TS1501).
  es: [new RegExp(String.raw`\b(webhook|motor|barrido)\b[^.]{0,60}\p{L}+ará(?!\p{L})`, 'iu'), new RegExp(String.raw`\bse (aplicará|reembolsará|pagará|abonará)(?!\p{L})`, 'iu'), new RegExp(String.raw`\bserá (aplicad|reembolsad|pagad|abonad)[oa]\b`, 'iu'), new RegExp(String.raw`\bautomáticamente[^.]{0,40}(reembols|pag|aplic|abon)`, 'iu')],
  it: [new RegExp(String.raw`\b(webhook|motore|scansione)\b[^.]{0,60}\p{L}+rà(?!\p{L})`, 'iu'), new RegExp(String.raw`\b(verrà|sarà) (applicat|rimborsat|pagat|accreditat)[oa]\b`, 'iu'), new RegExp(String.raw`\bautomaticamente[^.]{0,40}(rimbors|pag|applic|accredit)`, 'iu')],
  ar: [new RegExp(String.raw`(ويب\s?هوك|المحرك)[^.،]{0,60}سي`, 'u'), new RegExp(String.raw`سي\p{L}*[^.،]{0,30}(ويب\s?هوك|المحرك)`, 'u'), new RegExp('سيتم (تطبيق|استرداد|دفع)', 'u'), new RegExp(String.raw`تلقائي[اًا]?[^.،]{0,40}(استرداد|دفع|تطبيق)`, 'u')],
}
const flatten = (v: unknown): string[] => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(flatten) : [])

describe('PROMISES — each locale scanned with its own language (round-11 P3)', () => {
  for (const loc of LOCALES) {
    it(`${loc}: no claims or help string promises a webhook, a sweep or an automatic payment`, () => {
      const m = JSON.parse(read(`messages/${loc}.json`))
      const strings = [...flatten(m.claims), ...flatten(m.eat?.help)]
      const hits = strings.flatMap((s) => PROMISES_BY_LOCALE[loc].filter((re) => re.test(s)).map((re) => `${re} → « ${s} »`))
      expect(hits).toEqual([])
    })
  }

  it('NEGATIVE CONTROL — natural translations of the historical French promise are caught; the copy’s negations are not', () => {
    const caught = (loc: string, s: string) => PROMISES_BY_LOCALE[loc].some((re) => re.test(s))
    // « Elle n’avancera que si Stripe a réellement créé ce remboursement (son webhook l’appliquera) ou si le moteur de remboursement la reprend. »
    expect(caught('fr', 'Elle n’avancera que si Stripe a réellement créé ce remboursement (son webhook l’appliquera).')).toBe(true)
    expect(caught('en', 'It will only move forward if Stripe really created this refund (its webhook will apply it) or if the refund engine picks it up.')).toBe(true)
    expect(caught('es', 'Solo avanzará si Stripe creó realmente este reembolso (su webhook lo aplicará) o si el motor de reembolsos lo retoma.')).toBe(true)
    expect(caught('it', 'Avanzerà solo se Stripe ha davvero creato questo rimborso (il suo webhook lo applicherà) o se il motore di rimborso lo riprende.')).toBe(true)
    expect(caught('ar', 'لن تتقدم إلا إذا أنشأت Stripe هذا الاسترداد فعلاً (سيطبقه الويب هوك الخاص بها) أو إذا استأنفه محرك الاسترداد.')).toBe(true)
    // The negations the shipped copy really contains must NOT be caught.
    expect(caught('en', 'No automatic action will be taken — the decision stays with the restaurant.')).toBe(false)
    expect(caught('es', 'No se tomará ninguna acción automática — la decisión corresponde al restaurante.')).toBe(false)
    expect(caught('it', 'Nessuna azione automatica sarà intrapresa — la decisione spetta al ristorante.')).toBe(false)
    expect(caught('ar', 'لن يُتخذ أي إجراء تلقائي — القرار يعود إلى المطعم.')).toBe(false)
  })
})

// ══ P2/P3 — the financial-verification card ═════════════════════════════════════════════════
describe('FINANCIAL-VERIFICATION CARD — visible, and says what the toasts point to', () => {
  it('visibility truth table: claims OR unfinalized rows', () => {
    expect(financialVerificationCardVisible({ claimRows: 0, unfinalizedRows: 0 })).toBe(false)
    expect(financialVerificationCardVisible({ claimRows: 1, unfinalizedRows: 0 })).toBe(true)
    expect(financialVerificationCardVisible({ claimRows: 0, unfinalizedRows: 1 })).toBe(true)
  })

  it('the card uses the predicate, renders the recorded detail and the bound row status, and guidance on every unsettled row', () => {
    const fv = read('components/claims/AdminFinancialVerification.tsx')
    expect(fv).toContain('if (!financialVerificationCardVisible({ claimRows: rows.length, unfinalizedRows: unfinalized.length })) return null')
    expect(fv).toContain('Détail enregistré :')
    expect(fv).toContain('Statut de notre ligne liée :')
    expect(fv).toContain("{r.kind === 'other_unsettled' && (")
    expect(fv).toContain('Une ligne reste listée tant qu’elle est « en attente » dans notre base.')
  })
})

// ══ P3 — the stuck-close note ═══════════════════════════════════════════════════════════════
describe('STUCK CLOSE — a note that could not be recorded is reported', () => {
  const post = (body: unknown) => RESOLVE_STUCK(new Request('https://app.grubano.com/x', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }), { params: { id: 'cl1' } })

  beforeEach(() => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', status: 'approved', refundError: 'engine_failed: x' })
    fx.row = { status: 'approved', refundError: 'engine_failed: x' }
  })

  it('audit not written with a note → noteRecorded false; written → true; no note → null', async () => {
    // Round 13: recordAdminAudit RETURNS whether it wrote (it never throws); the route reports that value.
    auditMock.mockResolvedValue(false)
    expect((await (await post({ resolution: 'closed_no_payment', reason: 'note' })).json()).noteRecorded).toBe(false)
    fx.row = { status: 'approved', refundError: 'engine_failed: x' }
    auditMock.mockResolvedValue(true)
    expect((await (await post({ resolution: 'closed_no_payment', reason: 'note' })).json()).noteRecorded).toBe(true)
    fx.row = { status: 'approved', refundError: 'engine_failed: x' }
    expect((await (await post({ resolution: 'closed_no_payment' })).json()).noteRecorded).toBeNull()
  })

  it('both consoles warn when the note was not kept', () => {
    for (const f of ['components/claims/AdminFinancialVerification.tsx', 'components/claims/AdminClaimsArbitration.tsx']) {
      expect(read(f), f).toContain('.noteRecorded === false')
    }
  })
})

// ══ P3 — the gate operator's precheck ═══════════════════════════════════════════════════════
describe('GATE OPERATOR PRECHECK — a failed groupBy is NOT MEASURED, never « no rows »', () => {
  it('source pin', () => {
    const src = read('scripts/server/phase2-claims-gate.js')
    expect(src).toContain(".groupBy({ by: ['status'], _count: true }).catch(() => null)")
    expect(src).toContain('byStatus NOT MEASURED (groupBy failed)')
  })
})
