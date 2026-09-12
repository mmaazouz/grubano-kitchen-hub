// tests/claims-r13-rowtruth.test.ts — T-49 round 13, slice W2: J-M44 (G4 refundRowTruth).
//
// A succeeded row's refund is re-read: succeeded, reverted (failed / canceled), or a contradiction. Absence
// is EVIDENCE (not_on_payment) only for the one caller whose Stripe list is complete — loadOrderMoneyFacts.
// A failed row is read from our base only. Every other failure to read is 'unreadable', never a conclusion.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { payableWorld, wireWorld, stripeRefund, type World } from './support/claims-world'

const { db } = vi.hoisted(() => ({
  db: {
    claim:  { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    refund: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    order:  { findUnique: vi.fn() },
    franchiseRoyalty: { findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/refund', () => ({ executeRefund: vi.fn(), isRefundsEnabled: vi.fn(), RESUME_CREATE_WINDOW_MS: 20 * 60 * 60 * 1000 }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: vi.fn() }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: vi.fn() }))
const { stripeMock } = vi.hoisted(() => ({
  stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() } },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

import { refundRowTruth, attributeClaimRefund, reconcileClaimEvidence } from '@/lib/claims'
import { sendAdminMoneyReviewAlert } from '@/lib/admin-alerts'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
let w: World
beforeEach(() => {
  vi.clearAllMocks()
  w = payableWorld()
  wireWorld(w, db, stripeMock)
})
const row = (o: Record<string, unknown> = {}) => ({ id: 'rf', status: 'succeeded', stripeRefundId: 're_X', createdAt: new Date(Date.now() - 3_600_000), ...o })
const EV = { absenceIsEvidence: true }
const kindOf = (t: { kind: string }) => t.kind

describe('J-M44 — a succeeded row WITH a Stripe id', () => {
  it('404 with absenceIsEvidence and the complete list omitting the id → not_on_payment absent', async () => {
    w.fail.refundRetrieve = { re_X: 'missing' }
    expect(await refundRowTruth(row(), 'o1', {}, 'pi_1', EV)).toEqual({ kind: 'not_on_payment', how: 'absent', refundId: 're_X' })
  })

  it('404 with the flag but the list CONTAINS the id, or without the flag → the exact key/mode contradiction', async () => {
    const text = 'La ligne rf est marquée ABOUTIE et enregistre le remboursement Stripe re_X, que Stripe ne connaît pas avec la clé de ce serveur. Vérifiez que cette clé est celle du compte et du mode (test / live) où il a été créé, puis relancez la réconciliation ; sinon, anomalie de données à instruire. Aucune conclusion tirée.'
    w.fail.refundRetrieve = { re_X: 'missing' }
    w.stripeRefunds.push(stripeRefund('re_X'))
    expect(await refundRowTruth(row(), 'o1', {}, 'pi_1', EV)).toEqual({ kind: 'contradiction', detail: text })
    w.stripeRefunds = []
    expect(await refundRowTruth(row(), 'o1', {}, 'pi_1')).toEqual({ kind: 'contradiction', detail: text })
  })

  it('a refund on another payment: with the flag → not_on_payment other_payment; without → the other-payment contradiction', async () => {
    w.stripeRefunds.push(stripeRefund('re_X', { payment_intent: 'pi_OTHER' }))
    expect(await refundRowTruth(row(), 'o1', {}, 'pi_1', EV)).toEqual({ kind: 'not_on_payment', how: 'other_payment', refundId: 're_X' })
    expect(await refundRowTruth(row(), 'o1', {}, 'pi_1')).toEqual({ kind: 'contradiction', detail: 'Le remboursement Stripe re_X, enregistré comme ABOUTI sur la ligne rf, ne porte pas sur le paiement de cette commande. Anomalie de données à instruire. Aucune conclusion tirée.' })
  })

  it('failed / canceled → reverted {refund}; succeeded → row_terminal succeeded; pending / requires_action → contradiction tagged pendingAtStripe', async () => {
    for (const status of ['failed', 'canceled']) {
      w.stripeRefunds = [stripeRefund('re_X', { status })]
      const t = await refundRowTruth(row(), 'o1', {}, 'pi_1')
      expect(t.kind, status).toBe('reverted')
      expect((t as { refund: { status: string } }).refund.status).toBe(status)
    }
    w.stripeRefunds = [stripeRefund('re_X')]
    expect(kindOf(await refundRowTruth(row(), 'o1', {}, 'pi_1'))).toBe('row_terminal')
    for (const status of ['pending', 'requires_action']) {
      w.stripeRefunds = [stripeRefund('re_X', { status })]
      expect(await refundRowTruth(row(), 'o1', {}, 'pi_1', EV), status).toMatchObject({
        kind: 'contradiction', pendingAtStripe: true,
        detail: `La ligne rf est marquée ABOUTIE dans notre base, mais Stripe rapporte son remboursement re_X « ${status} ». Aucune conclusion tirée.`,
      })
    }
  })

  it('a transient Stripe error (ETIMEDOUT) → unreadable, with or without the flag', async () => {
    w.fail.refundRetrieve = { re_X: 'throw' }
    expect(await refundRowTruth(row(), 'o1', {}, 'pi_1', EV)).toEqual({ kind: 'unreadable' })
    expect(await refundRowTruth(row(), 'o1', {}, 'pi_1')).toEqual({ kind: 'unreadable' })
  })
})

describe('J-M44 — a succeeded row WITHOUT a Stripe id', () => {
  const idless = row({ stripeRefundId: null })
  it('the list unreadable → unreadable', async () => {
    w.fail.refundList = true
    expect(await refundRowTruth(idless, 'o1', {}, 'pi_1', EV)).toEqual({ kind: 'unreadable' })
  })
  it('a refund tagged with the row → the same mapping', async () => {
    w.stripeRefunds = [stripeRefund('re_T', { status: 'failed', metadata: { grubano_refund_row: 'rf' } })]
    expect(kindOf(await refundRowTruth(idless, 'o1', {}, 'pi_1', EV))).toBe('reverted')
  })
  it('not found → not_on_payment absent with the flag, a contradiction without it', async () => {
    expect(await refundRowTruth(idless, 'o1', {}, 'pi_1', EV)).toEqual({ kind: 'not_on_payment', how: 'absent', refundId: null })
    expect(kindOf(await refundRowTruth(idless, 'o1', {}, 'pi_1'))).toBe('contradiction')
  })
})

describe('J-M44 — pending and failed rows', () => {
  it('A-S13a a pending row whose recorded id is unknown to Stripe → contradiction; A-S13b on another payment → contradiction', async () => {
    w.fail.refundRetrieve = { re_X: 'missing' }
    expect(kindOf(await refundRowTruth(row({ status: 'pending' }), 'o1', {}, 'pi_1', EV))).toBe('contradiction')
    w.fail.refundRetrieve = {}
    w.stripeRefunds = [stripeRefund('re_X', { payment_intent: 'pi_OTHER', status: 'pending' })]
    expect(kindOf(await refundRowTruth(row({ status: 'pending' }), 'o1', {}, 'pi_1', EV))).toBe('contradiction')
  })
  it('a failed row → row_terminal failed with 0 Stripe calls', async () => {
    expect(await refundRowTruth(row({ status: 'failed' }), 'o1', {}, 'pi_1', EV)).toEqual({ kind: 'row_terminal', status: 'failed' })
    expect(stripeMock.refunds.retrieve).not.toHaveBeenCalled()
    expect(stripeMock.refunds.list).not.toHaveBeenCalled()
  })
})

describe('J-M44 — only loadOrderMoneyFacts passes absenceIsEvidence', () => {
  const sources = () => {
    const out: Record<string, string> = {}
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = join(dir, n)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.(ts|tsx)$/.test(n)) out[p.replace(/\\/g, '/')] = stripComments(read(p))
      }
    }
    walk('lib'); walk('app')
    return out
  }
  /** A top-level function body of a source, [start, end). */
  const span = (src: string, head: string): [number, number] => {
    const start = src.indexOf(head)
    return start < 0 ? [-1, -1] : [start, src.indexOf('\n}\n', start)]
  }
  /**
   * Every `absenceIsEvidence` TOKEN (any value, a spread, a variable) outside the loader and the two functions that
   * declare the option, and every refundRowTruth call with a 5th argument outside the loader.
   */
  const offenders = (files: Record<string, string>) => Object.entries(files).flatMap(([f, src]) => {
    const hits: string[] = []
    const inside = (i: number, s: [number, number]) => f === 'lib/claims.ts' && s[0] >= 0 && i > s[0] && i < s[1]
    const loader = span(src, 'export async function loadOrderMoneyFacts(')
    const declarers = [span(src, 'export async function refundRowTruth('), span(src, 'async function succeededRowTruth(')]
    let m: RegExpExecArray | null
    const token = /absenceIsEvidence/g
    while ((m = token.exec(src))) if (!inside(m.index, loader) && !declarers.some((d) => inside(m!.index, d))) hits.push(`${f}@${m.index}`)
    const call = /\brefundRowTruth\(/g
    while ((m = call.exec(src))) {
      if (f === 'lib/claims.ts' && src.slice(Math.max(0, m.index - 30), m.index).includes('function ')) continue // the declaration
      let depth = 0
      let commas = 0
      for (let j = m.index + 'refundRowTruth'.length; j < src.length; j++) {
        const ch = src[j]
        if (ch === '(' || ch === '{' || ch === '[') depth++
        else if (ch === ')' || ch === '}' || ch === ']') { depth--; if (depth === 0) break }
        else if (ch === ',' && depth === 1) commas++
      }
      if (commas >= 4 && !inside(m.index, loader)) hits.push(`${f}@${m.index} (5th argument)`)
    }
    return hits
  })
  it('the shipped tree', () => {
    const files = sources()
    expect(offenders(files)).toEqual([])
    const claims = files['lib/claims.ts']
    const loader = claims.slice(claims.indexOf('export async function loadOrderMoneyFacts('))
    expect(loader).toContain('{ absenceIsEvidence: true }')
  })
  it('NEGATIVE CONTROL — the flag passed from attributeClaimRefund (or any other caller) is caught; without the flag a 404 row is a contradiction, never not_on_payment', async () => {
    const files = sources()
    const mutated = { ...files, 'lib/claims.ts': files['lib/claims.ts'].replace('export async function attributeClaimRefund(', 'const x = { absenceIsEvidence: true }\nexport async function attributeClaimRefund(') }
    expect(offenders(mutated)).toHaveLength(1)
    // a variable value, a spread options object, and a 5th argument are caught too
    for (const inject of ['const x = { absenceIsEvidence: flag }', 'const y = refundRowTruth(r, o, c, pi, opts)']) {
      const m2 = { ...files, 'lib/claims.ts': files['lib/claims.ts'].replace('export async function attributeClaimRefund(', `${inject}\nexport async function attributeClaimRefund(`) }
      expect(offenders(m2), inject).toHaveLength(1)
    }
    w.fail.refundRetrieve = { re_X: 'missing' }
    expect(kindOf(await refundRowTruth(row(), 'o1', {}, 'pi_1'))).toBe('contradiction')
  })

  it('NEGATIVE CONTROL through attributeClaimRefund: a row whose Stripe refund is unknown (404) is a contradiction there, never not_on_payment', async () => {
    Object.assign(w.claims[0], { status: 'financial_verification', refundAttempted: true, refundError: 'financial_verification:refund_moved_unattributed: x' })
    w.refunds.push({ id: 'rf_P', orderId: 'o1', status: 'pending', amountCents: 300, stripeRefundId: 're_P', reason: null, idempotencyKey: 'refund:o1:0', createdAt: new Date(Date.now() - 3_600_000), royaltyRefundCents: 0 })
    w.fail.refundRetrieve = { re_P: 'missing' }
    const out = await attributeClaimRefund({ claimId: 'cl1', refundRowId: 'rf_P', adminId: 'admin1' })
    // ROUND 13 (G12, slice W4): attribution reads the evidence BEFORE any write — the contradiction is its NOT PROVEN 409
    // (« ${detail} La réclamation n’a pas été modifiée. »), the claim is untouched, never not_on_payment.
    expect(out).toMatchObject({ ok: false, status: 409 })
    expect((out as { error: string }).error).toContain('que Stripe ne connaît pas avec la clé de ce serveur')
    expect((out as { error: string }).error).toContain('La réclamation n’a pas été modifiée.')
    expect(w.claims[0]).toMatchObject({ status: 'financial_verification', refundError: 'financial_verification:refund_moved_unattributed: x' })
    expect(w.writes).toEqual([])
    expect(JSON.stringify(out)).not.toMatch(/not_on_payment|stripe_unreadable_retry/)
  })
})

// ══ J-M44 (W3 carry-over) — A-S05b-2 unstamped / A-S05c-2b stamped, the second reconcile ══════════════════════
describe('J-M44 — the second reconcile of a contradiction park: unstamped → the no-row lock; stamped → relabel, same reason, no alert', () => {
  const OTHER_PI_TEXT = 'Le remboursement Stripe re_X, enregistré comme ABOUTI sur la ligne rf_x, ne porte pas sur le paiement de cette commande. Anomalie de données à instruire. Aucune conclusion tirée.'
  const FV = { status: 'financial_verification', refundAttempted: true, refundId: 'rf_x', refundError: `financial_verification:stripe_refund_contradiction: ${OTHER_PI_TEXT}` }
  const alerts = () => (sendAdminMoneyReviewAlert as unknown as { mock: { calls: Array<[{ kind: string; dedupeKey: string }]> } }).mock.calls.map((c) => c[0])
  const setup = (reason: string | null, cursorMoved: boolean) => {
    w = payableWorld(FV)
    w.refunds.push({ id: 'rf_x', orderId: 'o1', status: 'succeeded', amountCents: 300, stripeRefundId: 're_X', reason, idempotencyKey: 'refund:o1:0', createdAt: new Date(Date.now() - 3_600_000), royaltyRefundCents: 0 })
    w.stripeRefunds.push(stripeRefund('re_X', { payment_intent: 'pi_OTHER' }))
    if (cursorMoved) { w.pis.pi_1.latest_charge.amount_refunded = 300; w.stripeRefunds.push(stripeRefund('re_N')) }
    wireWorld(w, db, stripeMock)
  }

  it('A-S05b-2 UNSTAMPED: the FV claim runs the no-row branch → not_on_payment → E6 + H1 lock, refundId null (the A-S05a-2 copy)', async () => {
    setup(null, false)
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'no_refund_proven_rail_locked' })
    const c = w.claims[0]
    expect(c).toMatchObject({ status: 'approved', refundAttempted: false, refundId: null })
    expect(String(c.refundError)).toContain('le moteur calculerait la clé refund:o1:0 pour un nouveau remboursement, et la ligne rf_x la détient déjà')
    expect(String(c.refundError)).toContain('De plus, la ligne rf_x est marquée ABOUTIE dans notre base, mais Stripe ne la compte pas sur ce paiement (son remboursement re_X porte sur un autre paiement)')
    expect(alerts().map((a) => a.dedupeKey)).toEqual(['claim_blocked:cl1:no_refund_proven_rail_locked:'])
  })

  it('A-S05c-2b STAMPED claim:<this>: every reconcile takes the mine path → the contradiction relabel, same reason, no new alert — never settled on our row alone', async () => {
    setup('claim:cl1', true)
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'financial_verification', reason: 'stripe_refund_contradiction', detail: OTHER_PI_TEXT })
    expect(w.claims[0]).toMatchObject({ status: 'financial_verification', refundId: 'rf_x', refundError: FV.refundError })
    expect(w.writes.map((x) => x.count)).toEqual([1])
    expect(alerts()).toEqual([])
  })

  it('NEGATIVE CONTROL — the stamped row whose refund Stripe reads succeeded on THIS payment settles on the mine path, with Stripe evidence', async () => {
    setup('claim:cl1', true)
    w.stripeRefunds = w.stripeRefunds.map((s) => (s.id === 're_X' ? { ...s, payment_intent: 'pi_1', amount: 250 } : s))
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'refunded', refundId: 'rf_x', amountCents: 250, evidence: 'stripe_read' })
  })
})
