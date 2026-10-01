// tests/claims-r13-cas.test.ts — T-49 round 13, slice W2: J-M17 (C1) and J-M26 (C9).
//
// Every claim write on a money path is a compare-and-set on what its decision read (status and refundError
// always; refundId / refundAttempted when read). A lost write writes nothing more, sends nothing and returns
// its changed outcome. markClaimsForRevertedRefundRow (G11) and the D11 declarations land with their slices.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { payableWorld, wireWorld, refundRow, stripeRefund, claimOf, engineOk, HOURS, type World } from './support/claims-world'

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

import { triggerClaimRefund, reconcileClaimEvidence, reconcileClaimForRefund, enterFinancialVerification, resolveStuckClaim } from '@/lib/claims'
import { MARKERS, HEAD_A } from '@/lib/claim-action-rules'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

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

// ══ J-M17 — the source scan ═══════════════════════════════════════════════════════════════════════
const C1_FUNCTIONS = [
  'triggerClaimRefund', 'reconcileClaimEvidence', 'applyRowTruth', 'reconcileBoundClaim', 'enterFinancialVerification', 'attributeClaimRefund',
  'adoptStripeRefundInner', 'reconcileClaimForRefund', 'resolveStuckClaim', 'runClaimAutoApproval', 'reconcileNoRowByDerivation',
  // ROUND 13 (C1 / C6, slice W4): the attribution transaction's CAS (tx.claim.updateMany) is scanned too.
  'attributeWithEvidence',
]
/** C1: refundId / refundAttempted are in the where « whenever the decision read them » — per function. */
const MUST_ALSO: Record<string, string[]> = {
  applyRowTruth: ['refundId'],
  reconcileNoRowByDerivation: ['refundAttempted', 'refundId'],
}
/** The body of a top-level function of lib/claims.ts (comments stripped). */
function bodyOf(src: string, name: string): string {
  const m = new RegExp(`\\n(?:export )?async function ${name}\\(`).exec(src)
  if (!m) return ''
  const end = src.indexOf('\n}\n', m.index + 1)
  return src.slice(m.index, end < 0 ? undefined : end)
}
/** Every prisma.claim.updateMany where clause of a body, resolved through `where: <identifier>` and t4Write. */
function whereClauses(body: string): string[] {
  const out: string[] = []
  const re = /prisma\.claim\.updateMany\(\{\s*where:\s*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body))) {
    const at = m.index + m[0].length
    /** balanced: a where may nest an operator object (status: { in: [...] }) or span several lines */
    const objectAt = (from: number) => {
      let depth = 0
      let j = from
      for (; j < body.length; j++) {
        if (body[j] === '{') depth++
        else if (body[j] === '}') { depth--; if (depth === 0) break }
      }
      return body.slice(from, j + 1)
    }
    if (body[at] === '{') {
      out.push(objectAt(at))
    } else {
      const id = /^[A-Za-z_]\w*/.exec(body.slice(at))?.[0] ?? ''
      const def = new RegExp(`const ${id} = \\{`).exec(body)
      out.push(def ? objectAt(def.index + def[0].length - 1) : `UNRESOLVED ${id}`)
    }
  }
  return out
}
function c1Violations(src: string): string[] {
  const v: string[] = []
  for (const name of C1_FUNCTIONS) {
    const body = bodyOf(src, name)
    if (!body) { v.push(`${name}: not found`); continue }
    if (body.includes('prisma.claim.update(')) v.push(`${name}: prisma.claim.update(`)
    for (const where of whereClauses(body)) {
      if (!/\bstatus\b/.test(where) || !/\brefundError\b/.test(where)) v.push(`${name}: ${where.replace(/\s+/g, ' ').slice(0, 90)}`)
      for (const key of MUST_ALSO[name] ?? []) {
        if (!new RegExp(`\\b${key}\\b`).test(where)) v.push(`${name} (${key}): ${where.replace(/\s+/g, ' ').slice(0, 90)}`)
      }
    }
    if (name === 'triggerClaimRefund') {
      // T1 and T2 read refundAttempted (C2 step 1): every write BEFORE the engine carries it; T4 (C5) does not.
      const beforeEngine = body.slice(0, body.indexOf('executeRefund('))
      for (const where of whereClauses(beforeEngine)) {
        if (!/\brefundAttempted\b/.test(where)) v.push(`triggerClaimRefund T1/T2 (refundAttempted): ${where.replace(/\s+/g, ' ').slice(0, 90)}`)
      }
    }
  }
  return v
}

describe('J-M17 — CAS discipline (C1): the source scan', () => {
  it('no prisma.claim.update( in the money-path functions, and every updateMany where carries status and refundError', () => {
    const src = stripComments(read('lib/claims.ts'))
    expect(c1Violations(src)).toEqual([])
    // the scan saw the writes it is about
    expect(whereClauses(bodyOf(src, 'triggerClaimRefund')).length).toBeGreaterThanOrEqual(5)
    expect(whereClauses(bodyOf(src, 'applyRowTruth')).length).toBeGreaterThanOrEqual(5)
  })

  it('NEGATIVE CONTROL — one applyRowTruth write replaced by update({ where: { id } }), or a where without refundError, is red', () => {
    const src = stripComments(read('lib/claims.ts'))
    const a = src.replace('const done = await prisma.claim.updateMany({\n        where: preImage,', 'const done = await prisma.claim.update({\n        where: { id: claim.id },')
    expect(a).not.toBe(src)
    expect(c1Violations(a).some((x) => x.startsWith('applyRowTruth: prisma.claim.update('))).toBe(true)
    const b = src.replace("where: { id: claim.id, status: claim.status, refundError: claim.refundError },", "where: { id: claim.id, status: claim.status },")
    expect(b).not.toBe(src)
    expect(c1Violations(b).length).toBeGreaterThan(0)
    // the per-function keys: applyRowTruth without refundId, a T2 write without refundAttempted
    const c = src.replace('id: claim.id, status: claim.status, refundId: claim.refundId,', 'id: claim.id, status: claim.status,')
    expect(c).not.toBe(src)
    expect(c1Violations(c).some((x) => x.startsWith('applyRowTruth (refundId)'))).toBe(true)
    const d = src.replace("where: { id: claimId, status: 'refunding', refundAttempted: true, refundError: M },", "where: { id: claimId, status: 'refunding', refundError: M },")
    expect(d).not.toBe(src)
    expect(c1Violations(d).some((x) => x.startsWith('triggerClaimRefund T1/T2 (refundAttempted)'))).toBe(true)
  })
})

describe('J-M17 — two concurrent writers, one write', () => {
  it('an approval race: one T1 CAS wins, the loser is already_handled, executeRefund once, the loser sends nothing', async () => {
    const [a, b] = await Promise.all([triggerClaimRefund('cl1'), triggerClaimRefund('cl1')])
    expect([a, b].filter((r) => r.state === 'already_handled')).toHaveLength(1)
    expect(execMock).toHaveBeenCalledTimes(1)
    expect(w.writes.filter((x) => x.data.status === 'refunding').map((x) => x.count).sort()).toEqual([0, 1])
    expect(alertMock).not.toHaveBeenCalled()
  })

  it('a reconcile race on one approved proof: exactly one write matches; the loser writes nothing and reports no proof', async () => {
    const proof = `${MARKERS.PROOF_PAYABLE_V13} ${HEAD_A} … Elle est payable au plus tôt le ${new Date(Date.now() - 1000).toISOString()} (UTC).`
    setWorld(payableWorld({ refundError: proof }))
    const [a, b] = await Promise.all([reconcileClaimEvidence({ claimId: 'cl1' }), reconcileClaimEvidence({ claimId: 'cl1' })])
    expect(w.writes.map((x) => x.count).sort()).toEqual([0, 1])
    const outcomes = [a, b].map((r) => (r.ok ? r.outcome : `error:${r.status}`))
    // C1: the loser answers changed_during_read; the winner's N8 write (D4) reports its proof.
    expect(outcomes.sort()).toEqual(['changed_during_read', 'no_refund_proven'])
    // one write, one ALERT-B (the winner's), no audit and no proof outcome for the loser
    expect(alertMock.mock.calls.map((c) => c[0].dedupeKey)).toEqual(['claim_blocked:cl1:no_refund_proven:v13:'])
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('a reconcile race that reaches applyRowTruth (an own stamped row): one bind, one settle; the loser writes nothing more and says changed_during_read', async () => {
    const x = payableWorld({ status: 'financial_verification', refundAttempted: true, refundError: 'financial_verification:refund_moved_unattributed: x' })
    x.refunds.push(refundRow('rf_own', { reason: 'claim:cl1', stripeRefundId: 're_own' }))
    // ROUND 13 (G2 (3) / G4, W3): the own stamped row settles only on its Stripe refund object.
    x.stripeRefunds.push(stripeRefund('re_own'))
    setWorld(x)
    const [a, b] = await Promise.all([reconcileClaimEvidence({ claimId: 'cl1' }), reconcileClaimEvidence({ claimId: 'cl1' })])
    const outcomes = [a, b].map((r) => (r.ok ? r.outcome : `error:${r.status}`)).sort()
    expect(outcomes).toEqual(['changed_during_read', 'refunded'])
    const binds = w.writes.filter((wr) => wr.data.refundId === 'rf_own' && wr.count === 1)
    expect(binds).toHaveLength(1)
    expect(w.writes.filter((wr) => wr.data.status === 'refunded' && wr.count === 1)).toHaveLength(1)
    expect(claimOf(w)).toMatchObject({ status: 'refunded', refundId: 'rf_own', refundError: null })
    expect(alertMock).not.toHaveBeenCalled()
  })
})

// ══ J-M26 — pre-images (C9) ═══════════════════════════════════════════════════════════════════════
describe('J-M26 — a refundError changed between the decision read and the write → 0 writes, the changed outcome, no alert', () => {
  const CHANGED = 'financial_verification:stripe_unreadable: écrit entre-temps par une autre requête'
  const FV_CLAIM = { status: 'financial_verification', refundAttempted: true, refundError: 'financial_verification:refund_moved_unattributed: x' }

  const APPLY: Array<[string, (x: World) => void]> = [
    // ROUND 13 (G2 (3) / G4, W3): the own stamped succeeded row is re-read at Stripe before its bind.
    ['bind (row terminal)', (x) => { x.refunds.push(refundRow('rf_own', { reason: 'claim:cl1', stripeRefundId: 're_own' })); x.stripeRefunds.push(stripeRefund('re_own')) }],
    ['at_stripe succeeded', (x) => { x.refunds.push(refundRow('rf_own', { reason: 'claim:cl1', status: 'pending', stripeRefundId: 're_own' })); x.stripeRefunds.push(stripeRefund('re_own')) }],
    ['at_stripe failed', (x) => { x.refunds.push(refundRow('rf_own', { reason: 'claim:cl1', status: 'pending', stripeRefundId: 're_own' })); x.stripeRefunds.push(stripeRefund('re_own', { status: 'failed' })) }],
    ['pending at Stripe', (x) => { x.refunds.push(refundRow('rf_own', { reason: 'claim:cl1', status: 'pending', stripeRefundId: 're_own' })); x.stripeRefunds.push(stripeRefund('re_own', { status: 'pending' })) }],
    ['absent_dead', (x) => { x.refunds.push(refundRow('rf_own', { reason: 'claim:cl1', status: 'pending', createdAt: new Date(Date.now() - 30 * HOURS) })) }],
  ]
  for (const [name, mutate] of APPLY) {
    it(`applyRowTruth ${name}`, async () => {
      const x = payableWorld(FV_CLAIM)
      mutate(x)
      setWorld(x)
      w.beforeClaimWrite = (n) => { if (n === 1) claimOf(w).refundError = CHANGED }
      const r = await reconcileClaimEvidence({ claimId: 'cl1' })
      expect(w.writes[0].where).toMatchObject({ id: 'cl1', status: 'financial_verification', refundError: FV_CLAIM.refundError, refundId: null })
      expect(w.writes.map((wr) => wr.count)).toEqual([0])
      // C1: a lost apply CAS answers changed_during_read (was financial_verification / already_parked_or_moved).
      expect(r).toEqual({ ok: true, outcome: 'changed_during_read' })
      expect(claimOf(w).refundError).toBe(CHANGED)
      expect(alertMock).not.toHaveBeenCalled()
    })
  }

  it('NEGATIVE CONTROL — unchanged refundError: the bind matches (count 1) and the row truth applies', async () => {
    const x = payableWorld(FV_CLAIM)
    APPLY[0][1](x)
    setWorld(x)
    x.claims[0].refundId = null
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(w.writes[0].count).toBe(1)
    expect(r).toMatchObject({ ok: true, outcome: 'refunded', refundId: 'rf_own' })
  })

  it('reconcileClaimForRefund, both CASes carry the refundError read', async () => {
    for (const status of ['succeeded', 'failed'] as const) {
      const x = payableWorld({ status: 'refunding', refundId: 'rf1', refundError: null })
      x.refunds.push(refundRow('rf1', { status, stripeRefundId: 're_1' }))
      setWorld(x)
      w.beforeClaimWrite = (n) => { if (n === 1) claimOf(w).refundError = CHANGED }
      const r = await reconcileClaimForRefund({ refundRowId: 'rf1', status, stripeRefundId: 're_1' })
      expect(w.writes[0].where, status).toEqual({ id: 'cl1', refundId: 'rf1', status: { in: ['refunding', 'approved'] }, refundError: null })
      expect(r, status).toEqual({ reconciled: false, reason: 'already_final' })
      expect(claimOf(w).refundError).toBe(CHANGED)
    }
  })

  it('enterFinancialVerification: entry only from approved or refunding, relabel only from FV, each a CAS on expect', async () => {
    setWorld(payableWorld({ status: 'refunding', refundError: 'reconcile_required: x' }))
    expect(await enterFinancialVerification({ claimId: 'cl1', reason: 'stripe_unreadable', detail: 'd', expect: { status: 'refunding', refundError: 'reconcile_required: OTHER' } })).toEqual({ entered: false })
    expect(w.writes.map((x) => x.count)).toEqual([0])
    expect(await enterFinancialVerification({ claimId: 'cl1', reason: 'stripe_unreadable', detail: 'd', expect: { status: 'refunded', refundError: null } })).toEqual({ entered: false })
    expect(w.writes).toHaveLength(1)
    expect(alertMock).not.toHaveBeenCalled()
    expect(await enterFinancialVerification({ claimId: 'cl1', reason: 'stripe_unreadable', detail: 'd', expect: { status: 'refunding', refundError: 'reconcile_required: x' } })).toEqual({ entered: true })
    expect(alertMock.mock.calls.map((c) => c[0].dedupeKey)).toEqual(['claim_fv:cl1:stripe_unreadable'])
  })

  it('I-02 relabel: a NEW reason alerts claim_fv:<id>:<reason>; the same reason sends nothing; a lost relabel sends nothing', async () => {
    const pre = 'financial_verification:stripe_unreadable: d'
    setWorld(payableWorld({ status: 'financial_verification', refundError: pre }))
    expect(await enterFinancialVerification({ claimId: 'cl1', reason: 'stripe_unreadable', detail: 'd2', expect: { status: 'financial_verification', refundError: pre } })).toEqual({ entered: false, relabelled: true })
    expect(alertMock).not.toHaveBeenCalled()
    const now = String(claimOf(w).refundError)
    expect(await enterFinancialVerification({ claimId: 'cl1', reason: 'refund_moved_unattributed', detail: 'd3', expect: { status: 'financial_verification', refundError: pre } })).toEqual({ entered: false })
    expect(alertMock).not.toHaveBeenCalled()
    expect(await enterFinancialVerification({ claimId: 'cl1', reason: 'refund_moved_unattributed', detail: 'd3', expect: { status: 'financial_verification', refundError: now } })).toEqual({ entered: false, relabelled: true })
    expect(alertMock.mock.calls.map((c) => c[0].dedupeKey)).toEqual(['claim_fv:cl1:refund_moved_unattributed'])
  })

  it('resolveStuckClaim: the CAS is on the refundError read, never { not: null }', async () => {
    setWorld(payableWorld({ status: 'approved', refundAttempted: true, refundError: 'stripe_failed: …' }))
    w.beforeClaimWrite = (n) => { if (n === 1) claimOf(w).refundError = 'engine_failed: écrit entre-temps' }
    const r = await resolveStuckClaim({ claimId: 'cl1', adminId: 'admin1', resolution: 'closed_no_payment' })
    expect(w.writes[0].where).toEqual({ id: 'cl1', status: 'approved', refundError: 'stripe_failed: …' })
    // D11 (slice W5 fixer): the count-0 text of the declaration exit.
    expect(r).toEqual({ ok: false, status: 409, error: 'Cette réclamation a changé d’état entre-temps — rien n’a été écrit. Relisez sa ligne dans la file.' })
    expect(claimOf(w).status).toBe('approved')
    // NEGATIVE CONTROL: unchanged → closes.
    setWorld(payableWorld({ status: 'approved', refundAttempted: true, refundError: 'stripe_failed: …' }))
    expect(await resolveStuckClaim({ claimId: 'cl1', adminId: 'admin1', resolution: 'closed_no_payment' })).toMatchObject({ ok: true })
    expect(claimOf(w).status).toBe('refused_final')
  })

  it('the N8-era proof write of the reconcile ladder is a CAS on the claim as read', async () => {
    const proof = `${MARKERS.PROOF_PAYABLE_V13} ${HEAD_A} … Elle est payable au plus tôt le ${new Date(Date.now() - 1000).toISOString()} (UTC).`
    setWorld(payableWorld({ refundError: proof }))
    w.beforeClaimWrite = (n) => { if (n === 1) claimOf(w).refundError = CHANGED }
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'changed_during_read' })
    expect(w.writes.map((x) => x.count)).toEqual([0])
    expect(w.writes[0].where).toMatchObject({ status: 'approved', refundError: proof, refundAttempted: false, refundId: null })
    expect(alertMock).not.toHaveBeenCalled()
  })

  it('applyRowTruth: a bind that matched, then a lost park → changed_during_read naming the bound row (this action wrote only the bind)', async () => {
    // A mine row whose reconcile cannot be applied (our row succeeded, but the claim changes after the bind).
    const x = payableWorld(FV_CLAIM)
    x.refunds.push(refundRow('rf_own', { reason: 'claim:cl1', stripeRefundId: 're_own' }))
    x.stripeRefunds.push(stripeRefund('re_own')) // ROUND 13 (G2 (3) / G4, W3): read at Stripe on the mine path
    setWorld(x)
    w.beforeClaimWrite = (n) => { if (n === 2) claimOf(w).refundError = CHANGED }
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(w.writes.map((wr) => wr.count)).toEqual([1, 0, 0])
    expect(r).toEqual({ ok: true, outcome: 'changed_during_read', boundRowId: 'rf_own' })
    expect(alertMock).not.toHaveBeenCalled()
  })
})

// ══ J-M17 / J-M26 — the LAST park of reconcileClaimEvidence (refund_moved_unattributed), W2 round-2 fix ════════════
// C1: « count !== 1 → … no success outcome … reconcile/apply: changed_during_read (replaces 'already_parked_or_moved') ».
// Round 1 converted every park but this one: a claim moved on while the park ran was answered
// financial_verification / already_parked_or_moved, so the console showed « aucune clôture » for a closed claim and
// the route audited a decision that wrote nothing.
// BREAK/RESTORE: put back `return { ok: true, outcome: 'financial_verification', reason: 'already_parked_or_moved' as
// AmbiguityReason, detail }` at the end of reconcileClaimEvidence → the lost-park fixtures and the source pin go red.
describe('J-M17 / J-M26 — the refund_moved_unattributed park: a lost CAS is changed_during_read, never a financial_verification outcome', () => {
  const FV_UNREADABLE = { status: 'financial_verification', refundAttempted: true, refundError: 'financial_verification:stripe_unreadable: x' }
  /** Money moved on the order (Stripe: 500 c refunded, by a Dashboard refund), and no Refund row is ours: the last park. */
  const movedUnattributed = (claim: Record<string, unknown> = FV_UNREADABLE): World => {
    const x = payableWorld(claim)
    x.pis.pi_1.latest_charge.amount_refunded = 500
    x.stripeRefunds.push(stripeRefund('re_dash', { amount: 500 }))
    return x
  }

  it('the claim moved to refunded while the park ran: 0 writes, changed_during_read, no alert, the refunded claim untouched', async () => {
    setWorld(movedUnattributed())
    w.beforeClaimWrite = (n) => { if (n === 1) Object.assign(claimOf(w), { status: 'refunded', refundId: 'rf_x', refundError: null }) }
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(w.writes.map((x) => x.count)).toEqual([0])
    expect(w.writes[0].where).toMatchObject({ id: 'cl1', status: 'financial_verification', refundError: FV_UNREADABLE.refundError })
    expect(r).toEqual({ ok: true, outcome: 'changed_during_read' })
    expect(claimOf(w)).toMatchObject({ status: 'refunded', refundId: 'rf_x', refundError: null })
    expect(alertMock).not.toHaveBeenCalled()
  })

  it('only the refundError changed (a concurrent relabel): 0 writes, changed_during_read, no alert', async () => {
    setWorld(movedUnattributed())
    w.beforeClaimWrite = (n) => { if (n === 1) claimOf(w).refundError = CHANGED_ELSEWHERE }
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(w.writes.map((x) => x.count)).toEqual([0])
    expect(r).toEqual({ ok: true, outcome: 'changed_during_read' })
    expect(claimOf(w).refundError).toBe(CHANGED_ELSEWHERE)
    expect(alertMock).not.toHaveBeenCalled()
  })

  it('an entry park (refunding, crash marker) lost to a concurrent close: 0 writes, changed_during_read, no alert', async () => {
    setWorld(movedUnattributed({ status: 'refunding', refundAttempted: true, refundError: 'reconcile_required: tentative de remboursement démarrée à 2026-09-01T10:00:00.000Z' }))
    w.beforeClaimWrite = (n) => { if (n === 1) Object.assign(claimOf(w), { status: 'refused_final' }) }
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(w.writes.map((x) => x.count)).toEqual([0])
    expect(r).toEqual({ ok: true, outcome: 'changed_during_read' })
    expect(claimOf(w).status).toBe('refused_final')
    expect(alertMock).not.toHaveBeenCalled()
  })

  it('two concurrent reconciles reach this park: one relabel, one alert; the loser says changed_during_read', async () => {
    setWorld(movedUnattributed())
    const [a, b] = await Promise.all([reconcileClaimEvidence({ claimId: 'cl1' }), reconcileClaimEvidence({ claimId: 'cl1' })])
    expect(w.writes.map((x) => x.count).sort()).toEqual([0, 1])
    expect([a, b].map((r) => (r.ok ? r.outcome : `error:${r.status}`)).sort()).toEqual(['changed_during_read', 'financial_verification'])
    expect(alertMock.mock.calls.map((c) => c[0].dedupeKey)).toEqual(['claim_fv:cl1:refund_moved_unattributed'])
  })

  it('NEGATIVE CONTROL — nothing changed: the park writes (count 1) and reports refund_moved_unattributed with one alert', async () => {
    setWorld(movedUnattributed())
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(w.writes.map((x) => x.count)).toEqual([1])
    expect(r).toMatchObject({ ok: true, outcome: 'financial_verification', reason: 'refund_moved_unattributed' })
    expect(String(claimOf(w).refundError)).toContain('financial_verification:refund_moved_unattributed')
    expect(alertMock.mock.calls.map((c) => c[0].dedupeKey)).toEqual(['claim_fv:cl1:refund_moved_unattributed'])
  })

  /** Every lost park (`!parked.entered && !parked.relabelled`) of lib/claims.ts returns changed_during_read, and the old reason is gone. */
  function lostParkViolations(src: string): string[] {
    const v: string[] = []
    const re = /if \(!parked\.entered && !parked\.relabelled\)\s*(?:\{\s*)?return ([^\n]*)/g
    let m: RegExpExecArray | null
    let n = 0
    while ((m = re.exec(src))) {
      n++
      const ret = m[1].trim()
      if (ret !== "{ ok: true, outcome: 'changed_during_read' }" && !/^changed\((?:row\.id)?\)$/.test(ret)) v.push(ret)
    }
    // ROUND 13 (G2, W3): the round-12 ladder's stripe_unreadable and last parks are deleted; 7 parks remain.
    if (n < 7) v.push(`only ${n} lost-park branches found`)
    if (src.includes('already_parked_or_moved')) v.push('already_parked_or_moved still present')
    return v
  }
  it('source pin — every lost park answers changed_during_read; « already_parked_or_moved » exists nowhere in lib/claims.ts', () => {
    const src = stripComments(read('lib/claims.ts'))
    expect(lostParkViolations(src)).toEqual([])
    // NEGATIVE CONTROL: the round-1 leftover, put back at a reconcile park (G2 (3) mine > 1), is caught.
    const reverted = src.replace(
      "    if (!parked.entered && !parked.relabelled) return { ok: true, outcome: 'changed_during_read' }\n    return { ok: true, outcome: 'financial_verification', reason: 'multiple_candidate_refunds', detail }",
      "    if (!parked.entered && !parked.relabelled) return { ok: true, outcome: 'financial_verification', reason: 'already_parked_or_moved' as AmbiguityReason, detail }\n    return { ok: true, outcome: 'financial_verification', reason: 'multiple_candidate_refunds', detail }",
    )
    expect(reverted).not.toBe(src)
    expect(lostParkViolations(reverted).length).toBeGreaterThan(0)
  })
})
const CHANGED_ELSEWHERE = 'financial_verification:stripe_unreadable: écrit entre-temps par une autre requête'

// C9 (c): `expect` is REQUIRED — this line must stay a compile error (tsc fails on an unused @ts-expect-error).
export const enterFinancialVerificationWithoutExpect = () =>
  // @ts-expect-error — C9 (c): a park without the pre-image it read does not compile
  enterFinancialVerification({ claimId: 'cl1', reason: 'stripe_unreadable', detail: 'd' })
