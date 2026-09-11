// tests/claims-t49-round9.test.ts — T-49, round-9 fixes for the round-8 adversarial audit
//
// Round 8 ran to completion on 66d6950: 22 findings, 17 confirmed, P0 0, P1 5. Two of the five P1s
// were the same Class-3 defect a THIRD time — a refusal added to attributeClaimRefund with no
// console disable — so attribution now goes through one pure rule both sides apply, and this file
// holds them together with a PARITY test instead of another string pin. The others: a permanent
// engine lock described as temporary, a pending row with no Stripe id called « envoyé à la
// banque », and engine failures after the claim's own row was created being made closable by
// assertion. All pinned against the SHIPPED code, with the operator-aware CAS mock.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync as readRaw } from 'node:fs'
import { updateManyMock, matchWhere } from './support/prisma-where'

/** CRLF-safe: the founder's checkout has core.autocrlf=true. */
const read = (p: string) => readRaw(p, 'utf8').replace(/\r\n/g, '\n')
/** Comments quote removed sentences ON PURPOSE (the audit record). Negative pins read CODE only —
 *  the same stripper the class pin in tests/claims-t49-round7-routes.test.ts uses. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

const { db } = vi.hoisted(() => ({
  db: {
    claim:  { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    refund: { findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() },
    order:  { findUnique: vi.fn(), findMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { execMock, refundsFlag } = vi.hoisted(() => ({ execMock: vi.fn(), refundsFlag: vi.fn() }))
vi.mock('@/lib/refund', () => ({ executeRefund: execMock, isRefundsEnabled: refundsFlag, RESUME_CREATE_WINDOW_MS: 20 * 60 * 60 * 1000 }))

const { alertMock } = vi.hoisted(() => ({ alertMock: vi.fn() }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: alertMock }))

const { auditMock } = vi.hoisted(() => ({ auditMock: vi.fn() }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: auditMock }))

const { stripeMock } = vi.hoisted(() => ({
  stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() } },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

import {
  attributeClaimRefund, listFinancialVerificationClaims, reconcileClaimEvidence, listActionableRefundClaims,
  triggerClaimRefund, arbitrateClaim, adoptStripeRefundForClaim, claimRefundReason, isRailLocked, isStuckResolvable,
  FINANCIAL_VERIFICATION, RECONCILE_REQUIRED, NO_REFUND_PROVEN,
} from '@/lib/claims'
import { claimStamp } from '@/lib/claim-attribution-rules'

const fx: { row: Record<string, unknown> | null; forcedCount: number | null; applyWrites: boolean } =
  { row: null, forcedCount: null, applyWrites: true }

/** The legacy stranded shape: refunding, unbound, no error — admitted by the reconcile gate. */
const LEGACY = { id: 'cl1', orderId: 'o1', status: 'refunding', refundId: null, requestedAmountCents: 500, refundError: null }

beforeEach(() => {
  vi.clearAllMocks()
  // Reset implementations too: several tests queue Once/Implementation mocks on these.
  for (const m of [db.claim.findUnique, db.claim.findFirst, db.claim.findMany, db.refund.findFirst, db.refund.findUnique, db.refund.findMany]) m.mockReset()
  fx.row = { status: 'refunding', refundId: null, refundError: null }; fx.forcedCount = null
  db.claim.findUnique.mockResolvedValue({ ...LEGACY })
  db.claim.findFirst.mockResolvedValue(null)
  db.claim.updateMany.mockImplementation(updateManyMock(fx))
  db.claim.update.mockResolvedValue({})
  db.claim.findMany.mockResolvedValue([])
  db.refund.findMany.mockResolvedValue([])
  db.refund.findUnique.mockResolvedValue(null)
  db.refund.findFirst.mockResolvedValue(null)
  db.refund.create.mockResolvedValue({ id: 'rf_ext' })
  db.order.findUnique.mockResolvedValue({ id: 'o1', restaurantId: 'r1', stripePaymentIntentId: 'pi_1' })
  db.order.findMany.mockResolvedValue([])
  stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000, amount_refunded: 0 } })
  stripeMock.refunds.list.mockResolvedValue({ data: [] })
  stripeMock.refunds.retrieve.mockReset()
  alertMock.mockResolvedValue({ status: 'sent' })
  auditMock.mockResolvedValue(undefined)
  refundsFlag.mockReturnValue(false)
})

// ══ ATTRIBUTION PARITY — the console disables exactly the rows the server refuses ════════
describe('attribution PARITY — the console disables exactly the rows the server refuses', () => {
  type Row = { id: string; orderId: string; status: string; amountCents: number; stripeRefundId: string | null; reason: string | null; createdAt: Date }
  const R = (id: string, o: Partial<Row>): Row => ({ id, orderId: 'o1', status: 'succeeded', amountCents: 500, stripeRefundId: 're_' + id, reason: 'admin:x', createdAt: new Date(), ...o })

  const SETS: Array<{ name: string; rows: Row[]; bindings: Array<{ id: string; refundId: string }>; expected: Record<string, string | null> }> = [
    {
      name: 'the order carries a row stamped for THIS claim',
      rows: [
        R('rMine', { reason: claimRefundReason('cl1') }),
        R('rAdmin', {}),
        R('rOther', { reason: claimRefundReason('cl_OTHER') }),
        R('rMinePending', { reason: claimRefundReason('cl1'), status: 'pending', stripeRefundId: null }),
      ],
      bindings: [],
      // ROUND-12: a pending row is attributable — Stripe's evidence for it decides (round-11 audit, P1).
      expected: { rMine: null, rAdmin: 'own_stamp_exists', rOther: 'stamped_for_other_claim', rMinePending: null },
    },
    {
      name: 'no row is stamped for this claim',
      rows: [
        R('rFree', {}),
        R('rBound', { reason: null }),
        R('rCanceled', { status: 'canceled' }),
        R('rPendNoId', { status: 'pending', stripeRefundId: null }),
        R('rPendWithId', { status: 'pending' }),
      ],
      bindings: [{ id: 'cl_Z', refundId: 'rBound' }],
      expected: { rFree: null, rBound: 'bound_to_other_claim', rCanceled: 'unusable_status', rPendNoId: null, rPendWithId: null },
    },
  ]

  for (const set of SETS) {
    it(`${set.name}: list verdict === server verdict, row by row — and both are the expected ones`, async () => {
      const parked = { id: 'cl1', orderId: 'o1', reason: 'wrong_item', requestedAmountCents: 500, refundId: null, refundError: 'financial_verification:refund_moved_unattributed: …', createdAt: new Date(), decidedAt: null, restaurantId: 'r1' }
      db.claim.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
        (where.status === FINANCIAL_VERIFICATION ? [parked] : set.bindings))
      db.refund.findMany.mockResolvedValue(set.rows)
      db.order.findMany.mockResolvedValue([{ id: 'o1', stripePaymentIntentId: 'pi_1' }])
      const listed = await listFinancialVerificationClaims()
      const listVerdict = Object.fromEntries(listed[0].candidateRefunds.map((c) => [c.id, c.refusal]))
      expect(listVerdict).toEqual(set.expected)

      for (const row of set.rows) {
        db.claim.updateMany.mockClear()
        fx.row = { status: FINANCIAL_VERIFICATION, refundId: null, refundError: parked.refundError }
        db.claim.findUnique.mockResolvedValue({ id: 'cl1', orderId: 'o1', status: FINANCIAL_VERIFICATION })
        db.refund.findUnique.mockResolvedValue(row)
        db.claim.findFirst.mockImplementation(async ({ where }: { where: { refundId?: string; id?: { not?: string } } }) => {
          const b = set.bindings.find((x) => x.refundId === where.refundId && (!where.id?.not || x.id !== where.id.not))
          return b ? { id: b.id, status: 'refunding', refundError: null } : null
        })
        const r = await attributeClaimRefund({ claimId: 'cl1', refundRowId: row.id, adminId: 'op1' })
        // "Refused" = refused BEFORE any write. A later 409 (after the bind CAS) is not a refusal
        // the console could have predicted, and is not what the button's disable is for.
        const serverRefused = !r.ok && db.claim.updateMany.mock.calls.length === 0
        expect(serverRefused, `${row.id}: server refused=${serverRefused}, console refusal=${listVerdict[row.id]}`).toBe(listVerdict[row.id] !== null)
      }
    })
  }

  it('the fixtures exercise EVERY refusal code — parity over a subset would prove nothing', () => {
    const seen = new Set(SETS.flatMap((s) => Object.values(s.expected)).filter(Boolean))
    // ROUND-12: 'pending_unconfirmed' is gone — a pending row's link is decided by Stripe's evidence.
    for (const code of ['stamped_for_other_claim', 'own_stamp_exists', 'bound_to_other_claim', 'unusable_status']) {
      expect(seen.has(code), code).toBe(true)
    }
  })

  it('the stamp the rule uses is the stamp the engine writes', () => {
    expect(claimStamp('abc')).toBe(claimRefundReason('abc'))
  })
})

// ══ RAIL LOCK — permanent, said so, and approve refused on both sides ═══════════════════
describe('RAIL LOCK — permanent, said so, and approve refused on both sides', () => {
  const RAIL = 'no_refund_proven_rail_locked: Stripe ne rapporte AUCUN remboursement …'

  it('the server refuses to APPROVE a rail-locked claim, before any write and before the engine', async () => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', status: 'approved', refundAttempted: false, responseDeadlineAt: new Date(0), arbitrationDecision: 'approved', refundError: RAIL })
    const r = await arbitrateClaim({ claimId: 'cl1', adminId: 'op1', decision: 'approve' })
    expect(r).toMatchObject({ ok: false, status: 409 })
    expect(String((r as { error?: string }).error)).toContain('refusera tout remboursement')
    expect(db.claim.updateMany).not.toHaveBeenCalled()
    expect(db.claim.update).not.toHaveBeenCalled()
    expect(execMock).not.toHaveBeenCalled()
  })

  it('the persisted copy says the lock is PERMANENT and names only an exit that exists', () => {
    const m = read('lib/claims.ts').match(/'no_refund_proven_rail_locked: ([^']*)'/)
    expect(m).not.toBeNull()
    expect(m![1]).not.toMatch(/tant que/)
    expect(m![1]).toMatch(/DÉFINITIVEMENT/)
    expect(m![1]).toMatch(/Clôturer ce dossier/)
    // …and that exit really exists on this claim: the stuck-money hatch accepts it.
    expect(isStuckResolvable({ status: 'approved', refundError: RAIL })).toBe(true)
    expect(isRailLocked(RAIL)).toBe(true)
    expect(isRailLocked(`${NO_REFUND_PROVEN}: x`)).toBe(false)
  })

  it('the queue carries the flag, and the console disables approve on it', () => {
    expect(read('lib/claims.ts')).toContain('railLocked:      isRailLocked(c.refundError),')
    expect(read('components/claims/AdminClaimsArbitration.tsx'))
      .toContain('disabled={c.approveRefusal != null}')
  })

  it('the approve label no longer promises a refund, in any locale', () => {
    for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
      const a = JSON.parse(read(`messages/${loc}.json`)).claims.admin.approve as string
      expect(a, loc).not.toMatch(/rembourser|refund|reembolsar|rimborsa|ورد المبلغ/)
    }
  })
})

// ══ ENGINE FAILURE after the claim's own row exists → evidence decides, not a declaration ══
describe('ENGINE FAILURE — when the claim’s own row exists, the crash marker stays', () => {
  beforeEach(() => {
    refundsFlag.mockReturnValue(true)
    fx.row = { status: 'approved', refundAttempted: false, refundId: null, refundError: null }
    execMock.mockResolvedValue({ ok: false, status: 502, error: 'Remboursement émis, reprise de la royalty franchisé en échec — réessayez.' })
    db.claim.findUnique
      .mockImplementationOnce(async () => ({ orderId: 'o1', requestedAmountCents: 500 }))
      .mockImplementation(async () => ({ refundError: fx.row!.refundError }))
  })

  it('a stamped PENDING row exists → still refunding, marker kept with the engine text, NOT engine_failed, NOT closable', async () => {
    db.refund.findFirst.mockResolvedValue({ id: 'rf_own', status: 'pending' })
    const r = await triggerClaimRefund('cl1')
    expect(r).toMatchObject({ state: 'failed' })
    expect(fx.row!.status).toBe('refunding')
    expect(String(fx.row!.refundError).startsWith(RECONCILE_REQUIRED)).toBe(true)
    expect(String(fx.row!.refundError)).toContain('Moteur : « Remboursement émis')
    expect(db.claim.update).not.toHaveBeenCalled()
    expect(isStuckResolvable({ status: 'refunding', refundError: String(fx.row!.refundError) })).toBe(false)
    // the lookup is keyed on THIS claim's stamp
    expect(db.refund.findFirst.mock.calls[0][0].where).toMatchObject({ orderId: 'o1', reason: claimRefundReason('cl1') })
  })

  it('no stamped row (the engine refused before creating anything) → engine_failed, as before', async () => {
    db.refund.findFirst.mockResolvedValue(null)
    await triggerClaimRefund('cl1')
    const w = db.claim.update.mock.calls.at(-1)![0].data
    expect(w).toMatchObject({ status: 'approved' })
    expect(String(w.refundError).startsWith('engine_failed:')).toBe(true)
    expect(w).not.toHaveProperty('refundId')
  })

  it('a stamped FAILED row → engine_failed, and the failed row is bound so the card shows it', async () => {
    db.refund.findFirst.mockResolvedValue({ id: 'rf_own', status: 'failed' })
    await triggerClaimRefund('cl1')
    const w = db.claim.update.mock.calls.at(-1)![0].data
    expect(w).toMatchObject({ status: 'approved', refundId: 'rf_own' })
    expect(String(w.refundError).startsWith('engine_failed:')).toBe(true)
  })
})

// ══ RECONCILE GATE — only the population the console offers the button on ════════════════
describe('RECONCILE GATE — only the population the console offers the button on', () => {
  it('a HEALTHY approved-but-unpaid claim (what a Mode-A approval produces) is refused: nothing read, nothing written', async () => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', orderId: 'o1', status: 'approved', refundId: null, requestedAmountCents: 500, refundError: null })
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ ok: false, status: 409 })
    expect(db.refund.findMany).not.toHaveBeenCalled()
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })

  it('a proven-absence claim and a rail-locked claim are refused too', async () => {
    for (const refundError of [`${NO_REFUND_PROVEN}: aucun …`, 'no_refund_proven_rail_locked: …', 'engine_failed: …']) {
      db.refund.findMany.mockClear()
      db.claim.findUnique.mockResolvedValue({ id: 'cl1', orderId: 'o1', status: 'approved', refundId: null, requestedAmountCents: 500, refundError })
      expect(await reconcileClaimEvidence({ claimId: 'cl1' }), refundError).toMatchObject({ ok: false, status: 409 })
      expect(db.refund.findMany).not.toHaveBeenCalled()
    }
  })

  it('admitted: parked, crash-marked, legacy stranded', async () => {
    const marker = `${RECONCILE_REQUIRED}: tentative de remboursement démarrée à 2026-09-10T00:00:00.000Z — identité pas encore liée.`
    for (const c of [
      { status: FINANCIAL_VERIFICATION, refundId: null, refundError: 'financial_verification:stripe_unreadable: …' },
      { status: 'refunding', refundId: null, refundError: marker },
      { status: 'refunding', refundId: null, refundError: null },
    ]) {
      db.refund.findMany.mockClear()
      db.claim.findUnique.mockResolvedValue({ id: 'cl1', orderId: 'o1', requestedAmountCents: 500, ...c })
      await reconcileClaimEvidence({ claimId: 'cl1' })
      expect(db.refund.findMany, String(c.refundError)).toHaveBeenCalled()
    }
  })
})

// ══ PENDING WITHOUT A STRIPE ID — never « envoyé à la banque », never dropped out of evidence ══
describe('PENDING WITHOUT A STRIPE ID', () => {
  const pendingRow = (stripeRefundId: string | null) => ({ id: 'rf1', status: 'pending', amountCents: 500, stripeRefundId, reason: claimRefundReason('cl1'), createdAt: new Date() })

  it('ROUND-9 FIX: no more no-write dead end — Stripe holds nothing and the row is young → it says until when, writes nothing', async () => {
    // Round 9 returned 'pending_unconfirmed' here without reading Stripe, and the claim had no exit.
    // The full outcome table is in tests/claims-t49-round10.test.ts.
    db.refund.findMany.mockResolvedValue([pendingRow(null)])
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(r).toMatchObject({ ok: true, outcome: 'unconfirmed_within_window', refundId: 'rf1' })
    expect(typeof (r as { until?: string }).until).toBe('string')
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })

  it('…while a pending row WITH a Stripe id that Stripe reports pending is genuinely pending', async () => {
    fx.row = { status: 'refunding', refundId: 'rf1', refundError: null }
    db.refund.findMany.mockResolvedValue([pendingRow('re_1')])
    // ROUND-10: a recorded Stripe id is read BY that id, as the engine's own resume does.
    stripeMock.refunds.retrieve.mockResolvedValue({ id: 're_1', status: 'pending', amount: 500, payment_intent: 'pi_1', metadata: { grubano_refund_row: 'rf1' } })
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toMatchObject({ ok: true, outcome: 'still_pending', refundId: 'rf1' })
  })

  it('the classifier: no Stripe id → local_pending_unconfirmed; with one → stripe_pending', async () => {
    const claimRow = { id: 'cl1', status: 'refunding', refundId: 'rf1', refundError: null, refundAttempted: true, requestedAmountCents: 500, createdAt: new Date(), reason: 'wrong_item' }
    db.claim.findMany.mockResolvedValue([claimRow])
    db.refund.findMany.mockResolvedValue([{ id: 'rf1', status: 'pending', amountCents: 500, stripeRefundId: null, createdAt: new Date() }])
    expect((await listActionableRefundClaims())[0].moneyState).toBe('local_pending_unconfirmed')
    db.refund.findMany.mockResolvedValue([{ id: 'rf1', status: 'pending', amountCents: 500, stripeRefundId: 're_1', createdAt: new Date() }])
    expect((await listActionableRefundClaims())[0].moneyState).toBe('stripe_pending')
  })

  it('the legacy stranded shape is money-UNKNOWN in both consoles (reconcile_required), not « sans remboursement Stripe »', async () => {
    db.claim.findMany.mockResolvedValue([{ id: 'cl1', status: 'refunding', refundId: null, refundError: null, refundAttempted: true, requestedAmountCents: 500, createdAt: new Date(), reason: 'wrong_item' }])
    const out = await listActionableRefundClaims()
    expect(out[0].moneyState).toBe('reconcile_required')
    expect(out[0].resolvable).toBe(false)
  })
})

// ══ ADOPTION REFUSALS say whether anything was written ═══════════════════════════════════
describe('ADOPTION REFUSALS say whether anything was written', () => {
  const RE = 're_dash12345678'
  const okRefund = { id: RE, status: 'succeeded', amount: 500, payment_intent: 'pi_1', charge: 'ch_1', created: 1_700_000_000, metadata: {} }
  beforeEach(() => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', orderId: 'o1', status: FINANCIAL_VERIFICATION })
    stripeMock.refunds.retrieve.mockResolvedValue(okRefund)
    stripeMock.paymentIntents.retrieve.mockResolvedValue({ latest_charge: { id: 'ch_1', amount: 2000, amount_captured: 2000 }, metadata: { orderId: 'o1' } })
  })

  it('a refusal BEFORE the mirror row → wrote: false', async () => {
    stripeMock.refunds.retrieve.mockResolvedValue({ ...okRefund, payment_intent: 'pi_OTHER' })
    expect(await adoptStripeRefundForClaim({ claimId: 'cl1', stripeRefundId: RE, adminId: 'op1' }))
      .toMatchObject({ ok: false, status: 400, wrote: false })
    expect(db.refund.create).not.toHaveBeenCalled()
  })

  it('a refusal AFTER the mirror row was created → wrote: true (the console must not say « Rien n’a été écrit »)', async () => {
    db.refund.findUnique.mockResolvedValue({ id: 'rf_ext', orderId: 'o1', status: 'succeeded', amountCents: 500, stripeRefundId: RE, reason: claimRefundReason('cl1') })
    fx.row = { status: 'refunding', refundId: null, refundError: null } // the bind CAS will miss
    const r = await adoptStripeRefundForClaim({ claimId: 'cl1', stripeRefundId: RE, adminId: 'op1' })
    expect(db.refund.create).toHaveBeenCalledTimes(1)
    expect(r).toMatchObject({ ok: false, wrote: true })
  })
})

// ══ SOURCE PINS — reverting a console or route fix turns this red ═══════════════════════
describe('round-9 source pins', () => {
  const fv = read('components/claims/AdminFinancialVerification.tsx')
  const arb = read('components/claims/AdminClaimsArbitration.tsx')
  const fvCode = stripComments(fv)
  const arbCode = stripComments(arb)

  it('attribution disables on the server verdict and has a legend for every refusal code', () => {
    expect(fv).toContain('disabled={busyId === r.id || c.refusal != null}')
    // ROUND-12: 'pending_unconfirmed' is gone — a pending row's link is decided by Stripe's evidence.
    for (const code of ['stamped_for_other_claim', 'own_stamp_exists', 'bound_to_other_claim', 'unusable_status']) {
      expect(fv, code).toMatch(new RegExp(`^  ${code}:`, 'm'))
    }
  })

  it('reconcile: pending_unconfirmed has its own toast and needs attention; the rail lock no longer « lifts »', () => {
    expect(fv).toContain("|| outcome === 'unconfirmed_within_window'")
    expect(fvCode).not.toMatch(/tant que la reprise manuelle/)
    expect(fvCode).not.toContain('déjà garée')
  })

  it('« Rien n’a été écrit » only when proven; the « Lier » toast depends on where the facts came from', () => {
    expect(fv).toContain("refusedFacts[r.id]!.wrote === false ? 'Rien n’a été écrit.'")
    expect(fv).toContain("body.result?.facts?.source === 'local_row'")
    expect(fvCode).not.toContain('tel que Stripe le rapporte.')
  })

  it('arbitration console: our row is not « Stripe », a pending row without id is not « envoyé à la banque »', () => {
    expect(arb).toContain('Statut de notre ligne :')
    expect(arbCode).not.toContain('Statut Stripe :')
    expect(arb).toMatch(/local_pending_unconfirmed:\s+\{ text: 'Ligne de remboursement liée en attente, sans identifiant Stripe enregistré/)
    expect(arbCode).not.toContain('sans aucun remboursement Stripe associé')
  })

  it('routes: arbitrate re-reads the admin role set; attribute branches are strict and report `wrote`', () => {
    const arbitrate = read('app/api/admin/claims/[id]/arbitrate/route.ts')
    expect(arbitrate).toContain('const operator = await resolveAdmin()')
    expect(arbitrate).not.toContain('getServerSession')
    const attribute = read('app/api/admin/claims/[id]/attribute/route.ts')
    expect(attribute.match(/\}\)\.strict\(\),/g) ?? []).toHaveLength(2)
    expect(attribute).toContain('wrote: result.wrote ?? null')
  })

  it('the help page no longer tells an APPROVED customer the refund is « en cours »', () => {
    const page = read('app/[locale]/eat/order/[orderId]/help/page.tsx')
    expect(page).toContain("if (ex.status === 'refunding') return t('claimRefunding')")
    expect(page).toContain("if (ex.status === 'approved') return t('claimApproved')")
  })
})

// ══ CUSTOMER AND ADMIN COPY, ALL FIVE LOCALES ════════════════════════════════════════════
describe('customer and admin copy, all five locales', () => {
  const L = (loc: string) => JSON.parse(read(`messages/${loc}.json`))
  const LOCALES = ['fr', 'en', 'es', 'it', 'ar']

  it('an APPROVED claim is never « in progress » to the customer; refunding has its own line', () => {
    for (const loc of LOCALES) {
      const m = L(loc)
      expect(m.claims.status.approved, loc).not.toMatch(/in progress|en curso|in corso|جارٍ|en cours/)
      expect(m.eat.help.claimApproved, loc).not.toMatch(/in progress|being processed|en curso|in corso|جارٍ|en cours/)
      expect(typeof m.eat.help.claimRefunding, loc).toBe('string')
    }
  })

  it('financial verification asserts no « existing transaction » and promises nothing', () => {
    for (const loc of LOCALES) {
      expect(L(loc).claims.status.financial_verification, loc)
        .not.toMatch(/transaction existante|existing transaction|transacción existente|transazione esistente|المعاملة القائمة|ne sera lancé|will be issued|se iniciará|sarà avviato|لن يُطلَق/)
    }
  })

  it('the admin toasts name the queue exactly as the (French-only) console heading does', () => {
    for (const loc of LOCALES) {
      const a = L(loc).claims.admin
      for (const k of ['approvedNotSent', 'approvedFailed', 'approvedResumeMismatch']) {
        expect(a[k], `${loc}.${k}`).toContain('« Remboursements à traiter »')
      }
    }
  })
})

// ══ INSTRUMENT — the where-matcher evaluates id OPERATORS (round-8 audit, P3) ═════════════
// The round-9 control run proved this change UNPINNED: reverting matchWhere to skip every `id`
// left the whole suite green. An instrument nobody tests is exactly how the where-blind mock of
// round 2 survived. These pin the matcher itself.
describe('tests/support/prisma-where matchWhere — id operators are evaluated, id addresses are not', () => {
  it('an id OPERATOR on a row that has an id is evaluated (the shape of `id: { not: row.id }`)', () => {
    expect(matchWhere({ orderId: 'o1', id: { not: 'rf1' } }, { id: 'rf1', orderId: 'o1' })).toBe(false)
    expect(matchWhere({ orderId: 'o1', id: { not: 'rf1' } }, { id: 'rf2', orderId: 'o1' })).toBe(true)
    expect(matchWhere({ id: { in: ['a', 'b'] } }, { id: 'c' })).toBe(false)
  })

  it('a scalar id only ADDRESSES the row, and a fixture without an id is never refused on id', () => {
    expect(matchWhere({ id: 'cl1', status: 'refunding' }, { status: 'refunding' })).toBe(true)
    expect(matchWhere({ id: 'cl1', status: 'refunding' }, { id: 'OTHER', status: 'refunding' })).toBe(true)
    expect(matchWhere({ id: { not: 'cl1' }, status: 'refunding' }, { status: 'refunding' })).toBe(true)
  })
})
