import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ── PATCH/GET /api/supplier/profile — self-service profile edit (P5a, Agent 21) ─
// Owner-only (session e-mail, never a client id → no IDOR), role-gated (no profile
// → 403), whitelist (identity fields stripped & never written), validated.

const { db, getSession } = vi.hoisted(() => ({
  db: { supplierProfile: { findUnique: vi.fn(), update: vi.fn() } },
  getSession: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: getSession }))

import { GET, PATCH } from '@/app/api/supplier/profile/route'

// P0-06 — rôle(s) ouvert(s) pour ces tests : la surface est désormais derrière un
// flag de rôle (404 OFF — prouvé par tests/role-locks.test.ts) ; ici on teste la
// logique métier, donc on ouvre le rôle explicitement.
beforeEach(() => { process.env.SUPPLIER_ENABLED = 'true' })
afterEach(() => { delete process.env.SUPPLIER_ENABLED })

const patch = (body: unknown) =>
  PATCH(new Request('http://x/api/supplier/profile', {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))

const VALID = {
  companyName: 'Primeurs Lyon', contactName: 'Marie', phone: '0600', city: 'Lyon',
  categories: ['fresh'], deliveryZones: ['Lyon'], minimumOrderEur: 50, leadTimeDays: 2, paymentTerms: '30 jours',
}

beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue({ user: { email: 'm@primeurs.fr' } })
  db.supplierProfile.findUnique.mockResolvedValue({ id: 'sp1' }) // caller owns a profile
  db.supplierProfile.update.mockResolvedValue({})
})

describe('PATCH /api/supplier/profile', () => {
  it('(a) updates the signed-in supplier OPERATIONAL fields (euros → cents)', async () => {
    const res = await patch(VALID)
    expect(res.status).toBe(200)
    const arg = db.supplierProfile.update.mock.calls[0][0]
    // Owner-only: the row is addressed by the SESSION e-mail, never a client id.
    expect(arg.where).toEqual({ email: 'm@primeurs.fr' })
    expect(arg.data).toMatchObject({
      companyName: 'Primeurs Lyon', contactName: 'Marie', phone: '0600', city: 'Lyon',
      categories: ['fresh'], deliveryZones: ['Lyon'], minimumOrderCents: 5000, leadTimeDays: 2, paymentTerms: '30 jours',
    })
  })

  it('(b) identity / login fields in the body are IGNORED (never written, no IDOR)', async () => {
    await patch({ ...VALID, siren: '999999999', officialName: 'HACK', verificationStatus: 'verified', status: 'active', email: 'other@x.fr', id: 'sp2', minimumOrderCents: 1 })
    const arg = db.supplierProfile.update.mock.calls[0][0]
    expect(arg.where).toEqual({ email: 'm@primeurs.fr' }) // NOT other@x.fr / sp2
    for (const k of ['siren', 'officialName', 'verificationStatus', 'status', 'email', 'id']) {
      expect(arg.data).not.toHaveProperty(k)
    }
    // minimumOrderCents is derived from minimumOrderEur, NOT taken from the body.
    expect(arg.data.minimumOrderCents).toBe(5000)
  })

  it('(c) invalid input → 400, no write', async () => {
    expect((await patch({ ...VALID, categories: ['weapons'] })).status).toBe(400)
    expect((await patch({ ...VALID, minimumOrderEur: -5 })).status).toBe(400)
    expect((await patch({ ...VALID, companyName: 'x' })).status).toBe(400) // < 2 chars
    expect(db.supplierProfile.update).not.toHaveBeenCalled()
  })

  it('(d) unauthenticated → 401, no write', async () => {
    getSession.mockResolvedValue(null)
    expect((await patch(VALID)).status).toBe(401)
    expect(db.supplierProfile.update).not.toHaveBeenCalled()
  })

  it('(e) no supplier profile for the session e-mail (wrong role) → 403, no write', async () => {
    db.supplierProfile.findUnique.mockResolvedValue(null)
    expect((await patch(VALID)).status).toBe(403)
    expect(db.supplierProfile.update).not.toHaveBeenCalled()
  })
})

describe('GET /api/supplier/profile', () => {
  it('returns the caller OWN profile (euros derived; identity surfaced read-only)', async () => {
    db.supplierProfile.findUnique.mockResolvedValue({
      companyName: 'P', contactName: 'M', phone: null, city: null, categories: ['fresh'], deliveryZones: [],
      minimumOrderCents: 5000, leadTimeDays: 2, paymentTerms: null,
      siren: '123456789', officialName: 'P SARL', verificationStatus: 'verified', status: 'active',
    })
    const res = await GET()
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.profile).toMatchObject({ companyName: 'P', minimumOrderEur: 50, siren: '123456789', verificationStatus: 'verified', status: 'active' })
  })

  it('unauthenticated → 401', async () => {
    getSession.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
  })

  it('no profile → 403', async () => {
    db.supplierProfile.findUnique.mockResolvedValue(null)
    expect((await GET()).status).toBe(403)
  })
})
