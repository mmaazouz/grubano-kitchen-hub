import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── GET /api/briefing — SEC: anonymous cross-tenant PII leak closed ────────────
// Before the fix, GET() had NO auth gate and NO tenant scoping: an ANONYMOUS
// caller obtained today's reservations — customerName + allergies (RGPD art. 9
// health data) — plus stock levels + revenue of EVERY establishment. Now it is
// gated to the connected restaurateur (restaurant/admin) and every query is
// fenced to their own establishments.

const { db, scope, llm } = vi.hoisted(() => ({
  db: {
    stockItem:    { findMany: vi.fn() },
    reservation:  { findMany: vi.fn() },
    loyaltyOrder: { findMany: vi.fn() },
  },
  scope: { resolveEstablishmentScope: vi.fn() },
  llm: { llmComplete: vi.fn(), LlmQuotaError: class LlmQuotaError extends Error {} },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/establishment-scope', () => scope)
vi.mock('@/lib/llm', () => llm)

import { GET } from '@/app/api/briefing/route'

beforeEach(() => {
  vi.clearAllMocks()
  db.stockItem.findMany.mockResolvedValue([])
  db.reservation.findMany.mockResolvedValue([])
  db.loyaltyOrder.findMany.mockResolvedValue([])
  llm.llmComplete.mockResolvedValue({ text: 'briefing' })
})

describe('auth gate', () => {
  it('anonymous → 401, NO db read at all (no PII, no health data leaves)', async () => {
    scope.resolveEstablishmentScope.mockResolvedValue({ ok: false, status: 401, error: 'Non autorisé' })
    const res = await GET()
    expect(res.status).toBe(401)
    expect(db.reservation.findMany).not.toHaveBeenCalled()
    expect(db.stockItem.findMany).not.toHaveBeenCalled()
    expect(db.loyaltyOrder.findMany).not.toHaveBeenCalled()
    expect(llm.llmComplete).not.toHaveBeenCalled()
  })

  it('wrong role → 403, NO db read', async () => {
    scope.resolveEstablishmentScope.mockResolvedValue({ ok: false, status: 403, error: 'Accès refusé' })
    const res = await GET()
    expect(res.status).toBe(403)
    expect(db.reservation.findMany).not.toHaveBeenCalled()
  })
})

describe('tenant scoping — restaurateur sees ONLY his own establishments', () => {
  beforeEach(() => {
    scope.resolveEstablishmentScope.mockResolvedValue({
      ok: true, operatorId: 'op1', role: 'restaurant', ownedIds: ['r1', 'r2'], restaurantId: 'r1',
    })
  })

  it('reservations fenced to ownedIds (never platform-wide)', async () => {
    await GET()
    const arg = db.reservation.findMany.mock.calls[0][0]
    expect(arg.where.restaurantId).toEqual({ in: ['r1', 'r2'] })
  })

  it('stock + loyalty orders fenced to the caller brand.operatorId', async () => {
    await GET()
    expect(db.stockItem.findMany.mock.calls[0][0].where).toEqual({ brand: { operatorId: 'op1' } })
    expect(db.loyaltyOrder.findMany.mock.calls[0][0].where).toMatchObject({ brand: { operatorId: 'op1' } })
  })

  it('LLM quota attributed to the authenticated operator', async () => {
    await GET()
    expect(llm.llmComplete).toHaveBeenCalledWith(
      expect.objectContaining({ operatorId: 'op1' }),
    )
  })

  it('returns 200 with the scoped reservation PII (customerName/allergies) only for own tenant', async () => {
    db.reservation.findMany.mockResolvedValue([
      { date: new Date('2026-07-12T19:00:00Z'), customerName: 'Alice', guests: 2, table: { name: 'T1' }, status: 'confirmed', allergies: ['gluten'] },
    ])
    const res = await GET()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.reservations[0]).toMatchObject({ customerName: 'Alice', allergies: ['gluten'] })
  })
})
