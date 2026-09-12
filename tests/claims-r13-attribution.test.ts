// tests/claims-r13-attribution.test.ts — T-49 round 13, slice W4: J-M14 (B10), J-M23 (C6, C7, B6 (2), D8, H05 sites 4-5,
// I-04) and J-M37 (G12).
//
// One Refund settles at most one claim. Attribution reads Stripe's evidence for the row BEFORE any write, then binds it
// in ONE Serializable transaction holding the binder read and the FV → refunded compare-and-set. A lost race writes
// nothing and states only what a re-read shows; the closure record, I-04, the audit and the success follow an observed
// commit only. InnoDB's lock behaviour itself is rehearsed on a real database (J-M24); tests/support/serializable-sim
// models what the transaction boundary buys (shared locks on the scanned rows, a deadlock victim rolled back).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { Prisma } from '@prisma/client'
import { LockSim, wireSim, stripeCalls, type SimState } from './support/serializable-sim'
import { txCallbackPins } from './support/tx-callback-pin'

/* eslint-disable @typescript-eslint/no-explicit-any -- test doubles of Prisma and Stripe payloads */
type Row = Record<string, any>

const { db } = vi.hoisted(() => ({
  db: {
    claim:  { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    refund: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    order:  { findUnique: vi.fn(), findMany: vi.fn() },
    emailDispatch: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
const { execMock } = vi.hoisted(() => ({ execMock: vi.fn() }))
vi.mock('@/lib/refund', () => ({ executeRefund: execMock, isRefundsEnabled: () => false, RESUME_CREATE_WINDOW_MS: 20 * 60 * 60 * 1000 }))
const { alertMock, auditMock } = vi.hoisted(() => ({ alertMock: vi.fn(), auditMock: vi.fn() }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: alertMock }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: auditMock }))
const { stripeMock } = vi.hoisted(() => ({
  stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() } },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))
const { adminMock } = vi.hoisted(() => ({ adminMock: vi.fn() }))
vi.mock('@/lib/admin-guard', () => ({ resolveAdmin: adminMock }))

import { readdirSync } from 'node:fs'
import { attributeClaimRefund, attributeWithEvidence, listFinancialVerificationClaims, FINANCIAL_VERIFICATION, ENGINE_DEAD_MARGIN_MS } from '@/lib/claims'
import { POST as ATTRIBUTE } from '@/app/api/admin/claims/[id]/attribute/route'
import { attributionRefusal, ROW_FAILED_MESSAGE, attributionSuccessText, PENDING_ROW_LEGEND } from '@/lib/claim-attribution-rules'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
const HOUR = 3_600_000
const WINDOW = 20 * HOUR

// C7, IMPLEMENTATION NOTE (W4, fixer round 1): an unchanged re-read after a transaction error establishes that nothing was
// written, not that anything changed (a different-row deadlock, an error before the transaction) — the text says only that.
const NOT_WRITTEN = 'La liaison n’a pas pu être enregistrée (écriture concurrente ou erreur de la base) — rien n’a été écrit. Relisez sa ligne dans la file, puis réessayez.'
const CLAIM_CHANGED = 'Cette réclamation a changé d’état entre-temps — elle n’a pas été modifiée. Relisez sa ligne dans la file.'
const UNESTABLISHED = 'État non établi : la base n’a pas pu confirmer ce qui a été écrit. Relisez la ligne de cette réclamation dans la file avant toute autre action.'
const KEPT = 'La réclamation n’a pas été modifiée.'
const fvError = (id: string) => `financial_verification:refund_moved_unattributed: ${id}`

const fvClaim = (id: string, o: Row = {}): Row => ({
  id, orderId: 'o1', consumerId: 'u1', restaurantId: 'r1', reason: 'wrong_item', requestedAmountCents: 500, createdAt: new Date(), decidedAt: null,
  status: FINANCIAL_VERIFICATION, refundAttempted: true, refundId: null, refundError: fvError(id), activeOrderKey: null, ...o,
})
const rowOf = (id: string, o: Row = {}): Row => ({
  id, orderId: 'o1', restaurantId: 'r1', status: 'succeeded', amountCents: 500, stripeRefundId: `re_${id}`, reason: null,
  idempotencyKey: `refund:o1:k_${id}`, createdAt: new Date(Date.now() - 2 * HOUR), royaltyRefundCents: 0, ...o,
})
const sRefund = (id: string, o: Row = {}): Row => ({
  id, object: 'refund', status: 'succeeded', amount: 500, payment_intent: 'pi_1', charge: 'ch_1', created: 1_700_000_000, metadata: {}, ...o,
})

let s: SimState
function world(claims: Row[], refunds: Row[], stripeRefunds: Row[] = []): SimState {
  s = {
    sim: new LockSim(claims, refunds),
    orders: [{ id: 'o1', restaurantId: 'r1', paymentStatus: 'paid', stripePaymentIntentId: 'pi_1' }],
    pis: { pi_1: { id: 'pi_1', status: 'succeeded', metadata: { orderId: 'o1' }, transfer_data: null, latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 500, disputed: false } } },
    stripeRefunds, retrieveFail: {}, calls: [],
  }
  wireSim(s, db, stripeMock)
  return s
}
const claimOf = (id: string) => s.sim.claims.find((c) => c.id === id)!
const attribute = (claimId: string, refundRowId: string) => attributeClaimRefund({ claimId, refundRowId, adminId: 'op1' })
const refundedOn = (rowId: string) => s.sim.claims.filter((c) => c.status === 'refunded' && c.refundId === rowId)
const records = () => (db.emailDispatch.create.mock.calls as Array<[{ data: { dedupeKey: string } }]>).map((c) => c[0].data.dedupeKey)

beforeEach(() => {
  vi.clearAllMocks()
  for (const m of [execMock, alertMock, auditMock, db.$transaction, db.emailDispatch.create]) m.mockReset()
  alertMock.mockImplementation(async (a: { kind: string }) => { s?.calls.push(`alert:${a.kind}`); return { status: 'sent' } })
  auditMock.mockImplementation(async (a: { action: string }) => { s?.calls.push(`audit:${a.action}`); return true })
})

// ══ J-M14 — B10 refusal order and server / console parity ═══════════════════════════════════════════════
describe('J-M14 — attribution identity refusals: order and server/console parity (B10)', () => {
  it('the pure rule answers in the order (1)..(6) when several refusals apply; a pending id-less row is not refused', () => {
    const r = (row: Row, o: { orderRows?: Array<{ id: string; reason: string | null }>; boundToOtherClaimId?: string | null } = {}) =>
      attributionRefusal({
        claimId: 'C', claimOrderId: 'o1', orderRows: o.orderRows ?? [], boundToOtherClaimId: o.boundToOtherClaimId ?? null,
        row: { id: 'r', orderId: 'o1', status: 'succeeded', reason: null, stripeRefundId: 're_r', ...row } as never,
      })?.code ?? null
    const own = [{ id: 'own', reason: 'claim:C' }]
    expect(r({ orderId: 'o2', reason: 'claim:Y', status: 'failed' }, { orderRows: own, boundToOtherClaimId: 'Z' })).toBe('other_order')
    expect(r({ reason: 'claim:Y', status: 'failed' }, { orderRows: own, boundToOtherClaimId: 'Z' })).toBe('stamped_for_other_claim')
    expect(r({ status: 'failed' }, { orderRows: own, boundToOtherClaimId: 'Z' })).toBe('own_stamp_exists')
    expect(r({ status: 'failed' }, { boundToOtherClaimId: 'Z' })).toBe('bound_to_other_claim')
    expect(r({ status: 'canceled' })).toBe('unusable_status')
    expect(r({ status: 'failed' })).toBe('row_failed')
    expect(r({ status: 'pending', stripeRefundId: null })).toBeNull()
  })

  const SETS: Array<{ name: string; rows: Row[]; others: Row[]; expected: Record<string, string | null> }> = [
    {
      name: 'no row stamped for this claim',
      rows: [
        rowOf('rFree'),
        rowOf('rStampY', { reason: 'claim:cl_Y' }),
        rowOf('rBoundZ'),
        rowOf('rCanceled', { status: 'canceled' }),
        rowOf('rFailed', { status: 'failed' }),
        rowOf('rPendNoId', { status: 'pending', stripeRefundId: null }),
        rowOf('rBoundMismatch'),
      ],
      others: [
        { id: 'cl_Z', orderId: 'o1', status: 'refunded', refundId: 'rBoundZ', refundError: null },
        { id: 'cl_W', orderId: 'o1', status: 'refunding', refundId: 'rBoundMismatch', refundError: 'resume_mismatch: le moteur a repris …' },
      ],
      expected: { rFree: null, rStampY: 'stamped_for_other_claim', rBoundZ: 'bound_to_other_claim', rCanceled: 'unusable_status', rFailed: 'row_failed', rPendNoId: null, rBoundMismatch: null },
    },
    {
      name: 'a row stamped for THIS claim exists',
      rows: [rowOf('rMine', { reason: 'claim:C' }), rowOf('rAdmin', { reason: 'admin:x' })],
      others: [],
      expected: { rMine: null, rAdmin: 'own_stamp_exists' },
    },
  ]
  for (const set of SETS) {
    it(`${set.name}: the console candidate flag === the server pre-check (refused before any Stripe read and any write), row by row`, async () => {
      for (const row of set.rows) {
        const stripe = set.rows.map((x) => sRefund(x.stripeRefundId ?? `re_tag_${x.id}`, x.stripeRefundId ? {} : { metadata: { grubano_refund_row: x.id } }))
        world([fvClaim('C'), ...set.others.map((o) => ({ ...o }))], set.rows.map((x) => ({ ...x })), stripe)
        const listed = await listFinancialVerificationClaims()
        const verdict = Object.fromEntries(listed.find((c) => c.id === 'C')!.candidateRefunds.map((c) => [c.id, c.refusal]))
        expect(verdict).toEqual(set.expected)
        s.calls.length = 0
        const out = await attribute('C', row.id)
        const preCheckRefused = !out.ok && stripeCalls(s.calls).length === 0 && !s.calls.includes('$transaction') && !s.calls.includes('claim.updateMany')
        expect(preCheckRefused, `${row.id}: ${JSON.stringify(out)}`).toBe(set.expected[row.id] !== null)
        // A row the console offers reaches the Stripe read (evidence before any write).
        if (set.expected[row.id] === null) expect(stripeCalls(s.calls).length, row.id).toBeGreaterThan(0)
      }
    })
  }

  it('A-S17: a row bound to settled claim Z → 409 with the B10 (4) text naming Z; no Stripe read, nothing written', async () => {
    world([fvClaim('C'), { id: 'cl_Z', orderId: 'o1', status: 'refunded', refundId: 'rZ', refundError: null }], [rowOf('rZ')], [sRefund('re_rZ')])
    expect(await attribute('C', 'rZ')).toEqual({ ok: false, status: 409, error: 'Ce remboursement est déjà lié à la réclamation cl_Z — une même somme ne peut pas solder deux réclamations.' })
    expect(stripeCalls(s.calls)).toEqual([])
    expect(s.calls).not.toContain('$transaction')
    expect(claimOf('C')).toMatchObject({ status: FINANCIAL_VERIFICATION, refundId: null, refundError: fvError('C') })
  })

  it('A-S22b: a FAILED row with a Stripe id → 409 row_failed with the exact B10 (6) text, before any Stripe read (break/restore: remove the row_failed clause → red)', async () => {
    world([fvClaim('C')], [rowOf('rF', { status: 'failed' })], [sRefund('re_rF', { status: 'failed' })])
    const out = await attribute('C', 'rF')
    expect(out).toEqual({ ok: false, status: 409, error: ROW_FAILED_MESSAGE })
    expect(ROW_FAILED_MESSAGE).toBe('Cette ligne est ÉCHOUÉE : elle ne verse rien et ne peut solder aucune réclamation. Rien n’a été écrit. « Réconcilier d’après la preuve » tient compte de cette ligne pour toute la commande.')
    expect(stripeCalls(s.calls)).toEqual([])
    const fv = read('components/claims/AdminFinancialVerification.tsx')
    expect(fv).toContain("row_failed:              'ligne échouée — ne peut solder aucune réclamation, sera refusé'")
    expect(fv).toContain('disabled={busyId === r.id || c.refusal != null}')
  })

  it('a pending id-less row passes the pre-check and reaches Stripe; its console legend says it binds only on Stripe evidence (B10 carry-over)', async () => {
    world([fvClaim('C')], [rowOf('rP', { status: 'pending', stripeRefundId: null })], [sRefund('re_tagP', { metadata: { grubano_refund_row: 'rP' } })])
    expect(await attribute('C', 'rP')).toMatchObject({ ok: true, outcome: 'refunded', refundId: 'rP', rowStatusBefore: 'pending' })
    expect(s.calls).toContain('stripe.refunds.list')
    expect(PENDING_ROW_LEGEND).toBe('lié seulement si Stripe le rapporte ABOUTI')
    const fv = stripComments(read('components/claims/AdminFinancialVerification.tsx'))
    expect(fv).toContain("{c.status === 'pending' && c.refusal == null && (")
    expect(fv).toContain('{PENDING_ROW_LEGEND}')
  })

  it('NEGATIVE CONTROL — a row bound only to a resume_mismatch claim is not refused (the one binder where, B1)', async () => {
    world([fvClaim('C'), { id: 'cl_W', orderId: 'o1', status: 'refunding', refundId: 'rW', refundError: 'resume_mismatch: repris …' }], [rowOf('rW')], [sRefund('re_rW')])
    const out = await attribute('C', 'rW')
    expect(out).toMatchObject({ ok: true, outcome: 'refunded', refundId: 'rW' })
    expect(JSON.stringify(out)).not.toContain('cl_W')
  })
})

// ══ J-M23 — two concurrent bindings of one Refund: exactly one succeeds ════════════════════════════════
describe('J-M23 — HARD INVARIANT: two concurrent bindings of one Refund, exactly one succeeds (C6, C7, B6 (2), D8)', () => {
  const ORIGINAL: Record<string, string> = { B1: fvError('B1'), B2: fvError('B2') }
  const race = (rowStatus: 'succeeded' | 'pending') =>
    world([fvClaim('B1'), fvClaim('B2')], [rowOf('R', { status: rowStatus, stripeRefundId: 're_R' })], [sRefund('re_R')])

  it('the call shape: prisma.$transaction(callback, { isolationLevel Serializable, maxWait ≤ 2000, timeout ≤ 5000 })', async () => {
    race('succeeded')
    expect(await attribute('B1', 'R')).toMatchObject({ ok: true, outcome: 'refunded' })
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    const [cb, o] = db.$transaction.mock.calls[0] as [unknown, { isolationLevel: string; maxWait: number; timeout: number }]
    expect(typeof cb).toBe('function')
    expect(o.isolationLevel).toBe(Prisma.TransactionIsolationLevel.Serializable)
    expect(o.isolationLevel).toBe('Serializable')
    expect(o.maxWait).toBeLessThanOrEqual(2000)
    expect(o.timeout).toBeLessThanOrEqual(5000)
  })

  it('AST pin: one transaction whose callback holds only the binder read and the CAS, through tx — no prisma., Stripe, record, audit or send', () => {
    const src = read('lib/claims.ts')
    const pins = txCallbackPins(src, 'attributeWithEvidence')
    expect(pins).toHaveLength(1)
    expect(pins[0].violations).toEqual([])
    expect(pins[0].calls).toEqual(['claim.findFirst', 'claim.updateMany'])
    expect(pins[0].options.isolationLevel).toBe('Prisma.TransactionIsolationLevel.Serializable')
    expect(pins[0].options.maxWait).toBeLessThanOrEqual(2000)
    expect(pins[0].options.timeout).toBeLessThanOrEqual(5000)
    // NEGATIVE CONTROL: the binder read moved out of the callback, or an audit put inside it, is reported.
    const moved = src.replace('const other = await tx.claim.findFirst(', 'const other = await prisma.claim.findFirst(')
    expect(moved).not.toBe(src)
    expect(txCallbackPins(moved, 'attributeWithEvidence')[0].violations.join(' ')).toContain('prisma')
    const audited = src.replace("if (done.count !== 1) throw new AttributionAbort('claim_changed')", "if (done.count !== 1) throw new AttributionAbort('claim_changed')\n      await recordAdminAudit({} as never)")
    expect(audited).not.toBe(src)
    expect(txCallbackPins(audited, 'attributeWithEvidence')[0].violations).toContain('references recordAdminAudit')
  })

  for (const rowStatus of ['succeeded', 'pending'] as const) {
    it(`interleaved (${rowStatus} row): the crossing bindings deadlock, one is rolled back — exactly one claim refunded on R; the loser unchanged, told nothing was written, with no record, audit or I-04`, async () => {
      race(rowStatus)
      s.sim.barrier = 2
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const [a, b] = await Promise.all([attribute('B1', 'R'), attribute('B2', 'R')])
      expect(s.sim.deadlocks).toBe(1)
      expect(refundedOn('R')).toHaveLength(1)
      const winner = refundedOn('R')[0].id as string
      const loser = winner === 'B1' ? 'B2' : 'B1'
      const [won, lost] = winner === 'B1' ? [a, b] : [b, a]
      expect(won).toEqual({ ok: true, outcome: 'refunded', refundId: 'R', rowStatusBefore: rowStatus, evidence: 'stripe_read', amountCents: 500 })
      expect(lost).toEqual({ ok: false, status: 409, error: NOT_WRITTEN })
      expect(claimOf(loser)).toMatchObject({ status: FINANCIAL_VERIFICATION, refundId: null, refundError: ORIGINAL[loser] })
      expect(records()).toEqual([`claim:${winner}`])
      expect(auditMock).toHaveBeenCalledTimes(1)
      expect(auditMock.mock.calls[0][0]).toMatchObject({ action: 'claim.attribute_refund', targetId: winner, metadata: { moneyMoved: false, stripeStatus: 'succeeded', rowStatusBefore: rowStatus } })
      expect(alertMock).toHaveBeenCalledTimes(rowStatus === 'pending' ? 1 : 0)
      expect(warn.mock.calls.some((c) => c[0] === '[claims] binding transaction aborted' && c[1] === 'P2034')).toBe(true)
      expect(execMock).not.toHaveBeenCalled()
      warn.mockRestore()
    })
  }

  it('sequential: the second binder passed its pre-check before the first committed — its in-transaction binder read sees the binding → 409 bound_to_other_claim naming the winner', async () => {
    race('succeeded')
    let open!: () => void
    const gate = new Promise<void>((resolve) => { open = resolve })
    let n = 0
    db.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>, o: unknown) => {
      n++
      if (n === 1) await gate
      return s.sim.transaction(fn as never, o)
    })
    const second = attribute('B2', 'R')
    for (let i = 0; i < 500 && n === 0; i++) await new Promise((r) => setTimeout(r, 0))
    expect(n).toBe(1) // B2 is at its transaction, past its pre-check
    expect(await attribute('B1', 'R')).toMatchObject({ ok: true, outcome: 'refunded' })
    open()
    expect(await second).toEqual({ ok: false, status: 409, error: 'Ce remboursement est déjà lié à la réclamation B1 — une même somme ne peut pas solder deux réclamations.' })
    expect(refundedOn('R').map((c) => c.id)).toEqual(['B1'])
    expect(claimOf('B2')).toMatchObject({ status: FINANCIAL_VERIFICATION, refundId: null, refundError: ORIGINAL.B2 })
    expect(s.sim.deadlocks).toBe(0)
    expect(records()).toEqual(['claim:B1'])
  })

  const REJECTIONS: Array<[string, () => Error]> = [
    ['P2034 (1213, a deadlock)', () => new Prisma.PrismaClientKnownRequestError('Transaction failed due to a write conflict or a deadlock.', { code: 'P2034', clientVersion: 'test' })],
    ['P2028 (a lock wait past the transaction timeout)', () => new Prisma.PrismaClientKnownRequestError('Transaction API error: Transaction already closed', { code: 'P2028', clientVersion: 'test' })],
    ['1020 ER_CHECKREAD', () => Object.assign(new Error('Record has changed since last read in table'), { code: '1020' })],
    ['a generic error', () => new Error('boom')],
  ]
  for (const [name, err] of REJECTIONS) {
    it(`${name}, nothing committed, the re-read shows the claim unchanged → 409 « rien n’a été écrit »; no record, audit or alert`, async () => {
      race('pending')
      db.$transaction.mockImplementation(async () => { throw err() })
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      expect(await attribute('B1', 'R')).toEqual({ ok: false, status: 409, error: NOT_WRITTEN })
      expect(claimOf('B1')).toMatchObject({ status: FINANCIAL_VERIFICATION, refundId: null, refundError: ORIGINAL.B1 })
      expect(db.emailDispatch.create).not.toHaveBeenCalled()
      expect(auditMock).not.toHaveBeenCalled()
      expect(alertMock).not.toHaveBeenCalled()
      expect(warn.mock.calls.some((c) => c[0] === '[claims] binding transaction aborted')).toBe(true)
      warn.mockRestore()
    })
  }

  it('claim_changed abort: the claim relabelled between the read and the CAS → 409 « a changé d’état entre-temps — elle n’a pas été modifiée »', async () => {
    race('succeeded')
    s.sim.beforeCallback = () => { claimOf('B1').refundError = 'financial_verification:stripe_unreadable: relabel' }
    expect(await attribute('B1', 'R')).toEqual({ ok: false, status: 409, error: CLAIM_CHANGED })
    expect(claimOf('B1')).toMatchObject({ status: FINANCIAL_VERIFICATION, refundId: null, refundError: 'financial_verification:stripe_unreadable: relabel' })
    expect(records()).toEqual([])
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('the re-read after a transaction error throws → 409 « État non établi »; no record, audit or alert', async () => {
    race('succeeded')
    let failed = false
    const inner = db.claim.findUnique.getMockImplementation()!
    db.$transaction.mockImplementation(async () => { failed = true; throw new Error('Connection lost') })
    db.claim.findUnique.mockImplementation(async (a: unknown) => { if (failed) throw new Error('db down'); return inner(a) })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await attribute('B1', 'R')).toEqual({ ok: false, status: 409, error: UNESTABLISHED })
    expect(records()).toEqual([])
    expect(auditMock).not.toHaveBeenCalled()
    expect(alertMock).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  for (const recorded of [true, false]) {
    it(`a commit reported lost (connection lost after COMMIT), re-read {refunded, R} → recordClaimClosure once, then 409 « déjà liée » (${recorded ? 'record written' : 'record failed'}); never ok, no audit, no I-04`, async () => {
      race('pending')
      s.sim.afterCommit = () => new Error('Connection lost')
      if (!recorded) db.emailDispatch.create.mockImplementation(async () => { throw new Error('db down') })
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const err = vi.spyOn(console, 'error').mockImplementation(() => {})
      const out = await attribute('B1', 'R')
      // IMPLEMENTATION NOTE (W4, fixer round 1) on C7: the record-written tail names no console section (H10 not landed).
      const tail = recorded
        ? 'sa clôture est enregistrée.'
        : 'l’enregistrement de sa clôture a échoué : aucun avis client ne pourra lui être envoyé.'
      expect(out).toEqual({ ok: false, status: 409, error: `Cette réclamation est déjà liée à ce remboursement (statut actuel : « refunded »). Cette action n’a tenté aucun e-mail et n’a écrit aucune trace d’audit ; ${tail} Relisez sa ligne dans la file.` })
      expect(out.ok).toBe(false)
      expect(db.emailDispatch.create).toHaveBeenCalledTimes(1)
      expect(auditMock).not.toHaveBeenCalled()
      expect(alertMock).not.toHaveBeenCalled()
      expect(refundedOn('R').map((c) => c.id)).toEqual(['B1'])
      warn.mockRestore()
      err.mockRestore()
    })
  }

  it('the winner, only after the resolved transaction and in this order: closure record, I-04 (pending row), audit — the Stripe read before the transaction', async () => {
    race('pending')
    s.sim.afterCommit = () => { s.calls.push('COMMIT') }
    expect(await attribute('B1', 'R')).toMatchObject({ ok: true, outcome: 'refunded' })
    const at = (x: string) => s.calls.indexOf(x)
    expect(at('stripe.refunds.retrieve')).toBeGreaterThan(-1)
    expect(at('stripe.refunds.retrieve')).toBeLessThan(at('$transaction'))
    expect(at('COMMIT')).toBeGreaterThan(at('$transaction'))
    expect(at('emailDispatch.create')).toBeGreaterThan(at('COMMIT'))
    expect(at('alert:claim_refunded_row_unfinalized')).toBeGreaterThan(at('emailDispatch.create'))
    expect(at('audit:claim.attribute_refund')).toBeGreaterThan(at('alert:claim_refunded_row_unfinalized'))
    expect(s.calls).not.toContain('claim.updateMany') // the only claim write is the transaction's
  })

  it('the console renders body.error for every 409 and a success toast only for « refunded »', () => {
    const fv = read('components/claims/AdminFinancialVerification.tsx')
    const handler = fv.slice(fv.indexOf('const attribute = useCallback'), fv.indexOf('type StripeFacts'))
    expect(handler.length).toBeGreaterThan(200)
    expect(handler).toContain("if (!res.ok) { toast.error((body as { error?: string }).error || 'Attribution refusée.'); return }")
    expect(handler).toContain("if (result?.outcome !== 'refunded') {")
    expect(handler).toContain('toast.success(attributionSuccessText(result.rowStatusBefore ??')
    expect(handler.match(/toast\.success\(/g) ?? []).toHaveLength(1)
    expect(stripComments(handler)).not.toMatch(/still_pending|refund_failed|engine_row_dead|unconfirmed_within_window|stripe_unreadable_retry/)
  })

  it('NEGATIVE CONTROL — two different rows R and R′: both bindings commit', async () => {
    world([fvClaim('B1'), fvClaim('B2')], [rowOf('R', { stripeRefundId: 're_R' }), rowOf('R2', { stripeRefundId: 're_R2' })], [sRefund('re_R'), sRefund('re_R2')])
    expect(await attribute('B1', 'R')).toMatchObject({ ok: true, outcome: 'refunded' })
    expect(await attribute('B2', 'R2')).toMatchObject({ ok: true, outcome: 'refunded' })
    expect(refundedOn('R').map((c) => c.id)).toEqual(['B1'])
    expect(refundedOn('R2').map((c) => c.id)).toEqual(['B2'])
  })

  it('IMPLEMENTATION NOTE (W4) on J-M23 — interleaved bindings of two DIFFERENT rows can deadlock too (the binder read scans every claim row): the victim writes nothing and a retry commits', async () => {
    world([fvClaim('B1'), fvClaim('B2')], [rowOf('R', { stripeRefundId: 're_R' }), rowOf('R2', { stripeRefundId: 're_R2' })], [sRefund('re_R'), sRefund('re_R2')])
    s.sim.barrier = 2
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const [a, b] = await Promise.all([attribute('B1', 'R'), attribute('B2', 'R2')])
    const lost = [a, b].filter((x) => !x.ok)
    expect(lost.length).toBeLessThanOrEqual(1)
    for (const l of lost) expect(l).toEqual({ ok: false, status: 409, error: NOT_WRITTEN })
    if (!b.ok) expect(await attribute('B2', 'R2')).toMatchObject({ ok: true })
    if (!a.ok) expect(await attribute('B1', 'R')).toMatchObject({ ok: true })
    expect(refundedOn('R')).toHaveLength(1)
    expect(refundedOn('R2')).toHaveLength(1)
    warn.mockRestore()
  })
})

// ══ J-M37 — attribution reads Stripe evidence before any write ═════════════════════════════════════════
describe('J-M37 — attribution reads Stripe evidence before any write (G12)', () => {
  const expectProven = (out: unknown, row: string, rowStatusBefore: 'succeeded' | 'pending', stripeAmount: number) => {
    expect(out).toEqual({ ok: true, outcome: 'refunded', refundId: row, rowStatusBefore, evidence: 'stripe_read', amountCents: stripeAmount })
    const firstStripe = s.calls.findIndex((c) => c.startsWith('stripe.'))
    expect(firstStripe).toBeGreaterThan(-1)
    expect(firstStripe).toBeLessThan(s.calls.indexOf('$transaction'))
    expect(claimOf('C')).toMatchObject({ status: 'refunded', refundId: row, refundError: null, activeOrderKey: null })
    expect(auditMock).toHaveBeenCalledTimes(1)
    expect(auditMock.mock.calls[0][0]).toMatchObject({ action: 'claim.attribute_refund', metadata: { stripeStatus: 'succeeded', rowStatusBefore, moneyMoved: false } })
  }

  it('the G12 success copy is split by the row status read before the write', () => {
    expect(attributionSuccessText('pending')).toBe('Remboursement attribué : Stripe rapporte ce remboursement ABOUTI ; la réclamation reflète désormais ce remboursement réel. La ligne reste « en attente » dans notre base (cette action n’a appliqué ni ligne de ledger ni reprise de royalty).')
    expect(attributionSuccessText('succeeded')).toBe('Remboursement attribué : Stripe confirme ce remboursement ABOUTI ; la réclamation reflète désormais ce remboursement réel.')
  })

  it('(1) A-S21 retrieve path: a pending row with a recorded id, Stripe reports it succeeded → refunded on Stripe’s amount; refunds.list NOT called; I-04 after the commit', async () => {
    world([fvClaim('C')], [rowOf('rf9', { status: 'pending', stripeRefundId: 're_9' })], [sRefund('re_9', { amount: 480 })])
    expectProven(await attribute('C', 'rf9'), 'rf9', 'pending', 480)
    expect(s.calls).not.toContain('stripe.refunds.list')
    expect(alertMock).toHaveBeenCalledTimes(1)
    expect(alertMock.mock.calls[0][0]).toMatchObject({ kind: 'claim_refunded_row_unfinalized', dedupeKey: 'claim_row_unfinalized:rf9' })
    expect(s.calls.indexOf('alert:claim_refunded_row_unfinalized')).toBeGreaterThan(s.calls.indexOf('$transaction'))
  })

  it('(2) A-S21 tag path: a pending id-less row whose PI-list refund carries its tag, succeeded → refunded; I-04', async () => {
    world([fvClaim('C')], [rowOf('rf_t', { status: 'pending', stripeRefundId: null })], [sRefund('re_T', { amount: 470, metadata: { grubano_refund_row: 'rf_t' } })])
    expectProven(await attribute('C', 'rf_t'), 'rf_t', 'pending', 470)
    expect(s.calls).toContain('stripe.refunds.list')
    expect(alertMock).toHaveBeenCalledTimes(1)
  })

  it('(3) A-S23a-1 an unstamped admin-rail succeeded row, retrieve succeeded → refunded; no I-04', async () => {
    world([fvClaim('C')], [rowOf('rf_a', { reason: 'admin:x' })], [sRefund('re_rf_a', { amount: 460 })])
    expectProven(await attribute('C', 'rf_a'), 'rf_a', 'succeeded', 460)
    expect(alertMock).not.toHaveBeenCalled()
  })

  it('(4) A-S23a-2 a succeeded row stamped claim:C → refunded; no I-04', async () => {
    world([fvClaim('C')], [rowOf('rf_c', { reason: 'claim:C' })], [sRefund('re_rf_c')])
    expectProven(await attribute('C', 'rf_c'), 'rf_c', 'succeeded', 500)
    expect(alertMock).not.toHaveBeenCalled()
  })

  const NOT_PROVEN: Array<[string, () => void, string, string]> = [
    ['pending at Stripe', () => { s.stripeRefunds = [sRefund('re_9', { status: 'pending' })] }, 'rf9', `Stripe rapporte le remboursement re_9 de la ligne rf9 EN ATTENTE : rien n’est prouvé, la réclamation n’a pas été modifiée. Réessayez lorsqu’il sera terminal.`],
    ['requires_action at Stripe', () => { s.stripeRefunds = [sRefund('re_9', { status: 'requires_action' })] }, 'rf9', `Stripe rapporte le remboursement re_9 de la ligne rf9 EN ATTENTE : rien n’est prouvé, la réclamation n’a pas été modifiée. Réessayez lorsqu’il sera terminal.`],
    ['failed at Stripe', () => { s.stripeRefunds = [sRefund('re_9', { status: 'failed' })] }, 'rf9', `Stripe rapporte le remboursement re_9 de la ligne rf9 « failed » : cette ligne ne verse rien et ne peut solder aucune réclamation. ${KEPT} « Réconcilier d’après la preuve » tient compte de cette ligne pour toute la commande.`],
    ['canceled at Stripe', () => { s.stripeRefunds = [sRefund('re_9', { status: 'canceled' })] }, 'rf9', `Stripe rapporte le remboursement re_9 de la ligne rf9 « canceled » : cette ligne ne verse rien et ne peut solder aucune réclamation. ${KEPT} « Réconcilier d’après la preuve » tient compte de cette ligne pour toute la commande.`],
    ['on another payment (pi_OTHER)', () => { s.stripeRefunds = [sRefund('re_9', { payment_intent: 'pi_OTHER' })] }, 'rf9', `Le remboursement Stripe re_9, enregistré sur la ligne rf9, ne porte pas sur le paiement de cette commande. Anomalie de données à instruire. Aucune conclusion tirée. ${KEPT}`],
    ['unknown to Stripe (404)', () => { s.retrieveFail = { re_9: 'missing' } }, 'rf9', `La ligne rf9 enregistre le remboursement Stripe re_9, que Stripe ne connaît pas avec la clé de ce serveur. Vérifiez que cette clé est celle du compte et du mode (test / live) où il a été créé, puis relancez la réconciliation ; sinon, anomalie de données à instruire. Aucune conclusion tirée. ${KEPT}`],
    ['ETIMEDOUT', () => { s.retrieveFail = { re_9: 'throw' } }, 'rf9', 'Stripe n’a pas pu être lu pour la ligne rf9 : rien n’est conclu, la réclamation n’a pas été modifiée. Réessayez.'],
  ]
  for (const [name, arrange, rowId, text] of NOT_PROVEN) {
    it(`(5) NOT PROVEN — ${name} → 409 with the exact G12 text, 0 writes, no audit, row and claim unchanged (NEGATIVE CONTROL of (1))`, async () => {
      world([fvClaim('C')], [rowOf('rf9', { status: 'pending', stripeRefundId: 're_9' })], [sRefund('re_9')])
      arrange()
      const rowBefore = JSON.stringify(s.sim.refunds)
      const out = await attribute('C', rowId)
      expect(out).toEqual({ ok: false, status: 409, error: text })
      expect((out as { error: string }).error).toContain('n’a pas été modifiée')
      expect(s.calls).not.toContain('$transaction')
      expect(s.calls).not.toContain('claim.updateMany')
      expect(auditMock).not.toHaveBeenCalled()
      expect(records()).toEqual([])
      expect(JSON.stringify(s.sim.refunds)).toBe(rowBefore)
      expect(claimOf('C')).toMatchObject({ status: FINANCIAL_VERIFICATION, refundId: null, refundError: fvError('C') })
    })
  }

  it('(5) NOT PROVEN — an id-less pending row Stripe does not know yet: within the window → the « à partir du » text; dead → the idempotency-window text', async () => {
    const young = new Date(Date.now() - 2 * HOUR)
    world([fvClaim('C')], [rowOf('rf_t', { status: 'pending', stripeRefundId: null, createdAt: young })], [])
    const until = new Date(young.getTime() + WINDOW + ENGINE_DEAD_MARGIN_MS).toISOString()
    expect(await attribute('C', 'rf_t')).toEqual({ ok: false, status: 409, error: `Stripe ne connaît pas encore de remboursement pour la ligne rf_t. ${KEPT} Conclusion possible à partir du ${until} (UTC).` })
    const old = new Date(Date.now() - 30 * HOUR)
    world([fvClaim('C')], [rowOf('rf_t', { status: 'pending', stripeRefundId: null, createdAt: old })], [])
    const windowEnd = new Date(old.getTime() + WINDOW).toISOString()
    expect(await attribute('C', 'rf_t')).toEqual({ ok: false, status: 409, error: `Stripe ne connaît aucun remboursement pour la ligne rf_t, et le moteur ne la créera plus (fenêtre d’idempotence expirée le ${windowEnd}) : elle ne verse rien et ne peut solder aucune réclamation. ${KEPT}` })
    expect(s.calls).not.toContain('$transaction')
    expect(claimOf('C').refundId).toBeNull()
  })

  it('(6) A-S23b a succeeded row reverted at Stripe, key = the current cursor and key ≠ cursor → the same reverted text, nothing written', async () => {
    for (const key of ['refund:o1:500', 'refund:o1:0']) {
      world([fvClaim('C')], [rowOf('rs', { stripeRefundId: 're_s', idempotencyKey: key })], [sRefund('re_s', { status: 'failed' })])
      const rowBefore = JSON.stringify(s.sim.refunds)
      expect(await attribute('C', 'rs'), key).toEqual({ ok: false, status: 409, error: `La ligne rs est marquée ABOUTIE ici, mais Stripe rapporte aujourd’hui son remboursement re_s « failed » : il ne solde rien. ${KEPT}` })
      expect(s.calls).not.toContain('$transaction')
      // W4 fixer (P3): the J-M37 (5)(6) no-write assertions, in full.
      expect(s.calls).not.toContain('claim.updateMany')
      expect(auditMock).not.toHaveBeenCalled()
      expect(records()).toEqual([])
      expect(JSON.stringify(s.sim.refunds)).toBe(rowBefore)
      expect(claimOf('C')).toMatchObject({ status: FINANCIAL_VERIFICATION, refundId: null, refundError: fvError('C') })
    }
  })

  it('(7) P1-6 an FV claim that kept refundId = the row is not refused by bound_to_other_claim (id: { not: claim.id }) → refunded', async () => {
    world([fvClaim('C', { refundId: 'rf7' })], [rowOf('rf7')], [sRefund('re_rf7')])
    expectProven(await attribute('C', 'rf7'), 'rf7', 'succeeded', 500)
  })

  it('(8) A-S27 two rows stamped claim:C: the provable one → refunded; the other (pending at Stripe) → 409, nothing written', async () => {
    const rows = () => [rowOf('rs1', { reason: 'claim:C' }), rowOf('rs2', { reason: 'claim:C', status: 'pending', stripeRefundId: 're_s2' })]
    world([fvClaim('C')], rows(), [sRefund('re_rs1'), sRefund('re_s2', { status: 'pending' })])
    expectProven(await attribute('C', 'rs1'), 'rs1', 'succeeded', 500)
    world([fvClaim('C')], rows(), [sRefund('re_rs1'), sRefund('re_s2', { status: 'pending' })])
    expect(await attribute('C', 'rs2')).toMatchObject({ ok: false, status: 409 })
    expect(s.calls).not.toContain('$transaction')
  })

  it('no bind-first write remains, the round-11 outcomes are gone, and « already_parked_or_moved » exists nowhere', () => {
    const src = stripComments(read('lib/claims.ts'))
    const attr = src.slice(src.indexOf('export async function attributeClaimRefund('), src.indexOf('\n}\n', src.indexOf('export async function attributeClaimRefund(')))
    expect(attr).not.toContain('updateMany')
    expect(attr).not.toContain('reconcileBoundClaim')
    expect(attr).not.toContain('reconcileClaimForRefund')
    expect(src).not.toContain('already_parked_or_moved')
    expect(src).not.toContain("status: 'refunding', refundError: null },\n  })\n  if (bound.count !== 1)")
  })
})

// ══ W4 fixer round 1 — D8 (6) preview, C6 supplied evidence, C7 texts ══════════════════════════════════
describe('D8 (6) — a row-branch preview reads Stripe and writes nothing (W4 fixer)', () => {
  const expectNothingWritten = () => {
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(s.calls).not.toContain('claim.updateMany')
    expect(db.emailDispatch.create).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
    expect(alertMock).not.toHaveBeenCalled()
    expect(claimOf('C')).toMatchObject({ status: FINANCIAL_VERIFICATION, refundId: null, refundError: fvError('C') })
  }
  const postAttribute = (body: unknown) => ATTRIBUTE(new Request('https://app.grubano.com/x', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }) as never, { params: { id: 'C' } })

  it('attributeClaimRefund({ dryRun: true }) on a pending row Stripe proves → preview with rowStatusBefore and Stripe’s amount; 0 transaction, claim write, record, audit, alert', async () => {
    world([fvClaim('C')], [rowOf('rf9', { status: 'pending', stripeRefundId: 're_9' })], [sRefund('re_9', { amount: 480 })])
    const out = await attributeClaimRefund({ claimId: 'C', refundRowId: 'rf9', adminId: 'op1', dryRun: true })
    expect(out).toEqual({ ok: true, outcome: 'preview', refundId: 'rf9', rowStatusBefore: 'pending', evidence: 'stripe_read', amountCents: 480 })
    expect(stripeCalls(s.calls).length).toBeGreaterThan(0)
    expectNothingWritten()
  })

  it('through the route: { refundRowId, dryRun: true } → 200 { result: preview }; nothing written', async () => {
    adminMock.mockResolvedValue({ id: 'op1' })
    world([fvClaim('C')], [rowOf('rs', { stripeRefundId: 're_s' })], [sRefund('re_s', { amount: 460 })])
    const res = await postAttribute({ refundRowId: 'rs', dryRun: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ result: { ok: true, outcome: 'preview', refundId: 'rs', rowStatusBefore: 'succeeded', evidence: 'stripe_read', amountCents: 460 } })
    expectNothingWritten()
  })

  it('NEGATIVE CONTROL — the same route request with dryRun false → refunded: one transaction, one record, one audit', async () => {
    adminMock.mockResolvedValue({ id: 'op1' })
    world([fvClaim('C')], [rowOf('rs', { stripeRefundId: 're_s' })], [sRefund('re_s', { amount: 460 })])
    const res = await postAttribute({ refundRowId: 'rs', dryRun: false })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ result: { ok: true, outcome: 'refunded', refundId: 'rs' } })
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(records()).toEqual(['claim:C'])
    expect(auditMock).toHaveBeenCalledTimes(1)
    expect(claimOf('C')).toMatchObject({ status: 'refunded', refundId: 'rs' })
  })
})

describe('C6 (W4 fixer) — a supplied Stripe refund is evidence only for a SUCCEEDED row', () => {
  it('supplied for a PENDING row it is ignored: the row is read through refundRowTruth, which anchors the PaymentIntent → not proven, nothing written', async () => {
    world([fvClaim('C')], [rowOf('rf9', { status: 'pending', stripeRefundId: 're_9' })], [sRefund('re_9', { payment_intent: 'pi_OTHER' })])
    const row = { id: 'rf9', orderId: 'o1', status: 'pending', amountCents: 500, stripeRefundId: 're_9', reason: null, createdAt: new Date(Date.now() - 2 * HOUR) }
    // The supplied object claims the order's PaymentIntent, SUCCEEDED, with the row's own id — Stripe says otherwise.
    const r = await attributeWithEvidence({ id: 'C' }, row, sRefund('re_9') as never, { adminId: 'op1' })
    expect(r.out).toEqual({ ok: false, status: 409, error: `Le remboursement Stripe re_9, enregistré sur la ligne rf9, ne porte pas sur le paiement de cette commande. Anomalie de données à instruire. Aucune conclusion tirée. ${KEPT}` })
    expect(s.calls).toContain('stripe.refunds.retrieve')
    expect(s.calls).not.toContain('$transaction')
    expect(claimOf('C')).toMatchObject({ status: FINANCIAL_VERIFICATION, refundId: null })
  })

  it('NEGATIVE CONTROL — supplied for a SUCCEEDED row (the adoption mirror shape) it is the evidence: no Stripe read, refunded', async () => {
    world([fvClaim('C')], [rowOf('rs', { stripeRefundId: 're_s' })], [])
    const row = { id: 'rs', orderId: 'o1', status: 'succeeded', amountCents: 500, stripeRefundId: 're_s', reason: null, createdAt: new Date() }
    const r = await attributeWithEvidence({ id: 'C' }, row, sRefund('re_s') as never, { adminId: 'op1' })
    expect(r.out).toMatchObject({ ok: true, outcome: 'refunded', refundId: 'rs' })
    expect(stripeCalls(s.calls)).toEqual([])
  })

  it('a not-proven refusal carries the Stripe object it read (stripeRead), and none when refused before any Stripe read', async () => {
    world([fvClaim('C')], [rowOf('rs', { stripeRefundId: 're_s' })], [sRefund('re_s', { status: 'failed' })])
    const row = { id: 'rs', orderId: 'o1', status: 'succeeded', amountCents: 500, stripeRefundId: 're_s', reason: null, createdAt: new Date() }
    const reverted = await attributeWithEvidence({ id: 'C' }, row, undefined, { adminId: 'op1' })
    expect(reverted).toMatchObject({ cause: 'not_proven', stripeRead: { id: 're_s', status: 'failed' } })
    world([fvClaim('C'), { id: 'cl_Z', orderId: 'o1', status: 'refunded', refundId: 'rs', refundError: null }], [rowOf('rs', { stripeRefundId: 're_s' })], [sRefund('re_s')])
    const refused = await attributeWithEvidence({ id: 'C' }, row, undefined, { adminId: 'op1' })
    expect(refused.cause).toBe('refused')
    expect((refused as { stripeRead?: unknown }).stripeRead).toBeUndefined()
  })
})

describe('C7 (W4 fixer) — operator texts state only what the code established', () => {
  it('the unchanged re-read text asserts no change; the claim_changed abort text is the one that does', () => {
    expect(NOT_WRITTEN).toContain('rien n’a été écrit')
    expect(NOT_WRITTEN).not.toMatch(/a changé/)
    expect(CLAIM_CHANGED).toMatch(/a changé d’état entre-temps/)
    const src = stripComments(read('lib/claims.ts'))
    expect(src).not.toContain('Cette réclamation, ou ce remboursement, a changé entre-temps')
  })

  // A console section named in an operator text must exist in the console (H10's sections have not landed).
  const SECTIONS = ['Avis client non envoyés', 'Réclamations remboursées dont la ligne liée n’est pas établie']
  const operatorCode = (src: string) => stripComments(src).split('\n').filter((l) => !/console\.(error|warn|log|info)\(/.test(l)).join('\n')
  const consoleCode = () => readdirSync('components/claims').filter((f) => f.endsWith('.tsx')).map((f) => stripComments(read(`components/claims/${f}`))).join('\n')
  const absentSectionsNamed = (lib: string, ui: string) => SECTIONS.filter((name) => operatorCode(lib).includes(`« ${name}`) && !ui.includes(name))

  it('no operator string of lib/claims.ts, lib/claim-attribution-rules.ts or the attribute route names a console section the console does not render', () => {
    const ui = consoleCode()
    for (const f of ['lib/claims.ts', 'lib/claim-attribution-rules.ts', 'app/api/admin/claims/[id]/attribute/route.ts']) {
      expect(absentSectionsNamed(read(f), ui), f).toEqual([])
    }
  })

  it('NEGATIVE CONTROL — the former record-written tail restored → the absent section is reported', () => {
    const src = read('lib/claims.ts')
    const restored = src.replace("const CLOSURE_RECORDED_TAIL = 'sa clôture est enregistrée.'", "const CLOSURE_RECORDED_TAIL = 'si l’avis client manque, la réclamation apparaît dans « Avis client non envoyés ».'")
    expect(restored).not.toBe(src)
    expect(absentSectionsNamed(restored, consoleCode())).toEqual(['Avis client non envoyés'])
  })
})
