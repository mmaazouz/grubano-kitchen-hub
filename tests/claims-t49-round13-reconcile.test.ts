// tests/claims-t49-round13-reconcile.test.ts — T-49 round 13, J-M45 (G6, G7)
//
// N0-N7 of the no-row branch, as the pure derivation deriveNoRowOutcome. Identity comes only from a
// stamp or a binding (B2), an unreadable fact is never a proof, and each park carries its exact detail.
// The wiring (updateMany, enterFinancialVerification with the pre-image) belongs to the reconcile slice.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { matchWhere } from './support/prisma-where'

const { db } = vi.hoisted(() => ({
  db: {
    claim:  { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    refund: { findUnique: vi.fn(), findMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/refund', () => ({ executeRefund: vi.fn(), isRefundsEnabled: () => false, RESUME_CREATE_WINDOW_MS: 20 * 60 * 60 * 1000 }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: vi.fn().mockResolvedValue({ status: 'sent' }) }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: vi.fn().mockResolvedValue(undefined) }))

import {
  deriveNoRowOutcome, acceptedExits, isStuckResolvable, MARKERS,
  type ReapprovalFacts, type MoneyRow, type StripeRefundFact, type NoRowOutcome,
} from '@/lib/claim-action-rules'
import { attributeClaimRefund } from '@/lib/claims'

const T0 = new Date('2026-09-12T08:00:00.000Z')
const row = (id: string, o: Partial<MoneyRow> = {}): MoneyRow => ({
  id, status: 'succeeded', amountCents: 300, stripeRefundId: `re_${id}`, reason: null, idempotencyKey: `refund:o:k_${id}`,
  createdAt: T0, royaltyRefundCents: 0, ...o,
})
const refund = (id: string, o: Partial<StripeRefundFact> = {}): StripeRefundFact => ({ id, status: 'succeeded', amount: 300, charge: 'ch_1', metadata: {}, ...o })
const facts = (o: Partial<ReapprovalFacts> = {}): ReapprovalFacts => ({
  orderId: 'o', requestedAmountCents: 500, orderPaymentStatus: 'paid', hasPaymentIntent: true, piStatus: 'succeeded',
  chargeId: 'ch_1', chargeAmountCents: 2000, amountCapturedCents: 2000, chargeDisputed: false, amountRefundedCents: 0,
  routed: false, royaltyStatus: null, stripeListLength: 0, rows: [], L: [], truths: {}, binders: {}, stampedClaims: {},
  succeededNotCounted: [], rowContradictions: [], ...o,
})
const derive = (f: ReapprovalFacts) => deriveNoRowOutcome({ readable: true, facts: f }, 'cl1')
const refunded = (id: string, refundId: string, refundError: string | null = null) => ({ id, status: 'refunded', refundError, refundId })
const parkOf = (o: NoRowOutcome) => (o.kind === 'park' ? o : null)

describe('J-M45 — N1: readability and the no-charge proof', () => {
  it('transient, refunded unknown or 0 → nothing written, retry', () => {
    expect(deriveNoRowOutcome({ readable: false, permanent: null }, 'cl1')).toEqual({ kind: 'no_write', outcome: 'stripe_unreadable_retry' })
    expect(deriveNoRowOutcome({ readable: false, permanent: null, refundedCents: 0 }, 'cl1')).toEqual({ kind: 'no_write', outcome: 'stripe_unreadable_retry' })
  })

  it('transient with refunded > 0 → park with the G6 detail', () => {
    expect(deriveNoRowOutcome({ readable: false, permanent: null, refundedCents: 300 }, 'cl1')).toEqual({
      kind: 'park', reason: 'refund_moved_unattributed',
      detail: 'Stripe rapporte 300 c remboursés sur ce paiement, mais la liste complète de ses remboursements, ou la lecture d’une ligne de remboursement, n’a pas pu être lue : aucune attribution n’est établie. Relancez « Réconcilier d’après la preuve ».',
    })
  })

  it('permanent list_over_cap → park', () => {
    expect(deriveNoRowOutcome({ readable: false, permanent: 'list_over_cap' }, 'cl1')).toEqual({
      kind: 'park', reason: 'refund_moved_unattributed',
      detail: 'Stripe rapporte plus de 1 000 remboursements sur ce paiement : leur liste complète ne peut pas être lue, aucune attribution n’est établie.',
    })
  })

  it('no_charge canonical → the locked proof (never the truth-null park), refusal E1 / E1b / E1c by the facts', () => {
    const nc = (paymentStatus: string, piStatus: string, rows: MoneyRow[] = []) => deriveNoRowOutcome({ readable: false, permanent: 'no_charge', rows, paymentStatus, piStatus }, 'cl1')
    expect(nc('paid', 'succeeded')).toEqual({ kind: 'proof', basis: 'no_charge', prefix: 'no_refund_proven_rail_locked:', noChargeStep: 'E1c' })
    expect(nc('pending', 'succeeded')).toMatchObject({ kind: 'proof', noChargeStep: 'E1' })
    expect(nc('paid', 'processing')).toMatchObject({ kind: 'proof', noChargeStep: 'E1b' })
    // a failed row without a Stripe id is still canonical
    expect(nc('paid', 'succeeded', [row('rf_f', { status: 'failed', stripeRefundId: null })])).toMatchObject({ kind: 'proof', basis: 'no_charge' })
  })

  it('no_charge variant (a row with a Stripe id, or a pending row) → contradiction park', () => {
    const variant = (rows: MoneyRow[]) => deriveNoRowOutcome({ readable: false, permanent: 'no_charge', rows, paymentStatus: 'paid', piStatus: 'succeeded' }, 'cl1')
    expect(variant([row('rf_s')])).toEqual({ kind: 'park', reason: 'stripe_refund_contradiction', detail: 'La ligne rf_s enregistre un remboursement alors que le paiement Stripe de cette commande n’a pas de charge. Aucune conclusion tirée.' })
    expect(parkOf(variant([row('rf_p', { status: 'pending', stripeRefundId: null })]))?.detail).toContain('La ligne rf_p enregistre un remboursement')
  })
})

describe('J-M45 — N2 / N3: charge, owners, the explanation rule, AM-A5', () => {
  it('N2: a standing refund on another charge → contradiction', () => {
    expect(derive(facts({ amountRefundedCents: 300, L: [refund('re_X', { charge: 'ch_2' })] }))).toEqual({
      kind: 'park', reason: 'stripe_refund_contradiction',
      detail: 'Stripe rapporte sur ce paiement re_X sur une autre charge que ch_1, la charge dont il compte 300 c remboursés. Aucune conclusion tirée.',
    })
  })

  it('N3 (A-S29-1): a FAILED local owner of a standing refund → contradiction', () => {
    expect(derive(facts({ amountRefundedCents: 300, rows: [row('rf', { status: 'failed', stripeRefundId: 're_X' })], L: [refund('re_X')] }))).toEqual({
      kind: 'park', reason: 'stripe_refund_contradiction',
      detail: 'La ligne rf est ÉCHOUÉE dans notre base, mais Stripe rapporte son remboursement re_X « succeeded ». Aucune conclusion tirée.',
    })
  })

  it('A-S02: a single refunded null-error binder explains the refund → payable proof', () => {
    const o = derive(facts({ amountRefundedCents: 300, rows: [row('rf_o', { stripeRefundId: 're_O', idempotencyKey: 'refund:o:0' })], L: [refund('re_O')], binders: { rf_o: [refunded('cl_X', 'rf_o')] } }))
    expect(o).toMatchObject({ kind: 'proof', basis: 'verdict', prefix: MARKERS.PROOF_PAYABLE_V13, verdict: 'payable' })
    expect(o.kind === 'proof' && o.basis === 'verdict' ? o.explained : null).toEqual([{ refundId: 're_O', rowId: 'rf_o', claimId: 'cl_X', stamped: false, amountCents: 300, status: 'succeeded' }])
  })

  it('A-S18 / P3-22: a binding disowned by resume_mismatch is not a binder — unexplained, and Z is never named', () => {
    // boundToWhere excludes Z, so the loader hands no binder for rf.
    const o = parkOf(derive(facts({ amountRefundedCents: 300, rows: [row('rf')], L: [refund('re_rf')], binders: { rf: [] } })))
    expect(o?.reason).toBe('refund_moved_unattributed')
    expect(o?.detail).not.toContain('cl_Z')
  })

  it('a binder refunded with DECLARED_AFTER_REVERT does not explain, nor do two owners', () => {
    const declared = parkOf(derive(facts({ amountRefundedCents: 300, rows: [row('rf')], L: [refund('re_rf')], binders: { rf: [refunded('cl_X', 'rf', 'declared_settled_after_revert: x')] } })))
    expect(declared?.reason).toBe('refund_moved_unattributed')
    const twoOwners = parkOf(derive(facts({
      amountRefundedCents: 300,
      rows: [row('rf1', { stripeRefundId: 're_T' }), row('rf2', { stripeRefundId: null })],
      L: [refund('re_T', { metadata: { grubano_refund_row: 'rf2' } })],
      binders: { rf1: [refunded('cl_X', 'rf1')], rf2: [refunded('cl_Y', 'rf2')] },
    })))
    expect(twoOwners?.detail).toContain('Au moins un remboursement (re_T)')
  })

  it('AM-A5 (A-S37): stamp Y refused_final / not found / refunded on another row / bound to a refunded X ≠ Y', () => {
    const am = (o: Partial<ReapprovalFacts>) => parkOf(derive(facts({ amountRefundedCents: 300, rows: [row('rf', { reason: 'claim:cl_Y' })], L: [refund('re_rf')], ...o })))
    expect(am({ binders: { rf: [] }, stampedClaims: { cl_Y: { status: 'refused_final', refundId: null } } })).toEqual({
      kind: 'park', reason: 'refund_moved_unattributed',
      detail: 'Le remboursement re_rf (ligne rf) porte l’identité de la réclamation cl_Y, dont le statut est « refused_final » : cet argent n’est ni attribuable à cette réclamation ni, de façon établie, à une autre. Anomalie à instruire ; aucune conclusion tirée.',
    })
    expect(am({ binders: { rf: [] }, stampedClaims: { cl_Y: null } })?.detail)
      .toBe('Le remboursement re_rf (ligne rf) porte l’identité de la réclamation cl_Y, introuvable : cet argent n’est ni attribuable à cette réclamation ni, de façon établie, à une autre. Anomalie à instruire ; aucune conclusion tirée.')
    expect(am({ binders: { rf: [] }, stampedClaims: { cl_Y: { status: 'refunded', refundId: 'rf_other' } } })?.detail)
      .toContain('dont le statut est « refunded » et qui est soldée sur une autre ligne (rf_other)')
    expect(am({ binders: { rf: [refunded('cl_X', 'rf')] }, stampedClaims: { cl_Y: { status: 'refunded', refundId: 'rf_y' } } })?.detail)
      .toBe('Le remboursement re_rf (ligne rf) porte l’identité de la réclamation cl_Y, dont le statut est « refunded » et qui est soldée sur une autre ligne (rf_y) ; il est lié à la réclamation cl_X : cet argent n’est ni attribuable à cette réclamation ni, de façon établie, à une autre. Anomalie à instruire ; aucune conclusion tirée.')
  })

  it('IMPLEMENTATION NOTE (W1) on G7: « soldée » is said only of a refunded Y — a refused Y holding a refundId is not settled', () => {
    const d = parkOf(derive(facts({ amountRefundedCents: 300, rows: [row('rf', { reason: 'claim:cl_Y' })], L: [refund('re_rf')], binders: { rf: [] }, stampedClaims: { cl_Y: { status: 'refused_final', refundId: 'rf_z' } } })))?.detail
    expect(d).not.toContain('soldée')
  })

  it('a standing refund owned by a row stamped for THIS claim → changed during read, nothing concluded', () => {
    expect(derive(facts({ amountRefundedCents: 300, rows: [row('rf', { reason: 'claim:cl1' })], L: [refund('re_rf')] }))).toEqual({ kind: 'no_write', outcome: 'changed_during_read' })
  })

  it('NEGATIVE CONTROL — the stamped claim refunded on THAT row explains the refund → payable', () => {
    const o = derive(facts({ amountRefundedCents: 300, rows: [row('rf', { reason: 'claim:cl_Y' })], L: [refund('re_rf')], binders: { rf: [refunded('cl_Y', 'rf')] } }))
    expect(o).toMatchObject({ kind: 'proof', prefix: MARKERS.PROOF_PAYABLE_V13 })
  })
})

describe('J-M45 — N4 / N5 / N6: the bracket, unexplained money, contradictions', () => {
  it('N4 (A-S29-2) refunded 0 against a standing succeeded refund → contradiction', () => {
    expect(derive(facts({ amountRefundedCents: 0, rows: [row('rf')], L: [refund('re_rf')], binders: { rf: [refunded('cl_X', 'rf')] } }))).toEqual({
      kind: 'park', reason: 'stripe_refund_contradiction',
      detail: 'Stripe rapporte 0 c remboursés sur la charge ch_1, mais la liste complète des remboursements du paiement totalise 300 c aboutis et 300 c aboutis ou en attente. Les deux lectures se contredisent ; aucune conclusion tirée. Relancez la réconciliation.',
    })
  })

  it('N4 refunded above the list → unattributed', () => {
    expect(parkOf(derive(facts({ amountRefundedCents: 700, rows: [row('rf')], L: [refund('re_rf')], binders: { rf: [refunded('cl_X', 'rf')] } })))?.reason).toBe('refund_moved_unattributed')
  })

  it('N5 (A-S19): an untagged Dashboard refund with no row → DETAIL_UNATTRIBUTED', () => {
    expect(derive(facts({ amountRefundedCents: 300, L: [refund('re_D')] }))).toEqual({
      kind: 'park', reason: 'refund_moved_unattributed',
      detail: 'Des remboursements existent sur cette commande (Stripe : 300 c remboursés ; liste du paiement : 300 c aboutis, 0 c en attente ; 0 ligne(s) Refund). Au moins un remboursement (re_D) n’est rattaché ni à l’identité de cette réclamation ni, de façon établie, à une autre réclamation soldée. L’attribution ne peut pas être prouvée.',
    })
  })

  it('N5 (A-S20): an unexplained admin-rail row; (A-S40) a pending Dashboard refund adds the pending sentence', () => {
    expect(parkOf(derive(facts({ amountRefundedCents: 300, rows: [row('rf_adm', { reason: 'admin:x' })], L: [refund('re_rf_adm')] })))?.detail).toContain('Au moins un remboursement (re_rf_adm)')
    expect(parkOf(derive(facts({ amountRefundedCents: 300, L: [refund('re_P', { status: 'pending' })] })))?.detail)
      .toBe('Des remboursements existent sur cette commande (Stripe : 300 c remboursés ; liste du paiement : 0 c aboutis, 300 c en attente ; 0 ligne(s) Refund). Au moins un remboursement (re_P) n’est rattaché ni à l’identité de cette réclamation ni, de façon établie, à une autre réclamation soldée. L’attribution ne peut pas être prouvée. Un remboursement de ce paiement est encore en attente chez Stripe : relancez « Réconcilier d’après la preuve » lorsqu’il sera terminal.')
  })

  it('N5 mixed: stamped + bound-only explained refunds listed apart from the unexplained one', () => {
    const d = parkOf(derive(facts({
      amountRefundedCents: 900,
      rows: [row('rf_S', { reason: 'claim:cl_S', stripeRefundId: 're_S' }), row('rf_B', { stripeRefundId: 're_B' })],
      L: [refund('re_S'), refund('re_B'), refund('re_U')],
      binders: { rf_S: [refunded('cl_S', 'rf_S')], rf_B: [refunded('cl_B', 'rf_B')] },
    })))?.detail
    expect(d).toContain('Au moins un remboursement (re_U) n’est rattaché ni')
    expect(d).toContain(' ; rattachés à d’autres réclamations soldées : re_S → cl_S, re_B → cl_B. L’attribution ne peut pas être prouvée.')
  })

  it('N6: a row contradiction → park with its detail', () => {
    expect(derive(facts({ rowContradictions: [{ rowId: 'rf', rowStatus: 'pending', detail: 'La ligne rf enregistre le remboursement Stripe re_X, que Stripe ne connaît pas avec la clé de ce serveur. Aucune conclusion tirée.' }] })))
      .toEqual({ kind: 'park', reason: 'stripe_refund_contradiction', detail: 'La ligne rf enregistre le remboursement Stripe re_X, que Stripe ne connaît pas avec la clé de ce serveur. Aucune conclusion tirée.' })
  })
})

describe('J-M45 — N7: in flight, within the window, unclassifiable', () => {
  it('A-S09a: another claim’s refund still pending at Stripe → the in-flight park (A-S09a admin text)', () => {
    expect(derive(facts({
      amountRefundedCents: 800,
      rows: [row('rf_P', { status: 'pending', stripeRefundId: 're_P', amountCents: 800 })],
      L: [refund('re_P', { status: 'pending', amount: 800 })],
      truths: { rf_P: { kind: 'at_stripe', refundId: 're_P', status: 'pending' } },
      binders: { rf_P: [refunded('cl_Z', 'rf_P')] },
    }))).toEqual({
      kind: 'park', reason: 'refund_moved_unattributed',
      detail: 'Stripe rapporte 800 c remboursés sur ce paiement ; re_P est rattaché à une AUTRE réclamation (re_P → cl_Z) mais encore EN ATTENTE chez Stripe : aucune conclusion pour cette réclamation avant qu’il soit terminal. Relancez alors « Réconcilier d’après la preuve ».',
    })
  })

  it('pending rows within the window → no write, until the latest', () => {
    const u1 = new Date(T0.getTime() + 3_600_000), u2 = new Date(T0.getTime() + 7_200_000)
    expect(derive(facts({
      rows: [row('a', { status: 'pending', stripeRefundId: null }), row('b', { status: 'pending', stripeRefundId: null })],
      truths: { a: { kind: 'absent_within_window', until: u1 }, b: { kind: 'absent_within_window', until: u2 } },
    }))).toEqual({ kind: 'no_write', outcome: 'unconfirmed_within_window', until: u2 })
  })

  it('an unclassifiable pending row → contradiction park', () => {
    expect(derive(facts({ rows: [row('rp', { status: 'pending', stripeRefundId: null })], truths: {} }))).toEqual({
      kind: 'park', reason: 'stripe_refund_contradiction', detail: 'La ligne rp est en attente sans preuve classable ; aucune conclusion tirée.',
    })
  })

  it('the explanation rule is strict: a relaxed « any refunded binder » would explain the declared and two-binder cases', () => {
    const relaxed = (binders: Array<{ status: string; refundError: string | null }>) => binders.some((b) => b.status === 'refunded')
    expect(relaxed([{ status: 'refunded', refundError: 'declared_settled_after_revert: x' }])).toBe(true)
    expect(relaxed([{ status: 'refunded', refundError: null }, { status: 'refunded', refundError: null }])).toBe(true)
    // the shipped rule refuses both
    const two = parkOf(derive(facts({ amountRefundedCents: 300, rows: [row('rf')], L: [refund('re_rf')], binders: { rf: [refunded('cl_X', 'rf'), refunded('cl_W', 'rf')] } })))
    expect(two?.reason).toBe('refund_moved_unattributed')
  })

  it('IMPLEMENTATION NOTE (W1) on G7 N7 — an in-flight refund no settled claim explains (absent from L by read skew) is never « rattaché à une AUTRE réclamation »', () => {
    const o = parkOf(derive(facts({
      amountRefundedCents: 0,
      rows: [row('rf_P', { status: 'pending', stripeRefundId: null, reason: null })],
      L: [],
      truths: { rf_P: { kind: 'at_stripe', refundId: 're_P', status: 'pending' } },
    })))
    expect(o?.reason).toBe('refund_moved_unattributed')
    expect(o?.detail).toBe('Des remboursements existent sur cette commande (Stripe : 0 c remboursés ; liste du paiement : 0 c aboutis, 0 c en attente ; 1 ligne(s) Refund). Au moins un remboursement (re_P) n’est rattaché ni à l’identité de cette réclamation ni, de façon établie, à une autre réclamation soldée. L’attribution ne peut pas être prouvée. Un remboursement de ce paiement est encore en attente chez Stripe : relancez « Réconcilier d’après la preuve » lorsqu’il sera terminal.')
    expect(o?.detail).not.toContain('AUTRE réclamation')
  })
})

// ══ J-M45 — A-S17: the explained row is not attributable to this claim ═════════════════════════════════
describe('J-M45 — A-S17: attributing the row the derivation explained by settled claim X → 409 bound_to_other_claim naming X, nothing written', () => {
  const ROW = { id: 'rf_o', orderId: 'o', status: 'succeeded', amountCents: 300, stripeRefundId: 're_O', reason: null }
  const arrange = (x: { id: string; refundId: string; status: string; refundError: string | null }) => {
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', orderId: 'o', status: MARKERS.FINANCIAL_VERIFICATION })
    db.refund.findUnique.mockResolvedValue(ROW)
    db.refund.findMany.mockResolvedValue([{ id: ROW.id, reason: null }])
    db.claim.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => (matchWhere(where, x) ? { id: x.id } : null))
    db.claim.updateMany.mockResolvedValue({ count: 0 })
  }
  beforeEach(() => {
    vi.clearAllMocks()
    for (const m of [db.claim.findUnique, db.claim.findFirst, db.claim.updateMany, db.refund.findUnique, db.refund.findMany]) m.mockReset()
  })

  it('the derivation explains re_O by cl_X; the attribution of rf_o to cl1 is refused naming cl_X, with 0 updateMany', async () => {
    const o = derive(facts({ amountRefundedCents: 300, rows: [row('rf_o', { stripeRefundId: 're_O', idempotencyKey: 'refund:o:0' })], L: [refund('re_O')], binders: { rf_o: [refunded('cl_X', 'rf_o')] } }))
    expect(o.kind === 'proof' && o.basis === 'verdict' ? o.explained.map((x) => x.claimId) : []).toEqual(['cl_X'])
    arrange({ id: 'cl_X', refundId: 'rf_o', status: 'refunded', refundError: null })
    expect(await attributeClaimRefund({ claimId: 'cl1', refundRowId: 'rf_o', adminId: 'op1' })).toEqual({
      ok: false, status: 409, error: 'Ce remboursement est déjà lié à la réclamation cl_X — une même somme ne peut pas solder deux réclamations.',
    })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
  })

  it('NEGATIVE CONTROL — X holding a resume_mismatch binding is not a binder: the pre-check passes and a write is attempted', async () => {
    arrange({ id: 'cl_X', refundId: 'rf_o', status: 'refunded', refundError: 'resume_mismatch: le moteur a repris …' })
    const r = await attributeClaimRefund({ claimId: 'cl1', refundRowId: 'rf_o', adminId: 'op1' })
    expect(JSON.stringify(r)).not.toContain('cl_X')
    expect(db.claim.updateMany).toHaveBeenCalled()
  })
})

// ══ ER-M01 — registered in E-04 and routed to the founder acceptance list ═════════════════════════════
describe('IMPLEMENTATION NOTE (W3) on G7 N7 — W1 verifier P3: a pending row stamped for THIS claim is never « rattaché ni à l’identité de cette réclamation »', () => {
  // A row stamped claim:cl1, pending, whose refund Stripe reports pending but which is absent from L (read skew).
  const skew = (reason: string) => facts({
    amountRefundedCents: 0,
    rows: [row('rf_own', { status: 'pending', stripeRefundId: 're_own', reason })],
    truths: { rf_own: { kind: 'at_stripe', refundId: 're_own', status: 'pending' } },
  })

  it('own stamp, in flight at Stripe → the own-stamp outcome (changed during read), no DETAIL_UNATTRIBUTED', () => {
    expect(derive(skew('claim:cl1'))).toEqual({ kind: 'no_write', outcome: 'changed_during_read' })
  })

  it('a succeeded row stamped for this claim that Stripe reports pending → the same own-stamp outcome', () => {
    const f = facts({
      rows: [row('rf_own', { stripeRefundId: 're_own', reason: 'claim:cl1' })],
      succeededNotCounted: [{ rowId: 'rf_own', how: 'pending_at_stripe', refundId: 're_own', stripeStatus: 'pending' }],
    })
    expect(derive(f)).toEqual({ kind: 'no_write', outcome: 'changed_during_read' })
  })

  it('NEGATIVE CONTROL — the same in-flight row stamped for ANOTHER claim → DETAIL_UNATTRIBUTED naming it', () => {
    const o = derive(skew('claim:cl_O'))
    expect(o).toMatchObject({ kind: 'park', reason: 'refund_moved_unattributed' })
    expect(parkOf(o)!.detail).toContain('Au moins un remboursement (re_own) n’est rattaché ni à l’identité de cette réclamation')
  })
})

describe('ER-M01 — a first approval on an order with an unexplained admin-rail partial refund parks with no declaration exit (E-04)', () => {
  it('null pre-image facts: the admin-rail row explained by no settled claim → refund_moved_unattributed; FV has no stuck_close', () => {
    const o = parkOf(derive(facts({ amountRefundedCents: 300, rows: [row('rf_adm', { reason: 'admin:partial', stripeRefundId: 're_adm' })], L: [refund('re_adm')] })))
    expect(o?.reason).toBe('refund_moved_unattributed')
    const parked = { id: 'cl1', orderId: 'o', status: MARKERS.FINANCIAL_VERIFICATION, refundError: `${MARKERS.FINANCIAL_VERIFICATION}:refund_moved_unattributed: ${o?.detail}` }
    expect(isStuckResolvable(parked)).toBe(false)
    expect(acceptedExits({ claim: parked, now: T0, attributableRows: 0 })).toEqual(['reconcile', 'adopt'])
  })

  it('NEGATIVE CONTROL — the same admin refund explained by a settled claim is not a park', () => {
    const o = derive(facts({ amountRefundedCents: 300, rows: [row('rf_adm', { reason: null, stripeRefundId: 're_adm', idempotencyKey: 'refund:o:0' })], L: [refund('re_adm')], binders: { rf_adm: [refunded('cl_X', 'rf_adm')] } }))
    expect(o.kind).toBe('proof')
  })

  it('the entry path is registered in E-04 and routed to the founder acceptance list (spec)', () => {
    const spec = readFileSync('docs/ops/CLAIMS-T49-ROUND13-SPEC-v1.md', 'utf8').replace(/\r\n/g, '\n')
    const a = spec.indexOf('### E-04 ')
    const e04 = spec.slice(a, spec.indexOf('\n### ', a + 1))
    expect(e04).toContain('IMPLEMENTATION NOTE (W1): ER-M01 registered.')
    expect(e04).toContain('FOUNDER ACCEPTANCE LIST')
    expect(e04).toContain('T2 (e\') on a NULL pre-image')
  })
})
