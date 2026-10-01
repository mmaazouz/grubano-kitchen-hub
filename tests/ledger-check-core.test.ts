// tests/ledger-check-core.test.ts — the PURE ledger reconciliation (lib/ledger-check-core.js),
// shared by GET /api/admin/ledger/check and the server-side read-only operator.
// Detector semantics: correct state → PASS ; every known corruption → FAIL, truthfully.
// No money mutation is even possible here: the core only calls findMany / list.
import { describe, it, expect } from 'vitest'
import { reconcileLedger, resolveWindow } from '@/lib/ledger-check-core'

type Line = { id: string; type: string; grossAmount: number; applicationFeeAmount: number; netToRestaurant: number; stripePaymentIntentId: string | null; sourceEventId?: string | null; createdAt: Date }
type PI = { id: string; status: string; amount_received: number }
type RF = { id: string; status: string; amount: number }

const FROM = new Date('2026-08-29T00:00:00Z')
const TO   = new Date('2026-09-05T00:00:00Z')
const inWin = (d: Date) => d >= FROM && d <= TO

function fakePrisma(lines: Line[]) {
  const calls: string[] = []
  return {
    calls,
    ledgerEntry: {
      findMany: async (q: { where: Record<string, unknown>; select: Record<string, boolean> }) => {
        calls.push(JSON.stringify(Object.keys(q.where)))
        const w = q.where as { createdAt?: { gte: Date; lte: Date }; stripePaymentIntentId?: { in: string[] }; sourceEventId?: { in: string[] }; type?: string }
        if (w.createdAt) return lines.filter((l) => inWin(l.createdAt))
        if (w.stripePaymentIntentId) return lines.filter((l) => l.stripePaymentIntentId && w.stripePaymentIntentId!.in.includes(l.stripePaymentIntentId)).map((l) => ({ stripePaymentIntentId: l.stripePaymentIntentId }))
        if (w.sourceEventId) return lines.filter((l) => l.type === (w.type ?? 'refund') && l.sourceEventId && w.sourceEventId!.in.includes(l.sourceEventId)).map((l) => ({ sourceEventId: l.sourceEventId }))
        return []
      },
    },
    // Any write would be a bug: none exists on the fake → a call throws.
  }
}
function fakeStripe(pis: PI[], refunds: RF[] | Error) {
  return {
    paymentIntents: { list: () => ({ autoPagingToArray: async () => pis }) },
    refunds: { list: () => ({ autoPagingToArray: async () => { if (refunds instanceof Error) throw refunds; return refunds } }) },
  }
}
const d = (iso: string) => new Date(iso)
const payment = (id: string, pi: string, gross: number, fee: number, when = '2026-09-01T10:00:00Z'): Line =>
  ({ id, type: 'payment', grossAmount: gross, applicationFeeAmount: fee, netToRestaurant: gross - fee, stripePaymentIntentId: pi, sourceEventId: pi, createdAt: d(when) })
const refundLine = (id: string, pi: string, re: string, gross: number, fee: number, when = '2026-09-02T10:00:00Z'): Line =>
  ({ id, type: 'refund', grossAmount: -gross, applicationFeeAmount: -fee, netToRestaurant: -(gross - fee), stripePaymentIntentId: pi, sourceEventId: re, createdAt: d(when) })

// The historical staging shape of the window: two payments (14,50 € fee 116 ; 14,10 € fee 76)
// and the Z1 rehearsal refund (14,50 €, fee refund 116) — F2: ledger = Stripe actual truth.
const GOOD_LINES: Line[] = [
  payment('l1', 'pi_A', 1450, 116),
  payment('l2', 'pi_B', 1410, 76),
  refundLine('l3', 'pi_A', 're_Z1', 1450, 116),
]
const GOOD_PIS: PI[] = [{ id: 'pi_A', status: 'succeeded', amount_received: 1450 }, { id: 'pi_B', status: 'succeeded', amount_received: 1410 }, { id: 'pi_C', status: 'requires_payment_method', amount_received: 0 }]
const GOOD_REFUNDS: RF[] = [{ id: 're_Z1', status: 'succeeded', amount: 1450 }, { id: 're_pending', status: 'pending', amount: 500 }]

describe('ledger-check-core — correct historical state', () => {
  it('PASS: counts, sums and refunds reconcile; only succeeded objects count', async () => {
    const r = await reconcileLedger({ prisma: fakePrisma(GOOD_LINES), stripe: fakeStripe(GOOD_PIS, GOOD_REFUNDS), from: FROM, to: TO })
    expect(r.ok).toBe(true)
    expect(r.internalOk).toBe(true)
    expect(r.reconciliationOk).toBe(true)
    expect(r.refundsOk).toBe(true)
    expect([r.ledgerCount, r.stripeCount, r.ledgerSum, r.stripeSum]).toEqual([2, 2, 2860, 2860])
    expect(r.refunds).toEqual({ ledgerCount: 1, stripeCount: 1, ledgerSum: -1450, stripeSum: -1450, checked: true })
    expect(r.ecarts).toEqual([])
    expect(r.aggregates).toEqual({ gross: 1410, applicationFee: 76, netToRestaurant: 1334 })
  })
  it('the core never writes: the fake prisma exposes findMany only and every call is a read', async () => {
    const p = fakePrisma(GOOD_LINES)
    await reconcileLedger({ prisma: p, stripe: fakeStripe(GOOD_PIS, GOOD_REFUNDS), from: FROM, to: TO })
    expect(p.calls.length).toBeGreaterThanOrEqual(3)
    expect(Object.keys(p.ledgerEntry)).toEqual(['findMany'])
  })
})

describe('ledger-check-core — the detector FAILS on every corruption (never forced PASS)', () => {
  it('missing Stripe object in the ledger (succeeded PI without any line) → missing_in_ledger, ok:false', async () => {
    const pis = [...GOOD_PIS, { id: 'pi_ORPHAN', status: 'succeeded', amount_received: 999 }]
    const r = await reconcileLedger({ prisma: fakePrisma(GOOD_LINES), stripe: fakeStripe(pis, GOOD_REFUNDS), from: FROM, to: TO })
    expect(r.ok).toBe(false)
    expect(r.ecarts).toEqual([{ kind: 'missing_in_ledger', stripePaymentIntentId: 'pi_ORPHAN', amount: 999 }])
    expect(r.reconciliationOk).toBe(false)
  })
  it('extra ledger line (money line whose PI Stripe never saw) → not_in_stripe_window, ok:false', async () => {
    const lines = [...GOOD_LINES, payment('l9', 'pi_GHOST', 700, 56)]
    const r = await reconcileLedger({ prisma: fakePrisma(lines), stripe: fakeStripe(GOOD_PIS, GOOD_REFUNDS), from: FROM, to: TO })
    expect(r.ok).toBe(false)
    expect(r.ecarts).toEqual([{ kind: 'not_in_stripe_window', ledgerId: 'l9', stripePaymentIntentId: 'pi_GHOST' }])
    expect(r.ledgerCount).toBe(3); expect(r.stripeCount).toBe(2)
    // tolerated by reconciliationOk (window edge effect) but NEVER by ok
    expect(r.reconciliationOk).toBe(true)
  })
  it('duplicate refund ledger line (same re_ booked twice — F8 breach in the ledger) → refund sums diverge, refundsOk:false', async () => {
    const lines = [...GOOD_LINES, refundLine('l4', 'pi_A', 're_Z1', 1450, 116, '2026-09-02T10:05:00Z')]
    const r = await reconcileLedger({ prisma: fakePrisma(lines), stripe: fakeStripe(GOOD_PIS, GOOD_REFUNDS), from: FROM, to: TO })
    expect(r.ok).toBe(false)
    expect(r.refundsOk).toBe(false)
    expect(r.refunds.ledgerSum).toBe(-2900); expect(r.refunds.stripeSum).toBe(-1450)
    expect(r.refunds.ledgerCount).toBe(2); expect(r.refunds.stripeCount).toBe(1)
  })
  it('succeeded Stripe refund with no ledger refund line → missing_refund_in_ledger, refundsOk:false', async () => {
    const refunds = [...GOOD_REFUNDS, { id: 're_EXTERNAL', status: 'succeeded', amount: 300 }]
    const r = await reconcileLedger({ prisma: fakePrisma(GOOD_LINES), stripe: fakeStripe(GOOD_PIS, refunds), from: FROM, to: TO })
    expect(r.ok).toBe(false)
    expect(r.refundsOk).toBe(false)
    expect(r.ecarts).toEqual([{ kind: 'missing_refund_in_ledger', stripeRefundId: 're_EXTERNAL', amount: 300 }])
  })
  it('broken golden equation (1 c off) → internal_equation ecart, internalOk:false, ok:false', async () => {
    const lines = [...GOOD_LINES]
    lines[1] = { ...lines[1], netToRestaurant: lines[1].netToRestaurant - 1 }
    const r = await reconcileLedger({ prisma: fakePrisma(lines), stripe: fakeStripe(GOOD_PIS, GOOD_REFUNDS), from: FROM, to: TO })
    expect(r.ok).toBe(false)
    expect(r.internalOk).toBe(false)
    expect(r.ecarts[0]).toMatchObject({ kind: 'internal_equation', ledgerId: 'l2', gross: 1410, fee: 76, net: 1333 })
  })
  it('sum mismatch with equal counts (ledger booked 1 € less than Stripe captured) → ok:false', async () => {
    const pis = GOOD_PIS.map((p) => (p.id === 'pi_B' ? { ...p, amount_received: 1510 } : p))
    const r = await reconcileLedger({ prisma: fakePrisma(GOOD_LINES), stripe: fakeStripe(pis, GOOD_REFUNDS), from: FROM, to: TO })
    expect(r.ok).toBe(false)
    expect(r.ledgerSum).toBe(2860); expect(r.stripeSum).toBe(2960)
    expect(r.ecarts).toEqual([])
  })
  it('refund listing unavailable → surfaced truthfully (checked:false), refunds not silently "ok"-ed as reconciled', async () => {
    const warns: string[] = []
    const r = await reconcileLedger({ prisma: fakePrisma(GOOD_LINES), stripe: fakeStripe(GOOD_PIS, new Error('stripe down')), from: FROM, to: TO, warn: (m) => warns.push(m) })
    expect(r.refunds.checked).toBe(false)
    expect(r.refunds.stripeCount).toBe(0)
    expect(warns[0]).toContain('refunds reconciliation unavailable')
    // A6 semantics (unchanged): refundsOk is not asserted when the listing is unavailable —
    // the caller must read `checked:false`, which the operator prints as NOT MEASURED.
    expect(r.refundsOk).toBe(true)
  })
})

describe('resolveWindow', () => {
  it('defaults to the last 7 days ending now', () => {
    const now = new Date('2026-09-05T12:00:00Z')
    const w = resolveWindow(null, null, now)
    expect(w.error).toBeUndefined()
    expect(w.to!.toISOString()).toBe(now.toISOString())
    expect(w.from!.toISOString()).toBe('2026-08-29T12:00:00.000Z')
  })
  it('rejects an invalid or inverted window', () => {
    expect(resolveWindow('nope', null).error).toBeTruthy()
    expect(resolveWindow('2026-09-05T00:00:00Z', '2026-09-01T00:00:00Z').error).toBeTruthy()
  })
})
