import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── PATCH/GET /api/franchise/profile — self-service account edit (P5c, Agent 23) ─
// The franchise has no dedicated profile model → this edits the Operator ACCOUNT's
// name/phone/city. Owner-only (session.user.id, never a client id → no IDOR),
// role-gated (must hold 'franchise' via readOperatorRoles), whitelist (email / role
// / status / finance / establishment data stripped & never written), validated.

const { db, getSession } = vi.hoisted(() => ({
  db: { operator: { findUnique: vi.fn(), update: vi.fn() }, operatorRole: { findMany: vi.fn() }, brand: { findMany: vi.fn() } },
  getSession: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: getSession }))

import { GET, PATCH } from '@/app/api/franchise/profile/route'

const patch = (body: unknown) =>
  PATCH(new Request('http://x/api/franchise/profile', {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))

const VALID = { name: 'Réseau Marco', phone: '0600000000', city: 'Lyon' }

beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue({ user: { id: 'op1' } })
  db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'franchise', name: 'Réseau', phone: '06', city: 'Lyon', email: 'fr@x.fr', status: 'active' })
  db.operatorRole.findMany.mockResolvedValue([]) // role set = [primary] = ['franchise']
  db.operator.update.mockResolvedValue({})
  db.brand.findMany.mockResolvedValue([]) // FR6 — real rate source (read-only)
})

describe('PATCH /api/franchise/profile', () => {
  it('(a) updates the signed-in franchise account contact/display fields', async () => {
    const res = await patch(VALID)
    expect(res.status).toBe(200)
    const arg = db.operator.update.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 'op1' }) // owner-only by SESSION operator id
    expect(arg.data).toEqual({ name: 'Réseau Marco', phone: '0600000000', city: 'Lyon' })
  })

  it('(b) account / finance / identity fields in the body are IGNORED (no IDOR)', async () => {
    await patch({ ...VALID, email: 'victim@x.fr', id: 'op2', role: 'admin', status: 'active', password: 'x', siret: '1', rib: '2', totalEarnings: 9999 })
    const arg = db.operator.update.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 'op1' }) // NOT op2
    expect(Object.keys(arg.data).sort()).toEqual(['city', 'name', 'phone'])
    for (const k of ['email', 'id', 'role', 'status', 'password', 'siret', 'rib', 'totalEarnings']) {
      expect(arg.data).not.toHaveProperty(k)
    }
  })

  it('(c) invalid input → 400, no write', async () => {
    expect((await patch({ ...VALID, name: 'x' })).status).toBe(400) // < 2 chars
    expect(db.operator.update).not.toHaveBeenCalled()
  })

  it('(d) unauthenticated → 401, no write', async () => {
    getSession.mockResolvedValue(null)
    expect((await patch(VALID)).status).toBe(401)
    expect(db.operator.update).not.toHaveBeenCalled()
  })

  it('(e) operator without the franchise role → 403, no write', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant', name: 'R', email: 'r@x.fr', status: 'active' })
    db.operatorRole.findMany.mockResolvedValue([]) // set = ['restaurant'] → no franchise
    expect((await patch(VALID)).status).toBe(403)
    expect(db.operator.update).not.toHaveBeenCalled()
  })

  it('(e2) no operator for the session → 403, no write', async () => {
    db.operator.findUnique.mockResolvedValue(null)
    expect((await patch(VALID)).status).toBe(403)
    expect(db.operator.update).not.toHaveBeenCalled()
  })

  it('multi-role operator (primary restaurant + franchise in the SET) is allowed', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant', name: 'R', phone: null, city: null, email: 'r@x.fr', status: 'active' })
    db.operatorRole.findMany.mockResolvedValue([{ role: 'restaurant' }, { role: 'franchise' }])
    expect((await patch(VALID)).status).toBe(200)
    expect(db.operator.update).toHaveBeenCalled()
  })
})

describe('GET /api/franchise/profile', () => {
  it('returns the caller OWN account (editable + email/status read-only)', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.profile).toMatchObject({ name: 'Réseau', email: 'fr@x.fr', status: 'active' })
    // never leaks role/password
    expect(j.profile).not.toHaveProperty('role')
    expect(j.profile).not.toHaveProperty('password')
  })

  it('unauthenticated → 401', async () => {
    getSession.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
  })

  it('non-franchise → 403', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'creator', email: 'c@x.fr', status: 'active' })
    db.operatorRole.findMany.mockResolvedValue([])
    expect((await GET()).status).toBe(403)
  })
})
