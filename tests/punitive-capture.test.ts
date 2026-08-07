import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// ── V4-1 (vague 4) — retrait des captures PUNITIVES (décision fondateur, motif
// juridique) : débiter une carte à titre de sanction (pénalité no-show, walk-out
// impayé) exige une base contractuelle que le pilote n'a pas. Flag DÉDIÉ
// PUNITIVE_CAPTURE_ENABLED, défaut OFF — la capacité revient post-pilote sans
// réécriture. ⚠️ L'EMPREINTE N'EST PAS TOUCHÉE : pré-autorisation et libération
// (releaseHold) fonctionnent comme avant. Point d'étranglement = captureHold
// dans la lib partagée → AUCUN chemin (PATCH no-show, /deposit/capture,
// tickets/close, futur appelant) ne peut capturer pendant le pilote.

const { stripe } = vi.hoisted(() => ({
  stripe: {
    retrieveIntent: vi.fn(),
    releaseDeposit: vi.fn(),
    captureDeposit: vi.fn(),
    eurosToCents:   (eur: number) => Math.round(eur * 100),
  },
}))
vi.mock('@/lib/stripe', () => stripe)

// Mocks partagés par les describes de ROUTES (PATCH réservations + tickets/close) —
// la lib deposit reste RÉELLE partout dans ce fichier, seul Stripe est mocké.
const { db } = vi.hoisted(() => ({
  db: {
    reservation: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    restaurant:  { findUnique: vi.fn() },
    tableTicket: { findUnique: vi.fn(), update: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
const { scopeMock } = vi.hoisted(() => ({ scopeMock: vi.fn() }))
vi.mock('@/lib/establishment-scope', () => ({ resolveEstablishmentScope: scopeMock }))
const { emails, recipientMock } = vi.hoisted(() => ({
  emails: {
    sendReservationCancelledByOwner: vi.fn(),
    sendNoShowPenaltyCharged:        vi.fn(),
    logEmailSkipped:                 vi.fn(),
  },
  recipientMock: vi.fn(),
}))
vi.mock('@/lib/transactional-emails', () => ({ ...emails, resolveReservationRecipient: recipientMock }))
const { maskMock } = vi.hoisted(() => ({ maskMock: vi.fn((r: unknown) => r) }))
vi.mock('@/lib/customer-scope', () => ({ maskEatReservation: maskMock }))
const { ticketMock } = vi.hoisted(() => ({ ticketMock: vi.fn() }))
vi.mock('@/lib/ticket', () => ({ ensureOpenTicket: ticketMock, ticketSelect: { id: true, status: true } }))
vi.mock('@/lib/opening-hours', () => ({ loadHoursContext: vi.fn(), slotFitsCtx: vi.fn() }))

import { captureHold, releaseHold, isPunitiveCaptureEnabled } from '@/lib/deposit'

beforeEach(() => {
  vi.clearAllMocks()
  stripe.retrieveIntent.mockResolvedValue({ status: 'requires_capture', amount_capturable: 1000 })
  stripe.releaseDeposit.mockResolvedValue({})
  stripe.captureDeposit.mockResolvedValue({})
})
afterEach(() => vi.unstubAllEnvs())

describe('V4-1 — le POINT D’ÉTRANGLEMENT captureHold (lib partagée)', () => {
  it('⭐ défaut (flag absent) : capture REFUSÉE 403 tracée, AUCUN appel Stripe — aucun chemin ne peut capturer une pénalité', async () => {
    vi.stubEnv('PUNITIVE_CAPTURE_ENABLED', '') // déterministe même si l'env CI pose la var
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const r = await captureHold('pi_1', 10, 10)
    expect(r).toEqual({ ok: false, status: 403, error: 'Capture de pénalité désactivée pendant le pilote.' })
    expect(stripe.retrieveIntent).not.toHaveBeenCalled()
    expect(stripe.captureDeposit).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[V4-1]'))
    warnSpy.mockRestore()
  })

  it("seule la chaîne exacte 'true' réactive — 'TRUE' et '1' restent OFF (convention maison)", async () => {
    for (const v of ['TRUE', '1']) {
      vi.stubEnv('PUNITIVE_CAPTURE_ENABLED', v)
      expect(isPunitiveCaptureEnabled()).toBe(false)
    }
    vi.stubEnv('PUNITIVE_CAPTURE_ENABLED', 'true')
    expect(isPunitiveCaptureEnabled()).toBe(true)
  })

  it('flag ON (post-pilote) : la capture fonctionne SANS réécriture — requires_capture → captured, montant plafonné', async () => {
    vi.stubEnv('PUNITIVE_CAPTURE_ENABLED', 'true')
    const r = await captureHold('pi_1', 10, 10)
    expect(r).toEqual({ ok: true, depositStatus: 'captured', capturedAmount: 1000 })
    expect(stripe.captureDeposit).toHaveBeenCalledWith('pi_1', 1000)
  })

  it('⭐ la LIBÉRATION n’est PAS gouvernée par le flag : releaseHold fonctionne flag OFF (la garantie et sa levée restent intactes)', async () => {
    vi.stubEnv('PUNITIVE_CAPTURE_ENABLED', '')
    const r = await releaseHold('pi_1')
    expect(r).toEqual({ ok: true, depositStatus: 'released' })
    expect(stripe.releaseDeposit).toHaveBeenCalledWith('pi_1')
  })
})

// ── Le chemin no-show du PATCH réservations : marquer le no-show reste possible,
// l'empreinte est LIBÉRÉE (pas de sanction déguisée par gel du hold).
describe('V4-1 — PATCH /api/reservations no-show, flag OFF (lib deposit RÉELLE, Stripe mocké)', () => {
  it('⭐ no-show flag OFF → 200, statut écrit, empreinte LIBÉRÉE (releaseDeposit), AUCUNE capture, AUCUN depositPaid, AUCUN email de pénalité, tracé [V4-1]', async () => {
    vi.stubEnv('PUNITIVE_CAPTURE_ENABLED', '')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    scopeMock.mockResolvedValue({ ok: true, operatorId: 'op1', ownedIds: ['rest1'] })
    db.reservation.findUnique.mockResolvedValue({
      restaurantId: 'rest1', stripePaymentIntentId: 'pi_hold_1',
      depositAmount: 10, noShowPenalty: 10, depositStatus: 'authorized',
    })
    db.reservation.update.mockResolvedValue({
      id: 'resv1', status: 'noshow', restaurantId: 'rest1', date: new Date(), customerName: 'Client',
      email: null, table: null,
    })
    const { PATCH } = await import('@/app/api/reservations/route')
    const res = await PATCH(new Request('https://app.grubano.com/api/reservations', {
      method: 'PATCH', body: JSON.stringify({ id: 'resv1', status: 'noshow' }),
      headers: { 'content-type': 'application/json' },
    }))
    expect(res.status).toBe(200)
    expect(stripe.captureDeposit).not.toHaveBeenCalled()          // jamais une capture
    expect(stripe.releaseDeposit).toHaveBeenCalledWith('pi_hold_1') // la garantie est levée
    const writeData = (db.reservation.update.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(writeData.status).toBe('noshow')                        // marquer reste possible
    expect(writeData.depositStatus).toBe('released')
    expect('depositPaid' in writeData).toBe(false)                 // aucune fausse validation
    expect(emails.sendNoShowPenaltyCharged).not.toHaveBeenCalled() // aucun email de pénalité
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[V4-1]'))
    warnSpy.mockRestore()
  })
})

// ── Le chemin walk-out de tickets/close : le choix 'capture' DÉGRADE en
// libération flag OFF (hold gelé = sanction déguisée) ; la réponse dit la vérité
// (settled.depositStatus='released' → le toast opérateur affiche la libération).
describe('V4-1 — POST /api/tickets/[id]/close deposit=capture (lib deposit RÉELLE, Stripe mocké)', () => {
  const TICKET = { id: 'tk1', restaurantId: 'rest1', status: 'open', reservationId: 'resv1', subtotal: 42 }
  const RESV   = { id: 'resv1', stripePaymentIntentId: 'pi_hold_1', depositStatus: 'authorized', depositAmount: 10, noShowPenalty: 10 }

  const close = async (deposit: string) => {
    const { POST } = await import('@/app/api/tickets/[id]/close/route')
    return POST(new Request('https://app.grubano.com/api/tickets/tk1/close', {
      method: 'POST', body: JSON.stringify({ reason: 'unpaid', deposit }),
      headers: { 'content-type': 'application/json' },
    }), { params: { id: 'tk1' } })
  }

  beforeEach(() => {
    scopeMock.mockResolvedValue({ ok: true, operatorId: 'op1', ownedIds: ['rest1'] })
    db.tableTicket.findUnique.mockResolvedValue(TICKET)
    db.tableTicket.update.mockResolvedValue({ id: 'tk1', status: 'void' })
    db.reservation.findUnique.mockResolvedValue(RESV)
    db.reservation.update.mockResolvedValue({})
    db.reservation.updateMany.mockResolvedValue({ count: 0 })
  })

  it("⭐ walk-out 'capture' flag OFF → ticket clos, empreinte LIBÉRÉE (pas de hold gelé), AUCUNE capture, AUCUN depositPaid, réponse honnête, tracé [V4-1]", async () => {
    vi.stubEnv('PUNITIVE_CAPTURE_ENABLED', '')
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await close('capture')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.deposit.settled).toEqual({ depositStatus: 'released' }) // la vérité, pas 'captured'
    expect(stripe.releaseDeposit).toHaveBeenCalledWith('pi_hold_1')
    expect(stripe.captureDeposit).not.toHaveBeenCalled()
    const w = (db.reservation.update.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(w.depositStatus).toBe('released')
    expect('depositPaid' in w).toBe(false)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[V4-1]'))
    warnSpy.mockRestore()
  })

  it("flag ON (post-pilote) : 'capture' capture réellement — settled 'captured' + montant, depositPaid écrit", async () => {
    vi.stubEnv('PUNITIVE_CAPTURE_ENABLED', 'true')
    const res = await close('capture')
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.deposit.settled).toEqual({ depositStatus: 'captured', capturedAmount: 1000 })
    expect(stripe.captureDeposit).toHaveBeenCalledWith('pi_hold_1', 1000)
    const w = (db.reservation.update.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect(w).toMatchObject({ depositStatus: 'captured', depositPaid: true })
  })

  it("⭐ le choix 'release' (renoncer) reste intact flag OFF — la levée volontaire n'est pas une pénalité", async () => {
    vi.stubEnv('PUNITIVE_CAPTURE_ENABLED', '')
    const res = await close('release')
    expect(res.status).toBe(200)
    expect((await res.json()).deposit.settled).toEqual({ depositStatus: 'released' })
    expect(stripe.releaseDeposit).toHaveBeenCalledWith('pi_hold_1')
  })
})

// ── Textes : aucun texte n'annonce une pénalité qui ne sera pas appliquée.
// Épinglage anti-régression : les formulations de débit punitif retirées (V4-1)
// ne doivent pas revenir tant que le flag n'est pas réactivé.
describe('V4-1 — aucun texte client/opérateur n’annonce une pénalité non appliquée', () => {
  const root = join(__dirname, '..')
  // Par locale : les tournures de PROMESSE DE DÉBIT retirées des clés traitées.
  const FORBIDDEN: Record<string, string[]> = {
    fr: ['Vous ne serez débité', 'sera débitée du client', 'Pénalité no-show = 100%'],
    en: ['You are only charged', 'will be charged to the guest', 'No-show penalty = 100%'],
    es: ['Solo se cobra', 'se cobrará al cliente', 'Penalización por no-show = 100%'],
    it: ['Verrai addebitato', 'sarà addebitata al cliente', 'Penale no-show = 100%'],
    ar: ['لن يتم الخصم إلا', 'سيتم خصم غرامة', 'غرامة عدم الحضور = 100%'],
  }
  // Clés traitées par V4-1 — seules surfaces qui annonçaient le débit punitif.
  const TREATED = (m: Record<string, any>) => [
    m.eat.reservation.depositIntro,
    m.tables.deposit.actionConfirm,
    m.tables.deposit.actionConfirmNoshowTitle,
    m.tables.deposit.actionConfirmNoshowBody,
    m.tables.noShow.penaltyNote,
    m.premium.closure.depositCapture,
  ].join('\n')

  it('⭐ les 6 clés traitées sont purgées de la promesse de débit dans les 5 locales (placeholder {amount} préservé)', () => {
    for (const loc of ['fr', 'en', 'es', 'it', 'ar']) {
      const m = JSON.parse(readFileSync(join(root, 'messages', `${loc}.json`), 'utf8'))
      const treated = TREATED(m)
      for (const phrase of FORBIDDEN[loc]) {
        expect(treated, `${loc}: « ${phrase} » ne doit plus apparaître dans les clés traitées`).not.toContain(phrase)
      }
      // Les clés paramétrées gardent leur placeholder (parité check-translations).
      expect(m.tables.deposit.actionConfirmNoshowBody).toContain('{amount}')
      expect(m.premium.closure.depositCapture).toContain('{amount}')
      expect(m.eat.reservation.depositIntro).toContain('{amount}')
    }
  })

  it('⭐ l’email de confirmation de réservation ne promet plus le débit no-show/walk-out', () => {
    const src = readFileSync(join(root, 'lib', 'transactional-emails.ts'), 'utf8')
    expect(src).not.toContain('Vous ne serez débité')
    // La description de la GARANTIE reste (l'empreinte est annoncée, pas la sanction).
    expect(src).toContain('est associée à cette réservation')
  })
})
