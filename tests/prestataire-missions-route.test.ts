import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── /api/prestataire/missions (P3, Agent 76) — prestataire side, flag-gated, NO money ──
// The prestataire QUOTES / DECLINES / marks DONE its own missions. Owner-scoped to the
// session PrestataireProfile (no IDOR), only valid transitions. The quote amount is stored
// DATA — never a charge. Real isPrestataireEnabled + canTransitionMission; prisma +
// callerPrestataireProfile mocked.

const { db, caller } = vi.hoisted(() => ({
  db: { serviceMission: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() } },
  caller: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/prestataire-account', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('@/lib/prestataire-account')
  return { ...actual, callerPrestataireProfile: caller }
})

import { GET } from '@/app/api/prestataire/missions/route'
import { PATCH } from '@/app/api/prestataire/missions/[id]/route'

const ON  = () => { process.env.PRESTATAIRE_ENABLED = 'true' }
const OFF = () => { delete process.env.PRESTATAIRE_ENABLED }
const patch = (body: unknown, id = 'm1') =>
  PATCH(new Request('http://x', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), { params: { id } })

beforeEach(() => {
  vi.clearAllMocks(); ON()
  caller.mockResolvedValue({ id: 'pp1', status: 'active' })
  db.serviceMission.findUnique.mockResolvedValue({ prestataireProfileId: 'pp1', status: 'requested' })
  db.serviceMission.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'm1', ...data }))
  db.serviceMission.findMany.mockResolvedValue([])
})
afterEach(() => OFF())

describe('FLAG OFF → 404', () => {
  it('GET + PATCH 404, no profile lookup, no DB', async () => {
    OFF()
    expect((await GET()).status).toBe(404)
    expect((await patch({ status: 'quoted' })).status).toBe(404)
    expect(caller).not.toHaveBeenCalled()
    expect(db.serviceMission.update).not.toHaveBeenCalled()
  })
})

describe('GET — owner-scoped list', () => {
  it('scopes to the caller profile', async () => {
    expect((await GET()).status).toBe(200)
    expect(db.serviceMission.findMany.mock.calls[0][0].where).toEqual({ prestataireProfileId: 'pp1' })
  })
  it('no prestataire session → 401', async () => {
    caller.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
  })
})

describe('QUOTE — stores the amount as DATA, never a charge (a + e)', () => {
  it('requested → quoted persists quoteAmountCents/description/proposedDate; NO money fields', async () => {
    const res = await patch({ status: 'quoted', quoteAmountCents: 15000, quoteDescription: 'Intervention + pièces', proposedDate: '2026-07-01T09:00:00.000Z' })
    expect(res.status).toBe(200)
    const data = db.serviceMission.update.mock.calls[0][0].data
    expect(data.status).toBe('quoted')
    expect(data.quoteAmountCents).toBe(15000)        // ← pure DATA
    expect(data.quoteDescription).toBe('Intervention + pièces')
    expect(data.proposedDate).toBeInstanceOf(Date)
    expect(data).not.toHaveProperty('paymentStatus') // NO money
    expect(data).not.toHaveProperty('chargedCents')
    expect(data).not.toHaveProperty('supplierPayoutCents')
  })
  it('a quote WITHOUT an amount → 400, no update', async () => {
    expect((await patch({ status: 'quoted', quoteDescription: 'x' })).status).toBe(400)
    expect(db.serviceMission.update).not.toHaveBeenCalled()
  })
  it('a quote WITHOUT a description → 400', async () => {
    expect((await patch({ status: 'quoted', quoteAmountCents: 100 })).status).toBe(400)
  })
})

describe('DECLINE / DONE + state machine (a + b)', () => {
  it('requested → declined (prestataire refuses the request) → 200', async () => {
    expect((await patch({ status: 'declined' })).status).toBe(200)
  })
  it('accepted → done → 200', async () => {
    db.serviceMission.findUnique.mockResolvedValue({ prestataireProfileId: 'pp1', status: 'accepted' })
    expect((await patch({ status: 'done' })).status).toBe(200)
  })
  it('INVALID: done on a requested (non-accepted) mission → 409, no update', async () => {
    expect((await patch({ status: 'done' })).status).toBe(409)
    expect(db.serviceMission.update).not.toHaveBeenCalled()
  })
  it('INVALID: a prestataire cannot accept (resto-only) → 400 (enum) / never updates', async () => {
    // 'accepted' is not in the prestataire route's enum → 400 at validation.
    expect((await patch({ status: 'accepted' })).status).toBe(400)
    expect(db.serviceMission.update).not.toHaveBeenCalled()
  })
})

describe('OWNER-SCOPING / IDOR (c)', () => {
  it('another prestataire’s mission → 403, no update', async () => {
    db.serviceMission.findUnique.mockResolvedValue({ prestataireProfileId: 'OTHER', status: 'requested' })
    expect((await patch({ status: 'declined' })).status).toBe(403)
    expect(db.serviceMission.update).not.toHaveBeenCalled()
  })
  it('no prestataire session → 401', async () => {
    caller.mockResolvedValue(null)
    expect((await patch({ status: 'declined' })).status).toBe(401)
  })
  it('unknown mission → 404', async () => {
    db.serviceMission.findUnique.mockResolvedValue(null)
    expect((await patch({ status: 'declined' })).status).toBe(404)
  })
})
