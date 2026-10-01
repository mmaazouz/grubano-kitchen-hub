import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── M1-02 — anti-double-hold : plus de fallthrough sur échec retrieveIntent ──
// Une erreur TRANSITOIRE (réseau/Stripe) sur la lecture du PI stocké tombait
// dans la création d'un PI FRAIS : deux autorisations de 10 € simultanées sur
// la carte du client (la 1re restait vivante ~7 j). Désormais : 502 « réessayez »
// — un nouveau PI n'est créé que sur un statut LU 'canceled'.

const { db, stripeLib } = vi.hoisted(() => ({
  db: {
    reservation: { findUnique: vi.fn(), update: vi.fn() },
    restaurant:  { findUnique: vi.fn() },
  },
  stripeLib: {
    createDepositHold:      vi.fn(),
    retrieveIntent:         vi.fn(),
    eurosToCents:           (e: number) => Math.round(e * 100),
    mapPaymentIntentStatus: vi.fn(() => 'authorized'),
    getPublishableKey:      vi.fn(() => 'pk_test_x'),
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/stripe', () => stripeLib)
vi.mock('@/lib/establishment-scope', () => ({ resolveEstablishmentScope: vi.fn() }))

import { POST } from '@/app/api/reservations/[id]/deposit/route'

const RESA = {
  id: 'resa1', restaurantId: 'r1', tableId: null, status: 'confirmed',
  depositAmount: 10, depositCurrency: 'eur', depositStatus: 'none',
  stripePaymentIntentId: 'pi_live_hold',
}

const post = () =>
  POST(new Request('http://x/api/reservations/resa1/deposit', { method: 'POST' }),
    { params: { id: 'resa1' } })

beforeEach(() => {
  vi.clearAllMocks()
  db.reservation.findUnique.mockResolvedValue({ ...RESA })
  db.restaurant.findUnique.mockResolvedValue({ stripeAccountId: null, stripeAccountStatus: null })
  stripeLib.getPublishableKey.mockReturnValue('pk_test_x')
})

describe('POST /api/reservations/[id]/deposit — réutilisation du hold', () => {
  it('PI stocké vivant → réutilisé, AUCUN nouveau hold', async () => {
    stripeLib.retrieveIntent.mockResolvedValue({ status: 'requires_capture', client_secret: 'cs_1' })
    const res = await post()
    expect(res.status).toBe(200)
    expect((await res.json()).clientSecret).toBe('cs_1')
    expect(stripeLib.createDepositHold).not.toHaveBeenCalled()
  })

  it('échec TRANSITOIRE de retrieveIntent → 502, AUCUN nouveau hold empilé', async () => {
    stripeLib.retrieveIntent.mockRejectedValue(new Error('network blip'))
    const res = await post()
    expect(res.status).toBe(502)
    expect(stripeLib.createDepositHold).not.toHaveBeenCalled()
  })

  it("statut LU 'canceled' → un hold FRAIS est bien recréé (comportement conservé)", async () => {
    stripeLib.retrieveIntent.mockResolvedValue({ status: 'canceled', client_secret: null })
    stripeLib.createDepositHold.mockResolvedValue({ id: 'pi_new', client_secret: 'cs_new', status: 'requires_payment_method' })
    db.reservation.update.mockResolvedValue({})
    const res = await post()
    expect(res.status).toBe(201) // création fraîche = 201 (la réutilisation, elle, rend 200)
    expect(stripeLib.createDepositHold).toHaveBeenCalledTimes(1)
  })
})
