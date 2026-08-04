import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── P0-26 (vague 1) — tickets/[id]/refund + reservations/[id]/refund-deposit ──────
// Alignement des 3 routes admin de remboursement sur le régime de
// /api/admin/refunds/run : rate-limit → kill-switch REFUNDS_ENABLED (défaut OFF →
// 403 explicite, AUCUN Stripe) → garde admin. La route orders/[id]/refund est
// couverte en profondeur par tests/order-refund.test.ts ; ce fichier pinne le même
// contrat sur les DEUX autres routes.

const { db } = vi.hoisted(() => ({
  db: {
    tableTicket: { findUnique: vi.fn() },
    reservation: { findUnique: vi.fn() },
    restaurant:  { findUnique: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: vi.fn().mockResolvedValue(undefined) }))

const { refundMock } = vi.hoisted(() => ({ refundMock: vi.fn() }))
vi.mock('@/lib/refunds', () => ({ refundPayment: refundMock }))
vi.mock('@/lib/transactional-emails', () => ({ sendRefundConfirmation: vi.fn().mockResolvedValue(undefined) }))

const { flagMock, limitMock } = vi.hoisted(() => ({ flagMock: vi.fn(), limitMock: vi.fn() }))
vi.mock('@/lib/refund', () => ({ isRefundsEnabled: flagMock }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: limitMock }))

import { POST as ticketPOST } from '@/app/api/tickets/[id]/refund/route'
import { POST as depositPOST } from '@/app/api/reservations/[id]/refund-deposit/route'

const req = () => new Request('https://app.grubano.com/x', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })
const ADMIN = { user: { id: 'adm1', email: 'admin@grubano.com', role: 'admin', roles: ['admin'] } }

const ROUTES: Array<{ name: string; key: string; call: () => Promise<Response> }> = [
  { name: 'tickets/[id]/refund', key: 'ticket_refund', call: () => ticketPOST(req(), { params: { id: 't1' } }) },
  { name: 'reservations/[id]/refund-deposit', key: 'reservation_refund_deposit', call: () => depositPOST(req(), { params: { id: 'rv1' } }) },
]

beforeEach(() => {
  vi.clearAllMocks()
  flagMock.mockReturnValue(true)
  limitMock.mockReturnValue(null)
  sessionMock.mockResolvedValue(ADMIN)
  db.tableTicket.findUnique.mockResolvedValue({ id: 't1', restaurantId: 'r1', status: 'paid', stripePaymentIntentId: 'pi_t', reservationId: null })
  db.reservation.findUnique.mockResolvedValue({ id: 'rv1', restaurantId: 'r1', depositStatus: 'captured', stripePaymentIntentId: 'pi_d', email: null, customerName: 'C' })
  db.restaurant.findUnique.mockResolvedValue({ name: 'Resto' })
  refundMock.mockResolvedValue({ ok: true, refund: { id: 're_x' }, refundedCents: 500, remainingCents: 0, routed: false })
})

for (const r of ROUTES) {
  describe(`POST /api/${r.name} — P0-26`, () => {
    it('⭐ REFUNDS_ENABLED OFF → 403 « Remboursements indisponibles » AVANT auth/DB/Stripe', async () => {
      flagMock.mockReturnValue(false)
      const res = await r.call()
      expect(res.status).toBe(403)
      expect(await res.json()).toMatchObject({ error: 'Remboursements indisponibles', gated: true })
      expect(refundMock).not.toHaveBeenCalled()
      expect(sessionMock).not.toHaveBeenCalled()
    })

    it('rate-limit : réponse du limiteur renvoyée telle quelle, clé dédiée', async () => {
      limitMock.mockReturnValue(new Response('{"error":"Trop de requêtes"}', { status: 429 }))
      const res = await r.call()
      expect(res.status).toBe(429)
      expect(limitMock).toHaveBeenCalledWith(expect.anything(), r.key, { limitDefault: 20, windowDefault: 60 })
      expect(refundMock).not.toHaveBeenCalled()
    })

    it('flag ON + admin → accès normal conservé (200, mécanique atteinte)', async () => {
      const res = await r.call()
      expect(res.status).toBe(200)
      expect(refundMock).toHaveBeenCalledTimes(1)
    })
  })
}
