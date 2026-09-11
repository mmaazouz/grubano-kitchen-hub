// tests/claims-t49-round11.test.ts — T-49, round-11 fixes for the round-10 adversarial audit
//
// Round 10 ran to completion on ec1a534: P0 0, P1 4, P2 6, P3 6; 6 of 22 findings refuted. The four
// P1s were TWO defects, neither of them in the shared rules or the exit table round 10 introduced:
//   (1) three auditors: a Refund row still 'pending' HERE whose Stripe refund had already FAILED was
//       counted as proof of absence — the claim was told a re-approval would pay, while the engine's
//       next resume on that order can only mark the row failed and lock the order for good;
//   (2) the customer read « Remboursement en cours » on a claim whose bound row had already failed.
// Pinned here against the shipped code, with the round's P2/P3 fixes. The refund-row reads behind the
// customer status are mocked SELECT-AWARE: dropping a selected field turns these tests red.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync as readRaw } from 'node:fs'
import { updateManyMock, matchWhere } from './support/prisma-where'

/** CRLF-safe: the founder's checkout has core.autocrlf=true. */
const read = (p: string) => readRaw(p, 'utf8').replace(/\r\n/g, '\n')

const WINDOW = 20 * 60 * 60 * 1000

const { db } = vi.hoisted(() => ({
  db: {
    claim:  { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    // aggregate: the claim scope behind eligibility sums the order's succeeded refunds.
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
  reconcileClaimEvidence, listActionableRefundClaims, listConsumerClaims, getClaimEligibility, resolveStuckClaim,
  listUnfinalizedClaimRefundRows, isStuckResolvable, isRailLocked, claimRefundReason,
  FINANCIAL_VERIFICATION, RECONCILE_REQUIRED, ENGINE_ROW_DEAD, ENGINE_DEAD_MARGIN_MS, RECONCILE_GRACE_MS,
} from '@/lib/claims'
import {
  reconcileRefusal, arbitrationRefusal, boundRowShowsInProgress, moneyStateGuidance, type ClaimFacts,
} from '@/lib/claim-action-rules'
import { moneyLineFor } from '@/lib/claim-money-line'
import { GET as CENSUS } from '@/app/api/admin/claims/census/route'

/** Returns only the selected fields, as Prisma does. */
function pick(row: Record<string, unknown> | null | undefined, select?: Record<string, unknown>): Record<string, unknown> | null {
  if (!row) return null
  if (!select) return row
  return Object.fromEntries(Object.entries(row).filter(([k]) => select[k] === true))
}

const fx: { row: Record<string, unknown> | null; forcedCount: number | null; applyWrites: boolean } =
  { row: null, forcedCount: null, applyWrites: true }

const OLD_MARKER = `${RECONCILE_REQUIRED}: tentative de remboursement démarrée à 2026-09-10T00:00:00.000Z — identité pas encore liée.`
const MARKED = { id: 'cl1', orderId: 'o1', status: 'refunding', refundAttempted: true, refundId: null, requestedAmountCents: 500, refundError: OLD_MARKER }
const adminRow = (o: Record<string, unknown> = {}) => ({
  id: 'rf_admin', orderId: 'o1', status: 'pending', amountCents: 300, stripeRefundId: null as string | null,
  reason: 'admin:x', createdAt: new Date(Date.now() - 3_600_000), ...o,
})
const stripeRefund = (status: string, o: Record<string, unknown> = {}) =>
  ({ id: 're_A', status, amount: 300, payment_intent: 'pi_1', metadata: { grubano_refund_row: 'rf_admin' }, ...o })

beforeEach(() => {
  vi.clearAllMocks()
  for (const m of [
    db.claim.findUnique, db.claim.findFirst, db.claim.findMany, db.claim.count, db.claim.groupBy,
    db.refund.findFirst, db.refund.findUnique, db.refund.findMany, db.order.findUnique,
    stripeMock.refunds.list, stripeMock.refunds.retrieve, stripeMock.paymentIntents.retrieve,
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
  refundsFlag.mockReturnValue(false)
  cronMock.mockReturnValue(true)
})

// ══ P1 (×3) — FAILED AT STRIPE, STILL PENDING HERE: a lock cause, never proof of absence ═══════
describe('FAILED AT STRIPE, STILL PENDING HERE — a lock cause, never proof of absence', () => {
  beforeEach(() => {
    db.claim.findUnique.mockResolvedValue({ ...MARKED })
    fx.row = { status: 'refunding', refundAttempted: true, refundId: null, refundError: OLD_MARKER }
  })

  const VARIANTS: Array<[string, () => void]> = [
    ['the tagged refund FAILED (our row has no Stripe id)', () => {
      db.refund.findMany.mockResolvedValue([adminRow()])
      stripeMock.refunds.list.mockResolvedValue({ data: [stripeRefund('failed')], has_more: false })
    }],
    ['the tagged refund was CANCELED', () => {
      db.refund.findMany.mockResolvedValue([adminRow()])
      stripeMock.refunds.list.mockResolvedValue({ data: [stripeRefund('canceled')], has_more: false })
    }],
    ['the row records a Stripe id whose refund FAILED', () => {
      db.refund.findMany.mockResolvedValue([adminRow({ stripeRefundId: 're_A' })])
      stripeMock.refunds.retrieve.mockResolvedValue(stripeRefund('failed'))
    }],
  ]
  for (const [name, arrange] of VARIANTS) {
    it(`${name} → rail-locked proof of absence naming the row; approve refused, close offered`, async () => {
      arrange()
      expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'no_refund_proven_rail_locked' })
      expect(fx.row).toMatchObject({ status: 'approved', refundAttempted: false, refundId: null })
      const e = String(fx.row!.refundError)
      expect(isRailLocked(e)).toBe(true)
      expect(e).toContain('rf_admin')
      expect(e).toContain('a ÉCHOUÉ ou a été annulé')
      expect(e).toContain('Clôturer ce dossier')
      const after: ClaimFacts = { status: 'approved', refundAttempted: false, refundId: null, refundError: e, arbitrationDecision: 'approved' }
      expect(arbitrationRefusal(after, 'approve', new Date())).not.toBeNull()
      expect(isStuckResolvable({ status: 'approved', refundError: e })).toBe(true)
    })
  }

  it('NEGATIVE CONTROL — with nothing on the order, the same claim is the plain, re-approvable proof of absence', async () => {
    db.refund.findMany.mockResolvedValue([])
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'no_refund_proven' })
    const after: ClaimFacts = { status: 'approved', refundAttempted: false, refundError: String(fx.row!.refundError), arbitrationDecision: 'approved' }
    expect(arbitrationRefusal(after, 'approve', new Date())).toBeNull()
  })
})

// ══ P2 — Stripe reports nothing, a local row says otherwise ═══════════════════════════════
describe('STRIPE REPORTS NOTHING, A LOCAL ROW SAYS OTHERWISE — never « Des remboursements existent »', () => {
  beforeEach(() => {
    db.claim.findUnique.mockResolvedValue({ ...MARKED })
    fx.row = { status: 'refunding', refundAttempted: true, refundId: null, refundError: OLD_MARKER }
  })

  it('a pending row Stripe could not be read for → retry, nothing written', async () => {
    db.refund.findMany.mockResolvedValue([adminRow({ stripeRefundId: 're_A' })])
    stripeMock.refunds.retrieve.mockRejectedValue(new Error('ETIMEDOUT'))
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'stripe_unreadable_retry', refundId: null })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })

  it('a local row marked succeeded while Stripe reports 0 / 0 → parked as a contradiction, with a true detail', async () => {
    db.refund.findMany.mockResolvedValue([adminRow({ status: 'succeeded', stripeRefundId: 're_S' })])
    const r = await reconcileClaimEvidence({ claimId: 'cl1' }) as { outcome?: string; reason?: string; detail?: string }
    expect(r).toMatchObject({ outcome: 'financial_verification', reason: 'stripe_refund_contradiction' })
    expect(r.detail).toContain('se contredisent')
    expect(r.detail).not.toContain('Des remboursements existent')
  })

  it('a recorded Stripe id Stripe does not know → parked with THAT contradiction', async () => {
    db.refund.findMany.mockResolvedValue([adminRow({ stripeRefundId: 're_A' })])
    stripeMock.refunds.retrieve.mockRejectedValue(Object.assign(new Error('No such refund'), { statusCode: 404, code: 'resource_missing' }))
    const r = await reconcileClaimEvidence({ claimId: 'cl1' }) as { reason?: string; detail?: string }
    expect(r.reason).toBe('stripe_refund_contradiction')
    expect(r.detail).toContain('ne connaît pas')
  })

  it('money DOES show at Stripe → the unattributed park, and only then « Des remboursements existent »', async () => {
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 300 } })
    db.refund.findMany.mockResolvedValue([adminRow({ status: 'succeeded', stripeRefundId: 're_S' })])
    const r = await reconcileClaimEvidence({ claimId: 'cl1' }) as { reason?: string; detail?: string }
    expect(r.reason).toBe('refund_moved_unattributed')
    expect(r.detail).toContain('Des remboursements existent')
  })
})

// ══ P1 — the customer's « en cours » ════════════════════════════════════════════════════════
describe('CUSTOMER — « en cours » only for a bound row still pending and recorded at Stripe', () => {
  it('the rule', () => {
    expect(boundRowShowsInProgress({ status: 'pending', stripeRefundId: 're_1' })).toBe(true)
    expect(boundRowShowsInProgress({ status: 'failed', stripeRefundId: 're_1' })).toBe(false)
    expect(boundRowShowsInProgress({ status: 'succeeded', stripeRefundId: 're_1' })).toBe(false)
    expect(boundRowShowsInProgress({ status: 'pending', stripeRefundId: null })).toBe(false)
    expect(boundRowShowsInProgress(null)).toBeNull()
    // a read that forgot to select `status` must never read as « en cours »
    expect(boundRowShowsInProgress({ stripeRefundId: 're_1' })).toBe(false)
  })

  const ROWS: Record<string, Record<string, unknown>> = {
    rfP: { id: 'rfP', status: 'pending', stripeRefundId: 're_P' },
    rfF: { id: 'rfF', status: 'failed', stripeRefundId: 're_F' },
    rfS: { id: 'rfS', status: 'succeeded', stripeRefundId: 're_S' },
  }

  it('the customer list — select-aware row read', async () => {
    db.claim.findMany.mockResolvedValue([
      { id: 'p', status: 'refunding', refundId: 'rfP', refundError: null },
      { id: 'f', status: 'refunding', refundId: 'rfF', refundError: null },
      { id: 's', status: 'refunding', refundId: 'rfS', refundError: null },
    ])
    db.refund.findMany.mockImplementation(async ({ where, select }: { where: { id: { in: string[] } }; select?: Record<string, unknown> }) =>
      where.id.in.map((id) => pick(ROWS[id], select)).filter(Boolean))
    const out = await listConsumerClaims('u1')
    expect(out.map((c) => [c.id, c.status])).toEqual([['p', 'refunding'], ['f', FINANCIAL_VERIFICATION], ['s', FINANCIAL_VERIFICATION]])
  })

  it('eligibility behind the help page — select-aware row read', async () => {
    db.order.findUnique.mockResolvedValue({ consumerId: 'u1', paymentStatus: 'paid', total: 20, updatedAt: new Date(), items: [], stripePaymentIntentId: 'pi_1' })
    db.refund.findUnique.mockImplementation(async ({ where, select }: { where: { id: string }; select?: Record<string, unknown> }) => pick(ROWS[where.id], select))
    const cases: Array<[string, string]> = [['rfP', 'refunding'], ['rfF', FINANCIAL_VERIFICATION], ['rfS', FINANCIAL_VERIFICATION]]
    for (const [rowId, want] of cases) {
      db.claim.findFirst.mockResolvedValue({ id: 'cl1', status: 'refunding', decidedAt: null, restaurantResponseReason: null, arbitrationReason: null, refundError: null, refundId: rowId, refundAttempted: true })
      const e = await getClaimEligibility({ consumerId: 'u1', orderId: 'o1' })
      expect(e.existingClaim?.status, rowId).toBe(want)
    }
  })
})

// ══ P3 — dead-row copy ═════════════════════════════════════════════════════════════════════
describe('DEAD ROW COPY — the window end is the engine’s; the margin is said separately', () => {
  it('engine_row_dead prints createdAt + window, not the conclusion date', async () => {
    db.claim.findUnique.mockResolvedValue({ ...MARKED })
    fx.row = { status: 'refunding', refundAttempted: true, refundId: null, refundError: OLD_MARKER }
    const createdAt = new Date(Date.now() - WINDOW - ENGINE_DEAD_MARGIN_MS - 60_000)
    db.refund.findMany.mockResolvedValue([{ id: 'rf1', orderId: 'o1', status: 'pending', amountCents: 500, stripeRefundId: null, reason: claimRefundReason('cl1'), createdAt }])
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ outcome: 'engine_row_dead' })
    const e = String(fx.row!.refundError)
    expect(e.startsWith(`${ENGINE_ROW_DEAD}:`)).toBe(true)
    expect(e).toContain(new Date(createdAt.getTime() + WINDOW).toISOString())
    expect(e).not.toContain(new Date(createdAt.getTime() + WINDOW + ENGINE_DEAD_MARGIN_MS).toISOString())
    // ROUND-12 (round-11 audit, P2): cancelling the row by hand is not a proven remedy — no remedy is claimed.
    expect(e).toContain('aucune procédure documentée')
    expect(e).not.toContain('annulation manuelle')
  })

  it('the approve refusal no longer asserts a permanence that not every cause has', () => {
    const r = arbitrationRefusal({ status: 'approved', refundAttempted: false, refundError: 'no_refund_proven_rail_locked: x', arbitrationDecision: 'approved' }, 'approve', new Date())
    expect(r?.error).toContain('refusera tout remboursement')
    expect(r?.error).not.toMatch(/définitivement/i)
  })
})

// ══ P2 (×2) — a claim applied from Stripe while our row stays pending ═══════════════════════
describe('APPLIED FROM STRIPE WHILE OUR ROW STAYS PENDING — alerted, and listed ungated', () => {
  it('the claim is refunded from Stripe, and a money-review alert names the pending row', async () => {
    db.claim.findUnique.mockResolvedValue({ ...MARKED })
    fx.row = { status: 'refunding', refundAttempted: true, refundId: null, refundError: OLD_MARKER, activeOrderKey: 'o1' }
    db.refund.findMany.mockResolvedValue([{ id: 'rf1', orderId: 'o1', status: 'pending', amountCents: 500, stripeRefundId: null, reason: claimRefundReason('cl1'), createdAt: new Date(Date.now() - 3_600_000) }])
    stripeMock.refunds.list.mockResolvedValue({ data: [{ id: 're_T', status: 'succeeded', amount: 500, payment_intent: 'pi_1', metadata: { grubano_refund_row: 'rf1' } }], has_more: false })
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ outcome: 'refunded', refundId: 'rf1' })
    expect(alertMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'claim_refunded_row_unfinalized', dedupeKey: 'claim_row_unfinalized:rf1' }))
  })

  it('the ungated list carries pending rows whose claim is no longer refunding — and nothing else', async () => {
    const CLAIMS = [
      { id: 'c1', status: 'refunded', refundId: 'rf1' },
      { id: 'c2', status: 'refunding', refundId: 'rf2' },
      { id: 'c3', status: 'approved', refundId: 'rf3' },
      { id: 'c4', status: 'refused_final', refundId: 'rf4' },
      { id: 'c5', status: 'approved', refundId: null },
    ]
    const ROWS = [
      { id: 'rf1', orderId: 'o1', status: 'pending', amountCents: 500, stripeRefundId: null, createdAt: new Date(1) },
      { id: 'rf2', orderId: 'o2', status: 'pending', amountCents: 500, stripeRefundId: 're_2', createdAt: new Date(2) },
      { id: 'rf3', orderId: 'o3', status: 'pending', amountCents: 300, stripeRefundId: 're_3', createdAt: new Date(3) },
      { id: 'rf4', orderId: 'o4', status: 'succeeded', amountCents: 300, stripeRefundId: 're_4', createdAt: new Date(4) },
    ]
    db.claim.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => CLAIMS.filter((c) => matchWhere(where, c)))
    db.refund.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => ROWS.filter((r) => matchWhere(where, r)))
    const out = await listUnfinalizedClaimRefundRows()
    expect(out.map((u) => [u.refundRowId, u.claimId, u.claimStatus])).toEqual([['rf1', 'c1', 'refunded'], ['rf3', 'c3', 'approved']])
  })

  it('the financial-verification card renders it, facts only', () => {
    const fv = read('components/claims/AdminFinancialVerification.tsx')
    expect(fv).toContain('Lignes de remboursement encore « en attente » dont la réclamation n’est plus en cours de remboursement')
    expect(fv).toContain('Aucune action n’est proposée ici.')
  })
})

// ══ P2 — grace belongs to the gate ═════════════════════════════════════════════════════════
describe('GRACE — an attempt in flight is refused by the GATE, so every list and route agree', () => {
  const fresh = () => `${RECONCILE_REQUIRED}: tentative de remboursement démarrée à ${new Date(Date.now() - 60_000).toISOString()} — identité pas encore liée.`

  it('the rule: a fresh marker is refused, an old one admitted, a future one admitted (fails visible)', () => {
    expect(reconcileRefusal({ status: 'refunding', refundError: fresh() })?.error).toContain('moins de 5 minutes')
    expect(reconcileRefusal({ status: 'refunding', refundError: OLD_MARKER })).toBeNull()
    const future = `${RECONCILE_REQUIRED}: démarrée à ${new Date(Date.now() + 3_600_000).toISOString()}`
    expect(reconcileRefusal({ status: 'refunding', refundError: future })).toBeNull()
    expect(RECONCILE_GRACE_MS).toBe(5 * 60 * 1000)
  })

  it('the route refuses before reading anything, and the list says not reconcilable, with guidance that says why', async () => {
    const claim = { ...MARKED, refundError: fresh() }
    db.claim.findUnique.mockResolvedValue(claim)
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ ok: false, status: 409 })
    expect(db.refund.findMany).not.toHaveBeenCalled()
    db.claim.findMany.mockResolvedValue([{ ...claim, reason: 'wrong_item', createdAt: new Date() }])
    const [row] = await listActionableRefundClaims()
    expect(row.reconcilable).toBe(false)
    expect(row.resolvable).toBe(false)
    expect(moneyStateGuidance(row.moneyState)).toContain('moins de 5 minutes')
  })
})

// ══ P2/P3 — copy ═══════════════════════════════════════════════════════════════════════════
describe('COPY — what the operator reads is what the code knows', () => {
  it('the bound money line no longer points to a queue hidden while claims are closed', () => {
    const l = moneyLineFor({ kind: 'other_unsettled', refundId: 'rf1', refundError: null })
    expect(l.text).not.toContain('Remboursements à traiter')
    expect(l.text).toContain('fait foi')
  })

  it('guidance states our rows, not a Stripe status the list never read', () => {
    expect(moneyStateGuidance('stripe_pending')).not.toMatch(/est en attente chez Stripe/)
    expect(moneyStateGuidance('stripe_failed')).toContain('statut enregistré d’après Stripe')
    expect(moneyStateGuidance('stripe_succeeded_claim_unreconciled')).toContain('statut enregistré d’après Stripe')
  })
})

// ══ P3 — census ═══════════════════════════════════════════════════════════════════════════
describe('CENSUS — a failed groupBy is NOT MEASURED, never an empty population', () => {
  it('byStatus, active and nonTerminal are null, flagged not measured', async () => {
    db.claim.count.mockResolvedValue(4)
    db.claim.groupBy.mockRejectedValue(new Error('groupBy down'))
    const c = (await (await CENSUS(new Request('https://app.grubano.com/api/admin/claims/census') as never)).json()).claims
    expect(c.total).toBe(4)
    expect(c.byStatusMeasured).toBe(false)
    expect([c.byStatus, c.active, c.nonTerminal]).toEqual([null, null, null])
  })
})

// ══ P3 — the operator's note ═══════════════════════════════════════════════════════════════
describe('STUCK CLOSE — the operator note stays admin-side', () => {
  it('arbitrationReason, which the customer payload carries, is not written from the note; the audit keeps it', async () => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', status: 'approved', refundError: 'engine_failed: x' })
    fx.row = { status: 'approved', refundError: 'engine_failed: x' }
    const r = await resolveStuckClaim({ claimId: 'cl1', adminId: 'op1', resolution: 'closed_no_payment', reason: 'note interne : appel restaurant' })
    expect(r.ok).toBe(true)
    const data = db.claim.updateMany.mock.calls.at(-1)![0].data
    expect(data.arbitrationReason).toBeNull()
    expect(read('app/api/admin/claims/[id]/resolve-stuck/route.ts')).toContain('note: parsed.data.reason ?? null')
  })
})
