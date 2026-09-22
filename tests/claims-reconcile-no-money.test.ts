// tests/claims-reconcile-no-money.test.ts — T-49 round 13, J-M49 (G14, D4 why no money, E0 NM0, B11): no reconciliation
// path can create money authority.
//
// Every reconciliation surface runs on one state per G class (the J-M01 fixtures) with every pre-image it can meet:
// reconcile (through its route, so its audit is exercised), attribution, adoption, the declaration close and the
// recovery sweep. The Stripe double throws on every write. Across all of it: the engine is never called, no Stripe
// write, no Refund update, a Refund create only by adoption, every audit says moneyMoved false, no write leaves a
// claim approved-unpaid with no recorded error, and every payable proof carries its quiescence instant.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { payableWorld, wireWorld, claimOf, engineOk, type World } from './support/claims-world'
import { stateOf } from './fixtures/claims-r13-states'

const { db } = vi.hoisted(() => ({
  db: {
    claim:  { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    refund: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    order:  { findUnique: vi.fn() },
    franchiseRoyalty: { findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
const { engine } = vi.hoisted(() => ({
  engine: { executeRefund: vi.fn(), markRefundRowFailed: vi.fn(), finalizeRefundRowFromStripe: vi.fn(), isRefundsEnabled: vi.fn() },
}))
vi.mock('@/lib/refund', () => ({ ...engine, RESUME_CREATE_WINDOW_MS: 20 * 60 * 60 * 1000 }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: vi.fn(async () => ({ status: 'sent' })) }))
const { auditMock, adminMock } = vi.hoisted(() => ({ auditMock: vi.fn(), adminMock: vi.fn() }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: auditMock }))
vi.mock('@/lib/admin-guard', () => ({ resolveAdmin: adminMock }))
const { stripeMock } = vi.hoisted(() => ({
  stripeMock: {
    paymentIntents: { retrieve: vi.fn() },
    refunds:        { list: vi.fn(), retrieve: vi.fn(), create: vi.fn(), update: vi.fn(), cancel: vi.fn() },
    transfers:      { createReversal: vi.fn() },
  },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

import { attributeClaimRefund, adoptStripeRefundForClaim, resolveStuckClaim, recoverStrandedClaimReconciliations, arbitrateClaim, triggerClaimRefund, markClaimsForRevertedRefundRow, reverifySettledClaimRefunds } from '@/lib/claims'
import { POST as RECONCILE } from '@/app/api/admin/claims/[id]/reconcile/route'
import { POST as CLOSURE_NOTICE } from '@/app/api/admin/claims/[id]/closure-notice/route'
import { MARKERS } from '@/lib/claim-action-rules'

const CLASSES = ['A-S01', 'A-S01b', 'A-S02', 'A-S03', 'A-S06a', 'A-S07', 'A-S10b', 'A-S10c', 'A-S11', 'A-S14b', 'A-S19', 'A-S21', 'A-S22', 'A-S31b', 'A-S31d', 'A-S33-1', 'A-S42', 'A-S43']
const OLD_MARKER = 'reconcile_required: tentative de remboursement démarrée à 2026-09-10T00:00:00.000Z (tentative 0) — identité pas encore liée.'
const HOLD = `${MARKERS.SAFETY_HOLD} Aucun remboursement n’a été lancé pour cette réclamation : x Décision humaine requise ; « Clôturer ce dossier… » enregistre votre déclaration.`
/** Every pre-image a reconciliation surface admits or refuses (refundId filled with the world's first row where bound). */
const PRE_IMAGES: Record<string, (firstRow: string | null) => Record<string, unknown>> = {
  lock:     () => ({ status: 'approved', refundAttempted: false, refundId: null, refundError: 'no_refund_proven_rail_locked: écrit avant' }),
  legacy:   () => ({ status: 'approved', refundAttempted: false, refundId: null, refundError: 'no_refund_proven: preuve héritée' }),
  hold:     () => ({ status: 'approved', refundAttempted: true, refundId: null, refundError: HOLD }),
  fv:       () => ({ status: 'financial_verification', refundAttempted: true, refundId: null, refundError: 'financial_verification:refund_moved_unattributed: x' }),
  marker:   () => ({ status: 'refunding', refundAttempted: true, refundId: null, refundError: OLD_MARKER }),
  stranded: () => ({ status: 'refunding', refundAttempted: true, refundId: null, refundError: null }),
  bound:    (r) => ({ status: 'refunding', refundAttempted: true, refundId: r, refundError: null }),
  refunded: (r) => ({ status: 'refunded', refundAttempted: true, refundId: r, refundError: null, activeOrderKey: null }),
  failed:   (r) => ({ status: 'approved', refundAttempted: true, refundId: r, refundError: 'stripe_failed: x' }),
}

let w: World
let inAdoption = false
const refundCreates: boolean[] = []
const violations: string[] = []

function setWorld(stateId: string, pre: string) {
  const s = stateOf(stateId)
  w = payableWorld()
  s.world!(w as never)
  const firstRow = w.refunds[0]?.id ?? null
  Object.assign(claimOf(w), PRE_IMAGES[pre](firstRow))
  wireWorld(w, db, stripeMock)
  // No write leaves a claim { approved, refundAttempted false, refundError null } (G14), checked on every claim after each write.
  const inner = db.claim.updateMany.getMockImplementation()!
  db.claim.updateMany.mockImplementation(async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    const out = await inner(args)
    for (const c of w.claims) {
      if (c.status === 'approved' && c.refundAttempted === false && c.refundError === null && out.count === 1 && c.id === args.where.id) violations.push(`${stateId}/${pre}: ${c.id} left approved-unpaid with no error`)
      if (typeof c.refundError === 'string' && c.refundError.startsWith(MARKERS.PROOF_PAYABLE_V13) && !c.refundError.includes('payable au plus tôt le ')) violations.push(`${stateId}/${pre}: v13 without instant`)
    }
    return out
  })
  db.refund.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    refundCreates.push(inAdoption)
    const row = { id: 'rf_mirror', createdAt: new Date(), ...data }
    w.refunds.push(row)
    return { ...row }
  })
  for (const m of [stripeMock.refunds.create, stripeMock.refunds.update, stripeMock.refunds.cancel, stripeMock.transfers.createReversal]) {
    m.mockImplementation(async () => { throw new Error('Stripe write attempted') })
  }
  for (const m of [db.refund.update, db.refund.updateMany]) m.mockImplementation(async () => { throw new Error('Refund update attempted') })
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const m of [...Object.values(engine), auditMock, adminMock, db.refund.update, db.refund.updateMany]) m.mockReset()
  engine.isRefundsEnabled.mockReturnValue(true)
  engine.executeRefund.mockResolvedValue(engineOk())
  adminMock.mockResolvedValue({ id: 'op1', role: 'admin', name: 'Admin', email: 'a@x.test' })
  auditMock.mockResolvedValue(true)
  refundCreates.length = 0
  violations.length = 0
  inAdoption = false
})

function expectNoMoney(label: string) {
  expect(engine.executeRefund, label).not.toHaveBeenCalled()
  expect(engine.markRefundRowFailed, label).not.toHaveBeenCalled()
  expect(engine.finalizeRefundRowFromStripe, label).not.toHaveBeenCalled()
  for (const m of [stripeMock.refunds.create, stripeMock.refunds.update, stripeMock.refunds.cancel, stripeMock.transfers.createReversal]) expect(m, label).not.toHaveBeenCalled()
  expect(db.refund.update, label).not.toHaveBeenCalled()
  expect(db.refund.updateMany, label).not.toHaveBeenCalled()
  expect(refundCreates.every((adoption) => adoption), `${label}: a Refund row created outside adoption`).toBe(true)
  for (const [a] of auditMock.mock.calls as Array<[{ action: string; metadata?: { moneyMoved?: unknown } }]>) {
    expect(a.metadata?.moneyMoved, `${label}: audit ${a.action}`).toBe(false)
  }
  expect(violations, label).toEqual([])
}

describe('J-M49 — reconcile (route), on every G state class and pre-image, creates no money authority', () => {
  for (const id of CLASSES) {
    it(id, async () => {
      for (const pre of Object.keys(PRE_IMAGES)) {
        setWorld(id, pre)
        const res = await RECONCILE(new Request('https://app.grubano.com/x', { method: 'POST' }), { params: { id: 'cl1' } })
        expect([200, 409], `${id}/${pre}`).toContain(res.status)
        expectNoMoney(`${id}/${pre}`)
      }
    })
  }
})

describe('J-M49 — attribution, adoption, the declaration close and the recovery sweep create no money authority', () => {
  for (const id of CLASSES) {
    it(id, async () => {
      // attribution of every row of the order to an FV claim
      setWorld(id, 'fv')
      for (const r of [...w.refunds]) await attributeClaimRefund({ claimId: 'cl1', refundRowId: r.id, adminId: 'op1' })
      expectNoMoney(`${id} attribute`)
      // adoption of every Stripe refund of the payment, plus a Dashboard-style id the route format accepts
      setWorld(id, 'fv')
      w.stripeRefunds.push({ id: 're_dash12345678', status: 'succeeded', amount: 100, charge: 'ch_1', payment_intent: 'pi_1', metadata: {} })
      inAdoption = true
      for (const s of [...w.stripeRefunds]) await adoptStripeRefundForClaim({ claimId: 'cl1', stripeRefundId: s.id, adminId: 'op1' })
      inAdoption = false
      expectNoMoney(`${id} adopt`)
      // the declaration close, both resolutions, on a lock and on a recorded failure
      for (const pre of ['lock', 'failed']) {
        for (const resolution of ['settled_out_of_band', 'closed_no_payment'] as const) {
          setWorld(id, pre)
          await resolveStuckClaim({ claimId: 'cl1', adminId: 'op1', resolution })
          expectNoMoney(`${id} resolve ${pre} ${resolution}`)
        }
      }
      // the cron recovery sweep over a bound claim
      setWorld(id, 'bound')
      await recoverStrandedClaimReconciliations()
      expectNoMoney(`${id} recovery`)
    })
  }

  // ROUND 13 (G14, slice W5): supersedes the W3 absence pin — markClaimsForRevertedRefundRow (G11) and the AMF-1
  // re-verification landed and join the run. The closure-notice route (H) still belongs to the email slice.
  for (const id of CLASSES) {
    it(`${id} — markClaimsForRevertedRefundRow on every row with every evidence kind, and the settled re-verification`, async () => {
      for (const pre of ['refunded', 'bound']) {
        setWorld(id, pre)
        for (const r of [...w.refunds]) {
          const refund = { id: String(r.stripeRefundId ?? 're_none'), status: 'failed', amount: 100, payment_intent: 'pi_1', metadata: { grubano_refund_row: String(r.id) } } as never
          await markClaimsForRevertedRefundRow({ rowId: String(r.id), evidence: { kind: 'failed_row' } })
          await markClaimsForRevertedRefundRow({ rowId: String(r.id), evidence: { kind: 'stripe_object', refund } })
          await markClaimsForRevertedRefundRow({ rowId: String(r.id), evidence: { kind: 'pending_row_stripe', refund } })
        }
        expectNoMoney(`${id} mark ${pre}`)
        setWorld(id, pre)
        await reverifySettledClaimRefunds()
        expectNoMoney(`${id} reverify ${pre}`)
      }
    })
  }

  // ROUND 13 (slice W6): the closure-notice route (H08) landed and joins the run — supersedes the W5 absence pin. It reads
  // Stripe only through reconcileClaimEvidence (R0) and sends through the closure sender; neither may reach money.
  for (const id of CLASSES) {
    it(`${id} — POST closure-notice on every pre-image creates no money authority`, async () => {
      expect(readFileSync('lib/claims.ts', 'utf8')).toContain('export async function markClaimsForRevertedRefundRow(')
      for (const pre of Object.keys(PRE_IMAGES)) {
        setWorld(id, pre)
        const res = await CLOSURE_NOTICE(new Request('https://app.grubano.com/x', { method: 'POST' }), { params: { id: 'cl1' } })
        expect([200, 409], `${id}/${pre}`).toContain(res.status)
        expectNoMoney(`closure-notice ${id}/${pre}`)
      }
    })
  }
})

// ══ the static call graph of reconcileClaimEvidence ════════════════════════════════════════════════════════
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
function engineReach(src: string): string[] {
  const bodies = new Map<string, string>()
  for (const m of Array.from(src.matchAll(/^(?:export )?(?:async )?function (\w+)\s*[(<]/gm))) {
    const at = m.index ?? 0
    bodies.set(m[1], src.slice(at, src.indexOf('\n}\n', at)))
  }
  const seen = new Set<string>(['reconcileClaimEvidence'])
  const queue = ['reconcileClaimEvidence']
  while (queue.length) {
    const body = bodies.get(queue.shift()!) ?? ''
    for (const name of Array.from(bodies.keys())) {
      if (!seen.has(name) && new RegExp(`\\b${name}\\(`).test(body)) { seen.add(name); queue.push(name) }
    }
  }
  const FORBIDDEN = /\b(executeRefund|driveRefund|finalizeRefund|markRefundRowFailed|finalizeRefundRowFromStripe|triggerClaimRefund)\(|refunds\.create\(|createReversal\(/
  return Array.from(seen).filter((n) => FORBIDDEN.test(bodies.get(n) ?? '')).map((n) => `${n}: ${(bodies.get(n) ?? '').match(FORBIDDEN)![0]}`)
}

describe('J-M49 — the call graph of reconcileClaimEvidence reaches none of the engine functions', () => {
  const src = stripComments(readFileSync('lib/claims.ts', 'utf8').replace(/\r\n/g, '\n'))
  it('the shipped source', () => {
    expect(src).toContain('export async function reconcileClaimEvidence(')
    expect(engineReach(src)).toEqual([])
  })

  it('NEGATIVE CONTROL — an engine call injected into a function reconcile reaches is found', () => {
    const injected = src.replace('async function reconcileNoRowByDerivation(', 'async function reconcileNoRowByDerivation(_x = executeRefund({ orderId: "o" }), ')
    expect(injected).not.toBe(src)
    expect(engineReach(injected)).toEqual(['reconcileNoRowByDerivation: executeRefund('])
  })

  it('NEGATIVE CONTROL — the spy works: the DIRECT triggerClaimRefund on an A-S01 payable proof past its instant is the ONE path that reaches executeRefund (the L5 rail’s entry point); the approval before it reaches nothing (D′ L2)', async () => {
    // W3 round-1 fix, re-scoped by D′ L2 (spec v2 S-02, R13 v1.1 E-10): arbitrateClaim — the function POST
    // /api/admin/claims/[id]/arbitrate calls — is a DECISION only. It is still driven here so the D14 / C4 refusal and the
    // decision CAS stay part of the proof, but the engine is reached only by the direct triggerClaimRefund that follows (the
    // T1 C4 instant check and the REFUNDS lease live there).
    setWorld('A-S01', 'lock')
    claimOf(w).refundError = `${MARKERS.PROOF_PAYABLE_V13} … Elle est payable au plus tôt le ${new Date(Date.now() + 3_600_000).toISOString()} (UTC).`
    // before its instant the same approval is refused (C4) and reaches nothing — and so does the direct rail step (T1 C4)
    expect(await arbitrateClaim({ claimId: 'cl1', adminId: 'op1', decision: 'approve' })).toMatchObject({ ok: false, status: 409 })
    expect(engine.executeRefund).not.toHaveBeenCalled()
    expect(await triggerClaimRefund('cl1')).toEqual({ state: 'already_handled' })
    expect(engine.executeRefund).not.toHaveBeenCalled()
    setWorld('A-S01', 'lock')
    claimOf(w).refundError = `${MARKERS.PROOF_PAYABLE_V13} … Elle est payable au plus tôt le ${new Date(Date.now() - 60_000).toISOString()} (UTC).`
    const leaseReadsBefore = engine.isRefundsEnabled.mock.calls.length // the direct rail step above read it once (T1), the decision never does
    const r = await arbitrateClaim({ claimId: 'cl1', adminId: 'op1', decision: 'approve' })
    expect(r.ok).toBe(true)
    // D′ L2 DIFFERENTIAL: the won decision (a ratification) reaches nothing, carries no refund field, starts no attempt
    expect(r).not.toHaveProperty('refund')
    expect(engine.executeRefund).not.toHaveBeenCalled()
    expect(engine.isRefundsEnabled).toHaveBeenCalledTimes(leaseReadsBefore)
    expect(claimOf(w)).toMatchObject({ status: 'approved', refundAttempted: false, refundId: null })
    expect(String(claimOf(w).refundError).startsWith(MARKERS.PROOF_PAYABLE_V13)).toBe(true)
    // the ONE path: the direct rail step → T1 admits the v13 past its instant → T2 re-derives payable → the engine, once
    expect(await triggerClaimRefund('cl1')).toMatchObject({ state: 'refunded', refundId: 'rf_new' })
    expect(engine.executeRefund).toHaveBeenCalledTimes(1)
    expect(engine.executeRefund.mock.calls[0][0]).toMatchObject({ reason: 'claim:cl1', amountCents: 500 })
  })
})
