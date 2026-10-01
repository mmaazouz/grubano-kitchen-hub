import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── T43 (vague 3) — lib/claim-emails : les senders du cycle réclamation ────────
// Rail central réutilisé (sendTransactional + dedupeKey @@unique + EmailLog) ;
// localisation patron onboarding-nudge (Operator.locale, null ⇒ fr, RTL ar).
// Les senders sont BEST-EFFORT (jamais un throw vers la route appelante).
//
// ROUND 13 (slice W6): J-C20 (H02, H03, H06, H11, I-08, E-17) — every claim sender takes `claimsOpen`; while claims are
// closed nothing is sent and the skip is traced once. The existing expectations pass claimsOpen:true; a failure now also
// says why (H03: sender_error, smtp_disabled, no_recipient).

const { db } = vi.hoisted(() => ({
  db: {
    operator:      { findUnique: vi.fn() },
    claim:         { findUnique: vi.fn(), count: vi.fn() },
    refund:        { findUnique: vi.fn() },
    emailDispatch: { findFirst: vi.fn() },
    emailLog:      { create: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { sendMock, skipLogMock } = vi.hoisted(() => ({ sendMock: vi.fn(), skipLogMock: vi.fn() }))
vi.mock('@/lib/transactional-emails', () => ({ sendTransactional: sendMock, logEmailSkipped: skipLogMock }))

// getTranslations écho : t(key, vars) → "key|{vars}" — permet d'asserter clé + variables.
const { getTranslationsMock } = vi.hoisted(() => ({
  getTranslationsMock: vi.fn(async () =>
    (key: string, vars?: Record<string, unknown>) => `${key}|${JSON.stringify(vars ?? {})}`),
}))
vi.mock('next-intl/server', () => ({ getTranslations: getTranslationsMock }))

vi.mock('@/lib/onboarding-nudge', () => ({
  resolveNudgeLocale: (l: string | null | undefined) =>
    l && ['fr', 'en', 'es', 'it', 'ar'].includes(l) ? l : 'fr',
}))

import {
  sendClaimAckEmail, sendClaimDecisionEmail, sendClaimClosureEmail, sendOrderCancelledPaidEmail, sendOrderCancelledPaidOffEmail,
  DECISION_TRIGGER, decisionDedupeKey, type ClaimDecisionKind,
} from '@/lib/claim-emails'

beforeEach(() => {
  vi.clearAllMocks()
  for (const m of [sendMock, skipLogMock, db.claim.findUnique, db.claim.count, db.refund.findUnique, db.emailDispatch.findFirst, db.emailLog.create]) m.mockReset()
  db.operator.findUnique.mockResolvedValue({ email: 'lea@x.fr', name: 'Léa', locale: null })
  sendMock.mockResolvedValue({ status: 'sent' })
})

describe('P0-08 — sendOrderCancelledPaidEmail (annulation PAYÉE : email honnête)', () => {
  it('⭐ trigger order_cancelled + dedupeKey order:<id> — UNE notification d’annulation par commande ; contenu : demande transmise, AUCUN remboursement promis, AUCUN e-mail ultérieur promis (next rendu avec {ref})', async () => {
    const r = await sendOrderCancelledPaidEmail({ orderId: 'ord123abc', consumerId: 'c1', restaurantName: 'Gnocchi Bar' })
    expect(r).toEqual({ status: 'sent' })
    const call = sendMock.mock.calls[0][0]
    expect(call.trigger).toBe('order_cancelled')
    expect(call.dedupeKey).toBe('order:ord123abc')
    expect(call.to).toBe('lea@x.fr')
    expect(call.subject).toContain('orderCancelledPaid.subject')
    expect(call.html).toContain('orderCancelledPaid.body')
    expect(call.html).toContain('Gnocchi Bar')
    // H12: orderCancelledPaid.next is rendered with the reference.
    expect(call.html).toContain('orderCancelledPaid.next|{&quot;ref&quot;:&quot;GR-123ABC&quot;}')
  })

  it('client sans email → skipped TRACÉ (logEmailSkipped), jamais un throw', async () => {
    db.operator.findUnique.mockResolvedValue({ email: null, name: 'X', locale: null })
    const r = await sendOrderCancelledPaidEmail({ orderId: 'o1', consumerId: 'c1', restaurantName: 'R' })
    expect(r).toEqual({ status: 'skipped' })
    expect(sendMock).not.toHaveBeenCalled()
    // W6 (H11): the reason travels as the fourth argument too; no_recipient keeps the historical row and line.
    expect(skipLogMock).toHaveBeenCalledWith('order_cancelled', expect.stringContaining('o1'), expect.objectContaining({ reason: 'no_recipient' }), 'no_recipient')
  })

  it("existingClaim:true (réclamation déjà active — AUCUNE demande créée) → corps bodyExisting, l'email ne ment pas", async () => {
    await sendOrderCancelledPaidEmail({ orderId: 'o1', consumerId: 'c1', restaurantName: 'R', existingClaim: true })
    const html = sendMock.mock.calls[0][0].html as string
    expect(html).toContain('orderCancelledPaid.bodyExisting')
    expect(html).not.toContain('orderCancelledPaid.body|')
  })
})

describe('sendClaimAckEmail — accusé de réception (claim_ack / claim:<id>)', () => {
  it('⭐ envoie via le rail central : trigger claim_ack, dedupeKey claim:<id>, au CLIENT', async () => {
    const r = await sendClaimAckEmail({ claimId: 'cl1', consumerId: 'c1', orderId: 'ord123abc', requestedAmountCents: 1250, claimsOpen: true })
    expect(r).toEqual({ status: 'sent' })
    expect(sendMock).toHaveBeenCalledTimes(1)
    const call = sendMock.mock.calls[0][0]
    expect(call.trigger).toBe('claim_ack')
    expect(call.dedupeKey).toBe('claim:cl1')
    expect(call.to).toBe('lea@x.fr')
    expect(call.subject).toContain('ack.subject')
    expect(call.subject).toContain('GR-123ABC')        // ref unifiee lib/order-ref (lot veracite)
    expect(call.html).toContain('ack.body')
    expect(call.html).toContain('12,50')               // euros dans la LOCALE (fr → virgule)
    // H12: ack.next carries the reference.
    expect(call.html).toContain('ack.next|{&quot;ref&quot;:&quot;GR-123ABC&quot;}')
  })

  it('locale du client respectée (Operator.locale en → getTranslations en) ; null ⇒ fr ; ar ⇒ RTL', async () => {
    db.operator.findUnique.mockResolvedValue({ email: 'l@x.fr', name: 'L', locale: 'en' })
    await sendClaimAckEmail({ claimId: 'cl1', consumerId: 'c1', orderId: 'o1', requestedAmountCents: 500, claimsOpen: true })
    expect(getTranslationsMock).toHaveBeenCalledWith({ locale: 'en', namespace: 'claimEmails' })

    db.operator.findUnique.mockResolvedValue({ email: 'l@x.fr', name: 'L', locale: null })
    await sendClaimAckEmail({ claimId: 'cl2', consumerId: 'c1', orderId: 'o1', requestedAmountCents: 500, claimsOpen: true })
    expect(getTranslationsMock).toHaveBeenLastCalledWith({ locale: 'fr', namespace: 'claimEmails' })

    db.operator.findUnique.mockResolvedValue({ email: 'l@x.fr', name: 'L', locale: 'ar' })
    await sendClaimAckEmail({ claimId: 'cl3', consumerId: 'c1', orderId: 'o1', requestedAmountCents: 500, claimsOpen: true })
    expect(sendMock.mock.calls[2][0].html).toContain('dir="rtl"')
  })

  it('client sans email → skipped no_recipient, AUCUN envoi, MAIS trace EmailLog via logEmailSkipped (revue : aucun MISS sans audit)', async () => {
    db.operator.findUnique.mockResolvedValue({ email: null, name: 'X', locale: null })
    const r = await sendClaimAckEmail({ claimId: 'cl1', consumerId: 'c1', orderId: 'o1', requestedAmountCents: 500, claimsOpen: true })
    expect(r).toEqual({ status: 'skipped', why: 'no_recipient' })
    expect(sendMock).not.toHaveBeenCalled()
    expect(skipLogMock).toHaveBeenCalledWith('claim_ack', 'claim cl1', expect.objectContaining({ reason: 'no_recipient' }), 'no_recipient')
  })

  it('panne DB → failed sender_error tracé [EMAIL MISS] + EmailLog via logEmailSkipped, jamais un throw vers la route', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    db.operator.findUnique.mockRejectedValue(new Error('db down'))
    const r = await sendClaimAckEmail({ claimId: 'cl1', consumerId: 'c1', orderId: 'o1', requestedAmountCents: 500, claimsOpen: true })
    expect(r).toEqual({ status: 'failed', why: 'sender_error' })
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('[EMAIL MISS]'), 'cl1', 'db down')
    expect(skipLogMock).toHaveBeenCalledWith('claim_ack', 'claim cl1', expect.objectContaining({ reason: 'sender_error' }), 'sender_error')
    errSpy.mockRestore()
  })

  it('le rail répond skipped (SMTP désactivé) → smtp_disabled ; failed → sender_error (H03)', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    sendMock.mockResolvedValue({ status: 'skipped' })
    expect(await sendClaimAckEmail({ claimId: 'cl1', consumerId: 'c1', orderId: 'o1', requestedAmountCents: 500, claimsOpen: true })).toEqual({ status: 'skipped', why: 'smtp_disabled' })
    sendMock.mockResolvedValue({ status: 'failed' })
    expect(await sendClaimAckEmail({ claimId: 'cl1', consumerId: 'c1', orderId: 'o1', requestedAmountCents: 500, claimsOpen: true })).toEqual({ status: 'failed', why: 'sender_error' })
    // the rail wrote its own row: no second trace
    expect(skipLogMock).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  it("Operator.name vide → pas de « Bonjour , » orphelin (le paragraphe de salutation est omis)", async () => {
    db.operator.findUnique.mockResolvedValue({ email: 'l@x.fr', name: null, locale: null })
    await sendClaimAckEmail({ claimId: 'cl1', consumerId: 'c1', orderId: 'o1', requestedAmountCents: 500, claimsOpen: true })
    expect(sendMock.mock.calls[0][0].html).not.toContain('greeting')
  })
})

describe('sendClaimDecisionEmail — un trigger DÉDIÉ par décision, dedupeKey claim:<id>', () => {
  const base = { claimId: 'cl1', consumerId: 'c1', orderId: 'ord123abc', claimsOpen: true }

  it("⭐ 'accepted' (resto) : trigger claim_decision_accepted, le nom du restaurant dit PAR QUI", async () => {
    await sendClaimDecisionEmail({ ...base, decision: 'accepted', restaurantName: 'Gnocchi Bar' })
    const call = sendMock.mock.calls[0][0]
    expect(call.trigger).toBe('claim_decision_accepted')
    expect(call.dedupeKey).toBe('claim:cl1')
    expect(call.html).toContain('accepted.body')
    expect(call.html).toContain('Gnocchi Bar')
  })

  it("'refused' (resto) : motif inclus quand fourni + mention contestation CONDITIONNELLE, rendue avec {ref} (H12)", async () => {
    await sendClaimDecisionEmail({ ...base, decision: 'refused', restaurantName: 'Gnocchi Bar', reason: 'Plat conforme' })
    const call = sendMock.mock.calls[0][0]
    expect(call.trigger).toBe('claim_decision_refused')
    expect(call.html).toContain('reasonLabel')
    expect(call.html).toContain('Plat conforme')
    expect(call.html).toContain('refused.contest|{&quot;ref&quot;:&quot;GR-123ABC&quot;}')
  })

  it("'refused' sans nom de resto → libellé de repli traduit (theRestaurant), jamais un trou", async () => {
    await sendClaimDecisionEmail({ ...base, decision: 'refused', restaurantName: null })
    expect(sendMock.mock.calls[0][0].html).toContain('theRestaurant')
  })

  it("⭐ 'refunded' (Grubano) : trigger claim_decision_refunded + montant remboursé en euros localisés", async () => {
    await sendClaimDecisionEmail({ ...base, decision: 'refunded', refundedCents: 2199 })
    const call = sendMock.mock.calls[0][0]
    expect(call.trigger).toBe('claim_decision_refunded')
    expect(call.html).toContain('refunded.body')
    expect(call.html).toContain('21,99')               // fr → virgule décimale
  })

  it("'approved' (Grubano, remboursement pas encore émis) : trigger dédié, AUCUNE promesse de délai (clé approved.*)", async () => {
    await sendClaimDecisionEmail({ ...base, decision: 'approved' })
    const call = sendMock.mock.calls[0][0]
    expect(call.trigger).toBe('claim_decision_approved')
    expect(call.html).toContain('approved.body')
  })

  it("⭐ D′ L4 (D-11) — 'approved' NOMME le montant APPROUVÉ (approvedCents), jamais refundedCents ; la clé de dédup porte l'instant de CETTE décision", async () => {
    const stamp = new Date('2026-09-23T10:00:00.000Z')
    // refundedCents est délibérément un AUTRE montant : si le sender le lisait, l'avis annoncerait 5,00 €.
    await sendClaimDecisionEmail({ ...base, decision: 'approved', approvedCents: 1250, refundedCents: 500, decisionStamp: stamp })
    const call = sendMock.mock.calls[0][0]
    expect(call.html).toContain('12,50')
    expect(call.html).not.toContain('5,00')
    expect(call.dedupeKey).toBe(`claim:cl1:approved:${stamp.toISOString()}`)
    // CONTRÔLE NÉGATIF — deux approbations successives avec des instants DIFFÉRENTS ⇒ deux clés distinctes,
    // donc deux avis. Sous l'ancienne clé par réclamation elles auraient collisionné et le client aurait
    // lu le mauvais montant : la preuve est que la clé ci-dessous n'est PAS `claim:cl1`.
    const later = new Date('2026-09-23T11:00:00.000Z')
    sendMock.mockClear()
    await sendClaimDecisionEmail({ ...base, decision: 'approved', approvedCents: 800, decisionStamp: later })
    expect(sendMock.mock.calls[0][0].dedupeKey).toBe(`claim:cl1:approved:${later.toISOString()}`)
    expect(sendMock.mock.calls[0][0].dedupeKey).not.toBe('claim:cl1')
    expect(sendMock.mock.calls[0][0].html).toContain('8,00')
  })

  it("⭐ D′ L4 (T-09) — 'approval_withdrawn' : trigger claim_approval_withdrawn, gabarit withdrawn.*, AUCUN montant, clé estampillée de la décision retirée", async () => {
    const stamp = new Date('2026-09-23T10:00:00.000Z')
    await sendClaimDecisionEmail({ ...base, decision: 'approval_withdrawn', decisionStamp: stamp })
    const call = sendMock.mock.calls[0][0]
    expect(call.trigger).toBe('claim_approval_withdrawn')
    expect(call.subject).toContain('withdrawn.subject')
    expect(call.html).toContain('withdrawn.title')
    expect(call.html).toContain('withdrawn.body')
    // un retrait ne parle d'aucun remboursement émis : ni le gabarit 'approved' ni 'refunded'
    expect(call.html).not.toContain('approved.body')
    expect(call.html).not.toContain('refunded.body')
    expect(call.dedupeKey).toBe(`claim:cl1:withdrawn:${stamp.toISOString()}`)
  })

  it("D′ L4 (§6.4) — decisionDedupeKey : par DÉCISION pour approved / approval_withdrawn, par RÉCLAMATION pour tout le reste ; sans instant, repli sur la clé historique", () => {
    const iso = '2026-09-23T10:00:00.000Z'
    expect(decisionDedupeKey('cl1', 'approved', new Date(iso))).toBe(`claim:cl1:approved:${iso}`)
    expect(decisionDedupeKey('cl1', 'approval_withdrawn', iso)).toBe(`claim:cl1:withdrawn:${iso}`)
    // pas d'instant ⇒ un avis de trop peu plutôt qu'une tempête de doublons
    for (const stamp of [undefined, null, '']) {
      expect(decisionDedupeKey('cl1', 'approved', stamp), String(stamp)).toBe('claim:cl1')
      expect(decisionDedupeKey('cl1', 'approval_withdrawn', stamp), String(stamp)).toBe('claim:cl1')
    }
    // CONTRÔLE NÉGATIF — les autres décisions gardent la clé historique MÊME estampillées
    for (const d of ['accepted', 'refused', 'refunded', 'refused_final', 'refused_by_grubano'] as ClaimDecisionKind[]) {
      expect(decisionDedupeKey('cl1', d, new Date(iso)), d).toBe('claim:cl1')
    }
  })

  it("'refused_final' (Grubano, refus du restaurant confirmé) : trigger claim_decision_refused_final", async () => {
    await sendClaimDecisionEmail({ ...base, decision: 'refused_final', reason: 'Preuves insuffisantes' })
    const call = sendMock.mock.calls[0][0]
    expect(call.trigger).toBe('claim_decision_refused_final')
    expect(call.html).toContain('refusedFinal.body')
    expect(call.html).toContain('Preuves insuffisantes')
  })

  it("ROUND 13 (H03) 'refused_by_grubano' : trigger claim_decision_refused_final, sujet refusedFinal.subject, titre et corps refusedByGrubano, « Motif : » quand un motif est donné", async () => {
    await sendClaimDecisionEmail({ ...base, decision: 'refused_by_grubano', reason: 'Hors délai' })
    const call = sendMock.mock.calls[0][0]
    expect(call.trigger).toBe('claim_decision_refused_final')
    expect(call.subject).toContain('refusedFinal.subject')
    expect(call.html).toContain('refusedByGrubano.title')
    expect(call.html).toContain('refusedByGrubano.body')
    expect(call.html).not.toContain('refusedFinal.body')
    expect(call.html).toContain('reasonLabel')
    expect(call.html).toContain('Hors délai')
    // D′ L4 (T-09): the withdrawal is a decision kind of its own, with its OWN trigger — never reusing
    // an approval or a refusal trigger, so the rail can tell the three apart in EmailDispatch.
    expect(DECISION_TRIGGER).toEqual({
      accepted: 'claim_decision_accepted', refused: 'claim_decision_refused', refunded: 'claim_decision_refunded',
      approved: 'claim_decision_approved', refused_final: 'claim_decision_refused_final', refused_by_grubano: 'claim_decision_refused_final',
      approval_withdrawn: 'claim_approval_withdrawn',
    })
    expect(DECISION_TRIGGER.approval_withdrawn).not.toBe(DECISION_TRIGGER.approved)
    expect(DECISION_TRIGGER.approval_withdrawn).not.toBe(DECISION_TRIGGER.refused_final)
  })

  it('⭐ rejouer la même décision : la dedupe est DÉLÉGUÉE au rail (dedupeKey transmis → @@unique tranche)', async () => {
    sendMock.mockResolvedValue({ status: 'duplicate' })
    const r = await sendClaimDecisionEmail({ ...base, decision: 'refused' })
    expect(r).toEqual({ status: 'duplicate' })
    expect(sendMock.mock.calls[0][0].dedupeKey).toBe('claim:cl1')
  })

  it('le motif utilisateur est ÉCHAPPÉ (pas d’injection HTML dans l’email)', async () => {
    await sendClaimDecisionEmail({ ...base, decision: 'refused', reason: '<img src=x onerror=alert(1)>' })
    const html = sendMock.mock.calls[0][0].html as string
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x')
  })
})

// ══ J-C20 — CLAIMS_ENABLED skip in every claim sender (R-D7) ═══════════════════════════════════════
describe('J-C20 — while claims are closed, no claim sender reaches the rail; the skip is traced once', () => {
  let errSpy: ReturnType<typeof vi.spyOn>
  beforeEach(async () => {
    // logEmailSkipped runs for real (its EmailLog row and console line), on the mocked Prisma.
    const actual = await vi.importActual<typeof import('@/lib/transactional-emails')>('@/lib/transactional-emails')
    skipLogMock.mockImplementation(actual.logEmailSkipped)
    db.emailLog.create.mockResolvedValue({ id: 'l1' })
    // A closure on record, a proven refunded row, Stripe evidence — every other gate would let the notice go out.
    db.claim.findUnique.mockResolvedValue({ id: 'cl1', status: 'refunded', consumerId: 'c1', orderId: 'ord123abc', refundId: 'rf1', refundError: null, arbitrationDecision: 'approved', restaurantResponse: null, arbitrationReason: null })
    db.refund.findUnique.mockResolvedValue({ orderId: 'ord123abc', status: 'succeeded', amountCents: 1250, stripeRefundId: 're_1' })
    db.claim.count.mockResolvedValue(1)
    db.emailDispatch.findFirst.mockResolvedValue({ id: 'rec1' })
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => { errSpy.mockRestore() })

  // D′ L4: the withdrawal notice is gated exactly like every other claim notice.
  const KINDS: ClaimDecisionKind[] = ['accepted', 'refused', 'refunded', 'approved', 'refused_final', 'refused_by_grubano', 'approval_withdrawn']
  const senders = (claimsOpen: boolean): Array<[string, string, () => Promise<Record<string, unknown>>]> => [
    ['ack', 'claim_ack', () => sendClaimAckEmail({ claimId: 'cl1', consumerId: 'c1', orderId: 'ord123abc', requestedAmountCents: 1250, claimsOpen })],
    ...KINDS.map((decision): [string, string, () => Promise<Record<string, unknown>>] =>
      [`decision ${decision}`, DECISION_TRIGGER[decision], () => sendClaimDecisionEmail({ claimId: 'cl1', consumerId: 'c1', orderId: 'ord123abc', decision, refundedCents: 1250, claimsOpen })]),
    ['closure', 'claim_decision_refunded', () => sendClaimClosureEmail({ claimId: 'cl1', evidence: { basis: 'stripe_read', amountCents: 1250 }, claimsOpen })],
  ]

  it('claimsOpen false → {skipped, claims_disabled}, sendTransactional 0, logEmailSkipped once with the reason, the row « (non envoyé : claims_disabled) », the console « not sent (claims_disabled) »', async () => {
    for (const [name, trigger, run] of senders(false)) {
      sendMock.mockClear(); skipLogMock.mockClear(); db.emailLog.create.mockClear(); errSpy.mockClear()
      const r = await run()
      expect(r, name).toMatchObject({ status: 'skipped', why: 'claims_disabled' })
      expect(sendMock, name).not.toHaveBeenCalled()
      expect(skipLogMock, name).toHaveBeenCalledTimes(1)
      expect(skipLogMock, name).toHaveBeenCalledWith(trigger, 'claim cl1', expect.objectContaining({ claimId: 'cl1' }), 'claims_disabled')
      expect(db.emailLog.create.mock.calls.map((c) => c[0].data), name).toEqual([{ recipient: '(non envoyé : claims_disabled)', subject: 'claim cl1', trigger, status: 'skipped' }])
      expect(errSpy.mock.calls.some((c) => String(c[0]).includes('not sent (claims_disabled)')), name).toBe(true)
    }
  })

  it('sendClaimClosureEmail: the record check precedes the gate — no record + closed → no_closure_record', async () => {
    db.emailDispatch.findFirst.mockResolvedValue(null)
    const r = await sendClaimClosureEmail({ claimId: 'cl1', evidence: { basis: 'stripe_read', amountCents: 1250 }, claimsOpen: false })
    expect(r).toEqual({ status: 'skipped', kind: 'refunded', why: 'no_closure_record' })
    expect(sendMock).not.toHaveBeenCalled()
  })

  it('NEGATIVE CONTROL — claimsOpen true on the same fixtures → sendTransactional called once each', async () => {
    for (const [name, trigger, run] of senders(true)) {
      sendMock.mockClear()
      await run()
      expect(sendMock, name).toHaveBeenCalledTimes(1)
      expect(sendMock.mock.calls[0][0].trigger, name).toBe(trigger)
    }
  })

  it('sendOrderCancelledPaidEmail / OffEmail take no claimsOpen and keep the {status} shape', async () => {
    // @ts-expect-error — the order-cancellation senders are not claim senders (H13 chooses the variant in the route)
    await sendOrderCancelledPaidEmail({ orderId: 'o1', consumerId: 'c1', restaurantName: 'R', claimsOpen: false })
    expect(await sendOrderCancelledPaidOffEmail({ orderId: 'o1', consumerId: 'c1', restaurantName: 'R' })).toEqual({ status: 'sent' })
    expect(sendMock).toHaveBeenCalledTimes(2)
  })
})
