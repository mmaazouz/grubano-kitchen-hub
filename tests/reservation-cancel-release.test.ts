import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── P0-12 (vague 1, Q12 fondateur) — PATCH /api/reservations status='cancelled' ──
// L'annulation par le RESTAURANT doit LIBÉRER l'empreinte bancaire, comme le promet
// l'email de confirmation. Le mécanisme est lib/deposit.releaseHold (réutilisé, pas
// réécrit). Cas couverts : hold actif → libéré + depositStatus écrit ; pas
// d'empreinte → aucun appel, aucune erreur ; échec Stripe → annulation NON bloquée
// mais erreur TRACÉE et SURFACÉE (depositError) — jamais avalée.

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
// V4-1 : flag mocké ON — ce fichier photographie le comportement CAPTURE historique
// (le contrat flag OFF vit dans tests/punitive-capture.test.ts).
vi.mock('@/lib/deposit', () => ({ releaseHold: releaseMock, captureHold: captureMock, isPunitiveCaptureEnabled: vi.fn(() => true) }))

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
  scopeMock.mockResolvedValue({ ok: true, ownedIds: ['rest1'] })
  db.reservation.findUnique.mockResolvedValue(HOLD)
  db.reservation.update.mockResolvedValue({
    id: 'resv1', status: 'cancelled', restaurantId: 'rest1', date: new Date(), customerName: 'Client',
    table: null,
  })
  db.restaurant.findUnique.mockResolvedValue({ name: 'Resto Test' })
  releaseMock.mockResolvedValue({ ok: true, depositStatus: 'released' })
  recipientMock.mockResolvedValue(null) // pas d'email → logEmailSkipped (hors sujet ici)
  emails.logEmailSkipped.mockResolvedValue(undefined)
})

describe('PATCH /api/reservations → cancelled — libération de l\'empreinte (P0-12)', () => {
  it('empreinte active (PI + authorized) → releaseHold appelé, depositStatus écrit, depositReleased:true', async () => {
    const res = await call({ id: 'resv1', status: 'cancelled' })
    expect(res.status).toBe(200)
    expect(releaseMock).toHaveBeenCalledWith('pi_hold_1')
    // Le depositStatus libéré est écrit dans la MÊME update que l'annulation.
    expect(db.reservation.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'cancelled', cancelledBy: 'operator', depositStatus: 'released' }),
    }))
    expect(await res.json()).toMatchObject({ depositReleased: true })
  })

  it('sans empreinte (pas de PI) → AUCUN appel Stripe, aucune erreur, annulation normale', async () => {
    db.reservation.findUnique.mockResolvedValue({ ...HOLD, stripePaymentIntentId: null, depositStatus: 'none' })
    const res = await call({ id: 'resv1', status: 'cancelled' })
    expect(res.status).toBe(200)
    expect(releaseMock).not.toHaveBeenCalled()
    const body = await res.json()
    expect(body).toMatchObject({ depositReleased: false })
    expect(body.depositError).toBeUndefined()
  })

  it('empreinte déjà released/captured → pas de re-appel (idempotence au niveau route)', async () => {
    db.reservation.findUnique.mockResolvedValue({ ...HOLD, depositStatus: 'released' })
    await call({ id: 'resv1', status: 'cancelled' })
    expect(releaseMock).not.toHaveBeenCalled()

    db.reservation.findUnique.mockResolvedValue({ ...HOLD, depositStatus: 'captured' })
    await call({ id: 'resv1', status: 'cancelled' })
    expect(releaseMock).not.toHaveBeenCalled() // une pénalité capturée ne se "libère" pas — rail refund admin
  })

  it('échec Stripe (releaseHold not-ok) → annulation RÉUSSIT quand même, erreur SURFACÉE (depositError), depositStatus non écrit', async () => {
    releaseMock.mockResolvedValue({ ok: false, status: 502, error: 'Erreur paiement, réessayez.' })
    const res = await call({ id: 'resv1', status: 'cancelled' })
    expect(res.status).toBe(200) // le droit d'annuler n'est jamais bloqué
    const body = await res.json()
    expect(body).toMatchObject({ depositReleased: false, depositError: 'Erreur paiement, réessayez.' })
    // la réservation est bien passée cancelled, SANS depositStatus mensonger
    const written = db.reservation.update.mock.calls[0][0].data
    expect(written.status).toBe('cancelled')
    expect(written.depositStatus).toBeUndefined()
  })

  it('releaseHold THROW → même contrat : 200 + depositError surfacé (jamais avalé)', async () => {
    releaseMock.mockRejectedValue(new Error('network down'))
    const res = await call({ id: 'resv1', status: 'cancelled' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ depositReleased: false, depositError: 'network down' })
  })

  it('un PATCH non-annulation (arrived) ne touche JAMAIS releaseHold (cycle premium-table intact)', async () => {
    ticketMock.mockResolvedValue({ ok: true })
    db.reservation.update.mockResolvedValue({
      id: 'resv1', status: 'arrived', restaurantId: 'rest1', tableId: 't1', date: new Date(), customerName: 'C', table: null,
    })
    const res = await call({ id: 'resv1', status: 'arrived' })
    expect(res.status).toBe(200)
    expect(releaseMock).not.toHaveBeenCalled()
    expect((await res.json()).depositReleased).toBeUndefined() // marqueur réservé à l'annulation
  })
})
