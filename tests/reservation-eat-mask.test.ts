import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Masquage PII des réservations /eat (passe dédiée, décision fondateur) ──────
// The DIRECT reservation book stays intact (staff typed the contact themselves).
// Only CONSUMER bookings via the public /eat flow are masked to the operator:
// masked name (first + last initial), phone/email nulled. Discriminator:
// source === 'eat' (written by /api/reservations/public) OR userId != null
// (legacy consumer rows created before the source column).

const { db, scope } = vi.hoisted(() => ({
  db: {
    reservation: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  },
  scope: { resolveEstablishmentScope: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/establishment-scope', () => scope)
vi.mock('@/lib/deposit', () => ({ captureHold: vi.fn(), releaseHold: vi.fn(), isPunitiveCaptureEnabled: vi.fn(() => true) }))
vi.mock('@/lib/ticket', () => ({ ensureOpenTicket: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/opening-hours', () => ({ loadHoursContext: vi.fn(), slotFitsCtx: vi.fn(() => ({ ok: true })) }))
vi.mock('@/lib/transactional-emails', () => ({
  sendReservationCancelledByOwner: vi.fn(),
  sendNoShowPenaltyCharged: vi.fn(),
  resolveReservationRecipient: vi.fn(async () => null),
  logEmailSkipped: vi.fn(),
}))

import { isEatReservation, maskEatReservation } from '@/lib/customer-scope'
import { GET, PATCH } from '@/app/api/reservations/route'

const STAFF_ROW = {
  id: 'r-staff', source: 'staff', userId: null,
  customerName: 'Karim Benali', phone: '0612345678', email: 'karim@x.fr',
  guests: 2, status: 'confirmed', allergies: ['gluten'],
  date: new Date('2026-07-12T19:00:00Z'), endTime: new Date('2026-07-12T20:00:00Z'),
  restaurantId: 'r1', table: { id: 't1', name: 'T1' },
}
const EAT_ROW = {
  ...STAFF_ROW,
  id: 'r-eat', source: 'eat',
  customerName: 'Mohammed Maazouz', phone: '0699999999', email: 'momo@x.fr',
}

beforeEach(() => {
  vi.clearAllMocks()
  scope.resolveEstablishmentScope.mockResolvedValue({
    ok: true, operatorId: 'op1', role: 'restaurant', ownedIds: ['r1'], restaurantId: 'r1',
  })
})

describe('isEatReservation / maskEatReservation', () => {
  it('source=eat → masked name, phone/email nulled', () => {
    const m = maskEatReservation(EAT_ROW)
    expect(m.customerName).toBe('Mohammed M.')
    expect(m.phone).toBeNull()
    expect(m.email).toBeNull()
  })
  it('legacy consumer row (no source, userId set) → masked', () => {
    const legacy = { ...EAT_ROW, source: 'staff', userId: 'cons1' }
    expect(isEatReservation(legacy)).toBe(true)
    expect(maskEatReservation(legacy).customerName).toBe('Mohammed M.')
  })
  it('staff row → returned UNCHANGED (direct book intact)', () => {
    const m = maskEatReservation(STAFF_ROW)
    expect(m).toEqual(STAFF_ROW)
    expect(m.customerName).toBe('Karim Benali')
    expect(m.phone).toBe('0612345678')
  })
  it('allergies stay on a masked row (per-booking food safety, not contact PII)', () => {
    expect(maskEatReservation(EAT_ROW).allergies).toEqual(['gluten'])
  })
})

describe('GET /api/reservations — operator payload', () => {
  it('eat row masked, staff row intact, in the same response', async () => {
    db.reservation.findMany.mockResolvedValue([STAFF_ROW, EAT_ROW])
    const res = await GET(new Request('http://x/api/reservations'))
    expect(res.status).toBe(200)
    const { reservations } = await res.json()
    const staff = reservations.find((r: { id: string }) => r.id === 'r-staff')
    const eat   = reservations.find((r: { id: string }) => r.id === 'r-eat')
    expect(staff.customerName).toBe('Karim Benali')
    expect(staff.phone).toBe('0612345678')
    expect(staff.email).toBe('karim@x.fr')
    expect(eat.customerName).toBe('Mohammed M.')
    expect(eat.phone).toBeNull()
    expect(eat.email).toBeNull()
  })
})

describe('PATCH /api/reservations — operator payload', () => {
  it('updated eat reservation comes back masked', async () => {
    db.reservation.findUnique.mockResolvedValue({
      restaurantId: 'r1', stripePaymentIntentId: null, depositAmount: 0, noShowPenalty: 0,
    })
    db.reservation.update.mockResolvedValue(EAT_ROW)
    const res = await PATCH(new Request('http://x/api/reservations', {
      method: 'PATCH',
      body: JSON.stringify({ id: 'r-eat', status: 'arrived' }),
    }))
    expect(res.status).toBe(200)
    const { reservation } = await res.json()
    expect(reservation.customerName).toBe('Mohammed M.')
    expect(reservation.phone).toBeNull()
    expect(reservation.email).toBeNull()
  })

  it('updated staff reservation stays intact', async () => {
    db.reservation.findUnique.mockResolvedValue({
      restaurantId: 'r1', stripePaymentIntentId: null, depositAmount: 0, noShowPenalty: 0,
    })
    db.reservation.update.mockResolvedValue(STAFF_ROW)
    const res = await PATCH(new Request('http://x/api/reservations', {
      method: 'PATCH',
      body: JSON.stringify({ id: 'r-staff', status: 'arrived' }),
    }))
    const { reservation } = await res.json()
    expect(reservation.customerName).toBe('Karim Benali')
    expect(reservation.phone).toBe('0612345678')
  })
})
