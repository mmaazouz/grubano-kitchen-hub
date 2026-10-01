import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Annulation client de réservation : bascule GARDÉE contre la concurrence ──
// L'ancien flux lisait status==='confirmed' puis (1) libérait l'empreinte et
// (2) faisait un update inconditionnel : une course fine avec le passage
// 'arrived' côté restaurant pouvait annuler une session déjà démarrée ET
// libérer son empreinte. Désormais : updateMany conditionné sur 'confirmed'
// D'ABORD (0 ligne ⇒ 409 not_cancellable, AUCUN appel Stripe), release ENSUITE.

const { db } = vi.hoisted(() => ({
  db: {
    reservation: { findUnique: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { tokenMock } = vi.hoisted(() => ({ tokenMock: vi.fn() }))
vi.mock('next-auth/jwt', () => ({ getToken: tokenMock }))

const { releaseMock } = vi.hoisted(() => ({ releaseMock: vi.fn() }))
vi.mock('@/lib/deposit', () => ({ releaseHold: releaseMock }))

const { emailMocks } = vi.hoisted(() => ({
  emailMocks: {
    sendReservationCancelledByClientToClient: vi.fn(async () => ({ status: 'sent' })),
    sendReservationCancelledByClientToOwner:  vi.fn(async () => ({ status: 'sent' })),
    resolveReservationRecipient:              vi.fn(async () => null),
    logEmailSkipped:                          vi.fn(async () => undefined),
  },
}))
vi.mock('@/lib/transactional-emails', () => emailMocks)
vi.mock('@/lib/customer-scope', () => ({ maskCustomerName: (n: string) => n }))

import { POST } from '@/app/api/reservations/[id]/cancel/route'

const FUTURE = new Date(Date.now() + 48 * 3_600_000)
const RESA = {
  id: 'resa1', userId: 'u1', status: 'confirmed', date: FUTURE,
  customerName: 'Client', email: null,
  stripePaymentIntentId: 'pi_hold', depositStatus: 'authorized',
  restaurantId: 'r1',
  restaurant: { name: 'Resto', cancellationWindowHours: 2, operator: { email: 'o@x.zz', phone: null } },
}

const post = () =>
  POST(new Request('http://x/api/reservations/resa1/cancel', { method: 'POST' }) as never,
    { params: { id: 'resa1' } })

beforeEach(() => {
  vi.clearAllMocks()
  tokenMock.mockResolvedValue({ sub: 'u1' })
  db.reservation.findUnique.mockResolvedValue({ ...RESA })
  db.reservation.updateMany.mockResolvedValue({ count: 1 })
  db.reservation.update.mockResolvedValue({ id: 'resa1' })
  releaseMock.mockResolvedValue({ ok: true, depositStatus: 'released' })
})

describe('POST /api/reservations/[id]/cancel — garde de concurrence', () => {
  it('chemin nominal : flip gardé (updateMany where status confirmed) PUIS release — 200', async () => {
    const res = await post()
    expect(res.status).toBe(200)
    expect(db.reservation.updateMany).toHaveBeenCalledWith({
      where: { id: 'resa1', status: 'confirmed' },
      data:  { status: 'cancelled', cancelledBy: 'consumer' },
    })
    const flipOrder    = db.reservation.updateMany.mock.invocationCallOrder[0]
    const releaseOrder = releaseMock.mock.invocationCallOrder[0]
    expect(releaseOrder).toBeGreaterThan(flipOrder) // release APRÈS l'annulation acquise
  })

  it("course perdue (le resto vient de passer 'arrived') : 0 ligne touchée → 409 not_cancellable, AUCUN release, AUCUN email", async () => {
    db.reservation.updateMany.mockResolvedValue({ count: 0 })
    const res = await post()
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe('not_cancellable')
    expect(releaseMock).not.toHaveBeenCalled()
    expect(emailMocks.sendReservationCancelledByClientToClient).not.toHaveBeenCalled()
  })

  it('échec du release APRÈS le flip : l’annulation reste acquise (200), erreur surfacée', async () => {
    releaseMock.mockResolvedValue({ ok: false, error: 'stripe down' })
    const res = await post()
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.deposit?.released ?? j.depositReleased ?? false).toBe(false)
  })

  it('pré-checks intacts : non-propriétaire → 403 sans écriture', async () => {
    tokenMock.mockResolvedValue({ sub: 'intrus' })
    const res = await post()
    expect(res.status).toBe(403)
    expect(db.reservation.updateMany).not.toHaveBeenCalled()
  })
})
