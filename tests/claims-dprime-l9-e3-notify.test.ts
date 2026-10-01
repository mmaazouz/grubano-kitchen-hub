import { describe, it, expect, beforeEach, vi } from 'vitest'

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
// D′ L9 / E3 — THE DEFERRED SUPPORT NOTICE (spec v2 §6.3, founder §19–§24).
//
// THE DEFECT. A support refund Stripe settles ASYNCHRONOUSLY reaches the customer's bank with no
// `refund_confirmation` ever dispatched. `/api/admin/refunds/run` answers 202 with no e-mail — truthfully,
// because at that instant the money has not moved — and the webhook that later finalises the row to
// `succeeded` is FORBIDDEN from sending (H15, and that ban is load-bearing: a webhook retry storm must not
// become a mail storm). Same for the abandoned-checkout auto-refund, whose only notice is an admin alert.
//
// SO THE REPAIR IS HUMAN-TRIGGERED, and everything below pins the three properties that make it safe:
//   (1) it re-reads STRIPE in the same request and sends STRIPE's amount, never ours (§20);
//   (2) it refuses rather than duplicates — claim-bound, already-sent, reverted (§21, §22);
//   (3) it is NOT gated, because the money already left (§23, S-25).
// ═══════════════════════════════════════════════════════════════════════════════════════════════════

const { db, adminMock, stripeMock, sendRefund, alert, audit, rateLimitMock } = vi.hoisted(() => ({
  db: {
    refund:        { findMany: vi.fn(), findUnique: vi.fn(), groupBy: vi.fn(), aggregate: vi.fn() },
    claim:         { findMany: vi.fn(), count: vi.fn() },
    emailDispatch: { findMany: vi.fn(), count: vi.fn() },
    order:         { findMany: vi.fn(), findUnique: vi.fn() },
    operator:      { findUnique: vi.fn() },
  },
  adminMock:  vi.fn(),
  stripeMock: { refunds: { retrieve: vi.fn() } },
  sendRefund: vi.fn(),
  alert:      vi.fn(),
  audit:      vi.fn(),
  rateLimitMock: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/admin-guard', () => ({ resolveAdmin: adminMock }))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))
vi.mock('@/lib/transactional-emails', () => ({ sendRefundConfirmation: sendRefund }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: alert }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: audit }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: rateLimitMock }))

import { POST, GET } from '@/app/api/admin/refunds/rows/[rowId]/notify/route'
import {
  listPendingSupportRefundNotices, resolveSupportNoticeTarget, refundNoticeKeys,
  REFUND_CONFIRMATION_TRIGGER, EXTERNAL_KEY_PREFIX,
} from '@/lib/support-refund-notices'

const RE = 're_L9E3AAAAAAA1'
const ROW = 'rf_1'

const row = (over: Record<string, unknown> = {}) => ({
  id: ROW, orderId: 'o1', amountCents: 500, status: 'succeeded', stripeRefundId: RE,
  reason: null, idempotencyKey: 'refund:o1:0', settledAt: new Date('2026-09-20T10:00:00Z'),
  createdAt: new Date('2026-09-20T09:59:00Z'), ...over,
})

const world = () => {
  for (const m of [db.refund.findMany, db.refund.findUnique, db.refund.groupBy, db.refund.aggregate,
    db.claim.findMany, db.claim.count, db.emailDispatch.findMany, db.emailDispatch.count,
    db.order.findMany, db.order.findUnique, db.operator.findUnique,
    adminMock, stripeMock.refunds.retrieve, sendRefund, alert, audit, rateLimitMock]) m.mockReset()
  rateLimitMock.mockReturnValue(null)
  adminMock.mockResolvedValue({ id: 'adm1', role: 'admin', name: 'A', email: 'a@g.com' })
  db.refund.findUnique.mockResolvedValue(row())
  db.refund.findMany.mockResolvedValue([row()])
  db.refund.groupBy.mockResolvedValue([{ orderId: 'o1', _sum: { amountCents: 500 } }])
  db.refund.aggregate.mockResolvedValue({ _sum: { amountCents: 500 } })
  db.claim.findMany.mockResolvedValue([])
  db.claim.count.mockResolvedValue(0)
  db.emailDispatch.findMany.mockResolvedValue([])
  db.emailDispatch.count.mockResolvedValue(0)
  db.order.findUnique.mockResolvedValue({ id: 'o1', total: 14.5, consumerId: 'u1', restaurant: { name: 'Gnocchi Bar' } })
  db.order.findMany.mockResolvedValue([{ id: 'o1', total: 14.5, restaurant: { name: 'Gnocchi Bar' } }])
  db.operator.findUnique.mockResolvedValue({ email: 'buyer@x.com', name: 'Zoé' })
  stripeMock.refunds.retrieve.mockResolvedValue({ id: RE, status: 'succeeded', amount: 500 })
  sendRefund.mockResolvedValue({ status: 'sent' })
  audit.mockResolvedValue(true)
  alert.mockResolvedValue(undefined)
}
beforeEach(world)

const post = () => POST(new Request('http://x/api', { method: 'POST', body: '{}' }) as never, { params: { rowId: ROW } })

// ── §19 — THE POPULATION, and the two traps in translating it ════════════════════════════════════════
describe('E3 — the « non notifiées » population', () => {
  it('the where clause carries the spec conditions, with the NULL-SAFE reason branch', async () => {
    await listPendingSupportRefundNotices()
    const where = db.refund.findMany.mock.calls[0][0].where
    expect(where.status).toBe('succeeded')
    expect(where.stripeRefundId).toEqual({ not: null })
    expect(where.idempotencyKey).toEqual({ not: { startsWith: EXTERNAL_KEY_PREFIX } })
    // THE MYSQL TRAP, and it would have hidden the COMMONEST row in this list. `reason` is nullable and
    // /api/admin/refunds/run makes it optional, so most support rows have reason NULL. A naive
    // `{ reason: { not: { startsWith: 'claim:' } } }` compiles to `reason NOT LIKE 'claim:%'`, and in MySQL
    // `NULL NOT LIKE 'x%'` is NULL — not TRUE — so every one of those rows would silently vanish.
    expect(where.OR).toEqual([{ reason: null }, { NOT: { reason: { startsWith: 'claim:' } } }])
    // NEGATIVE CONTROL: the naive shape must not be what is used.
    expect(JSON.stringify(where)).not.toContain('"not":{"startsWith":"claim:"}')
  })

  it('a row with a NULL reason IS listed — it is the ordinary support row, not an edge case', async () => {
    db.refund.findMany.mockResolvedValue([row({ reason: null })])
    const out = await listPendingSupportRefundNotices()
    expect(out.items.map((i) => i.rowId)).toEqual([ROW])
    expect(out.items[0].origin).toBe('support')
  })

  it('a claim-bound row is excluded by the BINDER read, not only by its reason stamp', async () => {
    // A row can be bound by a Claim while carrying no `claim:` reason (the admin console attaches it), so
    // the reason stamp alone is not the population rule.
    db.claim.findMany.mockResolvedValue([{ refundId: ROW }])
    expect((await listPendingSupportRefundNotices()).items).toEqual([])
  })

  const PRE_T47 = new Date('2026-09-05T10:00:00Z')   // before ae98239 (2026-09-10)
  const POST_T47 = new Date('2026-09-25T10:00:00Z')

  it('a row already announced under either of its OWN keys is excluded', async () => {
    for (const k of [`refund:${RE}`, `refund:${ROW}`]) {
      world()
      db.emailDispatch.findMany.mockResolvedValue([{ dedupeKey: k }])
      expect((await listPendingSupportRefundNotices()).items, k).toEqual([])
    }
  })

  it('THE LEGACY KEY IS CONSULTED — but ONLY for a row that could own one, or T-47’s collision reopens', async () => {
    // Before T-47 (ae98239, 2026-09-10) the key was `order:<orderId>:<amountCents>`, and the clean-room
    // runbook records that those pilot dispatches exist and are NEVER deleted. So a PRE-cutoff row must
    // consult it, or a customer already told in the pilot is told a second time.
    expect(refundNoticeKeys({ id: ROW, stripeRefundId: RE, orderId: 'o1', amountCents: 500, createdAt: PRE_T47 }))
      .toEqual([`refund:${RE}`, `refund:${ROW}`, 'order:o1:500'])
    world()
    db.refund.findMany.mockResolvedValue([row({ createdAt: PRE_T47, settledAt: PRE_T47 })])
    db.emailDispatch.findMany.mockResolvedValue([{ dedupeKey: 'order:o1:500' }])
    expect((await listPendingSupportRefundNotices()).items).toEqual([])
    expect(db.emailDispatch.findMany.mock.calls[0][0].where.dedupeKey.in).toContain('order:o1:500')
    expect(db.emailDispatch.findMany.mock.calls[0][0].where.trigger).toBe(REFUND_CONFIRMATION_TRIGGER)

    // …AND A POST-CUTOFF ROW MUST NOT. Found by the adversarial review of this lot: appending the legacy key
    // unconditionally re-opened the exact bug T-47 was created to fix — two DISTINCT legitimate refunds of the
    // SAME amount on one order share `order:<id>:<cents>`. A pilot-era 500 c dispatch would then suppress a
    // brand-new, unrelated 500 c refund: dropped from the list, 409 « already_sent », and the customer never
    // told about the second 500 c. A row created after the cutoff cannot own a legacy key, so consulting it
    // carries only that false-negative risk.
    expect(refundNoticeKeys({ id: ROW, stripeRefundId: RE, orderId: 'o1', amountCents: 500, createdAt: POST_T47 }))
      .toEqual([`refund:${RE}`, `refund:${ROW}`])
    world()
    db.refund.findMany.mockResolvedValue([row({ createdAt: POST_T47, settledAt: POST_T47 })])
    db.emailDispatch.findMany.mockResolvedValue([{ dedupeKey: 'order:o1:500' }])   // the pilot dispatch
    expect((await listPendingSupportRefundNotices()).items.map((i) => i.rowId)).toEqual([ROW])
    expect(db.emailDispatch.findMany.mock.calls[0][0].where.dedupeKey.in).not.toContain('order:o1:500')
  })

  it('a DISOWNED claim is not a binder, so the repair stays reachable (§21 vs resume_mismatch)', async () => {
    // Found by the adversarial review. A 500 c support refund left pending, then a later 300 c claim's
    // RESUME-FIRST adopts that row, cannot match the amount, and is marked `resume_mismatch` — the engine
    // saying « that row is not this claim's ». Counting it as a binder SUPPRESSED the row from this list, i.e.
    // made the repair button unreachable for a customer who was refunded and never told. Every other module
    // excludes such a claim; this one now uses the same shape, with the explicit null branch MySQL needs.
    await listPendingSupportRefundNotices()
    expect(db.claim.findMany.mock.calls[0][0].where.OR).toEqual([
      { refundError: null }, { NOT: { refundError: { startsWith: 'resume_mismatch' } } },
    ])
    // and the per-row re-check asks the same question, so preview and act cannot disagree
    await resolveSupportNoticeTarget(ROW)
    expect(db.claim.count.mock.calls[0][0].where.OR).toEqual([
      { refundError: null }, { NOT: { refundError: { startsWith: 'resume_mismatch' } } },
    ])
  })

  it('a legacy id that is not a Stripe refund id is excluded — its button could never work', async () => {
    // The row-reading contract is `re_` + something (it must name an object we can retrieve), NOT a length
    // rule: `re_x` is short but nameable, and excluding it would disagree with the frozen §24 set about
    // which rows count. What IS excluded is a row whose id names nothing retrievable.
    for (const bad of ['re_', 'rf_legacy_1', 'pi_1', '', null]) {
      world()
      db.refund.findMany.mockResolvedValue([row({ stripeRefundId: bad })])
      expect((await listPendingSupportRefundNotices()).items, JSON.stringify(bad)).toEqual([])
    }
    world()
    db.refund.findMany.mockResolvedValue([row({ stripeRefundId: 're_x' })])
    expect((await listPendingSupportRefundNotices()).items.map((i) => i.rowId)).toEqual([ROW])
  })

  it('the ghost-order auto-refund is listed and labelled « system », not « support »', async () => {
    db.refund.findMany.mockResolvedValue([row({ reason: 'ghost_order_expired' })])
    expect((await listPendingSupportRefundNotices()).items[0].origin).toBe('system')
  })

  it('« partiel » is MEASURED from the order total, never assumed', async () => {
    db.refund.groupBy.mockResolvedValue([{ orderId: 'o1', _sum: { amountCents: 500 } }])
    expect((await listPendingSupportRefundNotices()).items[0].partial).toBe(true)   // 500 < 1450
    world()
    db.refund.groupBy.mockResolvedValue([{ orderId: 'o1', _sum: { amountCents: 1450 } }])
    expect((await listPendingSupportRefundNotices()).items[0].partial).toBe(false)  // fully refunded
  })

  it('ZERO LEAK — a listed row carries no Stripe id, no idempotency key and no recipient', async () => {
    const out = await listPendingSupportRefundNotices()
    expect(Object.keys(out.items[0]).sort()).toEqual(['amountCents', 'orderRef', 'origin', 'partial', 'restaurantName', 'rowId', 'settledAt'])
    const json = JSON.stringify(out)
    for (const secret of [RE, 'refund:o1:0', 'buyer@x.com', 'pi_']) expect(json, secret).not.toContain(secret)
    // the PUBLIC reference is what an admin reads, not the raw cuid
    expect(out.items[0].orderRef).toMatch(/^GR-/)
  })
})

// ── §20 — THE STRIPE RE-READ, which is the whole safety of this route ════════════════════════════════
describe('E3 — the route re-reads Stripe and sends STRIPE’s amount', () => {
  it('it retrieves the refund READ-ONLY and never writes to Stripe', async () => {
    await post()
    expect(stripeMock.refunds.retrieve).toHaveBeenCalledWith(RE)
    expect(Object.keys(stripeMock.refunds)).toEqual(['retrieve'])
    const src = require('node:fs').readFileSync('app/api/admin/refunds/rows/[rowId]/notify/route.ts', 'utf8') as string
    for (const forbidden of ['refunds.create', 'refunds.update', 'refunds.cancel', '@/lib/refund\'', '@/lib/claim-emails']) {
      expect(src, forbidden).not.toContain(forbidden)
    }
  })

  it('the e-mail states STRIPE’s amount, not ours, when the two disagree', async () => {
    stripeMock.refunds.retrieve.mockResolvedValue({ id: RE, status: 'succeeded', amount: 480 })
    const res = await post()
    expect(res.status).toBe(200)
    expect(sendRefund.mock.calls[0][0].refundedCents).toBe(480)
    expect(sendRefund.mock.calls[0][0].refundedCents).not.toBe(500)
    expect((await res.json()).amountCents).toBe(480)
  })

  it('reverted / failed / canceled ⇒ 0 mail, 409, and a support_row_reverted alert', async () => {
    for (const status of ['failed', 'canceled', 'pending', 'requires_action']) {
      world()
      stripeMock.refunds.retrieve.mockResolvedValue({ id: RE, status, amount: 500 })
      const res = await post()
      expect(res.status, status).toBe(409)
      expect(await res.json(), status).toMatchObject({ error: 'support_row_reverted', notified: false })
      expect(sendRefund, status).not.toHaveBeenCalled()
      expect(alert.mock.calls[0][0], status).toMatchObject({ kind: 'support_row_reverted' })
      expect(alert.mock.calls[0][0].facts, status).toMatchObject({ customerNotified: false, moneyMoved: false })
    }
  })

  it('a non-integer or non-positive Stripe amount ⇒ no mail either', async () => {
    for (const amount of [0, -1, 1.5, null, undefined]) {
      world()
      stripeMock.refunds.retrieve.mockResolvedValue({ id: RE, status: 'succeeded', amount })
      expect((await post()).status, String(amount)).toBe(409)
      expect(sendRefund).not.toHaveBeenCalled()
    }
  })

  it('Stripe UNREADABLE is not « reverted »: 502, no mail, and NO alert claiming a contradiction', async () => {
    stripeMock.refunds.retrieve.mockRejectedValue(new Error('network'))
    const res = await post()
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: 'stripe_unreadable', notified: false })
    expect(sendRefund).not.toHaveBeenCalled()
    // We learned nothing, so we assert nothing — an alert here would call an outage a money contradiction.
    expect(alert).not.toHaveBeenCalled()
  })

  it('an alert that itself fails does not turn the refusal into a 500', async () => {
    stripeMock.refunds.retrieve.mockResolvedValue({ id: RE, status: 'failed', amount: 500 })
    alert.mockRejectedValue(new Error('smtp down'))
    expect((await post()).status).toBe(409)
  })
})

// ── §21 / §22 — REFUSALS AND DEDUPE ═════════════════════════════════════════════════════════════════
describe('E3 — it refuses rather than duplicates', () => {
  it('claim-bound ⇒ 409 claim_bound, by the reason stamp OR by a live binder (§21)', async () => {
    db.refund.findUnique.mockResolvedValue(row({ reason: 'claim:cl_9' }))
    expect(await (await post()).json()).toMatchObject({ error: 'claim_bound', notified: false })
    world()
    db.claim.count.mockResolvedValue(1)
    expect(await (await post()).json()).toMatchObject({ error: 'claim_bound' })
    expect(sendRefund).not.toHaveBeenCalled()
    expect(stripeMock.refunds.retrieve).not.toHaveBeenCalled()  // refused BEFORE touching Stripe
  })

  it('already announced ⇒ 409 already_sent, and Stripe is never called', async () => {
    db.emailDispatch.count.mockResolvedValue(1)
    const res = await post()
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ error: 'already_sent' })
    expect(stripeMock.refunds.retrieve).not.toHaveBeenCalled()
  })

  it('the dedupe key is the REFUND’s identity, so TEN replays send at most ONE e-mail (§22)', async () => {
    // The route claims the key; `sendTransactional` answers 'duplicate' from the second attempt on. The
    // route passes the SAME key every time, which is the property that makes that possible.
    const keys: string[] = []
    sendRefund.mockImplementation(async (p: { dedupeKey: string }) => {
      keys.push(p.dedupeKey)
      return { status: keys.length === 1 ? 'sent' : 'duplicate' }
    })
    const statuses: string[] = []
    for (let i = 0; i < 10; i++) { world(); sendRefund.mockImplementation(async (p: { dedupeKey: string }) => { keys.push(p.dedupeKey); return { status: keys.length === 1 ? 'sent' : 'duplicate' } }); statuses.push((await (await post()).json()).status) }
    expect(new Set(keys).size).toBe(1)
    expect(keys[0]).toBe(`refund:${RE}`)
    expect(statuses.filter((s) => s === 'sent')).toHaveLength(1)
    expect(statuses.filter((s) => s === 'duplicate')).toHaveLength(9)
  })

  it('a duplicate answer is reported as such, never as « sent »', async () => {
    sendRefund.mockResolvedValue({ status: 'duplicate' })
    expect(await (await post()).json()).toMatchObject({ notified: false, status: 'duplicate' })
  })

  it('the other refusals each answer 409 with their own code and send nothing', async () => {
    const cases: Array<[string, () => void]> = [
      ['row_missing',       () => db.refund.findUnique.mockResolvedValue(null)],
      ['not_succeeded',     () => db.refund.findUnique.mockResolvedValue(row({ status: 'pending' }))],
      ['refund_id_unknown', () => db.refund.findUnique.mockResolvedValue(row({ stripeRefundId: null }))],
      ['external_mirror',   () => db.refund.findUnique.mockResolvedValue(row({ idempotencyKey: `${EXTERNAL_KEY_PREFIX}${RE}` }))],
      ['order_missing',     () => db.order.findUnique.mockResolvedValue(null)],
      ['no_recipient',      () => db.operator.findUnique.mockResolvedValue({ email: null, name: null })],
    ]
    for (const [code, arrange] of cases) {
      world(); arrange()
      const res = await post()
      expect(res.status, code).toBe(409)
      expect(await res.json(), code).toMatchObject({ error: code, notified: false })
      expect(sendRefund, code).not.toHaveBeenCalled()
    }
  })

  it('resolveSupportNoticeTarget is the SINGLE implementation both GET and POST consult', async () => {
    // The preview and the act must not be able to disagree. GET renders the same verdict POST enforces.
    db.refund.findUnique.mockResolvedValue(row({ reason: 'claim:cl_9' }))
    const preview = await GET(new Request('http://x') as never, { params: { rowId: ROW } })
    expect(await preview.json()).toEqual({ eligible: false, reason: 'claim_bound' })
    const direct = await resolveSupportNoticeTarget(ROW)
    expect(direct).toEqual({ ok: false, refusal: 'claim_bound' })
    // …and the preview never calls Stripe: it must stay cheap.
    expect(stripeMock.refunds.retrieve).not.toHaveBeenCalled()
  })

  it('GET on an eligible row previews the ORDER and the amount, never the Stripe id or the recipient', async () => {
    const res = await GET(new Request('http://x') as never, { params: { rowId: ROW } })
    const body = await res.json()
    expect(body).toMatchObject({ eligible: true, amountCents: 500, partial: true })
    expect(body.orderRef).toMatch(/^GR-/)
    expect(JSON.stringify(body)).not.toContain(RE)
    expect(JSON.stringify(body)).not.toContain('buyer@x.com')
  })
})

describe('E3 — the dedupe marker is VERIFIED, not assumed (§22 cannot rest on a guard that fails open)', () => {
  it('a send whose EmailDispatch row never landed is reported as NOT deduplicated, and alerted', async () => {
    // `sendTransactional` claims its dispatch row before sending and, on any error that is not a uniqueness
    // violation (a missing or unmigrated table → P2021), logs and sends ANYWAY rather than swallow the mail.
    // For the money rail that is the right trade. HERE it is not: this route's eligibility is defined as « no
    // dispatch row exists », so a marker that never landed leaves the row back in the « avis non envoyés »
    // list, inviting a SECOND notice for one refund. Found by the adversarial review of this lot.
    world()
    db.emailDispatch.count.mockResolvedValueOnce(0)   // the eligibility check: nothing sent yet
      .mockResolvedValueOnce(0)                        // …and after the send, STILL nothing → marker missing
    const res = await post()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ notified: true, status: 'sent', deduped: false })
    expect(alert.mock.calls.some((c) => c[0]?.facts?.dedupeRowWritten === false)).toBe(true)
    expect(alert.mock.calls.find((c) => c[0]?.facts?.dedupeRowWritten === false)![0].facts.customerNotified).toBe(true)
  })

  it('the ordinary send reports deduped:true, so the admin knows pressing again is safe to refuse', async () => {
    world()
    db.emailDispatch.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1)
    expect(await (await post()).json()).toMatchObject({ notified: true, status: 'sent', deduped: true })
    expect(alert).not.toHaveBeenCalled()
  })
})

// ── §23 — THE POST-MONEY KILL-SWITCH (S-25) ═════════════════════════════════════════════════════════
describe('E3 — post-money is NOT gated, because the money already left (§23, S-25)', () => {
  it('with SURFACE, INTAKE and REFUNDS all false, a proven refund is still notifiable', async () => {
    const before = {
      CLAIMS_SURFACE_ENABLED: process.env.CLAIMS_SURFACE_ENABLED,
      CLAIMS_INTAKE_ENABLED:  process.env.CLAIMS_INTAKE_ENABLED,
      CLAIMS_ENABLED:         process.env.CLAIMS_ENABLED,
      REFUNDS_ENABLED:        process.env.REFUNDS_ENABLED,
    }
    try {
      process.env.CLAIMS_SURFACE_ENABLED = 'false'
      process.env.CLAIMS_INTAKE_ENABLED  = 'false'
      process.env.CLAIMS_ENABLED         = 'false'
      process.env.REFUNDS_ENABLED        = 'false'
      const res = await post()
      expect(res.status).toBe(200)
      expect(await res.json()).toMatchObject({ notified: true, status: 'sent' })
      expect(sendRefund).toHaveBeenCalledTimes(1)
    } finally {
      for (const [k, v] of Object.entries(before)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
    }
  })

  it('SOURCE PIN — the route reads no claims flag and no refund gate at all', () => {
    const src = require('node:fs').readFileSync('app/api/admin/refunds/rows/[rowId]/notify/route.ts', 'utf8') as string
    // Asserted on the CODE with comments stripped. The route's header EXPLAINS why it is not gated and names
    // CLAIMS_SURFACE_ENABLED to do so — naming a flag in prose to say « not this one » must stay possible,
    // and asserting on raw source would forbid the explanation while permitting the mistake.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    for (const forbidden of ['claimsSurfaceOpen', 'claimsIntakeOpen', 'isClaimsEnabled', 'refundGateState', 'isRefundsEnabled', 'claimNoticeGate', 'CLAIMS_', 'REFUNDS_ENABLED', 'process.env']) {
      expect(code, forbidden).not.toContain(forbidden)
    }
    // …and the explanation IS present, so the absence above is a decision and not an omission.
    expect(src).toContain('THE MONEY HAS ALREADY LEFT')
  })

  it('but it IS admin-gated, and by resolveAdmin — which honours an admin ROLE GRANT', async () => {
    // The sibling void route inlines `operator.role !== 'admin'`, which REFUSES an operator holding an admin
    // grant. §19 names resolveAdmin, and that difference is the reason.
    adminMock.mockResolvedValue(null)
    const res = await post()
    expect(res.status).toBe(403)
    expect(sendRefund).not.toHaveBeenCalled()
    const src = require('node:fs').readFileSync('app/api/admin/refunds/rows/[rowId]/notify/route.ts', 'utf8') as string
    expect(src).toContain('resolveAdmin')
    expect(src).not.toContain("role !== 'admin'")
  })

  it('the rate limit runs BEFORE the session lookup, so a flood costs no query', async () => {
    rateLimitMock.mockReturnValue(new Response('slow down', { status: 429 }))
    const res = await post()
    expect(res.status).toBe(429)
    expect(adminMock).not.toHaveBeenCalled()
    expect(db.refund.findUnique).not.toHaveBeenCalled()
  })
})

// ── the trace ═══════════════════════════════════════════════════════════════════════════════════════
describe('E3 — the trace, and what it must not contain', () => {
  it('an audit row is written after the send, with no address and no Stripe id', async () => {
    await post()
    const a = audit.mock.calls[0][0]
    expect(a).toMatchObject({ actorId: 'adm1', action: 'refund.support_notice', targetType: 'refund', targetId: ROW })
    expect(a.metadata).toMatchObject({ emailStatus: 'sent', moneyMoved: false })
    const json = JSON.stringify(a)
    expect(json).not.toContain(RE)
    expect(json).not.toContain('buyer@x.com')
  })

  it('an audit failure does not undo or hide a send that already happened', async () => {
    audit.mockRejectedValue(new Error('db down'))
    const res = await post()
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ notified: true })
  })

  it('NO WRITE to the Refund row, the Claim or the ledger — this route only reads and sends', () => {
    const src = require('node:fs').readFileSync('app/api/admin/refunds/rows/[rowId]/notify/route.ts', 'utf8') as string
    const lib = require('node:fs').readFileSync('lib/support-refund-notices.ts', 'utf8') as string
    for (const body of [src, lib]) {
      for (const forbidden of ['.update(', '.updateMany(', '.create(', '.delete(', '.upsert(', 'recordLedgerEntry', '$transaction']) {
        expect(body, forbidden).not.toContain(forbidden)
      }
    }
  })
})
