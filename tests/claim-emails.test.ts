import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── T43 (vague 3) — lib/claim-emails : les senders du cycle réclamation ────────
// Rail central réutilisé (sendTransactional + dedupeKey @@unique + EmailLog) ;
// localisation patron onboarding-nudge (Operator.locale, null ⇒ fr, RTL ar).
// Les senders sont BEST-EFFORT (jamais un throw vers la route appelante).

const { db } = vi.hoisted(() => ({
  db: { operator: { findUnique: vi.fn() } },
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

import { sendClaimAckEmail, sendClaimDecisionEmail } from '@/lib/claim-emails'

beforeEach(() => {
  vi.clearAllMocks()
  db.operator.findUnique.mockResolvedValue({ email: 'lea@x.fr', name: 'Léa', locale: null })
  sendMock.mockResolvedValue({ status: 'sent' })
})

describe('sendClaimAckEmail — accusé de réception (claim_ack / claim:<id>)', () => {
  it('⭐ envoie via le rail central : trigger claim_ack, dedupeKey claim:<id>, au CLIENT', async () => {
    const r = await sendClaimAckEmail({ claimId: 'cl1', consumerId: 'c1', orderId: 'ord123abc', requestedAmountCents: 1250 })
    expect(r).toEqual({ status: 'sent' })
    expect(sendMock).toHaveBeenCalledTimes(1)
    const call = sendMock.mock.calls[0][0]
    expect(call.trigger).toBe('claim_ack')
    expect(call.dedupeKey).toBe('claim:cl1')
    expect(call.to).toBe('lea@x.fr')
    expect(call.subject).toContain('ack.subject')
    expect(call.subject).toContain('#123ABC')          // même dérivation de ref que le checkout
    expect(call.html).toContain('ack.body')
    expect(call.html).toContain('12,50')               // euros dans la LOCALE (fr → virgule)
  })

  it('locale du client respectée (Operator.locale en → getTranslations en) ; null ⇒ fr ; ar ⇒ RTL', async () => {
    db.operator.findUnique.mockResolvedValue({ email: 'l@x.fr', name: 'L', locale: 'en' })
    await sendClaimAckEmail({ claimId: 'cl1', consumerId: 'c1', orderId: 'o1', requestedAmountCents: 500 })
    expect(getTranslationsMock).toHaveBeenCalledWith({ locale: 'en', namespace: 'claimEmails' })

    db.operator.findUnique.mockResolvedValue({ email: 'l@x.fr', name: 'L', locale: null })
    await sendClaimAckEmail({ claimId: 'cl2', consumerId: 'c1', orderId: 'o1', requestedAmountCents: 500 })
    expect(getTranslationsMock).toHaveBeenLastCalledWith({ locale: 'fr', namespace: 'claimEmails' })

    db.operator.findUnique.mockResolvedValue({ email: 'l@x.fr', name: 'L', locale: 'ar' })
    await sendClaimAckEmail({ claimId: 'cl3', consumerId: 'c1', orderId: 'o1', requestedAmountCents: 500 })
    expect(sendMock.mock.calls[2][0].html).toContain('dir="rtl"')
  })

  it('client sans email → skipped, AUCUN envoi, MAIS trace EmailLog via logEmailSkipped (revue : aucun MISS sans audit)', async () => {
    db.operator.findUnique.mockResolvedValue({ email: null, name: 'X', locale: null })
    const r = await sendClaimAckEmail({ claimId: 'cl1', consumerId: 'c1', orderId: 'o1', requestedAmountCents: 500 })
    expect(r).toEqual({ status: 'skipped' })
    expect(sendMock).not.toHaveBeenCalled()
    expect(skipLogMock).toHaveBeenCalledWith('claim_ack', expect.stringContaining('cl1'), expect.objectContaining({ reason: 'no_recipient' }))
  })

  it('panne DB → failed tracé [EMAIL MISS] + EmailLog via logEmailSkipped, jamais un throw vers la route', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    db.operator.findUnique.mockRejectedValue(new Error('db down'))
    const r = await sendClaimAckEmail({ claimId: 'cl1', consumerId: 'c1', orderId: 'o1', requestedAmountCents: 500 })
    expect(r).toEqual({ status: 'failed' })
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('[EMAIL MISS]'), 'cl1', 'db down')
    expect(skipLogMock).toHaveBeenCalledWith('claim_ack', expect.stringContaining('cl1'), expect.objectContaining({ reason: 'sender_error' }))
    errSpy.mockRestore()
  })

  it("Operator.name vide → pas de « Bonjour , » orphelin (le paragraphe de salutation est omis)", async () => {
    db.operator.findUnique.mockResolvedValue({ email: 'l@x.fr', name: null, locale: null })
    await sendClaimAckEmail({ claimId: 'cl1', consumerId: 'c1', orderId: 'o1', requestedAmountCents: 500 })
    expect(sendMock.mock.calls[0][0].html).not.toContain('greeting')
  })
})

describe('sendClaimDecisionEmail — un trigger DÉDIÉ par décision, dedupeKey claim:<id>', () => {
  const base = { claimId: 'cl1', consumerId: 'c1', orderId: 'ord123abc' }

  it("⭐ 'accepted' (resto) : trigger claim_decision_accepted, le nom du restaurant dit PAR QUI", async () => {
    await sendClaimDecisionEmail({ ...base, decision: 'accepted', restaurantName: 'Gnocchi Bar' })
    const call = sendMock.mock.calls[0][0]
    expect(call.trigger).toBe('claim_decision_accepted')
    expect(call.dedupeKey).toBe('claim:cl1')
    expect(call.html).toContain('accepted.body')
    expect(call.html).toContain('Gnocchi Bar')
  })

  it("'refused' (resto) : motif inclus quand fourni + mention contestation (le contest EXISTE dans le suivi de commande)", async () => {
    await sendClaimDecisionEmail({ ...base, decision: 'refused', restaurantName: 'Gnocchi Bar', reason: 'Plat conforme' })
    const call = sendMock.mock.calls[0][0]
    expect(call.trigger).toBe('claim_decision_refused')
    expect(call.html).toContain('reasonLabel')
    expect(call.html).toContain('Plat conforme')
    expect(call.html).toContain('refused.contest')
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

  it("'refused_final' (Grubano) : trigger claim_decision_refused_final", async () => {
    await sendClaimDecisionEmail({ ...base, decision: 'refused_final', reason: 'Preuves insuffisantes' })
    const call = sendMock.mock.calls[0][0]
    expect(call.trigger).toBe('claim_decision_refused_final')
    expect(call.html).toContain('refusedFinal.body')
    expect(call.html).toContain('Preuves insuffisantes')
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
