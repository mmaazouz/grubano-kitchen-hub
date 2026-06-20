import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── /api/prestataire/availability (P4, Agent 77) — owner-scoped, flag-gated, NO money ──
// SIMPLE DECLARATIVE: weekdays + note + leave periods. Every op is scoped to the caller's
// PrestataireProfile (session) — no IDOR. 404 when PRESTATAIRE_ENABLED is OFF. NO bookable
// slots / NO conflict detection / NO money. Real isPrestataireEnabled + normalizeWeekdays;
// prisma + callerPrestataireProfile mocked.

const { db, caller } = vi.hoisted(() => ({
  db: {
    prestataireProfile:        { findUnique: vi.fn(), update: vi.fn() },
    prestataireUnavailability: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
  },
  caller: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/prestataire-account', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('@/lib/prestataire-account')
  return { ...actual, callerPrestataireProfile: caller }
})

import { GET, PATCH, POST, DELETE } from '@/app/api/prestataire/availability/route'

const ON  = () => { process.env.PRESTATAIRE_ENABLED = 'true' }
const OFF = () => { delete process.env.PRESTATAIRE_ENABLED }
const send = (h: (r: Request) => Promise<Response>, b: unknown, method = 'POST') =>
  h(new Request('http://x', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }))
const del = (qs: string) => DELETE(new Request(`http://x${qs}`, { method: 'DELETE' }))

beforeEach(() => {
  vi.clearAllMocks(); ON()
  caller.mockResolvedValue({ id: 'pp1', status: 'active' })
  db.prestataireProfile.findUnique.mockResolvedValue({ availableWeekdays: ['mon'], availabilityNote: 'x' })
  db.prestataireProfile.update.mockResolvedValue({})
  db.prestataireUnavailability.findMany.mockResolvedValue([])
  db.prestataireUnavailability.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'u1', ...data }))
  db.prestataireUnavailability.delete.mockResolvedValue({})
})
afterEach(() => OFF())

describe('FLAG OFF → 404', () => {
  it('GET/PATCH/POST/DELETE all 404, no profile lookup, no DB', async () => {
    OFF()
    expect((await GET()).status).toBe(404)
    expect((await send(PATCH, { availableWeekdays: ['mon'] }, 'PATCH')).status).toBe(404)
    expect((await send(POST, { startDate: '2026-07-01T00:00:00.000Z', endDate: '2026-07-02T00:00:00.000Z' })).status).toBe(404)
    expect((await del('?id=u1')).status).toBe(404)
    expect(caller).not.toHaveBeenCalled()
    expect(db.prestataireProfile.update).not.toHaveBeenCalled()
  })
})

describe('GET — owner-scoped read', () => {
  it('returns weekdays + note + periods scoped to the caller', async () => {
    db.prestataireUnavailability.findMany.mockResolvedValue([{ id: 'u1', startDate: new Date(), endDate: new Date(), reason: null }])
    const res = await GET()
    expect(res.status).toBe(200)
    expect(db.prestataireProfile.findUnique.mock.calls[0][0].where).toEqual({ id: 'pp1' })
    expect(db.prestataireUnavailability.findMany.mock.calls[0][0].where).toEqual({ prestataireProfileId: 'pp1' })
    const d = await res.json()
    expect(d.availableWeekdays).toEqual(['mon'])
    expect(Array.isArray(d.unavailabilities)).toBe(true)
  })
  it('no prestataire session → 401', async () => {
    caller.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
  })
})

describe('PATCH — declare weekdays + note (normalized, NO money)', () => {
  it('canonicalizes + de-dups weekdays, trims the note, scoped to the caller id', async () => {
    const res = await send(PATCH, { availableWeekdays: ['sun', 'mon', 'mon', 'junk'], availabilityNote: '  8h-18h  ' }, 'PATCH')
    expect(res.status).toBe(200)
    const arg = db.prestataireProfile.update.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 'pp1' })
    expect(arg.data.availableWeekdays).toEqual(['mon', 'sun']) // canonical, unique, junk dropped
    expect(arg.data.availabilityNote).toBe('8h-18h')
    expect(arg.data).not.toHaveProperty('chargedCents') // NO money
    expect(arg.data).not.toHaveProperty('payoutStatus')
  })
  it('no prestataire session → 401', async () => {
    caller.mockResolvedValue(null)
    expect((await send(PATCH, { availableWeekdays: [] }, 'PATCH')).status).toBe(401)
  })
})

describe('POST — add a leave period (validated, NO money)', () => {
  it('end >= start → 201 with the period scoped to the caller; NO money fields', async () => {
    const res = await send(POST, { startDate: '2026-07-01T00:00:00.000Z', endDate: '2026-07-10T00:00:00.000Z', reason: '  congés  ' })
    expect(res.status).toBe(201)
    const data = db.prestataireUnavailability.create.mock.calls[0][0].data
    expect(data.prestataireProfileId).toBe('pp1') // ← session, never body
    expect(data.startDate).toBeInstanceOf(Date)
    expect(data.reason).toBe('congés')
    expect(data).not.toHaveProperty('priceCents')
  })
  it('end < start → 400, no create', async () => {
    expect((await send(POST, { startDate: '2026-07-10T00:00:00.000Z', endDate: '2026-07-01T00:00:00.000Z' })).status).toBe(400)
    expect(db.prestataireUnavailability.create).not.toHaveBeenCalled()
  })
  it('missing startDate → 400 (Zod)', async () => {
    expect((await send(POST, { endDate: '2026-07-02T00:00:00.000Z' })).status).toBe(400)
  })
})

describe('DELETE — owner-checked (no IDOR)', () => {
  it('another prestataire’s period → 403, no delete', async () => {
    db.prestataireUnavailability.findUnique.mockResolvedValue({ prestataireProfileId: 'OTHER' })
    expect((await del('?id=uX')).status).toBe(403)
    expect(db.prestataireUnavailability.delete).not.toHaveBeenCalled()
  })
  it('own period → 200, delete called', async () => {
    db.prestataireUnavailability.findUnique.mockResolvedValue({ prestataireProfileId: 'pp1' })
    expect((await del('?id=u1')).status).toBe(200)
    expect(db.prestataireUnavailability.delete).toHaveBeenCalledWith({ where: { id: 'u1' } })
  })
  it('unknown period → 404; missing id → 400', async () => {
    db.prestataireUnavailability.findUnique.mockResolvedValue(null)
    expect((await del('?id=missing')).status).toBe(404)
    expect((await del('')).status).toBe(400)
  })
})
