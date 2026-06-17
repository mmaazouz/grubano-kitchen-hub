import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── B2.4 / SEC2 — admin restaurant approval endpoint (Agent 33) ──────────────
// POST /api/admin/restaurants/[id]/approve is the ONLY way a never-approved resto
// comes online (the SEC1 invariant: an owner can never self-publish one). These
// tests lock: admin-only (401 no session / 403 non-admin BEFORE any read/write),
// the approval effect (isActive=true, status='published', approvedAt stamped only
// if null → idempotent), no-IDOR (the [id] only selects the target), and 404.

const { db } = vi.hoisted(() => ({
  db: {
    restaurant: { findUnique: vi.fn(), update: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

import { POST } from '@/app/api/admin/restaurants/[id]/approve/route'

function approve(id: string, user: { role?: string; roles?: string[] } | null) {
  sessionMock.mockResolvedValue(user ? { user: { email: 'u@x', ...user } } : null)
  return POST(
    new Request(`https://app.grubano.com/api/admin/restaurants/${id}/approve`, { method: 'POST' }),
    { params: { id } },
  )
}
const ADMIN = { role: 'admin' }

beforeEach(() => {
  vi.clearAllMocks()
  db.restaurant.update.mockResolvedValue({ id: 'r1', name: 'Resto', isActive: true })
})

describe('POST /api/admin/restaurants/[id]/approve', () => {
  it('(a) admin approves a never-approved resto → isActive=true, status=published, approvedAt stamped', async () => {
    db.restaurant.findUnique.mockResolvedValue({ id: 'r1', approvedAt: null })
    const res = await approve('r1', ADMIN)
    expect(res.status).toBe(200)
    const data = db.restaurant.update.mock.calls[0][0].data
    expect(data.isActive).toBe(true)
    expect(data.status).toBe('published')
    expect(data.approvedAt).toBeInstanceOf(Date)
  })

  it('(b) no session → 401, BEFORE any read/write', async () => {
    const res = await approve('r1', null)
    expect(res.status).toBe(401)
    expect(db.restaurant.findUnique).not.toHaveBeenCalled()
    expect(db.restaurant.update).not.toHaveBeenCalled()
  })

  it('(c) non-admin → 403, BEFORE any read/write (no IDOR, no self-approval)', async () => {
    const res = await approve('r1', { role: 'restaurant' })
    expect(res.status).toBe(403)
    expect(db.restaurant.findUnique).not.toHaveBeenCalled()
    expect(db.restaurant.update).not.toHaveBeenCalled()
  })

  it('(d) idempotent re-approval of an already-approved resto → no approvedAt re-stamp', async () => {
    const existing = new Date('2026-01-01T00:00:00Z')
    db.restaurant.findUnique.mockResolvedValue({ id: 'r1', approvedAt: existing })
    const res = await approve('r1', ADMIN)
    expect(res.status).toBe(200)
    const data = db.restaurant.update.mock.calls[0][0].data
    expect(data.isActive).toBe(true)
    expect(data.status).toBe('published')
    expect(data).not.toHaveProperty('approvedAt') // original timestamp preserved
  })

  it('(e) unknown restaurant → 404, no write', async () => {
    db.restaurant.findUnique.mockResolvedValue(null)
    const res = await approve('ghost', ADMIN)
    expect(res.status).toBe(404)
    expect(db.restaurant.update).not.toHaveBeenCalled()
  })

  it('(f) admin via the roles SET (roles:[admin]) is authorized too', async () => {
    db.restaurant.findUnique.mockResolvedValue({ id: 'r1', approvedAt: null })
    const res = await approve('r1', { role: 'restaurant', roles: ['restaurant', 'admin'] })
    expect(res.status).toBe(200)
    expect(db.restaurant.update.mock.calls[0][0].data.isActive).toBe(true)
  })
})
