import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ── POST /api/admin/suppliers/coherence — admin clears the visibility gate (Agent 111, D2) ──
// The admin override for the coherence review queue: approve a status='active' but still
// marketplaceCoherencePending=true supplier → pending=false (visible). Admin-only, idempotent,
// one-directional (clear only), NON-money / NON-status (flips ONLY the visibility flag).

const { db, getSession } = vi.hoisted(() => ({
  db: { supplierProfile: { findUnique: vi.fn(), update: vi.fn() } },
  getSession: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth', () => ({ getServerSession: getSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

import { POST } from '@/app/api/admin/suppliers/coherence/route'

// P0-06 — rôle(s) ouvert(s) pour ces tests : la surface est désormais derrière un
// flag de rôle (404 OFF — prouvé par tests/role-locks.test.ts) ; ici on teste la
// logique métier, donc on ouvre le rôle explicitement.
beforeEach(() => { process.env.SUPPLIER_ENABLED = 'true' })
afterEach(() => { delete process.env.SUPPLIER_ENABLED })

const post = (body: unknown) =>
  POST(new Request('http://x/api/admin/suppliers/coherence', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))

beforeEach(() => {
  vi.clearAllMocks()
  db.supplierProfile.update.mockResolvedValue({})
})

describe('POST /api/admin/suppliers/coherence', () => {
  it('401 when not authenticated', async () => {
    getSession.mockResolvedValue(null)
    const res = await post({ email: 'a@b.fr' })
    expect(res.status).toBe(401)
    expect(db.supplierProfile.update).not.toHaveBeenCalled()
  })

  it('403 for a non-admin', async () => {
    getSession.mockResolvedValue({ user: { role: 'supplier' } })
    const res = await post({ email: 'a@b.fr' })
    expect(res.status).toBe(403)
    expect(db.supplierProfile.update).not.toHaveBeenCalled()
  })

  it('admin + pending → clears the flag (pending=false → visible)', async () => {
    getSession.mockResolvedValue({ user: { role: 'admin' } })
    db.supplierProfile.findUnique.mockResolvedValue({ id: 'sp1', marketplaceCoherencePending: true })
    const res = await post({ email: 'A@B.fr' })
    expect(res.status).toBe(200)
    expect(db.supplierProfile.update.mock.calls[0][0]).toMatchObject({
      where: { id: 'sp1' }, data: { marketplaceCoherencePending: false },
    })
  })

  it('idempotent: already cleared → no write', async () => {
    getSession.mockResolvedValue({ user: { roles: ['admin'] } })
    db.supplierProfile.findUnique.mockResolvedValue({ id: 'sp1', marketplaceCoherencePending: false })
    const res = await post({ email: 'a@b.fr' })
    expect(res.status).toBe(200)
    expect(db.supplierProfile.update).not.toHaveBeenCalled()
  })

  it('404 when the supplier does not exist', async () => {
    getSession.mockResolvedValue({ user: { role: 'admin' } })
    db.supplierProfile.findUnique.mockResolvedValue(null)
    const res = await post({ email: 'a@b.fr' })
    expect(res.status).toBe(404)
  })

  it('NON-money / NON-status: clears ONLY the visibility flag (never status/payout)', async () => {
    getSession.mockResolvedValue({ user: { role: 'admin' } })
    db.supplierProfile.findUnique.mockResolvedValue({ id: 'sp1', marketplaceCoherencePending: true })
    await post({ email: 'a@b.fr' })
    const data = db.supplierProfile.update.mock.calls[0][0].data
    expect(Object.keys(data)).toEqual(['marketplaceCoherencePending'])
  })
})
