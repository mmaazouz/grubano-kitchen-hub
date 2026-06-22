import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── POST /api/admin/prestataires/coherence — admin clears the visibility gate (Agent 112, D2) ──
// Calque of /api/admin/suppliers/coherence. The admin override for the coherence review queue:
// approve a status='active' but still marketplaceCoherencePending=true prestataire → pending=false
// (visible). FLAG-gated (404 when OFF), then admin-only, idempotent, one-directional (clear only),
// NON-money / NON-status (flips ONLY the visibility flag). Real isPrestataireEnabled (env-toggled).

const { db, getSession } = vi.hoisted(() => ({
  db: { prestataireProfile: { findUnique: vi.fn(), update: vi.fn() } },
  getSession: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth', () => ({ getServerSession: getSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

import { POST } from '@/app/api/admin/prestataires/coherence/route'

const ON  = () => { process.env.PRESTATAIRE_ENABLED = 'true' }
const OFF = () => { delete process.env.PRESTATAIRE_ENABLED }
const post = (body: unknown) =>
  POST(new Request('http://x/api/admin/prestataires/coherence', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))

beforeEach(() => {
  vi.clearAllMocks()
  ON()
  db.prestataireProfile.update.mockResolvedValue({})
})
afterEach(() => { OFF() })

describe('POST /api/admin/prestataires/coherence', () => {
  it('FLAG OFF → 404 (role does not exist), no write', async () => {
    OFF()
    getSession.mockResolvedValue({ user: { role: 'admin' } })
    const res = await post({ email: 'a@b.fr' })
    expect(res.status).toBe(404)
    expect(db.prestataireProfile.update).not.toHaveBeenCalled()
  })

  it('401 when not authenticated', async () => {
    getSession.mockResolvedValue(null)
    const res = await post({ email: 'a@b.fr' })
    expect(res.status).toBe(401)
    expect(db.prestataireProfile.update).not.toHaveBeenCalled()
  })

  it('403 for a non-admin', async () => {
    getSession.mockResolvedValue({ user: { role: 'prestataire' } })
    const res = await post({ email: 'a@b.fr' })
    expect(res.status).toBe(403)
    expect(db.prestataireProfile.update).not.toHaveBeenCalled()
  })

  it('admin + pending → clears the flag (pending=false → visible)', async () => {
    getSession.mockResolvedValue({ user: { role: 'admin' } })
    db.prestataireProfile.findUnique.mockResolvedValue({ id: 'pp1', marketplaceCoherencePending: true })
    const res = await post({ email: 'A@B.fr' })
    expect(res.status).toBe(200)
    expect(db.prestataireProfile.update.mock.calls[0][0]).toMatchObject({
      where: { id: 'pp1' }, data: { marketplaceCoherencePending: false },
    })
  })

  it('idempotent: already cleared → no write', async () => {
    getSession.mockResolvedValue({ user: { roles: ['admin'] } })
    db.prestataireProfile.findUnique.mockResolvedValue({ id: 'pp1', marketplaceCoherencePending: false })
    const res = await post({ email: 'a@b.fr' })
    expect(res.status).toBe(200)
    expect(db.prestataireProfile.update).not.toHaveBeenCalled()
  })

  it('404 when the prestataire does not exist', async () => {
    getSession.mockResolvedValue({ user: { role: 'admin' } })
    db.prestataireProfile.findUnique.mockResolvedValue(null)
    const res = await post({ email: 'a@b.fr' })
    expect(res.status).toBe(404)
  })

  it('NON-money / NON-status: clears ONLY the visibility flag (never status/payout)', async () => {
    getSession.mockResolvedValue({ user: { role: 'admin' } })
    db.prestataireProfile.findUnique.mockResolvedValue({ id: 'pp1', marketplaceCoherencePending: true })
    await post({ email: 'a@b.fr' })
    const data = db.prestataireProfile.update.mock.calls[0][0].data
    expect(Object.keys(data)).toEqual(['marketplaceCoherencePending'])
  })
})
