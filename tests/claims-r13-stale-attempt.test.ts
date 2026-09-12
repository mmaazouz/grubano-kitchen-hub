// tests/claims-r13-stale-attempt.test.ts — T-49 round 13, slice W2: J-M22 (C5, B6 (4), A-S41, E-11, I-03).
//
// HARD INVARIANT: a late or stalled attempt never overwrites a claim bound, reconciled or closed since it
// started. executeRefund is held open after T1 wrote M; the claim moves on; the engine returns. Every post-
// engine write is a CAS on {refunding, M}: it matches nothing, the claim is byte-identical, and only a human
// money-review alert says that the attempt created or drove a row the claim does not reflect.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { payableWorld, wireWorld, refundRow, claimOf, engineOk, engine202, engineRefusal, type World } from './support/claims-world'

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
const { alertMock } = vi.hoisted(() => ({ alertMock: vi.fn() }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: alertMock }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: vi.fn() }))
const { stripeMock } = vi.hoisted(() => ({
  stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() } },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

import { triggerClaimRefund, attributeClaimRefund } from '@/lib/claims'
import { MARKERS, HEAD_A } from '@/lib/claim-action-rules'

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')

let w: World
beforeEach(() => {
  vi.clearAllMocks()
  for (const m of [execMock, alertMock, refundsFlag]) m.mockReset()
  refundsFlag.mockReturnValue(true)
  alertMock.mockResolvedValue({ status: 'sent' })
  w = payableWorld()
  wireWorld(w, db, stripeMock)
})

/** Holds executeRefund open until release(result); the row the engine returns is written into the base on release. */
function holdEngine() {
  let release!: (v: unknown) => void
  const held = new Promise((resolve) => { release = resolve })
  execMock.mockImplementation(() => held)
  return release
}
const engineCalled = async () => { for (let i = 0; i < 200 && execMock.mock.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 0)) }

const CHANGES: Array<[string, (x: World) => void]> = [
  ['(A) parked FV, then attributed to R2 (refunded)', (x) => {
    x.refunds.push(refundRow('R2', { stripeRefundId: 're_R2', idempotencyKey: 'refund:o1:x' }))
    Object.assign(claimOf(x), { status: 'refunded', refundId: 'R2', refundError: null, activeOrderKey: null })
  }],
  ['(B) reconciled to a v13 proof', (x) => {
    Object.assign(claimOf(x), { status: 'approved', refundAttempted: false, refundId: null, refundError: `${MARKERS.PROOF_PAYABLE_V13} ${HEAD_A} … Elle est payable au plus tôt le ${new Date(Date.now() + 3_600_000).toISOString()} (UTC).` })
  }],
  ['(C) closed by resolve-stuck closed_no_payment', (x) => {
    Object.assign(claimOf(x), { status: 'refused_final', refundError: 'stripe_failed: …', activeOrderKey: null })
  }],
  ['(D) parked FV', (x) => {
    Object.assign(claimOf(x), { status: 'financial_verification', refundError: 'financial_verification:stripe_unreadable: …' })
  }],
]
/** [name, the engine result on release, the signal, the refund row the engine returned (the alert must name it)]. */
const RELEASES: Array<[string, (x: World) => Record<string, unknown>, 'alert' | 'warn', string | null]> = [
  ['(i) ok resumed:true on R9 stamped claim:OTHER', (x) => { x.refunds.push(refundRow('R9', { reason: 'claim:OTHER' })); return engineOk({ resumed: true, refundId: 'R9', stripeRefundId: 're_R9' }) }, 'alert', 'R9'],
  ['(ii) ok resumed:false, own row', (x) => { x.refunds.push(refundRow('rf_new', { reason: 'claim:cl1' })); return engineOk() }, 'alert', 'rf_new'],
  ['(iii) 202 pending', (x) => { x.refunds.push(refundRow('rf_new', { reason: 'claim:cl1', status: 'pending' })); return engine202() }, 'alert', 'rf_new'],
  ['(iv) refusal 409', () => engineRefusal(), 'warn', null],
  ['(v) own row not failed', (x) => { x.refunds.push(refundRow('rf_new', { reason: 'claim:cl1', status: 'pending' })); return engineRefusal('Erreur paiement, réessayez.', 502) }, 'warn', null],
  ['(vi) engine_failed', () => engineRefusal('Paiement déjà intégralement remboursé.'), 'warn', null],
]

describe('J-M22 — a late attempt never overwrites a claim bound, reconciled or closed since', () => {
  for (const [changeName, change] of CHANGES) {
    for (const [releaseName, result, signal, expectedRow] of RELEASES) {
      it(`${changeName} × ${releaseName}`, async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        const release = holdEngine()
        const run = triggerClaimRefund('cl1')
        await engineCalled()
        const M = String(w.writes[0].data.refundError)
        change(w)
        const snapshot = JSON.stringify(claimOf(w))
        const writesBefore = w.writes.length
        release(result(w))
        const r = await run

        expect(r).toEqual({ state: 'failed', error: 'attempt_superseded' })
        const post = w.writes.slice(writesBefore)
        expect(post.length).toBeGreaterThan(0)
        for (const p of post) {
          expect(p.where).toEqual({ id: 'cl1', status: 'refunding', refundError: M })
          expect(p.count).toBe(0)
        }
        expect(JSON.stringify(claimOf(w))).toBe(snapshot)
        expect(db.claim.update).not.toHaveBeenCalled()
        const superseded = (alertMock.mock.calls as Array<[{ kind: string; dedupeKey: string; title: string; facts: Record<string, unknown> }]>).map((c) => c[0])
        expect(superseded.filter((a) => a.kind === 'claim_payment_blocked')).toEqual([])
        if (signal === 'alert') {
          expect(superseded).toHaveLength(1)
          const a = superseded[0]
          // The row the ENGINE returned — never read back from the alert's own facts.
          expect(expectedRow).not.toBeNull()
          expect(a.kind).toBe('claim_attempt_superseded')
          expect(a.dedupeKey).toBe(`claim_attempt:cl1:${expectedRow}`)
          expect(a.facts.refundRowId).toBe(expectedRow)
          expect(Object.keys(a.facts)).toEqual(expect.arrayContaining(['claimId', 'orderId', 'refundRowId', 'stripeRefundId', 'engineStatus', 'resumed', 'claimStatusNow']))
          expect(a.facts.claimStatusNow).toBe(claimOf(w).status)
          expect(`${a.title} ${JSON.stringify(a.facts)}`).not.toMatch(/payé deux fois|paid twice|must be reversed|à rembourser|doit être (rembours|annul)/i)
        } else {
          expect(superseded).toEqual([])
          expect(warn.mock.calls.some((c) => String(c[0]).includes('attempt_superseded'))).toBe(true)
        }
        warn.mockRestore()
      })
    }
  }

  it('(A)(i) after the late return, a third claim W attributing R2 is still refused: bound_to_other_claim', async () => {
    const release = holdEngine()
    const run = triggerClaimRefund('cl1')
    await engineCalled()
    CHANGES[0][1](w)
    release(RELEASES[0][1](w))
    await run
    expect(claimOf(w).refundId).toBe('R2')
    w.claims.push({ id: 'W', orderId: 'o1', status: 'financial_verification', refundId: null, refundError: 'financial_verification:refund_moved_unattributed: …' })
    const out = await attributeClaimRefund({ claimId: 'W', refundRowId: 'R2', adminId: 'admin1' })
    expect(out).toMatchObject({ ok: false, status: 409 })
    expect((out as { error: string }).error).toContain('cl1')
    expect(claimOf(w, 'W').status).toBe('financial_verification')
  })

  it('NEGATIVE CONTROL — no concurrent change: (ii) writes refunded with refundId = own row (count 1)', async () => {
    const release = holdEngine()
    const run = triggerClaimRefund('cl1')
    await engineCalled()
    release(RELEASES[1][1](w))
    expect(await run).toEqual({ state: 'refunded', refundId: 'rf_new', amountCents: 500 })
    expect(w.writes.at(-1)!.count).toBe(1)
    expect(claimOf(w)).toMatchObject({ status: 'refunded', refundId: 'rf_new' })
    expect(alertMock).not.toHaveBeenCalled()
  })

  it('AST pin — after executeRefund every claim write of triggerClaimRefund goes through ONE CAS on {id, refunding, M}; no prisma.claim.update remains', () => {
    const src = stripComments(readFileSync('lib/claims.ts', 'utf8').replace(/\r\n/g, '\n'))
    const start = src.indexOf('export async function triggerClaimRefund(')
    const body = src.slice(start, src.indexOf('\n}\n', start))
    expect(body).not.toContain('prisma.claim.update(')
    const afterEngine = body.slice(body.indexOf('const result = await executeRefund('))
    const writes = afterEngine.match(/prisma\.claim\.updateMany\(/g) ?? []
    expect(writes).toHaveLength(1)
    expect(afterEngine).toMatch(/prisma\.claim\.updateMany\(\{\s*where: \{\s*id:\s*claimId,\s*status:\s*'refunding',\s*refundError: M,\s*\},\s*data,\s*\}\)/)
    // every post-engine write is t4Write(...)
    const direct = afterEngine.replace(/const t4Write = async[\s\S]*?return w\.count === 1\n\s*\}/, '')
    expect(direct).not.toMatch(/prisma\.claim\.(update|updateMany)\(/)
  })
})
