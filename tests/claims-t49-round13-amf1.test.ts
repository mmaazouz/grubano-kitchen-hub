// tests/claims-t49-round13-amf1.test.ts — T-49 round 13, slice W5: J-M-AMF1 (FREEZE NOTES AMF-1; E-09 closed to a 35-day
// residual; G13 amendment).
//
// reverifySettledClaimRefunds re-reads, read-only toward Stripe, the claims settled in the last lookbackDays (at most
// `take`), and marks — claim only (G11) — a settled claim whose refund Stripe now reports failed or canceled, with the
// I-01 alert and the claim.reconcile_evidence {moneyMoved:false} audit. recoverStrandedClaimReconciliations runs it after
// its existing pass; POST /api/admin/claims/reconcile-refunds accepts the cron token OR an admin session.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { payableWorld, wireWorld, refundRow, stripeRefund, HOURS, type World } from './support/claims-world'

const { db } = vi.hoisted(() => ({
  db: {
    claim:  { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    refund: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    order:  { findUnique: vi.fn() },
    franchiseRoyalty: { findFirst: vi.fn() },
    emailDispatch: { create: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
const { engine } = vi.hoisted(() => ({ engine: { executeRefund: vi.fn(), markRefundRowFailed: vi.fn(), finalizeRefundRowFromStripe: vi.fn(), isRefundsEnabled: vi.fn() } }))
vi.mock('@/lib/refund', () => ({ ...engine, RESUME_CREATE_WINDOW_MS: 20 * 60 * 60 * 1000 }))
const { alertMock, auditMock, adminMock, sessionMock, cronMock } = vi.hoisted(() => ({ alertMock: vi.fn(), auditMock: vi.fn(), adminMock: vi.fn(), sessionMock: vi.fn(), cronMock: vi.fn() }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: alertMock }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: auditMock }))
vi.mock('@/lib/admin-guard', () => ({ resolveAdmin: adminMock }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/safe-compare', async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), isInternalCronRequest: cronMock }))
const { stripeMock } = vi.hoisted(() => ({
  stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() } },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

import { reverifySettledClaimRefunds, recoverStrandedClaimReconciliations } from '@/lib/claims'
import { POST as RECONCILE_REFUNDS } from '@/app/api/admin/claims/reconcile-refunds/route'
import { MARKERS } from '@/lib/claim-action-rules'

const DAY = 24 * HOURS
let w: World
/** A settled claim `cl<n>` on its own row `rf<n>` (re<n>), settled `ageDays` ago. */
function addSettled(n: number, row: Record<string, unknown>, stripe: Record<string, unknown> | null, ageDays = 1) {
  const decidedAt = new Date(Date.now() - ageDays * DAY)
  w.claims.push({ id: `cl${n}`, orderId: 'o1', consumerId: 'c1', status: 'refunded', refundAttempted: true, refundId: `rf${n}`, refundError: null, activeOrderKey: null, decidedAt, createdAt: new Date(decidedAt.getTime() - HOURS) })
  w.refunds.push(refundRow(`rf${n}`, { status: 'succeeded', stripeRefundId: `re_${n}`, reason: `claim:cl${n}`, createdAt: new Date(decidedAt.getTime() - HOURS), ...row }))
  if (stripe) w.stripeRefunds.push(stripeRefund(`re_${n}`, stripe))
}
function freshWorld() {
  w = payableWorld()
  w.claims.length = 0
  wireWorld(w, db, stripeMock)
  return w
}
const blocked = () => alertMock.mock.calls.map((c) => c[0]).filter((a) => a.kind === 'claim_payment_blocked')

beforeEach(() => {
  vi.clearAllMocks()
  for (const m of [...Object.values(engine), alertMock, auditMock, adminMock, sessionMock, cronMock, db.refund.update, db.refund.updateMany]) m.mockReset()
  alertMock.mockResolvedValue({ status: 'sent' })
  auditMock.mockResolvedValue(true)
  cronMock.mockReturnValue(false)
  freshWorld()
})

describe('J-M-AMF1 — reverifySettledClaimRefunds', () => {
  it('(a) a succeeded row whose retrieve returns failed → marked (claim only), I-01 sent, audit moneyMoved false; executeRefund / refunds.create not called', async () => {
    addSettled(1, {}, { status: 'failed' })
    const out = await reverifySettledClaimRefunds()
    expect(out).toEqual({ checked: 1, reverted: 1, standing: 0, unreadable: 0, unproven: 0, truncated: false })
    expect(w.claims[0]).toMatchObject({ status: 'refunded' })
    expect(String(w.claims[0].refundError).startsWith(MARKERS.REVERTED_AFTER_REFUND)).toBe(true)
    expect(blocked()).toHaveLength(1)
    expect(blocked()[0]).toMatchObject({ dedupeKey: 'claim_blocked:cl1:reverted_after_refund' })
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'system:cron', action: 'claim.reconcile_evidence', targetId: 'cl1', metadata: expect.objectContaining({ outcome: 'reverted_after_refund', moneyMoved: false }) }))
    expect(engine.executeRefund).not.toHaveBeenCalled()
    expect(stripeMock.refunds.create).not.toHaveBeenCalled()
    expect(db.refund.update).not.toHaveBeenCalled()
  })

  it('a PENDING row whose refund failed at Stripe → marked with the pending-row text; the row untouched', async () => {
    addSettled(1, { status: 'pending' }, { status: 'canceled' })
    const before = JSON.stringify(w.refunds)
    expect(await reverifySettledClaimRefunds()).toMatchObject({ checked: 1, reverted: 1 })
    expect(String(w.claims[0].refundError)).toContain('encore « en attente » dans notre base')
    expect(JSON.stringify(w.refunds)).toBe(before)
  })

  it('(b) retrieve succeeded → no write, counted standing', async () => {
    addSettled(1, {}, { status: 'succeeded' })
    expect(await reverifySettledClaimRefunds()).toEqual({ checked: 1, reverted: 0, standing: 1, unreadable: 0, unproven: 0, truncated: false })
    expect(w.writes).toEqual([])
    expect(blocked()).toEqual([])
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('(c) unreadable → counted, no write; a 404 contradiction and a pending row within its window → unproven, no write', async () => {
    addSettled(1, {}, null)
    w.fail.refundRetrieve = { re_1: 'throw' }
    addSettled(2, {}, null)
    w.fail.refundRetrieve.re_2 = 'missing'
    addSettled(3, { status: 'pending', stripeRefundId: null, createdAt: new Date(Date.now() - HOURS) }, null)
    expect(await reverifySettledClaimRefunds()).toEqual({ checked: 3, reverted: 0, standing: 0, unreadable: 1, unproven: 2, truncated: false })
    expect(w.writes).toEqual([])
  })

  it('(d) a claim settled outside lookbackDays is not selected (where clause and the restated selection)', async () => {
    addSettled(1, {}, { status: 'failed' }, 40)
    expect(await reverifySettledClaimRefunds()).toEqual({ checked: 0, reverted: 0, standing: 0, unreadable: 0, unproven: 0, truncated: false })
    expect(w.writes).toEqual([])
    const where = db.claim.findMany.mock.calls[0][0].where
    expect(where).toMatchObject({ status: 'refunded', refundError: null, refundId: { not: null } })
    const since = (where.OR[0].decidedAt.gte as Date).getTime()
    expect(Math.abs(Date.now() - 35 * DAY - since)).toBeLessThan(60_000)
    // NEGATIVE CONTROL — the same claim with a wider lookback is re-verified and marked.
    expect(await reverifySettledClaimRefunds({ lookbackDays: 45 })).toMatchObject({ checked: 1, reverted: 1 })
  })

  it('(e) the take bound is reached → truncated true, oldest first', async () => {
    addSettled(1, {}, { status: 'succeeded' }, 3)
    addSettled(2, {}, { status: 'succeeded' }, 2)
    addSettled(3, {}, { status: 'succeeded' }, 1)
    expect(await reverifySettledClaimRefunds({ take: 2 })).toMatchObject({ checked: 2, standing: 2, truncated: true })
    expect(db.claim.findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 3, orderBy: [{ decidedAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] })
    expect(await reverifySettledClaimRefunds({ take: 3 })).toMatchObject({ checked: 3, truncated: false })
  })

  // W5 fixer (AMF-1 selection): the row conditions are part of the selection — `take` and `truncated` count ELIGIBLE claims.
  it('(e′) take 1: the oldest settled claim is on a FAILED row (ineligible), the next one reverted → checked 1, reverted 1, truncated false', async () => {
    addSettled(1, { status: 'failed' }, null, 3)
    addSettled(2, {}, { status: 'failed' }, 2)
    expect(await reverifySettledClaimRefunds({ take: 1 })).toEqual({ checked: 1, reverted: 1, standing: 0, unreadable: 0, unproven: 0, truncated: false })
    expect(String(w.claims[1].refundError).startsWith(MARKERS.REVERTED_AFTER_REFUND)).toBe(true)
    expect(w.claims[0].refundError).toBeNull()
  })

  it('(e″) paged read (skip / take honoured): ineligible claims never use a slot; truncated only when more ELIGIBLE claims than take remain', async () => {
    // A findMany that honours orderBy decidedAt, skip and take, as the database does (over the world's own implementation).
    const world = db.claim.findMany.getMockImplementation() as unknown as (x: unknown) => Promise<Array<Record<string, unknown>>>
    db.claim.findMany.mockImplementation(async (a: { where: Record<string, unknown>; skip?: number; take?: number }) => {
      const all = (await world({ where: a.where })).sort((x, y) => new Date(x.decidedAt as Date).getTime() - new Date(y.decidedAt as Date).getTime())
      return all.slice(a.skip ?? 0, (a.skip ?? 0) + (a.take ?? all.length))
    })
    addSettled(1, { orderId: 'o_other' }, { status: 'failed' }, 5)
    addSettled(2, { status: 'failed' }, null, 4)
    addSettled(3, {}, { status: 'failed' }, 3)
    expect(await reverifySettledClaimRefunds({ take: 1 })).toEqual({ checked: 1, reverted: 1, standing: 0, unreadable: 0, unproven: 0, truncated: false })
    expect(db.claim.findMany.mock.calls.length).toBeGreaterThan(1) // pages were read past the two ineligible claims
    // NEGATIVE CONTROL — two more eligible claims beyond the bound → truncated true, the oldest eligible first.
    addSettled(4, {}, { status: 'succeeded' }, 2)
    addSettled(5, {}, { status: 'succeeded' }, 1)
    expect(await reverifySettledClaimRefunds({ take: 1 })).toEqual({ checked: 1, reverted: 0, standing: 1, unreadable: 0, unproven: 0, truncated: true })
  })

  it('a row on another order, a failed row, or a claim with a recorded error is never re-verified', async () => {
    addSettled(1, { orderId: 'o_other' }, { status: 'failed' })
    addSettled(2, { status: 'failed' }, null)
    addSettled(3, {}, { status: 'failed' })
    w.claims[2].refundError = `${MARKERS.DECLARED_AFTER_REVERT} déclaration`
    expect(await reverifySettledClaimRefunds()).toMatchObject({ checked: 0, reverted: 0 })
    expect(w.writes).toEqual([])
  })
})

describe('J-M-AMF1 (f) — POST /api/admin/claims/reconcile-refunds: cron token OR resolveAdmin, not gated by CLAIMS', () => {
  const post = () => RECONCILE_REFUNDS(new Request('https://app.grubano.com/api/admin/claims/reconcile-refunds', { method: 'POST' }) as never)

  it('no session → 401; a non-admin session → 403; nothing read', async () => {
    sessionMock.mockResolvedValue(null)
    expect((await post()).status).toBe(401)
    sessionMock.mockResolvedValue({ user: { email: 'resto@x.test' } })
    adminMock.mockResolvedValue(null)
    expect((await post()).status).toBe(403)
    expect(db.claim.findMany).not.toHaveBeenCalled()
  })

  it('an admin session → 200 with the summary; the cron token → 200', async () => {
    addSettled(1, {}, { status: 'failed' })
    sessionMock.mockResolvedValue({ user: { email: 'a@x.test' } })
    adminMock.mockResolvedValue({ id: 'op1', role: 'admin', name: 'Admin', email: 'a@x.test' })
    const res = await post()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, scanned: 0, settledReverify: { checked: 1, reverted: 1, standing: 0, unreadable: 0, unproven: 0, truncated: false } })
    expect(body).not.toHaveProperty('closureEmails')
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'op1', actorEmail: 'a@x.test' }))
    cronMock.mockReturnValue(true)
    sessionMock.mockReset()
    const cron = await post()
    expect(cron.status).toBe(200)
    expect(sessionMock).not.toHaveBeenCalled()
    // the claim is already marked: the second pass selects nothing more
    expect((await cron.json()).settledReverify).toMatchObject({ checked: 0 })
  })

  it('(a) through the route — the settled re-verification is part of the cron pass (BREAK/RESTORE: drop the call → red)', async () => {
    addSettled(1, {}, { status: 'failed' })
    cronMock.mockReturnValue(true)
    expect((await post()).status).toBe(200)
    expect(String(w.claims[0].refundError).startsWith(MARKERS.REVERTED_AFTER_REFUND)).toBe(true)
    expect(blocked()).toHaveLength(1)
    const src = readFileSync('lib/claims.ts', 'utf8').replace(/\r\n/g, '\n')
    const body = src.slice(src.indexOf('export async function recoverStrandedClaimReconciliations('), src.indexOf('async function recoverStrandedPass('))
    expect(body).toContain('out.settledReverify = await reverifySettledClaimRefunds({ actor: opts.actor })')
    expect(body.indexOf('await recoverStrandedPass(out, limit)')).toBeLessThan(body.indexOf('reverifySettledClaimRefunds('))
  })

  it('a failed selection read answers 500, never « ok »', async () => {
    cronMock.mockReturnValue(true)
    w.fail.claimFindMany = true
    const res = await post()
    expect(res.status).toBe(500)
    expect((await res.json())).toEqual({ error: 'Recovery error' })
    await expect(recoverStrandedClaimReconciliations()).rejects.toThrow('db down')
  })

  it('the route source: resolveAdmin or the cron token, no CLAIMS gate, no e-mail import', () => {
    const src = readFileSync('app/api/admin/claims/reconcile-refunds/route.ts', 'utf8')
    expect(src).toContain('isInternalCronRequest(req)')
    expect(src).toContain('await resolveAdmin()')
    expect(src).not.toMatch(/isClaimsEnabled|claimsGateState|claim-emails|sendClaimClosureEmail|markClaimsForRevertedRefundRow/)
  })
})
