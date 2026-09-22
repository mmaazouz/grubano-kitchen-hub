// tests/claims-t49-round13-copy.test.ts — T-49 round 13, J-M46 (G8, I-01 proof prefixes): the N8 proof-of-absence write,
// its exact text and its alert.
//
// Every sentence N8 writes is pinned verbatim against G8 (with the ER-R26 / ER-C24 wordings its W2 note applies), every
// engine quote it embeds exists verbatim in lib/refund.ts, the write is a compare-and-set on every field reconcile read,
// and ALERT-B follows a won CAS for all three prefixes — the payable one included — and never a lost one.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { payableWorld, wireWorld, refundRow, stripeRefund, claimOf, HOURS, type World } from './support/claims-world'
import { stateOf } from './fixtures/claims-r13-states'

const { db } = vi.hoisted(() => ({
  db: {
    claim:  { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), count: vi.fn() },
    refund: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    order:  { findUnique: vi.fn() },
    franchiseRoyalty: { findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/refund', () => ({ executeRefund: vi.fn(), isRefundsEnabled: () => false, RESUME_CREATE_WINDOW_MS: 20 * 60 * 60 * 1000 }))
const { alertMock } = vi.hoisted(() => ({ alertMock: vi.fn() }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminMoneyReviewAlert: alertMock }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: vi.fn() }))
const { stripeMock } = vi.hoisted(() => ({
  stripeMock: { paymentIntents: { retrieve: vi.fn() }, refunds: { list: vi.fn(), retrieve: vi.fn(), create: vi.fn() } },
}))
vi.mock('@/lib/stripe', () => ({ getStripe: () => stripeMock }))

import { reconcileClaimEvidence } from '@/lib/claims'
import {
  HEAD_A, headB, payableTail, LOCKED_OPEN, LOCKED_CLOSE, AWAITING_OPEN, AWAITING_CLOSE, routedSentence, routedApplies, refusalSentence, holdSentence,
  e3Sentence, proofInstant, MARKERS, type ReapprovalFacts, type EngineRefusal, type MoneyRow,
} from '@/lib/claim-action-rules'

const REFUND_SRC = readFileSync('lib/refund.ts', 'utf8')
const PRE = 'no_refund_proven_rail_locked: écrit avant'
let w: World
const setWorld = (mutate?: (x: World) => void, claim: Record<string, unknown> = { refundError: PRE }) => {
  w = payableWorld(claim)
  mutate?.(w)
  wireWorld(w, db, stripeMock)
}
beforeEach(() => {
  vi.clearAllMocks()
  alertMock.mockReset()
  alertMock.mockResolvedValue({ status: 'sent' })
  setWorld()
})

const T0 = new Date('2026-09-12T08:00:00.000Z')
const facts = (o: Partial<ReapprovalFacts> = {}): ReapprovalFacts => ({
  orderId: 'o1', requestedAmountCents: 500, orderPaymentStatus: 'paid', hasPaymentIntent: true, piStatus: 'succeeded', chargeId: 'ch_1',
  chargeAmountCents: 2000, amountCapturedCents: 2000, chargeDisputed: false, amountRefundedCents: 0, routed: false, royaltyStatus: null,
  stripeListLength: 0, rows: [], L: [], truths: {}, binders: {}, stampedClaims: {}, succeededNotCounted: [], rowContradictions: [], ...o,
})
const mrow = (id: string, o: Partial<MoneyRow> = {}): MoneyRow => ({ id, status: 'pending', amountCents: 300, stripeRefundId: null, reason: null, idempotencyKey: `refund:o1:k_${id}`, createdAt: T0, royaltyRefundCents: 0, ...o })
const e3 = (ids: string[], evidence: string, o: Partial<Extract<EngineRefusal, { step: 'E3' }>> = {}): Extract<EngineRefusal, { step: 'E3' }> =>
  ({ step: 'E3', oldestRowIds: ids, evidenceByRow: Object.fromEntries(ids.map((id) => [id, evidence])) as never, otherPendingRowIds: [], engineListTruncated: false, ...o })

describe('J-M46 — G8 HEADs and tails, exact', () => {
  it('HEAD_A and HEAD_B, with « identité portée par la ligne » / « liaison seule »', () => {
    expect(HEAD_A).toBe('Stripe ne rapporte aujourd’hui aucun remboursement abouti ni en attente sur ce paiement (liste complète lue).')
    expect(headB(300, [{ refundId: 're_O', rowId: 'rf_o', claimId: 'cl_X', stamped: false, amountCents: 300, status: 'succeeded' }]))
      .toBe('Stripe rapporte 300 c remboursés sur ce paiement, et chacun de ses remboursements aboutis ou en attente est rattaché à une AUTRE réclamation, soldée sur sa ligne : re_O (ligne rf_o, réclamation cl_X, liaison seule), 300 c. Aucun n’est rattaché à celle-ci.')
    expect(headB(600, [
      { refundId: 're_1', rowId: 'rf_1', claimId: 'cl_A', stamped: true, amountCents: 300, status: 'succeeded' },
      { refundId: 're_2', rowId: 'rf_2', claimId: 'cl_B', stamped: false, amountCents: 300, status: 'succeeded' },
    ])).toContain('re_1 (ligne rf_1, réclamation cl_A, identité portée par la ligne), 300 c ; re_2 (ligne rf_2, réclamation cl_B, liaison seule), 300 c.')
  })

  // D′ L2 (R13 spec v1.1, D13 / G8): payableTail, LOCKED_* and AWAITING_* no longer name a re-approval — the rail
  // (« Payer les approuvées ») is the only payer, and « approuvez-la à nouveau » / « nouvelle approbation » never appear.
  it('PAYABLE tail with « payable au plus tôt le <ISO> (UTC) » (text v1.1 — D′ L2)', () => {
    expect(payableTail(500, new Date('2026-09-12T09:00:00.000Z'))).toBe('Aucune ligne de remboursement de cette commande n’est en attente, et au moment de cette lecture aucune condition de refus du moteur ni aucun blocage de sûreté n’était rempli pour le montant de cette réclamation (500 c). La réclamation repasse en « approuvée, non payée ». Rien ne la paiera automatiquement : elle devra être sélectionnée explicitement par un admin dans le rail financier (« Payer les approuvées »), remboursements ouverts ; une vérification relira alors Stripe et nos lignes avant le moteur. Elle est payable au plus tôt le 2026-09-12T09:00:00.000Z (UTC).')
    // the parser-critical phrase C4 reads is unchanged
    expect(proofInstant(payableTail(500, new Date('2026-09-12T09:00:00.000Z')))?.toISOString()).toBe('2026-09-12T09:00:00.000Z')
  })

  it('LOCKED and AWAITING tails (text v1.1 — D′ L2)', () => {
    expect(LOCKED_OPEN).toBe('MAIS le rail financier ne paierait pas cette réclamation :')
    expect(LOCKED_CLOSE).toBe('Rien ne sera payé par le rail pour cette réclamation tant que cet état est enregistré : le rail la refuse et aucun balayage ne la paie. « Réconcilier d’après la preuve » réévalue toutes les conditions ; une cause qui ne dépend d’aucune action ultérieure ne cessera pas. Si elle a été remboursée hors système (Dashboard Stripe), déclarez-le (« Clôturer ce dossier… ») ; sinon clôturez sans paiement. Décision humaine requise.')
    expect(AWAITING_OPEN).toBe('MAIS le rail financier ne paierait pas cette réclamation tant que')
    expect(AWAITING_CLOSE).toBe('Relancez « Réconcilier d’après la preuve » lorsque cette ligne ne sera plus « en attente » dans notre base : la réconciliation réévaluera alors toutes les conditions. En attendant, rien ne sera payé par le rail pour cette réclamation (le rail la refuse, aucun balayage ne la paie). Si elle a été remboursée hors système (Dashboard Stripe), déclarez-le (« Clôturer ce dossier… »).')
  })

  it('NEGATIVE CONTROL (D′ L2) — the v1 G8 pieces are not the shipped ones, and no shipped piece names a re-approval', () => {
    const V1 = {
      payableTail: 'Rien ne la paiera automatiquement : elle devra être approuvée à nouveau par un admin, réclamations et remboursements ouverts ;',
      LOCKED_OPEN: 'MAIS une nouvelle approbation ne paierait pas cette réclamation :',
      LOCKED_CLOSE_clause: 'l’approbation est refusée et le balayage automatique l’ignore',
      AWAITING_OPEN: 'MAIS une nouvelle approbation ne paierait pas cette réclamation tant que',
      AWAITING_CLOSE_clause: '(approbation refusée, balayage automatique ignoré)',
    }
    expect(payableTail(500, T0)).not.toContain(V1.payableTail)
    expect(LOCKED_OPEN).not.toBe(V1.LOCKED_OPEN)
    expect(LOCKED_CLOSE).not.toContain(V1.LOCKED_CLOSE_clause)
    expect(AWAITING_OPEN).not.toBe(V1.AWAITING_OPEN)
    expect(AWAITING_CLOSE).not.toContain(V1.AWAITING_CLOSE_clause)
    for (const t of [payableTail(500, T0), LOCKED_OPEN, LOCKED_CLOSE, AWAITING_OPEN, AWAITING_CLOSE]) {
      expect(t).not.toMatch(/approuvez-la à nouveau|nouvelle approbation|approuvée à nouveau/)
    }
    expect(payableTail(500, T0)).toContain('Payer les approuvées')
  })
})

describe('J-M46 — every refusal and hold sentence, exact', () => {
  const f = facts({ rows: [mrow('rf_1'), mrow('rf_2')], amountRefundedCents: 300 })
  it('E1, E2, E1b, E4, E5, E6', () => {
    expect(refusalSentence({ step: 'E1', paymentStatus: 'pending', hasPaymentIntent: true }, f)).toBe('le moteur refuse tout remboursement sur cette commande, dont le statut de paiement enregistré est « pending » (« Commande non payée — rien à rembourser. »).')
    expect(refusalSentence({ step: 'E2', rowIds: ['rf_f'] }, f)).toBe('la ligne rf_f est ÉCHOUÉE avec un identifiant Stripe : le moteur refuse tout remboursement sur une commande qui porte une telle ligne, et aucune action des réclamations ne modifie cette ligne.')
    expect(refusalSentence({ step: 'E1b', piStatus: 'requires_capture' }, f)).toBe('le paiement Stripe de cette commande est au statut « requires_capture », et le moteur ne rembourse qu’un paiement « succeeded » (« Paiement non débité — rien à rembourser. »).')
    expect(refusalSentence({ step: 'E4', refundedCents: 2000, chargeAmountCents: 2000 }, f)).toBe('le paiement est déjà intégralement remboursé chez Stripe (2000 c sur 2000 c) ; le moteur refuserait (« Paiement déjà intégralement remboursé. »).')
    expect(refusalSentence({ step: 'E5', requestedAmountCents: 500, refundableCents: 300 }, f)).toBe('le montant de cette réclamation (500 c) dépasse ce qui reste remboursable sur ce paiement (300 c) ; le moteur refuserait (« Montant invalide »).')
    expect(refusalSentence({ step: 'E6', key: 'refund:o1:300', rowId: 'rf_k' }, f)).toBe('le moteur calculerait la clé refund:o1:300 pour un nouveau remboursement, et la ligne rf_k la détient déjà ; il refuserait (« Un remboursement est déjà en cours sur ce montant cumulé. ») tant que le montant remboursé rapporté par Stripe reste 300 c.')
  })

  it('E3 opener, tie, and each continuation (truncated, failed_at_stripe, dead, succeeded_at_stripe, clawback)', () => {
    const g = facts({ rows: [mrow('rf_1', { reason: 'claim:cl_A' })], truths: { rf_1: { kind: 'at_stripe', refundId: 're_1', status: 'succeeded' } } })
    const open = 'la plus ancienne ligne en attente de la commande, rf_1 (identité claim:cl_A), est reprise par le moteur avant tout nouveau remboursement'
    expect(e3Sentence(e3(['rf_1'], 'succeeded_at_stripe'), g)).toBe(`${open} : son remboursement Stripe re_1 est ABOUTI mais la ligne n’est pas finalisée ici ; le moteur finaliserait cette ligne, pas un remboursement de cette réclamation, tant qu’elle reste en attente.`)
    // ER-C24 (W2 note): « si le moteur reprend cette ligne »
    expect(e3Sentence(e3(['rf_1'], 'failed_at_stripe'), g)).toBe(`${open} ; son remboursement Stripe re_1 a ÉCHOUÉ ou a été annulé : si le moteur reprend cette ligne, il la marquera en échec, ce qui verrouille la commande.`)
    expect(e3Sentence(e3(['rf_1'], 'dead'), g)).toBe(`${open} : Stripe ne connaît aucun remboursement pour elle et le moteur ne la créera plus (fenêtre d’idempotence expirée) ; il refuse donc sa reprise (« Reprise impossible : la fenêtre d’idempotence Stripe du remboursement initial a expiré… ») ; aucun code de l’application ne retire cette ligne.`)
    // ER-R26 (W2 note): the clawback is conditional on a settlement transfer
    expect(e3Sentence(e3(['rf_1'], 'succeeded_at_stripe_clawback'), g)).toBe(`${open} : son remboursement Stripe re_1 est ABOUTI mais la ligne n’est pas finalisée ici, et sa finalisation peut devoir d’abord reprendre au franchiseur une royalty (si un transfert de règlement existe) : le moteur peut la refuser à chaque appel, et la ligne reste alors en attente ; sa finalisation n’est pas établie.`)
    const noId = facts({ rows: [mrow('rf_1')], stripeListLength: 101 })
    expect(e3Sentence(e3(['rf_1'], 'dead', { engineListTruncated: true }), noId)).toBe('la plus ancienne ligne en attente de la commande, rf_1, est reprise par le moteur avant tout nouveau remboursement ; Stripe rapporte plus de 100 remboursements sur ce paiement et cette ligne n’a pas d’identifiant Stripe enregistré : le moteur refuse alors la reprise (« Reprise impossible pour l’instant (liste Stripe indisponible) — réessayez. ») ; aucun code de l’application ne retire cette ligne.')
    const tie = e3Sentence(e3(['rf_1', 'rf_2'], 'dead', { otherPendingRowIds: ['rf_3'] }), facts({ rows: [mrow('rf_1'), mrow('rf_2'), mrow('rf_3')] }))
    expect(tie.startsWith('les plus anciennes lignes en attente de la commande, créées au même instant (rf_1, rf_2), sont reprises par le moteur avant tout nouveau remboursement (il prend l’une d’elles)')).toBe(true)
    expect(tie.endsWith('(ligne(s) aussi en attente : rf_3).')).toBe(true)
  })

  it('H1 per how, H2, H3, H5 disputed and captured', () => {
    const h1 = (how: 'reverted' | 'pending_at_stripe' | 'absent' | 'other_payment', status: string | null) => holdSentence({ hold: 'H1', rowId: 'rf_o', how, refundId: 're_O', stripeStatus: status })
    const tail = ' ; notre base la compte toujours comme remboursée et aucune action de l’application n’est prévue pour la corriger ; l’approbation est refusée par sûreté (blocage de sûreté, pas un refus du moteur).'
    expect(h1('reverted', 'failed')).toBe(`la ligne rf_o est marquée ABOUTIE dans notre base, mais Stripe ne la compte pas sur ce paiement (son remboursement re_O est « failed » chez Stripe)${tail}`)
    expect(h1('pending_at_stripe', 'pending')).toBe(`la ligne rf_o est marquée ABOUTIE dans notre base, mais Stripe ne la compte pas sur ce paiement (son remboursement re_O est « pending » chez Stripe)${tail}`)
    expect(h1('absent', null)).toBe(`la ligne rf_o est marquée ABOUTIE dans notre base, mais Stripe ne la compte pas sur ce paiement (son remboursement re_O est introuvable parmi les remboursements de ce paiement, lus en entier avec la clé qui lit ce paiement)${tail}`)
    expect(h1('other_payment', null)).toBe(`la ligne rf_o est marquée ABOUTIE dans notre base, mais Stripe ne la compte pas sur ce paiement (son remboursement re_O porte sur un autre paiement)${tail}`)
    expect(holdSentence({ hold: 'H2', refundId: 're_D', status: 'failed' })).toBe('sur ce paiement routé, Stripe rapporte un remboursement « failed » (re_D) qui ne correspond à aucune ligne de notre base ; le moteur ne le voit pas, et l’approbation est refusée par sûreté (blocage de sûreté).')
    expect(holdSentence({ hold: 'H3', rowId: 'rf_x', rowStatus: 'pending', detail: 'd' })).toBe('la ligne rf_x (« pending » dans notre base) enregistre un remboursement dont la lecture chez Stripe se contredit (d) ; l’approbation est refusée par sûreté (blocage de sûreté).')
    expect(holdSentence({ hold: 'H5', cause: 'disputed', chargeId: 'ch_1' })).toBe('Stripe rapporte un litige sur la charge ch_1 de ce paiement : Stripe peut refuser le remboursement après que le moteur a enregistré sa ligne, qui resterait alors en attente et bloquerait la reprise sur cette commande ; l’approbation est refusée par sûreté (blocage de sûreté).')
    expect(holdSentence({ hold: 'H5', cause: 'captured', requestedAmountCents: 500, remainingCapturedCents: 400 })).toBe('le montant de cette réclamation (500 c) dépasse ce qui reste remboursable sur le montant capturé de ce paiement (400 c) ; le moteur calcule sur le montant de la charge et enregistrerait sa ligne avant que Stripe refuse, ligne qui resterait en attente ; l’approbation est refusée par sûreté (blocage de sûreté).')
  })

  it('ROUTED: appended for E2, E3 failed_at_stripe, H1 reverted, H2 — never otherwise; the three forms', () => {
    expect(routedSentence(true)).toBe('Ce paiement est routé : un remboursement échoué a pu laisser le transfert du restaurant inversé, et Stripe ne le restaure pas — vérifiez-le dans le Dashboard Stripe.')
    expect(routedSentence(null)).toBe('Si ce paiement est routé, un remboursement échoué a pu laisser le transfert du restaurant inversé (Stripe ne le restaure pas) — vérifiez-le dans le Dashboard Stripe.')
    expect(routedSentence(false)).toBe('')
    expect(routedApplies({ step: 'E2', rowIds: ['x'] }, [])).toBe(true)
    expect(routedApplies(e3(['x'], 'failed_at_stripe'), [])).toBe(true)
    expect(routedApplies(null, [{ hold: 'H1', rowId: 'x', how: 'reverted', refundId: 're', stripeStatus: 'failed' }])).toBe(true)
    expect(routedApplies(null, [{ hold: 'H2', refundId: 're', status: 'failed' }])).toBe(true)
    expect(routedApplies(e3(['x'], 'dead'), [{ hold: 'H1', rowId: 'x', how: 'absent', refundId: 're', stripeStatus: null }, { hold: 'H5', cause: 'disputed', chargeId: 'ch' }])).toBe(false)
  })

  it('every engine quote the texts embed exists verbatim in lib/refund.ts', () => {
    for (const q of [
      'Commande non payée — rien à rembourser.', 'Paiement non débité — rien à rembourser.', 'Charge introuvable sur le paiement.',
      'Paiement déjà intégralement remboursé.', 'Montant invalide', 'Un remboursement est déjà en cours sur ce montant cumulé.',
      'Reprise impossible pour l’instant (liste Stripe indisponible) — réessayez.', 'Reprise impossible : la fenêtre d’idempotence Stripe du remboursement initial a expiré',
    ]) expect(REFUND_SRC, q).toContain(q)
  })
})

describe('J-M46 — the N8 write: compare-and-set on the read, ALERT-B after count 1 for all three prefixes', () => {
  const PREFIXES: Array<[string, (x: World) => void, string]> = [
    [MARKERS.PROOF_PAYABLE_V13, () => {}, 'no_refund_proven'],
    [MARKERS.AWAITING_FINALIZATION, (x) => {
      x.refunds.push(refundRow('rf_A', { status: 'pending', stripeRefundId: 're_A', reason: 'claim:cl_A' }))
      x.stripeRefunds.push(stripeRefund('re_A', { metadata: { grubano_refund_row: 'rf_A' } }))
      x.pis.pi_1.latest_charge.amount_refunded = 300
      x.claims.push({ id: 'cl_A', orderId: 'o1', status: 'refunded', refundId: 'rf_A', refundError: null })
    }, 'no_refund_proven_awaiting_finalization'],
    ['no_refund_proven_rail_locked:', (x) => { x.refunds.push(refundRow('rf_D', { status: 'pending', createdAt: new Date(Date.now() - 30 * HOURS) })) }, 'no_refund_proven_rail_locked'],
  ]
  for (const [prefix, mutate, outcome] of PREFIXES) {
    it(`${prefix} → one CAS on { id, status, refundAttempted, refundId, refundError } as read, then ALERT-B claim_blocked:cl1:${prefix}`, async () => {
      setWorld(mutate)
      const r = await reconcileClaimEvidence({ claimId: 'cl1' })
      expect(r.ok && r.outcome).toBe(outcome)
      expect(w.writes).toHaveLength(1)
      expect(w.writes[0].where).toEqual({ id: 'cl1', status: 'approved', refundAttempted: false, refundId: null, refundError: PRE })
      expect(w.writes[0].data).toMatchObject({ status: 'approved', refundAttempted: false, refundId: null })
      const text = String(claimOf(w).refundError)
      expect(text.startsWith(`${prefix} `)).toBe(true)
      if (prefix === MARKERS.PROOF_PAYABLE_V13) {
        expect(text).toContain('payable au plus tôt le ')
        expect(r).toMatchObject({ payableFrom: proofInstant(text)!.toISOString() })
      }
      expect(alertMock.mock.calls.map((c) => c[0].dedupeKey)).toEqual([`claim_blocked:cl1:${prefix}`])
    })

    it(`${prefix} — a lost CAS (the claim changed during the read) writes nothing more and sends NO alert`, async () => {
      setWorld(mutate)
      w.beforeClaimWrite = () => { claimOf(w).refundError = 'financial_verification:x: écrit entre-temps' }
      expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'changed_during_read' })
      expect(w.writes.map((x) => x.count)).toEqual([0])
      expect(alertMock).not.toHaveBeenCalled()
    })
  }

  it('A-S29-3 — a row stamped for this claim appears before the write (N8 step 1) → changed_during_read, updateMany not called', async () => {
    db.refund.findFirst.mockResolvedValueOnce({ id: 'rf_late' })
    expect(await reconcileClaimEvidence({ claimId: 'cl1' })).toEqual({ ok: true, outcome: 'changed_during_read' })
    expect(db.claim.updateMany).not.toHaveBeenCalled()
    expect(alertMock).not.toHaveBeenCalled()
  })

  // W3 round-1 fix (J-M46): complete written texts, verbatim (instant masked), on the J-M01 worlds — so a defect in how
  // absenceProofText joins HEAD_A / HEAD_B, « De plus, », ROUTED and the tail is caught, not only the sentence builders.
  const ISO_MASK = (t: string) => t.replace(/payable au plus tôt le \d{4}-\d{2}-\d{2}T[\d:.]+Z \(UTC\)/, 'payable au plus tôt le <ISO> (UTC)')
  // D′ L2 (R13 spec v1.1, G8): the complete texts N8 writes, regenerated verbatim from the v1.1 pieces (HEAD, payableTail,
  // LOCKED_OPEN … LOCKED_CLOSE, AWAITING_OPEN … AWAITING_CLOSE). They name the rail, never a re-approval.
  const PAYABLE_500 = 'Aucune ligne de remboursement de cette commande n’est en attente, et au moment de cette lecture aucune condition de refus du moteur ni aucun blocage de sûreté n’était rempli pour le montant de cette réclamation (500 c). La réclamation repasse en « approuvée, non payée ». Rien ne la paiera automatiquement : elle devra être sélectionnée explicitement par un admin dans le rail financier (« Payer les approuvées »), remboursements ouverts ; une vérification relira alors Stripe et nos lignes avant le moteur. Elle est payable au plus tôt le <ISO> (UTC).'
  const FULL: Array<[string, string, string]> = [
    ['A-S01', 'no_refund_proven', `no_refund_proven:v13: Stripe ne rapporte aujourd’hui aucun remboursement abouti ni en attente sur ce paiement (liste complète lue). ${PAYABLE_500}`],
    ['A-S02', 'no_refund_proven', `no_refund_proven:v13: Stripe rapporte 300 c remboursés sur ce paiement, et chacun de ses remboursements aboutis ou en attente est rattaché à une AUTRE réclamation, soldée sur sa ligne : re_O (ligne rf_o, réclamation cl_X, liaison seule), 300 c. Aucun n’est rattaché à celle-ci. ${PAYABLE_500}`],
    ['A-S03', 'no_refund_proven_rail_locked', 'no_refund_proven_rail_locked: Stripe ne rapporte aujourd’hui aucun remboursement abouti ni en attente sur ce paiement (liste complète lue). MAIS le rail financier ne paierait pas cette réclamation : le moteur calculerait la clé refund:o1:0 pour un nouveau remboursement, et la ligne rf_o la détient déjà ; il refuserait (« Un remboursement est déjà en cours sur ce montant cumulé. ») tant que le montant remboursé rapporté par Stripe reste 0 c. De plus, la ligne rf_o est marquée ABOUTIE dans notre base, mais Stripe ne la compte pas sur ce paiement (son remboursement re_O est « failed » chez Stripe) ; notre base la compte toujours comme remboursée et aucune action de l’application n’est prévue pour la corriger ; l’approbation est refusée par sûreté (blocage de sûreté, pas un refus du moteur). Ce paiement est routé : un remboursement échoué a pu laisser le transfert du restaurant inversé, et Stripe ne le restaure pas — vérifiez-le dans le Dashboard Stripe. Rien ne sera payé par le rail pour cette réclamation tant que cet état est enregistré : le rail la refuse et aucun balayage ne la paie. « Réconcilier d’après la preuve » réévalue toutes les conditions ; une cause qui ne dépend d’aucune action ultérieure ne cessera pas. Si elle a été remboursée hors système (Dashboard Stripe), déclarez-le (« Clôturer ce dossier… ») ; sinon clôturez sans paiement. Décision humaine requise.'],
    ['A-S10b', 'no_refund_proven_awaiting_finalization', 'no_refund_proven_rail_locked:awaiting_finalization: Stripe rapporte 300 c remboursés sur ce paiement, et chacun de ses remboursements aboutis ou en attente est rattaché à une AUTRE réclamation, soldée sur sa ligne : re_rf_A (ligne rf_A, réclamation cl_A, identité portée par la ligne), 300 c. Aucun n’est rattaché à celle-ci. MAIS le rail financier ne paierait pas cette réclamation tant que la plus ancienne ligne en attente de la commande, rf_A (identité claim:cl_A), est reprise par le moteur avant tout nouveau remboursement : son remboursement Stripe re_rf_A est ABOUTI mais la ligne n’est pas finalisée ici ; le moteur finaliserait cette ligne, pas un remboursement de cette réclamation, tant qu’elle reste en attente. Relancez « Réconcilier d’après la preuve » lorsque cette ligne ne sera plus « en attente » dans notre base : la réconciliation réévaluera alors toutes les conditions. En attendant, rien ne sera payé par le rail pour cette réclamation (le rail la refuse, aucun balayage ne la paie). Si elle a été remboursée hors système (Dashboard Stripe), déclarez-le (« Clôturer ce dossier… »).'],
  ]
  /** The v1 (pre-D′) payable tail, kept as the negative control's witness — never what N8 writes now. */
  const V1_PAYABLE_500 = 'Aucune ligne de remboursement de cette commande n’est en attente, et au moment de cette lecture aucune condition de refus du moteur ni aucun blocage de sûreté n’était rempli pour le montant de cette réclamation (500 c). La réclamation repasse en « approuvée, non payée ». Rien ne la paiera automatiquement : elle devra être approuvée à nouveau par un admin, réclamations et remboursements ouverts ; une vérification relira alors Stripe et nos lignes avant le moteur. Elle est payable au plus tôt le <ISO> (UTC).'
  for (const [id, outcome, text] of FULL) {
    it(`${id} — the complete written refundError, verbatim (instant masked)`, async () => {
      setWorld((x) => stateOf(id).world!(x as never))
      const r = await reconcileClaimEvidence({ claimId: 'cl1' })
      expect(r.ok && r.outcome).toBe(outcome)
      expect(ISO_MASK(String(claimOf(w).refundError))).toBe(text)
    })
  }

  /**
   * ROUND 13 (slice W8, W3 carry-over): the A-S03 locked text's structure as a checker (empty = the G8 pieces joined in
   * order): prefix + HEAD_A + LOCKED_OPEN first, the H1 hold joined with « De plus, », then ROUTED and LOCKED_CLOSE last.
   */
  const lockedStructureViolations = (t: string): string[] => {
    const out: string[] = []
    if (!t.startsWith(`${MARKERS.RAIL_LOCKED}: ${HEAD_A} ${LOCKED_OPEN} `)) out.push('prefix, HEAD_A and LOCKED_OPEN do not open the text')
    const deplus = t.indexOf(' De plus, la ligne rf_o est marquée ABOUTIE')
    if (deplus < 0) out.push('the H1 hold is not joined with « De plus, »')
    else if (!(t.indexOf(LOCKED_OPEN) < deplus && deplus < t.indexOf(routedSentence(true)))) out.push('LOCKED_OPEN, « De plus, » and ROUTED are out of order')
    if (!t.endsWith(` ${routedSentence(true)} ${LOCKED_CLOSE}`)) out.push('ROUTED and LOCKED_CLOSE do not end the text')
    return out
  }

  it('the full texts are the G8 pieces joined in order (HEAD, then tail / MAIS … De plus … ROUTED … LOCKED_CLOSE)', () => {
    expect(FULL[0][2]).toBe(`${MARKERS.PROOF_PAYABLE_V13} ${HEAD_A} ${PAYABLE_500}`)
    expect(PAYABLE_500).toBe(ISO_MASK(payableTail(500, new Date('2026-09-12T09:00:00.000Z'))))
    const locked = FULL[2][2]
    expect(lockedStructureViolations(locked)).toEqual([])
    expect(locked).toContain(` ${LOCKED_OPEN} `)
    expect(FULL[3][2]).toContain(` ${AWAITING_OPEN} `)
    expect(FULL[3][2].endsWith(AWAITING_CLOSE)).toBe(true)
  })

  it('NEGATIVE CONTROL (D′ L2) — the v1 written texts (re-approval vocabulary) are not what N8 writes any more, and the structure check rejects a v1 LOCKED_OPEN', async () => {
    expect(V1_PAYABLE_500).not.toBe(PAYABLE_500)
    expect(V1_PAYABLE_500).toMatch(/approuvée à nouveau/)
    setWorld((x) => stateOf('A-S01').world!(x as never))
    await reconcileClaimEvidence({ claimId: 'cl1' })
    const written = ISO_MASK(String(claimOf(w).refundError))
    expect(written).not.toBe(`${MARKERS.PROOF_PAYABLE_V13} ${HEAD_A} ${V1_PAYABLE_500}`)
    expect(written).not.toMatch(/approuvez-la à nouveau|nouvelle approbation|approuvée à nouveau/)
    // a locked text opened by the v1 « MAIS une nouvelle approbation ne paierait pas cette réclamation : » fails the structure check
    const v1Locked = FULL[2][2].replace(LOCKED_OPEN, 'MAIS une nouvelle approbation ne paierait pas cette réclamation :')
    expect(v1Locked).not.toBe(FULL[2][2])
    expect(lockedStructureViolations(v1Locked)).toContain('prefix, HEAD_A and LOCKED_OPEN do not open the text')
    for (const [, , text] of FULL) expect(text).not.toMatch(/approuvez-la à nouveau|nouvelle approbation|approuvée à nouveau/)
  })

  it('NEGATIVE CONTROL (W8) — the A-S03 text with its holds joined without « De plus, » fails the structure check; so does ROUTED moved before the hold', () => {
    const locked = FULL[2][2]
    expect(lockedStructureViolations(locked.replace(' De plus, la ligne', ' La ligne'))).toEqual(['the H1 hold is not joined with « De plus, »'])
    const routed = routedSentence(true)
    const routedFirst = locked.replace(` ${routed}`, '').replace(' De plus, ', ` ${routed} De plus, `)
    expect(lockedStructureViolations(routedFirst)).toEqual(['LOCKED_OPEN, « De plus, » and ROUTED are out of order', 'ROUTED and LOCKED_CLOSE do not end the text'])
  })

  it('an alert rejection does not fail the write', async () => {
    alertMock.mockRejectedValue(new Error('smtp down'))
    const r = await reconcileClaimEvidence({ claimId: 'cl1' })
    expect(r.ok && r.outcome).toBe('no_refund_proven')
    expect(String(claimOf(w).refundError).startsWith(MARKERS.PROOF_PAYABLE_V13)).toBe(true)
  })

  it('NEGATIVE CONTROL — no rendered text contains « jamais », « Aucun ne paie celle-ci » or « dite définitive »', async () => {
    const texts: string[] = []
    for (const [, mutate] of PREFIXES) {
      setWorld(mutate)
      await reconcileClaimEvidence({ claimId: 'cl1' })
      texts.push(String(claimOf(w).refundError))
    }
    expect(texts).toHaveLength(3)
    for (const t of texts) expect(t).not.toMatch(/jamais|Aucun ne paie celle-ci|dite définitive/)
    // the pin catches the round-12 sentence
    expect('aucun remboursement n’a jamais déplacé d’argent').toMatch(/jamais|Aucun ne paie celle-ci|dite définitive/)
  })
})
