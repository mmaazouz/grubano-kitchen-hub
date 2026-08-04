import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── P0-31 (vague 2 — Q8 fondateur) : verrou sur la FAUSSE VALIDATION d'acompte ──
// PATCH /api/reservations acceptait depositPaid:true SANS AUCUN mouvement Stripe,
// et ce booléen alimente le total « acomptes » du tableau de bord (TablesShell) —
// un acompte « déclaré » était indistinguable d'une capture réelle. Le verrou :
// toute déclaration CLIENT de depositPaid → 403 explicite + tracé, AUCUNE écriture.
// Les seuls écrivains restants sont adossés à une capture Stripe réelle : webhook
// 'captured', tickets/[id]/close, reservations/[id]/deposit/capture, et la branche
// no-show du PATCH lui-même (captureHold — testée ici : elle DOIT survivre).
// C'est un VERROU, pas un chantier dine-in (consigne fondateur explicite).
// Mock harness copied from tests/reservation-cancel-release.test.ts (same route).

const { db } = vi.hoisted(() => ({
  db: {
    reservation: { findUnique: vi.fn(), update: vi.fn() },
    restaurant:  { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { scopeMock } = vi.hoisted(() => ({ scopeMock: vi.fn() }))
vi.mock('@/lib/establishment-scope', () => ({ resolveEstablishmentScope: scopeMock }))

const { releaseMock, captureMock } = vi.hoisted(() => ({ releaseMock: vi.fn(), captureMock: vi.fn() }))
vi.mock('@/lib/deposit', () => ({ releaseHold: releaseMock, captureHold: captureMock }))

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
vi.mock('@/lib/ticket', () => ({ ensureOpenTicket: ticketMock }))

vi.mock('@/lib/opening-hours', () => ({ loadHoursContext: vi.fn(), slotFitsCtx: vi.fn() }))

import { PATCH } from '@/app/api/reservations/route'

const call = (body: Record<string, unknown>) =>
  PATCH(new Request('https://app.grubano.com/api/reservations', {
    method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  }))

const HOLD = {
  restaurantId: 'rest1', stripePaymentIntentId: 'pi_hold_1',
  depositAmount: 10, noShowPenalty: 10, depositStatus: 'authorized',
}

beforeEach(() => {
  vi.clearAllMocks()
  scopeMock.mockResolvedValue({ ok: true, operatorId: 'op1', ownedIds: ['rest1'] })
  db.reservation.findUnique.mockResolvedValue(HOLD)
  db.reservation.update.mockResolvedValue({
    id: 'resv1', status: 'noshow', restaurantId: 'rest1', date: new Date(), customerName: 'Client',
    email: null, table: null,
  })
  db.restaurant.findUnique.mockResolvedValue({ name: 'Resto Test' })
  captureMock.mockResolvedValue({ ok: true, depositStatus: 'captured', capturedAmount: 1000 })
  recipientMock.mockResolvedValue(null)
  emails.logEmailSkipped.mockResolvedValue(undefined)
})

describe('PATCH /api/reservations — P0-31 : la déclaration manuelle depositPaid est REFUSÉE', () => {
  it('⭐ depositPaid:true → 403 explicite + code, AUCUNE écriture DB, AUCUN Stripe, tentative TRACÉE', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await call({ id: 'resv1', depositPaid: true })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({
      error: "L'acompte ne peut pas être déclaré encaissé manuellement — seule une capture bancaire réelle le valide.",
      code:  'deposit_declaration_forbidden',
    })
    expect(db.reservation.update).not.toHaveBeenCalled()
    expect(captureMock).not.toHaveBeenCalled()
    expect(releaseMock).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('[P0-31]'))
    warnSpy.mockRestore()
  })

  it('depositPaid:false est refusé au même titre (dé-déclarer une capture réelle est tout aussi interdit)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await call({ id: 'resv1', depositPaid: false })
    expect(res.status).toBe(403)
    expect(db.reservation.update).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it("le refus tombe même COMBINÉ à un status légitime ({ status:'arrived', depositPaid:true }) — pas de contrebande", async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await call({ id: 'resv1', status: 'arrived', depositPaid: true })
    expect(res.status).toBe(403)
    expect(db.reservation.update).not.toHaveBeenCalled()
    expect(ticketMock).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('un PATCH status SANS depositPaid reste normal (200) et son update ne contient PAS depositPaid', async () => {
    db.reservation.update.mockResolvedValue({
      id: 'resv1', status: 'confirmed', restaurantId: 'rest1', date: new Date(), customerName: 'Client',
      email: null, table: null,
    })
    const res = await call({ id: 'resv1', status: 'confirmed' })
    expect(res.status).toBe(200)
    const writeData = (db.reservation.update.mock.calls[0][0] as { data: Record<string, unknown> }).data
    expect('depositPaid' in writeData).toBe(false)
  })

  it('⭐ la capture RÉELLE no-show survit : captureHold captured → depositPaid:true écrit PAR LE SERVEUR', async () => {
    // Le seul chemin du PATCH qui pose depositPaid est adossé à une capture Stripe
    // réelle (captureHold) — le verrou ne touche pas ce chemin.
    const res = await call({ id: 'resv1', status: 'noshow' })
    expect(res.status).toBe(200)
    expect(captureMock).toHaveBeenCalledWith('pi_hold_1', 10, 10)
    expect(db.reservation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'noshow', depositPaid: true, depositStatus: 'captured' }),
    }))
  })

  it('no-show dont la capture échoue → l’erreur Stripe est surfacée et depositPaid n’est JAMAIS écrit', async () => {
    captureMock.mockResolvedValue({ ok: false, status: 502, error: 'capture failed' })
    const res = await call({ id: 'resv1', status: 'noshow' })
    expect(res.status).toBe(502)
    expect(db.reservation.update).not.toHaveBeenCalled()
  })
})
