// tests/claims-dprime-l6-loyalty-d15.test.ts — D′ lot L6: the loyalty prorata of a PRE-DELIVERY refund.
//
// THE DEFECT THIS FILE PROVES CLOSED (LOYALTY-REFUND-CONTRACT §23 residual → §24, D-15). Points are credited
// once, at `delivered`. A refund can land before that: the customer is refunded on Monday, the order is
// marked delivered on Tuesday. At the refund the webhook reconciles the loyalty ledger, finds no `earn` row
// and correctly reverses nothing; then the delivered transition credited the FULL earning and no later event
// ever took it back. A customer refunded in full kept every point of a meal they did not pay for.
//
// WHAT IS REAL HERE. The whole chain runs: `buildDbKnownRefundSet` assembles the refund set from an
// in-memory database, `reconcileLoyaltyOnRefund` applies it, and `planLoyaltyRefund` does the arithmetic.
// Nothing about the numbers is asserted from a fixture — every figure below is what the product computed.
// The §24 pins (T = 1410, E = 14, 470×3 ⇒ −5/−4/−5, 705 ⇒ −7) are therefore MEASURED, not restated.
//
// WHAT CANNOT HAPPEN HERE. No Stripe client exists in this file: the set comes from the database, which is
// the whole point — the delivered transition runs when a courier taps a button and must not depend on a
// payment provider being reachable. No cash moves: this layer moves POINTS.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const { alertMock, auditMock, adminMock, holder } = vi.hoisted(() => ({
  alertMock: vi.fn(), auditMock: vi.fn(), adminMock: vi.fn(),
  // The repair route imports the prisma singleton at module load; this proxy forwards every access to
  // whichever world the test built, so the route runs against the SAME in-memory database as the helper.
  holder: { db: null as unknown as Record<string, unknown> },
}))
vi.mock('@/lib/prisma', () => ({
  prisma: new Proxy({}, { get: (_t, k) => (holder.db as Record<string, unknown> | null)?.[k as string] }),
}))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: alertMock }))
vi.mock('@/lib/admin-audit', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/admin-audit')>()
  return { ...real, recordAdminAudit: auditMock }
})
vi.mock('@/lib/admin-guard', () => ({ resolveAdmin: adminMock }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => null }))

import { buildDbKnownRefundSet, replayLoyaltyProrata } from '@/lib/loyalty-prorata'
import { makeLoyaltyWorld, type LoyaltyWorld } from './support/loyalty-world'

// ── the world ─────────────────────────────────────────────────────────────────────────────────────

/** §24's pinned figures: T = the cash captured, E = the points the order would earn. */
const T = 1410
const E = 14
const ORDER = 'o_d15'

let w: LoyaltyWorld

const setWorld = (over: Parameters<typeof makeLoyaltyWorld>[0] = {}) => {
  w = makeLoyaltyWorld({ orderId: ORDER, chargeCents: T, pointsEarned: E, ...over })
  holder.db = w.db as unknown as Record<string, unknown>
  return w
}

/** The loyalty rows the world holds, in the order they were written. */
const rowsOf = (type?: string) => w.loyaltyTransactions.filter((r) => !type || r.type === type)
const pointsOf = (type: string) => rowsOf(type).map((r) => r.points)
const balance = () => w.customer.pointsBalance
const offset = () => w.customer.recoveryOffsetPoints

beforeEach(() => {
  vi.clearAllMocks()
  alertMock.mockReset(); alertMock.mockResolvedValue({ status: 'sent' })
  auditMock.mockReset(); auditMock.mockResolvedValue(true)
  adminMock.mockReset(); adminMock.mockResolvedValue({ id: 'admin1', email: 'admin@grubano.test', role: 'admin', name: 'A' })
  setWorld()
})

// ══ 1. THE DB-KNOWN SET (§24 (3)) ═════════════════════════════════════════════════════════════════

describe('D′ L6 — the refund set comes from the DATABASE, and from nothing else', () => {
  it('⭐ the union of our succeeded rows and the ledger lines, deduplicated by the Stripe re_', async () => {
    // One refund we know as a row, one we know only from the ledger (a Dashboard refund), one in both.
    w.refunds.push(w.refundRow('re_a', 470), w.refundRow('re_both', 100))
    w.ledger.push(w.ledgerRefund('re_b', 235), w.ledgerRefund('re_both', 100))
    const set = await buildDbKnownRefundSet(w.db, ORDER)
    expect(set).not.toBeNull()
    expect(set!.refunds.map((r) => r.id).sort()).toEqual(['re_a', 're_b', 're_both'])
    expect(set!.refunds.find((r) => r.id === 're_both')!.amountCents).toBe(100)
    expect(set!.fromRefundRows).toBe(2)
    expect(set!.fromLedger).toBe(2)
  })

  it('⭐ a pending row, a failed row, a row with no re_ and a zero amount are NOT refunds', async () => {
    w.refunds.push(
      w.refundRow('re_ok', 470),
      { ...w.refundRow('re_pending', 100), status: 'pending' },
      { ...w.refundRow('re_failed', 100), status: 'failed' },
      { ...w.refundRow('re_x', 100), stripeRefundId: null },
      w.refundRow('re_zero', 0),
    )
    // A ledger line whose sourceEventId is not a Stripe refund id is not one either.
    w.ledger.push({ ...w.ledgerRefund('re_led', 50), sourceEventId: 'internal-key' })
    const set = await buildDbKnownRefundSet(w.db, ORDER)
    expect(set!.refunds.map((r) => r.id)).toEqual(['re_ok'])
  })

  it('⭐ the ledger amount is the MAGNITUDE of a negative gross — never the signed number', async () => {
    w.ledger.push(w.ledgerRefund('re_l', 705))
    const set = await buildDbKnownRefundSet(w.db, ORDER)
    expect(w.ledger[0].grossAmount, 'a refund line is written negative').toBe(-705)
    expect(set!.refunds[0].amountCents).toBe(705)
  })

  it('⭐ T is the ledger PAYMENT line when there is one, and the order total is a NAMED fallback', async () => {
    // No payment line: the denominator is derived from the order and says so.
    let set = await buildDbKnownRefundSet(w.db, ORDER)
    expect(set!.chargeAmountCents).toBe(T)
    expect(set!.chargeSource).toBe('order_total')
    // With a payment line, the measured cash wins — even when it differs from the order total.
    w.ledger.push(w.ledgerPayment(1400))
    set = await buildDbKnownRefundSet(w.db, ORDER)
    expect(set!.chargeAmountCents).toBe(1400)
    expect(set!.chargeSource).toBe('ledger_payment')
  })

  it('⭐ the LEDGER instant wins when both sources carry the same re_: the order of the events decides the deltas', async () => {
    // Our row's settledAt is when WE noticed; the ledger's createdAt comes from Stripe's own refund.created.
    const ours = { ...w.refundRow('re_1', 470), settledAt: new Date(3_000_000 * 1000) }
    w.refunds.push(ours)
    w.ledger.push({ ...w.ledgerRefund('re_1', 470), createdAt: new Date(1_000_000 * 1000) })
    const set = await buildDbKnownRefundSet(w.db, ORDER)
    expect(set!.refunds).toHaveLength(1)
    expect(set!.refunds[0].createdUnix, 'the ledger instant, not ours').toBe(1_000_000)
  })

  it('an order that does not exist yields nothing, and is not an error', async () => {
    expect(await buildDbKnownRefundSet(w.db, 'nope')).toBeNull()
    expect(await replayLoyaltyProrata(w.db, 'nope')).toEqual({ ok: true, replayed: false, reason: 'no_order' })
    expect(alertMock).not.toHaveBeenCalled()
  })
})

// ══ 2. THE FOUNDER'S CASES A–J ════════════════════════════════════════════════════════════════════

describe('D′ L6 — D-15, case by case (the numbers are computed, never restated)', () => {
  /** The delivered transition's own two steps, in order: credit the nominal earning, then replay. */
  const deliverAndReplay = async () => {
    w.creditEarn()
    return replayLoyaltyProrata(w.db, ORDER, { via: 'order_delivered' })
  }

  it('A — no refund before delivered ⇒ the whole earning stands, and nothing else is written', async () => {
    const out = await deliverAndReplay()
    expect(out).toEqual({ ok: true, replayed: false, reason: 'no_refunds' })
    expect(pointsOf('earn')).toEqual([E])
    expect(rowsOf('earn_reversal')).toHaveLength(0)
    expect(balance()).toBe(E)
  })

  it('⭐ B — a partial refund of 470 on T=1410 with E=14 ⇒ earn 14, reversal −5, net 9', async () => {
    w.refunds.push(w.refundRow('re_1', 470))
    const out = await deliverAndReplay()
    expect(out.ok && out.replayed).toBe(true)
    expect(pointsOf('earn')).toEqual([14])
    // round(14 × 470 / 1410) = 5 — computed by lib/loyalty-refund, not by this test.
    expect(pointsOf('earn_reversal')).toEqual([-5])
    expect(balance()).toBe(9)
    expect(offset()).toBe(0)
  })

  it('⭐ C — a TOTAL refund before delivered ⇒ net 0 (the defect this lot closes)', async () => {
    w.refunds.push(w.refundRow('re_full', T))
    const out = await deliverAndReplay()
    expect(out.ok && out.replayed).toBe(true)
    expect(pointsOf('earn')).toEqual([14])
    expect(pointsOf('earn_reversal')).toEqual([-14])
    expect(balance(), 'a meal refunded in full leaves no points behind').toBe(0)
  })

  it('⭐ E — 470 × 3 ⇒ −5 / −4 / −5 and net 0: the deltas TELESCOPE, they are not rounded one by one', async () => {
    // The naive per-event round would give 5+5+5 = 15 on an earning of 14 — the drift §9 exists to remove.
    w.refunds.push(w.refundRow('re_1', 470, 1_000_000), w.refundRow('re_2', 470, 2_000_000), w.refundRow('re_3', 470, 3_000_000))
    const out = await deliverAndReplay()
    expect(out.ok && out.replayed).toBe(true)
    expect(pointsOf('earn_reversal')).toEqual([-5, -4, -5])
    expect(pointsOf('earn_reversal').reduce((a, b) => a + b, 0)).toBe(-14)
    expect(balance()).toBe(0)
  })

  it('⭐ F — a single 705 ⇒ −7', async () => {
    w.refunds.push(w.refundRow('re_half', 705))
    await deliverAndReplay()
    expect(pointsOf('earn_reversal')).toEqual([-7])
    expect(balance()).toBe(7)
  })

  it('⭐ D — points already SPENT elsewhere: the visible balance never goes negative, the debt is booked', async () => {
    // The customer earned 14 here, then spent them on another order before this refund was reconciled.
    w.refunds.push(w.refundRow('re_full', T))
    w.creditEarn()
    w.customer.pointsBalance = 0 // spent elsewhere
    const out = await replayLoyaltyProrata(w.db, ORDER, { via: 'order_delivered' })
    expect(out.ok && out.replayed).toBe(true)
    expect(pointsOf('earn_reversal')).toEqual([-14])
    expect(balance(), 'never negative').toBe(0)
    expect(offset(), 'the unrecovered part becomes an internal debt (D3)').toBe(14)
  })

  it('⭐ D (spent ON this order) — the redeemed points are restored on the same cumulative fraction', async () => {
    setWorld({ pointsRedeemed: 20 })
    w.refunds.push(w.refundRow('re_half', 705))
    await deliverAndReplay()
    // round(20 × 705 / 1410) = 10 restored; round(14 × 705 / 1410) = 7 reversed.
    expect(pointsOf('refund')).toEqual([10])
    expect(pointsOf('earn_reversal')).toEqual([-7])
    expect(balance()).toBe(E - 7 + 10)
  })

  it('⭐ G — a replay of the SAME set writes nothing the second time', async () => {
    w.refunds.push(w.refundRow('re_1', 470, 1_000_000), w.refundRow('re_2', 470, 2_000_000))
    await deliverAndReplay()
    const after = { rows: w.loyaltyTransactions.length, bal: balance() }
    const second = await replayLoyaltyProrata(w.db, ORDER, { via: 'admin_repair' })
    expect(second.ok && second.replayed).toBe(true)
    if (second.ok && second.replayed) {
      expect(second.result.applied, 'nothing new').toBe(0)
      expect(second.result.skipped).toBeGreaterThan(0)
    }
    expect(w.loyaltyTransactions).toHaveLength(after.rows)
    expect(balance()).toBe(after.bal)
  })

  it('⭐ G (a NEW refund after a replay) — only its own cumulative delta is booked', async () => {
    w.refunds.push(w.refundRow('re_1', 470))
    await deliverAndReplay()
    expect(pointsOf('earn_reversal')).toEqual([-5])
    // A second refund arrives LATER — and its instant is later too, which is what makes the telescoping
    // sound: Stripe's refund.created only ever moves forward, so a new refund appends at the END of the
    // sorted prefix and never shifts a delta that was already booked.
    w.refunds.push(w.refundRow('re_2', 470, 2_000_000))
    await replayLoyaltyProrata(w.db, ORDER, { via: 'order_delivered' })
    expect(pointsOf('earn_reversal')).toEqual([-5, -4])
    expect(balance()).toBe(14 - 9)
  })

  it('⭐ H — the replay throws ⇒ the alert names the order and the REPAIR route reaches the same end state', async () => {
    w.refunds.push(w.refundRow('re_full', T))
    w.creditEarn()
    // The database refuses the reconciliation twice (one attempt + one retry, §24 (5)).
    const failing = { ...w.db, loyaltyTransaction: { ...w.db.loyaltyTransaction, findFirst: async () => { throw new Error('lock wait timeout') } } }
    const failed = await replayLoyaltyProrata(failing as typeof w.db, ORDER, { via: 'order_delivered' })
    expect(failed.ok).toBe(false)
    if (!failed.ok) expect(failed.attempts).toBe(2)
    expect(alertMock).toHaveBeenCalledTimes(1)
    expect(alertMock.mock.calls[0][0]).toMatchObject({
      kind: 'loyalty_prorata_incomplete',
      dedupeKey: `loyalty:${ORDER}:prorata`,
    })
    expect(alertMock.mock.calls[0][0].facts).toMatchObject({ orderId: ORDER, moneyMoved: false, repair: 'POST /api/admin/loyalty/reconcile { orderId }' })
    // Nothing was written by the failed attempt: the earning stands whole and wrong, which is why it alerts.
    expect(rowsOf('earn_reversal')).toHaveLength(0)
    expect(balance()).toBe(E)
    // The repair replays the same plan on a healthy database and lands on the total-refund end state.
    const repaired = await replayLoyaltyProrata(w.db, ORDER, { via: 'admin_repair', notifyOnFailure: false })
    expect(repaired.ok && repaired.replayed).toBe(true)
    expect(pointsOf('earn_reversal')).toEqual([-14])
    expect(balance()).toBe(0)
  })

  it('⭐ I — the LEGACY marker: grandfathered, zero rows written, and the earning is left exactly as it was', async () => {
    // A pre-Phase-1 `refund` row carries NO sourceEventId. That order was reconciled by code that predates
    // the keyed model: it is never re-clawed and never double-restored.
    w.loyaltyTransactions.push({ id: 'lt_legacy', customerId: w.customer.id, orderId: ORDER, type: 'refund', points: 9, sourceEventId: null })
    w.customer.pointsBalance = 9
    w.refunds.push(w.refundRow('re_full', T))
    const out = await replayLoyaltyProrata(w.db, ORDER, { via: 'order_delivered' })
    expect(out.ok && out.replayed).toBe(true)
    if (out.ok && out.replayed) expect(out.result.grandfathered).toBe(true)
    expect(rowsOf('earn_reversal')).toHaveLength(0)
    expect(balance()).toBe(9)
  })

  it('⭐ J — the earn is credited ONCE: a second delivered pass adds no points', async () => {
    w.refunds.push(w.refundRow('re_1', 470))
    await deliverAndReplay()
    const before = { rows: w.loyaltyTransactions.length, bal: balance() }
    // The route's own guard is the [orderId,'earn'] row; the world models it.
    w.creditEarn()
    await replayLoyaltyProrata(w.db, ORDER, { via: 'order_delivered' })
    expect(pointsOf('earn'), 'one earning, whatever happens upstream').toEqual([14])
    expect(w.loyaltyTransactions).toHaveLength(before.rows)
    expect(balance()).toBe(before.bal)
  })

  it('⭐ the earn PRECONDITION still holds: with no earn row, a refund reverses NOTHING (no phantom negative)', async () => {
    // This is the refund-webhook order of events: the refund is reconciled BEFORE the delivery.
    w.refunds.push(w.refundRow('re_full', T))
    const out = await replayLoyaltyProrata(w.db, ORDER, { via: 'webhook' })
    expect(out.ok && out.replayed).toBe(true)
    expect(rowsOf('earn_reversal')).toHaveLength(0)
    expect(balance()).toBe(0)
    // …and then the delivered transition credits, and the replay takes it straight back off.
    w.creditEarn()
    await replayLoyaltyProrata(w.db, ORDER, { via: 'order_delivered' })
    expect(pointsOf('earn_reversal')).toEqual([-14])
    expect(balance()).toBe(0)
  })
})

// ══ 3. THE REPAIR ROUTE ═══════════════════════════════════════════════════════════════════════════

describe('D′ L6 — POST /api/admin/loyalty/reconcile', () => {
  const call = async (body: unknown) => {
    const { POST } = await import('@/app/api/admin/loyalty/reconcile/route')
    const res = await POST(new Request('https://app.grubano.com/api/admin/loyalty/reconcile', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }))
    return { status: res.status, body: await res.json() as Record<string, unknown> }
  }

  it('not an admin → 403, and nothing is read', async () => {
    adminMock.mockResolvedValue(null)
    const r = await call({ orderId: ORDER })
    expect(r.status).toBe(403)
    expect(w.loyaltyTransactions).toHaveLength(0)
  })

  it('an invalid body → 400 (the route takes an orderId and nothing else)', async () => {
    expect((await call({})).status).toBe(400)
    expect((await call({ orderId: ORDER, amountPoints: 5 })).status).toBe(400)
  })

  it('⭐ it replays the prorata and reports what it did — audited, with moneyMoved false', async () => {
    w.refunds.push(w.refundRow('re_full', T))
    w.creditEarn()
    const r = await call({ orderId: ORDER })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ ok: true, replayed: true, earnReversed: 14, knownRefunds: 1, chargeSource: 'order_total' })
    expect(balance()).toBe(0)
    const audit = auditMock.mock.calls.map((c) => c[0]).find((a) => a.action === 'loyalty.reconcile')
    expect(audit).toMatchObject({ targetType: 'order', targetId: ORDER })
    expect(audit.metadata).toMatchObject({ replayed: true, moneyMoved: false, earnReversed: 14 })
  })

  it('⭐ an order with no known refund is told so, and nothing is written', async () => {
    w.creditEarn()
    const r = await call({ orderId: ORDER })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ ok: true, replayed: false, reason: 'no_refunds' })
    expect(pointsOf('earn')).toEqual([E])
    expect(rowsOf('earn_reversal')).toHaveLength(0)
  })

  it('⭐ calling it twice is safe: the second call writes nothing', async () => {
    w.refunds.push(w.refundRow('re_1', 470))
    w.creditEarn()
    await call({ orderId: ORDER })
    const after = { rows: w.loyaltyTransactions.length, bal: balance() }
    const second = await call({ orderId: ORDER })
    expect(second.status).toBe(200)
    expect(second.body).toMatchObject({ applied: 0 })
    expect(w.loyaltyTransactions).toHaveLength(after.rows)
    expect(balance()).toBe(after.bal)
  })
})

// ══ 4. « IT FAILED » IS NOT « NOTHING WAS WRITTEN » (review P1, 4 lenses) ═════════════════════════
//
// `reconcileLoyaltyOnRefund` commits ONE TRANSACTION PER EFFECT. So a failure on the second of two refunds
// leaves the first one APPLIED — and the repair route used to tell the admin, and record in AdminAuditLog,
// that nothing had been written. An admin who believes that corrects a balance by hand on top of rows that
// already exist. These tests pin the measured truth instead.

describe('D′ L6 — a failed replay reports WHAT IT APPLIED', () => {
  /**
   * Let the FIRST keyed row through, then refuse — with an error that is not a P2002, so the reconciliation
   * rethrows it instead of counting it as an idempotent skip. The injector is set on the WORLD, not on a
   * wrapper around `db`: `$transaction` hands its callback the world's own client, so a patched
   * `db.loyaltyTransaction.create` would never be reached by the writes inside a transaction.
   */
  const failAfterFirstCreate = () => {
    let creates = 0
    w.onLoyaltyCreate = (data) => {
      creates++
      if (creates >= 2 && data.type === 'earn_reversal') throw new Error('server has gone away')
    }
  }

  it('⭐ the first effect is COMMITTED and the outcome says so, row by row', async () => {
    // Two refunds, monotonic instants ⇒ deltas −5 then −4 (the telescoping of case E).
    w.refunds.push(w.refundRow('re_1', 470, 1_000_000), w.refundRow('re_2', 470, 1_000_100))
    w.creditEarn()
    failAfterFirstCreate()
    const out = await replayLoyaltyProrata(w.db, ORDER, { via: 'order_delivered' })
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.applied, 'the count is measured, not assumed').toEqual({ earnReversal: 1, refund: 0 })
    }
    // …and the measurement matches the database: the first reversal really is there.
    expect(pointsOf('earn_reversal')).toEqual([-5])
    expect(balance()).toBe(E - 5)
  })

  it('⭐ the alert names the rows the failed call wrote, so nobody corrects on top of them', async () => {
    w.refunds.push(w.refundRow('re_1', 470, 1_000_000), w.refundRow('re_2', 470, 1_000_100))
    w.creditEarn()
    failAfterFirstCreate()
    await replayLoyaltyProrata(w.db, ORDER, { via: 'order_delivered' })
    expect(alertMock).toHaveBeenCalledTimes(1)
    expect(alertMock.mock.calls[0][0].facts).toMatchObject({ appliedRows: 'earn_reversal:1 refund:0' })
  })

  it('⭐ the REPAIR route no longer claims nothing was written — and says to call it again', async () => {
    w.refunds.push(w.refundRow('re_1', 470, 1_000_000), w.refundRow('re_2', 470, 1_000_100))
    w.creditEarn()
    failAfterFirstCreate()
    const { POST } = await import('@/app/api/admin/loyalty/reconcile/route')
    const res = await POST(new Request('https://app.grubano.com/api/admin/loyalty/reconcile', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderId: ORDER }),
    }))
    const body = await res.json() as Record<string, unknown>
    w.onLoyaltyCreate = null // the database is healthy again for the finishing call below
    expect(res.status).toBe(500)
    expect(body.appliedRows).toEqual({ earnReversal: 1, refund: 0 })
    expect(String(body.error), 'never « rien n’a été écrit » when something was').not.toMatch(/Rien n’a été écrit/)
    expect(String(body.error)).toMatch(/interrompue APRÈS avoir écrit/)
    // The audit trail records the same thing: 'partial', not false.
    const audit = auditMock.mock.calls.map((c) => c[0]).find((a) => a.action === 'loyalty.reconcile')
    expect(audit.metadata).toMatchObject({ replayed: 'partial', appliedEarnReversalRows: 1, moneyMoved: false })
    // …and calling it again on a healthy database finishes the plan without re-applying the first effect.
    const finish = await replayLoyaltyProrata(w.db, ORDER, { via: 'admin_repair', notifyOnFailure: false })
    expect(finish.ok && finish.replayed).toBe(true)
    if (finish.ok && finish.replayed) expect(finish.result.skipped).toBe(1)
    expect(pointsOf('earn_reversal')).toEqual([-5, -4])
    expect(balance()).toBe(E - 9)
  })

  it('a failure that wrote NOTHING still says so, and does not invent a number', async () => {
    w.refunds.push(w.refundRow('re_full', T))
    w.creditEarn()
    const dead = { ...w.db, loyaltyTransaction: { ...w.db.loyaltyTransaction, findFirst: async () => { throw new Error('lock wait timeout') } } }
    const out = await replayLoyaltyProrata(dead as typeof w.db, ORDER, { via: 'order_delivered' })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.applied).toEqual({ earnReversal: 0, refund: 0 })
    expect(rowsOf('earn_reversal')).toHaveLength(0)
  })
})

// ══ 5. THE §24 PREFIX RESIDUAL — DETECTED, NEVER SILENT (review P1, spec territory) ═══════════════
//
// §9 is drift-free for a writer that holds the WHOLE refund set in one pass. This replay's set is « what the
// database proves », which is weaker: a Dashboard refund whose webhook has not landed is invisible. Because
// every written (re_, type) row FREEZES its delta, a set that grows in the wrong ORDER can settle on a total
// one point away from §9 — permanently, in either direction. Closing that needs a change to §9 or §16, which
// is a founder decision. What the code must never do is keep quiet about it.

describe('D′ L6 — the drift the DB-known set can produce is measured and alerted', () => {
  it('⭐ an EARLIER refund that becomes visible later ⇒ booked 10 where §9 wants 9, and it is reported', async () => {
    w.creditEarn()
    // Round 1 — only the LATER refund is visible. Its delta is priced from a cumulative of zero: −5.
    w.refunds.push(w.refundRow('re_b', 470, 1_000_100))
    const first = await replayLoyaltyProrata(w.db, ORDER, { via: 'order_delivered' })
    expect(pointsOf('earn_reversal')).toEqual([-5])
    expect(first.ok && first.replayed && first.drift, 'one refund, one prefix: no drift yet').toBe(null)

    // Round 2 — the EARLIER refund lands. Sorted, it is now the first of the prefix, so its own delta is
    // also 5 — and re_b's frozen −5 is never recomputed to the −4 the complete prefix would give it.
    w.refunds.push(w.refundRow('re_a', 470, 1_000_000))
    const second = await replayLoyaltyProrata(w.db, ORDER, { via: 'order_delivered' })
    expect(second.ok && second.replayed).toBe(true)
    expect(pointsOf('earn_reversal')).toEqual([-5, -5])
    // §9 for the complete set: round(14 × 940 / 1410) = 9. Booked: 10. The residual, measured.
    if (second.ok && second.replayed) {
      expect(second.drift).toEqual({ targetEarnReversal: 9, bookedEarnReversal: 10, knownRefundedCents: 940, chargeAmountCents: T })
    }
    expect(balance(), 'the customer is one point short of the §9 target').toBe(E - 10)
  })

  it('⭐ the gap raises its OWN alert, with its own dedupe key — not the failure one', async () => {
    w.creditEarn()
    w.refunds.push(w.refundRow('re_b', 470, 1_000_100))
    await replayLoyaltyProrata(w.db, ORDER, { via: 'order_delivered' })
    alertMock.mockClear()
    w.refunds.push(w.refundRow('re_a', 470, 1_000_000))
    await replayLoyaltyProrata(w.db, ORDER, { via: 'order_delivered' })
    expect(alertMock).toHaveBeenCalledTimes(1)
    expect(alertMock.mock.calls[0][0]).toMatchObject({ kind: 'loyalty_prorata_incomplete', dedupeKey: `loyalty:${ORDER}:drift` })
    expect(alertMock.mock.calls[0][0].facts).toMatchObject({
      targetEarnReversal: 9, bookedEarnReversal: 10, knownRefundedCents: 940, moneyMoved: false,
    })
  })

  it('⭐ NEGATIVE CONTROL — the same three refunds seen in order raise NO drift and NO alert', async () => {
    w.creditEarn()
    w.refunds.push(w.refundRow('re_1', 470, 1_000_000), w.refundRow('re_2', 470, 1_000_100), w.refundRow('re_3', 470, 1_000_200))
    const out = await replayLoyaltyProrata(w.db, ORDER, { via: 'order_delivered' })
    expect(pointsOf('earn_reversal')).toEqual([-5, -4, -5])
    expect(out.ok && out.replayed && out.drift).toBe(null)
    expect(alertMock).not.toHaveBeenCalled()
    expect(balance()).toBe(0)
  })

  it('⭐ NEGATIVE CONTROL — a later refund arriving AFTER a replay telescopes correctly: still no drift', async () => {
    w.creditEarn()
    w.refunds.push(w.refundRow('re_1', 470, 1_000_000))
    await replayLoyaltyProrata(w.db, ORDER, { via: 'order_delivered' })
    w.refunds.push(w.refundRow('re_2', 470, 1_000_100))
    const out = await replayLoyaltyProrata(w.db, ORDER, { via: 'order_delivered' })
    expect(pointsOf('earn_reversal')).toEqual([-5, -4])
    expect(out.ok && out.replayed && out.drift).toBe(null)
  })

  it('a grandfathered order is NOT judged against §9 — it is left exactly as the old code wrote it', async () => {
    w.loyaltyTransactions.push({ id: 'lt_legacy', customerId: w.customer.id, orderId: ORDER, type: 'refund', points: 9, sourceEventId: null })
    w.creditEarn()
    w.refunds.push(w.refundRow('re_full', T))
    const out = await replayLoyaltyProrata(w.db, ORDER, { via: 'order_delivered' })
    expect(out.ok && out.replayed && out.result.grandfathered).toBe(true)
    expect(out.ok && out.replayed && out.drift, 'no earn_reversal is owed, so none is missing').toBe(null)
    expect(alertMock).not.toHaveBeenCalled()
  })

  it('the repair route surfaces the gap to the admin who called it', async () => {
    w.creditEarn()
    w.refunds.push(w.refundRow('re_b', 470, 1_000_100))
    await replayLoyaltyProrata(w.db, ORDER, { via: 'order_delivered' })
    w.refunds.push(w.refundRow('re_a', 470, 1_000_000))
    const { POST } = await import('@/app/api/admin/loyalty/reconcile/route')
    const res = await POST(new Request('https://app.grubano.com/api/admin/loyalty/reconcile', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ orderId: ORDER }),
    }))
    const body = await res.json() as Record<string, unknown>
    expect(res.status).toBe(200)
    expect(body.drift).toMatchObject({ targetEarnReversal: 9, bookedEarnReversal: 10 })
    const audit = auditMock.mock.calls.map((c) => c[0]).find((a) => a.action === 'loyalty.reconcile')
    expect(String(audit.metadata.drift)).toMatch(/booked 10/)
  })
})

// ══ 6. THE SOURCE CONTRACT ════════════════════════════════════════════════════════════════════════

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

describe('D′ L6 — what the loyalty path may never contain', () => {
  it('⭐ the status route reads no Stripe: the delivery of a meal never depends on a payment provider', () => {
    const src = read('app/api/orders/[id]/status/route.ts')
    expect(src).not.toMatch(/@\/lib\/stripe|getStripe|stripe\./)
    expect(src).toMatch(/replayLoyaltyProrata/)
  })

  it('⭐ the prorata module reads no Stripe either — the set is the DATABASE', () => {
    const src = read('lib/loyalty-prorata.ts')
    // The header explains what the module never does, so the ban is on USE, not on the words: the comment
    // at the top deliberately NAMES `charge.amount_refunded` to say it is never read.
    const code = src.replace(/^\/\/.*$/gm, '')
    expect(code).not.toMatch(/from '@\/lib\/stripe'|getStripe\(|amount_refunded/)
    // Its only reads: the order, our refund rows, the ledger, and then the shared reconciliation.
    expect(src).toMatch(/db\.refund\.findMany/)
    expect(src).toMatch(/db\.ledgerEntry\.findMany/)
    expect(src).toMatch(/reconcileLoyaltyOnRefund/)
  })

  it('⭐ the repair route touches no money and no claim: DB only, and gated by no claims flag', () => {
    const src = read('app/api/admin/loyalty/reconcile/route.ts')
    expect(src).not.toMatch(/@\/lib\/stripe|getStripe|executeRefund|triggerClaimRefund/)
    expect(src).not.toMatch(/isRefundsEnabled|claimsSurfaceOpen|isClaimsSurfaceEnabled|isClaimsEnabled/)
    expect(src).toMatch(/resolveAdmin\(\)/)
  })

  it('⭐ the prorata module does not claim the two paths always agree — the residual is NAMED', () => {
    const src = read('lib/loyalty-prorata.ts')
    // The claim that was there before the review: « Same set, same order, same deltas — whichever path runs
    // first ». It is false whenever the two paths see DIFFERENT sets, which is the whole residual.
    expect(src).not.toMatch(/Same set, same order, same deltas/)
    expect(src).toMatch(/prefix-completeness precondition/)
    expect(src).toMatch(/detectProrataDrift/)
  })

  it('⭐ the earn is credited BEFORE the replay — never the other way round', () => {
    const src = read('app/api/orders/[id]/status/route.ts')
    // The replay reverses points that must already be credited: run it first and it reverses nothing, and
    // nothing ever comes back for them — exactly the D-15 defect, reintroduced by an edit.
    // Anchored on the WRITE and on the CALL, never on the import (which is line 8, above everything).
    const earnAt = src.indexOf("type: 'earn', points: order.pointsEarned")
    const replayAt = src.indexOf('replayLoyaltyProrata(prisma')
    expect(earnAt, 'the earn write is in this route').toBeGreaterThan(-1)
    expect(replayAt, 'the replay is called in this route').toBeGreaterThan(-1)
    expect(replayAt).toBeGreaterThan(earnAt)
    // …and the replay is OUTSIDE the earn transaction: reconcileLoyaltyOnRefund opens its own.
    expect(src).toMatch(/replayLoyaltyProrata\(prisma/)
    expect(src).not.toMatch(/replayLoyaltyProrata\(tx/)
  })

  it('the refund engine and the L5 rail are untouched by this lot', () => {
    expect(read('lib/refund.ts')).not.toMatch(/deliveredAt|loyalty-prorata|D′ L6/)
    expect(read('app/api/admin/claims/pay-approved/route.ts')).not.toMatch(/deliveredAt|loyalty-prorata/)
  })
})
