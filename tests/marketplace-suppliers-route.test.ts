import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── GET /api/marketplace/suppliers — restaurant-facing visibility gate (Agent 111) ──────
// The single supplier-visibility reader. After the lean-signup decoupling it gates on
// status='active' AND marketplaceCoherencePending=false: EXISTING active suppliers
// (@default(false)) stay visible, lean-signup suppliers stay HIDDEN until the publication
// coherence check clears them. Auth/role gate unchanged.

const { db, caller } = vi.hoisted(() => ({
  db: { supplierProfile: { findMany: vi.fn() } },
  caller: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/operator-session', () => ({ callerOperator: caller }))

import { GET } from '@/app/api/marketplace/suppliers/route'

beforeEach(() => {
  vi.clearAllMocks()
  db.supplierProfile.findMany.mockResolvedValue([])
})

describe('GET /api/marketplace/suppliers — visibility gate', () => {
  it('lists ONLY status=active AND marketplaceCoherencePending=false', async () => {
    caller.mockResolvedValue({ role: 'restaurant' })
    await GET()
    expect(db.supplierProfile.findMany.mock.calls[0][0].where).toEqual({
      status: 'active', marketplaceCoherencePending: false,
    })
  })

  it('401 when not authenticated', async () => {
    caller.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(401)
    expect(db.supplierProfile.findMany).not.toHaveBeenCalled()
  })

  it('403 for a non-restaurant/admin role', async () => {
    caller.mockResolvedValue({ role: 'supplier' })
    const res = await GET()
    expect(res.status).toBe(403)
    expect(db.supplierProfile.findMany).not.toHaveBeenCalled()
  })
})
