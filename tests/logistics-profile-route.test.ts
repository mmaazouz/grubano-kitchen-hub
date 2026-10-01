import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ── PATCH/GET /api/logistics/profile — self-service profile edit (P5a, Agent 21) ─
// Calqued on the supplier profile test. Owner-only (session e-mail, no client id →
// no IDOR), role-gated (no profile → 403), whitelist (identity stripped), validated.

const { db, getSession } = vi.hoisted(() => ({
  db: { logisticsProfile: { findUnique: vi.fn(), update: vi.fn() } },
  getSession: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: getSession }))

import { GET, PATCH } from '@/app/api/logistics/profile/route'

// P0-06 — rôle(s) ouvert(s) pour ces tests : la surface est désormais derrière un
// flag de rôle (404 OFF — prouvé par tests/role-locks.test.ts) ; ici on teste la
// logique métier, donc on ouvre le rôle explicitement.
beforeEach(() => { process.env.LOGISTICS_ENABLED = 'true' })
afterEach(() => { delete process.env.LOGISTICS_ENABLED })

const patch = (body: unknown) =>
  PATCH(new Request('http://x/api/logistics/profile', {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))

const VALID = {
  partnerType: 'independent', contactName: 'Karim', contactPhone: '0600',
  missionTypes: ['repas'], vehicleTypes: ['velo'], zones: ['Lyon'],
}

beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue({ user: { email: 'k@courier.fr' } })
  db.logisticsProfile.findUnique.mockResolvedValue({ id: 'lp1' })
  db.logisticsProfile.update.mockResolvedValue({})
})

describe('PATCH /api/logistics/profile', () => {
  it('(a) updates the signed-in courier OPERATIONAL fields', async () => {
    const res = await patch(VALID)
    expect(res.status).toBe(200)
    const arg = db.logisticsProfile.update.mock.calls[0][0]
    expect(arg.where).toEqual({ email: 'k@courier.fr' })
    expect(arg.data).toMatchObject({
      partnerType: 'independent', contactName: 'Karim', contactPhone: '0600',
      missionTypes: ['repas'], vehicleTypes: ['velo'], zones: ['Lyon'],
    })
  })

  it('(b) identity / login fields in the body are IGNORED (never written, no IDOR)', async () => {
    await patch({ ...VALID, siren: '999999999', officialName: 'HACK', verificationStatus: 'verified', status: 'active', email: 'other@x.fr', id: 'lp2' })
    const arg = db.logisticsProfile.update.mock.calls[0][0]
    expect(arg.where).toEqual({ email: 'k@courier.fr' })
    for (const k of ['siren', 'officialName', 'verificationStatus', 'status', 'email', 'id']) {
      expect(arg.data).not.toHaveProperty(k)
    }
  })

  it('(c) invalid input → 400, no write', async () => {
    expect((await patch({ ...VALID, missionTypes: [] })).status).toBe(400)        // min 1
    expect((await patch({ ...VALID, vehicleTypes: [] })).status).toBe(400)        // min 1
    expect((await patch({ ...VALID, partnerType: 'martian' })).status).toBe(400)  // bad enum
    expect((await patch({ ...VALID, missionTypes: ['teleport'] })).status).toBe(400)
    expect(db.logisticsProfile.update).not.toHaveBeenCalled()
  })

  it('(d) unauthenticated → 401, no write', async () => {
    getSession.mockResolvedValue(null)
    expect((await patch(VALID)).status).toBe(401)
    expect(db.logisticsProfile.update).not.toHaveBeenCalled()
  })

  it('(e) no logistics profile for the session e-mail (wrong role) → 403, no write', async () => {
    db.logisticsProfile.findUnique.mockResolvedValue(null)
    expect((await patch(VALID)).status).toBe(403)
    expect(db.logisticsProfile.update).not.toHaveBeenCalled()
  })
})

describe('GET /api/logistics/profile', () => {
  it('returns the caller OWN profile (identity surfaced read-only)', async () => {
    db.logisticsProfile.findUnique.mockResolvedValue({
      partnerType: 'company', contactName: 'K', contactPhone: null, missionTypes: ['repas'], vehicleTypes: ['velo'], zones: [],
      siren: '123456789', officialName: 'K SARL', verificationStatus: 'verified', status: 'active',
    })
    const res = await GET()
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.profile).toMatchObject({ partnerType: 'company', missionTypes: ['repas'], siren: '123456789', status: 'active' })
  })

  it('unauthenticated → 401', async () => {
    getSession.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
  })
})
