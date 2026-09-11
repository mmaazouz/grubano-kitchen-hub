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
import { customerClaimStatus, type ClaimFacts } from '@/lib/claim-action-rules'
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
  db.order.findUnique.mockResolvedValue({ id: 'o1', restaurantId: 'r1', stripePaymentIntentId: 'pi_1' })
  stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 0 } })
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
      [{ status: 'refused_final', arbitrationDecision: 'refused_final' }, 'refused_final'],
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
    db.claim.findFirst.mockImplementation(async ({ select }: { select?: Record<string, unknown> }) => pick({ ...CLAIM, arbitrationDecision: 'refused_final' }, select))
    expect((await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })).existingClaim?.status).toBe('refused_final')
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
    expect(await attributeClaimRefund({ claimId: 'cl1', refundRowId: 'rf_e', adminId: 'op1' })).toMatchObject({ ok: true, outcome: 'refunded', refundId: 'rf_e' })
    expect(fx.row).toMatchObject({ status: 'refunded', refundId: 'rf_e', activeOrderKey: null })
  })

  it('…FAILED at Stripe → refund_failed, closable; not at Stripe yet → from when to conclude, nothing closed', async () => {
    const row = engineRow('rf_e')
    db.refund.findUnique.mockResolvedValue(row)
    db.refund.findMany.mockResolvedValue([row])
    stripeMock.refunds.list.mockResolvedValue({ data: [tagged('rf_e', 'failed')], has_more: false })
    expect(await attributeClaimRefund({ claimId: 'cl1', refundRowId: 'rf_e', adminId: 'op1' })).toMatchObject({ ok: true, outcome: 'refund_failed' })
    expect(String(fx.row!.refundError).startsWith('stripe_failed:')).toBe(true)

    fx.row = { status: FINANCIAL_VERIFICATION, refundId: null, refundError: 'financial_verification:x' }
    stripeMock.refunds.list.mockResolvedValue({ data: [], has_more: false })
    const r = await attributeClaimRefund({ claimId: 'cl1', refundRowId: 'rf_e', adminId: 'op1' })
    expect(r).toMatchObject({ ok: true, outcome: 'unconfirmed_within_window', until: new Date(row.createdAt.getTime() + WINDOW + ENGINE_DEAD_MARGIN_MS).toISOString() })
    expect(fx.row).toMatchObject({ status: 'refunding', refundId: 'rf_e' })
  })

  it('the ATTRIBUTE handler says what the evidence found, for every outcome the route can return', () => {
    const fv = read('components/claims/AdminFinancialVerification.tsx')
    // Scoped to the attribute handler: the reconcile handler names the same outcomes, so a file-wide
    // search would stay green if the attribute toasts were removed.
    const handler = fv.slice(fv.indexOf('const attribute = useCallback'), fv.indexOf('type StripeFacts'))
    expect(handler.length).toBeGreaterThan(200)
    // Each outcome must be a BRANCH of the toast-text chain (`: outcome === 'x'` then its `? text`). The
    // tone condition below names the same outcomes, so a bare substring would stay green if a branch
    // were removed — which is exactly what the first run of control E13 showed.
    for (const o of ['still_pending', 'unconfirmed_within_window', 'engine_row_dead', 'stripe_unreadable_retry', 'financial_verification']) {
      expect(handler, o).toMatch(new RegExp(`: outcome === '${o}'\\s*\\n\\s*\\? `))
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

  it('stamped for another claim → proof of absence FOR THIS CLAIM (an exit), with its own copy', async () => {
    db.refund.findMany.mockResolvedValue([engineRow('rf_o', { status: 'succeeded', stripeRefundId: 're_O', reason: claimRefundReason('cl_OTHER') })])
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'no_refund_proven' })
    expect(fx.row).toMatchObject({ status: 'approved', refundAttempted: false, refundId: null })
    expect(String(fx.row!.refundError)).toContain('relèvent d’AUTRES réclamations')
    expect(String(fx.row!.refundError)).toContain('rf_o')
  })

  it('bound to another claim → the same', async () => {
    db.refund.findMany.mockResolvedValue([engineRow('rf_o', { status: 'succeeded', stripeRefundId: 're_O' })])
    const CLAIMS = [{ id: 'cl_Z', refundId: 'rf_o' }, { id: 'cl1', refundId: null }]
    db.claim.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => CLAIMS.filter((c) => matchWhere(where, c)))
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'no_refund_proven' })
  })

  it('NEGATIVE CONTROL — an admin row, no claim’s, still contradicts Stripe and is parked', async () => {
    db.refund.findMany.mockResolvedValue([engineRow('rf_a', { status: 'succeeded', stripeRefundId: 're_A' })])
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

  it('a failed-at-Stripe row AND a dead row → the failed-at-Stripe cause is the one written (precedence pinned)', async () => {
    db.refund.findMany.mockResolvedValue([
      engineRow('rf_fail'),
      engineRow('rf_dead', { createdAt: new Date(Date.now() - WINDOW - ENGINE_DEAD_MARGIN_MS - 60_000) }),
    ])
    stripeMock.refunds.list.mockResolvedValue({ data: [tagged('rf_fail', 'failed')], has_more: false })
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'no_refund_proven_rail_locked' })
    const e = String(fx.row!.refundError)
    expect(e).toContain('rf_fail')
    expect(e).toContain('a ÉCHOUÉ ou a été annulé')
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
    ]
    db.claim.count.mockImplementation(async (args?: { where?: Record<string, unknown> }) => ROWS.filter((r) => !args?.where || matchWhere(args.where, r)).length)
    db.claim.groupBy.mockImplementation(async () =>
      Object.entries(ROWS.reduce<Record<string, number>>((m, r) => { m[r.status] = (m[r.status] ?? 0) + 1; return m }, {})).map(([status, _count]) => ({ status, _count })))
    const c = (await (await CENSUS(new Request('https://app.grubano.com/api/admin/claims/census') as never)).json()).claims
    expect(c.total).toBe(11)
    expect(c.nonTerminal).toBe(9)
    expect(c.active).toBe(7)          // arbitration, refunding ×3, restaurant_review, approved, financial_verification
    expect(c.refunding).toBe(3)
    expect(c.t49Shape).toBe(1)        // refunding, no binding, no error
    expect(c.reconcileMarked).toBe(1)
    expect(c.silenceExpired).toBe(1)  // restaurant_review past deadline — NOT the approved row with a past deadline
    expect(c.financialVerification).toBe(1)
  })
})

// ══ P3 — promise pin, per locale ═══════════════════════════════════════════════════════════
const PROMISES_BY_LOCALE: Record<string, RegExp[]> = {
  fr: [/l[’']appliquera/i, /sera appliqu[ée]e? par/i, /la reprend\b/i, /son webhook/i, /balayage de récupération/i, /sera (appliqué|remboursé|payé)e? automatiquement/i],
  en: [/\b(webhook|sweep)\b[^.]{0,40}\bwill\b/i, /will be (applied|refunded|paid) automatically/i],
  es: [/\b(webhook|barrido)\b[^.]{0,40}(aplicará|reembolsará|pagará)/i, /se (aplicará|reembolsará|pagará) automáticamente/i],
  it: [/\b(webhook|scansione)\b[^.]{0,40}(applicherà|rimborserà|pagherà)/i, /verrà (applicat[oa]|rimborsat[oa]|pagat[oa]) automaticamente/i],
  ar: [/سيتم (تطبيقه|استرداده|دفعه) تلقائي/],
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

  it('NEGATIVE CONTROL — an injected promise is caught in each language', () => {
    const caught = (loc: string, s: string) => PROMISES_BY_LOCALE[loc].some((re) => re.test(s))
    expect(caught('fr', 'Le remboursement sera payé automatiquement.')).toBe(true)
    expect(caught('en', 'The webhook will apply it.')).toBe(true)
    expect(caught('en', 'It will be refunded automatically.')).toBe(true)
    expect(caught('es', 'El webhook lo aplicará.')).toBe(true)
    expect(caught('it', 'Il rimborso verrà pagato automaticamente.')).toBe(true)
    expect(caught('ar', 'سيتم استرداده تلقائيًا')).toBe(true)
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

  it('audit write fails with a note → noteRecorded false; succeeds → true; no note → null', async () => {
    auditMock.mockRejectedValue(new Error('audit down'))
    expect((await (await post({ resolution: 'closed_no_payment', reason: 'note' })).json()).noteRecorded).toBe(false)
    fx.row = { status: 'approved', refundError: 'engine_failed: x' }
    auditMock.mockResolvedValue(undefined)
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
