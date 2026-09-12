// tests/claims-r13-adoption.test.ts — T-49 round 13, slice W4: J-M15 (B11, D9, A-S19, A-S34) and J-M25 (C8, D9 (4)-(6)).
//
// Adoption mirrors a Stripe-Dashboard refund that Stripe reports SUCCEEDED on this order's payment and charge. The
// stamped-row read and the mirror insert share ONE Serializable transaction, so two concurrent adoptions for one claim
// cannot both insert. The binding is attributeWithEvidence's (C6), on the refund object read in the same request. A
// refusal after the mirror exists says so (wrote: true); a transaction error reports only what a re-read shows.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { Prisma } from '@prisma/client'
import { LockSim, wireSim, type SimState } from './support/serializable-sim'
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

import { adoptStripeRefundForClaim, FINANCIAL_VERIFICATION, EXTERNAL_REFUND_KEY_PREFIX } from '@/lib/claims'
import { adoptionRefusalWroteText } from '@/lib/claim-attribution-rules'

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
const RE = 're_Dash00000001'
const RE2 = 're_Dash00000002'
const UNESTABLISHED = 'État non établi : la base n’a pas pu confirmer ce qui a été écrit. Relisez la ligne de cette réclamation dans la file avant toute autre action.'
const STAMPED_EXISTS = 'Un remboursement porte déjà l’identité de cette réclamation sur cette commande : aucune ligne miroir n’a été écrite. Relancez « Réconcilier d’après la preuve ».'
const ELSEWHERE = 'Ce remboursement Stripe vient d’être enregistré par ailleurs — rechargez la file.'
const NOT_CONFIRMED = 'L’enregistrement de la ligne miroir n’a pas pu être confirmé : aucune ligne miroir n’existe, rien n’a été écrit. Réessayez.'

const fvClaim = (id: string, o: Row = {}): Row => ({
  id, orderId: 'o1', consumerId: 'u1', restaurantId: 'r1', reason: 'wrong_item', requestedAmountCents: 500, createdAt: new Date(),
  status: FINANCIAL_VERIFICATION, refundAttempted: true, refundId: null, refundError: `financial_verification:refund_moved_unattributed: ${id}`, activeOrderKey: null, ...o,
})
const dash = (id: string, o: Row = {}): Row => ({ id, object: 'refund', status: 'succeeded', amount: 500, payment_intent: 'pi_1', charge: 'ch_1', created: 1_700_000_000, metadata: {}, ...o })

let s: SimState
function world(claims: Row[], refunds: Row[] = [], stripeRefunds: Row[] = [dash(RE)]): SimState {
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
const adopt = (claimId: string, stripeRefundId = RE, dryRun?: boolean) => adoptStripeRefundForClaim({ claimId, stripeRefundId, adminId: 'op1', dryRun })
const mirrorsOf = (re: string) => s.sim.refunds.filter((r) => r.stripeRefundId === re)
const stampedMirrors = (claimId: string) => s.sim.refunds.filter((r) => r.reason === `claim:${claimId}` && String(r.idempotencyKey).startsWith(EXTERNAL_REFUND_KEY_PREFIX))
const audits = () => (auditMock.mock.calls as Array<[{ action: string }]>).map((c) => c[0].action)
const mirrorWrittenText = (rowId: string, re: string) =>
  `La ligne miroir ${rowId} (remboursement ${re} ABOUTI chez Stripe, identité de cette réclamation) a été enregistrée, mais la réclamation n’a pas été modifiée : elle a changé d’état entre-temps. Si elle est encore en vérification financière, « Réconcilier d’après la preuve » appliquera cette ligne, qui porte son identité.`

beforeEach(() => {
  vi.clearAllMocks()
  for (const m of [execMock, alertMock, auditMock, db.$transaction, db.emailDispatch.create]) m.mockReset()
  alertMock.mockResolvedValue({ status: 'sent' })
  auditMock.mockResolvedValue(true)
})

// ══ J-M15 — adoption mirror identity and the post-mirror refusal ═══════════════════════════════════════
describe('J-M15 — adoption mirror identity and the post-mirror refusal (B11, D9)', () => {
  it('(a) A-S19 fresh: mirror external:re_D stamped claim:C → attributeWithEvidence → refunded on Stripe’s evidence; one Stripe refund read', async () => {
    world([fvClaim('C')])
    const out = await adopt('C')
    const [mirror] = stampedMirrors('C')
    expect(mirror).toMatchObject({ orderId: 'o1', stripeRefundId: RE, idempotencyKey: `${EXTERNAL_REFUND_KEY_PREFIX}${RE}`, reason: 'claim:C', status: 'succeeded', amountCents: 500 })
    expect(out).toMatchObject({ ok: true, outcome: 'refunded', refundId: mirror.id, evidence: 'stripe_read', amountCents: 500, facts: { source: 'stripe', stripeRefundId: RE } })
    expect(stripeMock.refunds.retrieve).toHaveBeenCalledTimes(1)
    expect(claimOf('C')).toMatchObject({ status: 'refunded', refundId: mirror.id, refundError: null, activeOrderKey: null })
    expect(db.$transaction).toHaveBeenCalledTimes(2) // C8 mirror, then C6 binding
    expect(audits()).toEqual(['claim.adopt_stripe_refund', 'claim.attribute_refund'])
    expect(alertMock).not.toHaveBeenCalled() // the mirror row is succeeded: no I-04 (I-04 TRIGGERS)
    expect(execMock).not.toHaveBeenCalled()
  })

  it('(b) an existing mirror external:re_D stamped claim:C: trace.wrote false before any refusal, attributeWithEvidence reads Stripe, no second mirror', async () => {
    const existing = { id: 'rf_mirror', orderId: 'o1', restaurantId: 'r1', stripeRefundId: RE, idempotencyKey: `${EXTERNAL_REFUND_KEY_PREFIX}${RE}`, reason: 'claim:C', status: 'succeeded', amountCents: 500, stripePaymentIntentId: 'pi_1', settledAt: new Date('2026-09-10T10:00:00Z'), createdAt: new Date() }
    world([fvClaim('C')], [{ ...existing }])
    const out = await adopt('C')
    expect(out).toMatchObject({ ok: true, outcome: 'refunded', refundId: 'rf_mirror', evidence: 'stripe_read', amountCents: 500, facts: { source: 'stripe' } })
    expect(stripeMock.refunds.retrieve).toHaveBeenCalledTimes(1)
    expect(mirrorsOf(RE)).toHaveLength(1)
    expect(audits()).toEqual(['claim.attribute_refund'])
    // A refusal on this branch: Stripe now reports the refund failed → the G12 reverted 409, and nothing was written.
    world([fvClaim('C')], [{ ...existing }], [dash(RE, { status: 'failed' })])
    const refused = await adopt('C')
    expect(refused).toMatchObject({ ok: false, status: 409, wrote: false })
    expect((refused as { error: string }).error).toContain('est marquée ABOUTIE ici, mais Stripe rapporte aujourd’hui son remboursement')
    expect(claimOf('C').status).toBe(FINANCIAL_VERIFICATION)
    // W4 fixer (B11 (a)): the refusal's facts are the Stripe object read for the row — Stripe's « failed », never our row's
    // « succeeded » — and the console names their source.
    expect((refused as { facts?: { stripeStatus: string; source: string } }).facts).toMatchObject({ stripeRefundId: RE, stripeStatus: 'failed', source: 'stripe' })
    // A refusal before any Stripe read (the mirror row bound to another claim, B10 (4)) carries no facts at all.
    world([fvClaim('C'), { id: 'cl_Z', orderId: 'o1', status: 'refunded', refundId: 'rf_mirror', refundError: null }], [{ ...existing }])
    const boundElsewhere = await adopt('C')
    expect(boundElsewhere).toMatchObject({ ok: false, status: 409, wrote: false })
    expect((boundElsewhere as { facts?: unknown }).facts).toBeUndefined()
    expect(s.calls.filter((c) => c.startsWith('stripe.'))).toEqual([])
    // the dead check formerly at 2109 is gone (source pin, comments stripped)
    const src = stripComments(read('lib/claims.ts'))
    expect(src).not.toContain('La ligne enregistrée n’est plus aboutie')
    expect(src).not.toContain("resumed.outcome !== 'refunded'")
    const inner = src.slice(src.indexOf('async function adoptStripeRefundInner('))
    expect(inner.indexOf('trace.wrote = false')).toBeGreaterThan(-1)
    expect(inner.indexOf('trace.wrote = false')).toBeLessThan(inner.indexOf('const bound = await attributeWithEvidence('))
  })

  it('(c) A-S34 the mirror commits, then C changes before attributeWithEvidence → 409 wrote:true with the exact B11 (c) text; the mirror is not deleted', async () => {
    // (i) closed after the mirror commit, before attributeWithEvidence reads the claim; (ii) relabelled after that read,
    // before the C6 compare-and-set (a relabel BEFORE the read is simply the new pre-image: the claim is still FV and
    // the mirror carries its identity, so binding it is right).
    const CHANGES: Array<(sim: LockSim) => void> = [
      (sim) => { sim.afterCommit = (txId) => { if (txId === 1) claimOf('C').status = 'refused_final' } },
      (sim) => { sim.beforeCallback = (txId) => { if (txId === 2) claimOf('C').refundError = 'financial_verification:stripe_unreadable: relabel' } },
    ]
    for (const change of CHANGES) {
      world([fvClaim('C')])
      change(s.sim)
      const out = await adopt('C')
      const [mirror] = stampedMirrors('C')
      expect(mirror).toBeDefined()
      expect(out).toMatchObject({ ok: false, status: 409, wrote: true, error: mirrorWrittenText(mirror.id, RE) })
      expect((out as { error: string }).error).toContain('La ligne miroir')
      expect(claimOf('C').status).not.toBe('refunded')
    }
  })

  it('(d) an engine-tagged refund and (e) a pending refund are refused: no transaction, no mirror', async () => {
    for (const r of [dash(RE, { metadata: { grubano_refund_row: 'rf_engine' } }), dash(RE, { status: 'pending' })]) {
      world([fvClaim('C')], [], [r])
      const out = await adopt('C')
      expect(out).toMatchObject({ ok: false, status: 409, wrote: false })
      expect(db.$transaction).not.toHaveBeenCalled()
      expect(mirrorsOf(RE)).toHaveLength(0)
    }
  })

  it('NEGATIVE CONTROL — a second adoption of re_D for claim C2 → 409, wrote:false, one mirror in total', async () => {
    world([fvClaim('C'), fvClaim('C2')])
    expect(await adopt('C')).toMatchObject({ ok: true, outcome: 'refunded' })
    const second = await adopt('C2')
    expect(second).toMatchObject({ ok: false, status: 409, wrote: false })
    expect(mirrorsOf(RE)).toHaveLength(1)
    expect(claimOf('C2').status).toBe(FINANCIAL_VERIFICATION)
  })
})

// ══ J-M25 — the adoption mirror insert under a Serializable transaction ════════════════════════════════
describe('J-M25 — adoption mirror insert under a Serializable transaction (C8)', () => {
  it('call shape and AST pin: Serializable, maxWait ≤ 2000, timeout ≤ 5000; the callback holds only the stamped read and tx.refund.create', async () => {
    world([fvClaim('C')])
    await adopt('C')
    const o = db.$transaction.mock.calls[0][1] as { isolationLevel: string; maxWait: number; timeout: number }
    expect(o.isolationLevel).toBe(Prisma.TransactionIsolationLevel.Serializable)
    expect(o.maxWait).toBeLessThanOrEqual(2000)
    expect(o.timeout).toBeLessThanOrEqual(5000)
    const src = read('lib/claims.ts')
    const pins = txCallbackPins(src, 'adoptStripeRefundInner')
    expect(pins).toHaveLength(1)
    expect(pins[0].violations).toEqual([])
    expect(pins[0].calls).toEqual(['refund.findFirst', 'refund.create'])
    expect(pins[0].options.isolationLevel).toBe('Prisma.TransactionIsolationLevel.Serializable')
    // NEGATIVE CONTROL: the stamped read through the singleton client inside the callback is reported
    const moved = src.replace('const stampedNow = await tx.refund.findFirst(', 'const stampedNow = await prisma.refund.findFirst(')
    expect(moved).not.toBe(src)
    expect(txCallbackPins(moved, 'adoptStripeRefundInner')[0].calls).toEqual(['refund.create'])
  })

  it('(a) the stamped read inside the transaction finds a row claim:C → 409 wrote:false, no mirror', async () => {
    world([fvClaim('C')])
    s.sim.beforeCallback = (txId) => {
      if (txId === 1) s.sim.refunds.push({ id: 'rf_late', orderId: 'o1', reason: 'claim:C', status: 'pending', idempotencyKey: 'refund:o1:0', stripeRefundId: null, amountCents: 500, createdAt: new Date() })
    }
    expect(await adopt('C')).toMatchObject({ ok: false, status: 409, wrote: false, error: STAMPED_EXISTS })
    expect(mirrorsOf(RE)).toHaveLength(0)
    expect(audits()).toEqual([])
  })

  it('(b) the insert raises P2002 → 409 wrote:false with the existing text', async () => {
    world([fvClaim('C')])
    s.sim.beforeCallback = (txId) => {
      if (txId === 1) s.sim.refunds.push({ id: 'rf_dup', orderId: 'o9', reason: null, status: 'succeeded', idempotencyKey: `${EXTERNAL_REFUND_KEY_PREFIX}${RE}`, stripeRefundId: null, amountCents: 1, createdAt: new Date() })
    }
    expect(await adopt('C')).toMatchObject({ ok: false, status: 409, wrote: false, error: ELSEWHERE })
    expect(claimOf('C').status).toBe(FINANCIAL_VERIFICATION)
  })

  it('(c) ER-M08 a commit reported lost, the re-read finds re_D stamped claim:C → treated as a commit (wrote true, attributeWithEvidence runs) with no second adoption audit', async () => {
    world([fvClaim('C')])
    s.sim.afterCommit = (txId) => (txId === 1 ? new Error('Connection lost') : undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = await adopt('C')
    expect(out).toMatchObject({ ok: true, outcome: 'refunded', evidence: 'stripe_read' })
    expect(db.$transaction).toHaveBeenCalledTimes(2)
    expect(stampedMirrors('C')).toHaveLength(1)
    expect(audits()).toEqual(['claim.attribute_refund'])
    // C7's log line covers the C8 transaction too (W4 fixer: the adoption variant text is gone).
    expect(warn.mock.calls.some((c) => c[0] === '[claims] binding transaction aborted')).toBe(true)
    warn.mockRestore()
  })

  it('(d) a generic error, the re-read finds nothing → 409 wrote:false « L’enregistrement de la ligne miroir n’a pas pu être confirmé … »', async () => {
    world([fvClaim('C')])
    db.$transaction.mockImplementationOnce(async () => { throw new Error('boom') })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await adopt('C')).toMatchObject({ ok: false, status: 409, wrote: false, error: NOT_CONFIRMED })
    expect(mirrorsOf(RE)).toHaveLength(0)
    expect(audits()).toEqual([])
    warn.mockRestore()
  })

  it('(e) a generic error, the re-read throws → 409 wrote:null « État non établi … »', async () => {
    world([fvClaim('C')])
    let failed = false
    const inner = db.refund.findFirst.getMockImplementation()!
    db.$transaction.mockImplementationOnce(async () => { failed = true; throw new Error('boom') })
    db.refund.findFirst.mockImplementation(async (a: unknown) => { if (failed) throw new Error('db down'); return inner(a) })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await adopt('C')).toMatchObject({ ok: false, status: 409, wrote: null, error: UNESTABLISHED })
    expect(audits()).toEqual([])
    warn.mockRestore()
  })

  it('(f) two concurrent adoptions of two different refunds for C → exactly one mirror stamped claim:C, one binding, the loser wrote nothing', async () => {
    world([fvClaim('C')], [], [dash(RE), dash(RE2)])
    s.sim.barrier = 2
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const [a, b] = await Promise.all([adopt('C', RE), adopt('C', RE2)])
    expect(stampedMirrors('C')).toHaveLength(1)
    expect(s.sim.deadlocks).toBe(1)
    const won = [a, b].filter((x) => x.ok)
    const lost = [a, b].filter((x) => !x.ok)
    expect(won).toHaveLength(1)
    expect(lost).toEqual([expect.objectContaining({ ok: false, status: 409, wrote: false, error: NOT_CONFIRMED })])
    expect(claimOf('C')).toMatchObject({ status: 'refunded', refundId: stampedMirrors('C')[0].id })
    warn.mockRestore()
  })

  it('dryRun → a preview and 0 transactions; NEGATIVE CONTROL: no stamped row → one mirror, then refunded', async () => {
    world([fvClaim('C')])
    expect(await adopt('C', RE, true)).toMatchObject({ ok: true, outcome: 'preview', wouldWrite: true })
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(await adopt('C')).toMatchObject({ ok: true, outcome: 'refunded' })
    expect(stampedMirrors('C')).toHaveLength(1)
  })
})

// ══ B11 (a)/(c) IMPLEMENTATION NOTE (W4, fixer round 1) — C7 outcomes of the binding, on both adoption branches ══════
// After the binding transaction of THIS call reports an error, the C7 re-read decides what may be said:
//   • a commit reported lost whose re-read shows the claim bound (already_bound), or a re-read that failed (unestablished)
//     → wrote null: « nothing written » is not established, and « la liaison n’a pas abouti » is not true either;
//   • an unchanged re-read (not_written), an abort, a refusal → wrote false (existing mirror) / true (fresh mirror).
describe('B11 (a)/(c) W4 fixer — what an adoption refusal says after the binding transaction', () => {
  const HEAD = (rowId: string) => `La ligne miroir ${rowId} (remboursement ${RE} ABOUTI chez Stripe, identité de cette réclamation) a été enregistrée`
  const NEUTRAL = 'L’état a pu changer : relisez la ligne dans la file.'
  const existingMirror = () => ({ id: 'rf_mirror', orderId: 'o1', restaurantId: 'r1', stripeRefundId: RE, idempotencyKey: `${EXTERNAL_REFUND_KEY_PREFIX}${RE}`, reason: 'claim:C', status: 'succeeded', amountCents: 500, stripePaymentIntentId: 'pi_1', settledAt: new Date('2026-09-10T10:00:00Z'), createdAt: new Date() })
  /** Makes a Prisma mock reject once `armed()` is true (the arming hook runs inside the simulated commit). */
  const failWhen = (m: typeof db.claim.findUnique, armed: () => boolean) => {
    const inner = m.getMockImplementation()!
    m.mockImplementation(async (a: unknown) => { if (armed()) throw new Error('db down'); return inner(a) })
  }
  let quiet: Array<{ mockRestore: () => void }> = []
  beforeEach(() => { quiet = [vi.spyOn(console, 'warn').mockImplementation(() => {}), vi.spyOn(console, 'error').mockImplementation(() => {})] })
  const restoreConsole = () => { for (const q of quiet) q.mockRestore() }

  describe('fresh branch (transaction 1 = the mirror, transaction 2 = the binding)', () => {
    it('identity_unread: the binder / stamp pre-check read rejects after the mirror commit → 409, wrote true, the identity variant; no second adoption audit', async () => {
      world([fvClaim('C')])
      let armed = false
      s.sim.afterCommit = (txId) => { if (txId === 1) armed = true }
      failWhen(db.refund.findMany, () => armed)
      const out = await adopt('C')
      const [mirror] = stampedMirrors('C')
      expect(out).toEqual(expect.objectContaining({ ok: false, status: 409, wrote: true, error: `${HEAD(mirror.id)}, mais la réclamation n’a pas été modifiée : la base n’a pas pu être relue pour établir l’identité du remboursement. Si elle est encore en vérification financière, « Réconcilier d’après la preuve » appliquera cette ligne, qui porte son identité.` }))
      expect(db.$transaction).toHaveBeenCalledTimes(1)
      expect(audits()).toEqual(['claim.adopt_stripe_refund'])
      expect(adoptionRefusalWroteText((out as { wrote: boolean | null }).wrote)).toBe('La ligne miroir a été enregistrée ; la liaison n’a pas abouti — relisez la ligne dans la file.')
      restoreConsole()
    })

    for (const recorded of [true, false]) {
      it(`already_bound (${recorded ? 'record written' : 'record failed'}): the binding commit is reported lost, the re-read shows {refunded, mirror} → 409, wrote NULL, the « déjà liée à cette ligne » variant; no attribute audit, no second adoption audit`, async () => {
        world([fvClaim('C')])
        s.sim.afterCommit = (txId) => (txId === 2 ? new Error('Connection lost') : undefined)
        if (!recorded) db.emailDispatch.create.mockImplementation(async () => { throw new Error('db down') })
        const out = await adopt('C')
        const [mirror] = stampedMirrors('C')
        const tail = recorded ? 'sa clôture est enregistrée.' : 'l’enregistrement de sa clôture a échoué : aucun avis client ne pourra lui être envoyé.'
        expect(out).toEqual(expect.objectContaining({ ok: false, status: 409, wrote: null, error: `${HEAD(mirror.id)}, et la réclamation est déjà liée à cette ligne (statut actuel : « refunded »). Cette action n’a tenté aucun e-mail ; ${tail} Relisez sa ligne dans la file.` }))
        expect(claimOf('C')).toMatchObject({ status: 'refunded', refundId: mirror.id })
        expect(db.emailDispatch.create).toHaveBeenCalledTimes(1)
        expect(audits()).toEqual(['claim.adopt_stripe_refund'])
        expect(alertMock).not.toHaveBeenCalled()
        expect(adoptionRefusalWroteText((out as { wrote: boolean | null }).wrote)).toBe(NEUTRAL)
        restoreConsole()
      })
    }

    it('unestablished: the binding transaction errors, then the re-read throws → 409, wrote NULL, the « n’a pas pu confirmer » variant; no second adoption audit', async () => {
      world([fvClaim('C')])
      let armed = false
      s.sim.afterCommit = (txId) => { if (txId === 2) { armed = true; return new Error('Connection lost') } }
      failWhen(db.claim.findUnique, () => armed)
      const out = await adopt('C')
      const [mirror] = stampedMirrors('C')
      expect(out).toEqual(expect.objectContaining({ ok: false, status: 409, wrote: null, error: `${HEAD(mirror.id)}, mais la base n’a pas pu confirmer ce qui a été écrit sur la réclamation. Relisez la ligne de cette réclamation dans la file avant toute autre action.` }))
      expect(audits()).toEqual(['claim.adopt_stripe_refund'])
      expect(adoptionRefusalWroteText((out as { wrote: boolean | null }).wrote)).toBe(NEUTRAL)
      restoreConsole()
    })

    it('not_written: the binding transaction errors before any commit and the re-read shows the claim unchanged → 409, wrote true, the « n’a pas pu être enregistrée » variant', async () => {
      world([fvClaim('C')])
      s.sim.beforeCallback = (txId) => { if (txId === 2) throw new Error('boom') }
      const out = await adopt('C')
      const [mirror] = stampedMirrors('C')
      expect(out).toEqual(expect.objectContaining({ ok: false, status: 409, wrote: true, error: `${HEAD(mirror.id)}, mais la réclamation n’a pas été modifiée : la liaison n’a pas pu être enregistrée (écriture concurrente ou erreur de la base). Si elle est encore en vérification financière, « Réconcilier d’après la preuve » appliquera cette ligne, qui porte son identité.` }))
      expect(claimOf('C').status).toBe(FINANCIAL_VERIFICATION)
      expect(audits()).toEqual(['claim.adopt_stripe_refund'])
      restoreConsole()
    })

    it('NEGATIVE CONTROL — a claim_changed abort keeps the frozen B11 (c) sentence and wrote true', async () => {
      world([fvClaim('C')])
      s.sim.beforeCallback = (txId) => { if (txId === 2) claimOf('C').refundError = 'financial_verification:stripe_unreadable: relabel' }
      const out = await adopt('C')
      const [mirror] = stampedMirrors('C')
      expect(out).toEqual(expect.objectContaining({ ok: false, status: 409, wrote: true, error: mirrorWrittenText(mirror.id, RE) }))
      restoreConsole()
    })
  })

  describe('existing-mirror branch (one transaction = the binding)', () => {
    it('already_bound: the binding commit is reported lost, the re-read shows {refunded, rf_mirror} → 409, wrote NULL, the C7 « déjà liée » text, Stripe’s facts', async () => {
      world([fvClaim('C')], [existingMirror()])
      s.sim.afterCommit = () => new Error('Connection lost')
      const out = await adopt('C')
      expect(out).toEqual(expect.objectContaining({ ok: false, status: 409, wrote: null, error: 'Cette réclamation est déjà liée à ce remboursement (statut actuel : « refunded »). Cette action n’a tenté aucun e-mail et n’a écrit aucune trace d’audit ; sa clôture est enregistrée. Relisez sa ligne dans la file.' }))
      expect((out as { facts?: { source: string } }).facts).toMatchObject({ source: 'stripe', stripeStatus: 'succeeded' })
      expect(claimOf('C')).toMatchObject({ status: 'refunded', refundId: 'rf_mirror' })
      expect(audits()).toEqual([])
      expect(adoptionRefusalWroteText((out as { wrote: boolean | null }).wrote)).toBe(NEUTRAL)
      restoreConsole()
    })

    it('unestablished: the binding errors, then the re-read throws → 409, wrote NULL, « État non établi »', async () => {
      world([fvClaim('C')], [existingMirror()])
      let armed = false
      s.sim.afterCommit = () => { armed = true; return new Error('Connection lost') }
      failWhen(db.claim.findUnique, () => armed)
      expect(await adopt('C')).toEqual(expect.objectContaining({ ok: false, status: 409, wrote: null, error: UNESTABLISHED }))
      restoreConsole()
    })

    it('NEGATIVE CONTROL — a claim_changed abort and an unchanged re-read after an error both keep wrote FALSE (nothing written, proven)', async () => {
      world([fvClaim('C')], [existingMirror()])
      s.sim.beforeCallback = () => { claimOf('C').refundError = 'financial_verification:stripe_unreadable: relabel' }
      expect(await adopt('C')).toEqual(expect.objectContaining({ ok: false, status: 409, wrote: false, error: 'Cette réclamation a changé d’état entre-temps — elle n’a pas été modifiée. Relisez sa ligne dans la file.' }))
      world([fvClaim('C')], [existingMirror()])
      s.sim.beforeCallback = () => { throw new Error('boom') }
      const notWritten = await adopt('C')
      expect(notWritten).toEqual(expect.objectContaining({ ok: false, status: 409, wrote: false, error: 'La liaison n’a pas pu être enregistrée (écriture concurrente ou erreur de la base) — rien n’a été écrit. Relisez sa ligne dans la file, puis réessayez.' }))
      expect(adoptionRefusalWroteText((notWritten as { wrote: boolean | null }).wrote)).toBe('Rien n’a été écrit.')
      restoreConsole()
    })
  })
})
