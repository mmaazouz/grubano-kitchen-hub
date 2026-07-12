import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── WP-SEC-02 — menu-mutation IDOR hardening ──────────────────────────────────
// PUT/DELETE /api/menu previously had NO auth (any caller could edit/delete any
// dish by id). PATCH /api/menu/[id]/availability was owner-scoped but returned 403
// (existence oracle). Now all three: caller must OWN the dish's brand
// (Brand.operatorId) or be admin; cross-tenant → 404 (never 403). Menu ownership
// is via brand.operatorId — NOT establishment-scope (a MenuItem has no restaurantId).

const { db, session } = vi.hoisted(() => ({
  db: {
    operator: { findUnique: vi.fn() },
    menuItem: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    brand:    { findFirst: vi.fn() },
  },
  session: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth', () => ({ getServerSession: session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/dish-photo', () => ({
  processDishImage: vi.fn(),
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
}))

import { PUT, DELETE } from '@/app/api/menu/route'
import { PATCH as PATCH_AVAIL } from '@/app/api/menu/[id]/availability/route'

const put = (body: Record<string, unknown>) =>
  PUT(new Request('http://x/api/menu', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))
const del = (id?: string) =>
  DELETE(new Request(`http://x/api/menu${id ? `?id=${id}` : ''}`, { method: 'DELETE' }))
const avail = (id: string, available = false): Promise<Response> =>
  PATCH_AVAIL(
    new Request(`http://x/api/menu/${id}/availability`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ available }),
    }),
    { params: { id } },
  ) as Promise<Response>

// actor helpers
const anon = () => session.mockResolvedValue(null)
const as = (id: string, role: string) => {
  session.mockResolvedValue({ user: { email: `${id}@x.fr` } })
  db.operator.findUnique.mockResolvedValue({ id, role })
}
const dishOwnedBy = (operatorId: string) =>
  db.menuItem.findUnique.mockResolvedValue({ id: 'm1', brand: { operatorId } })

beforeEach(() => {
  vi.clearAllMocks()
  db.menuItem.update.mockResolvedValue({ id: 'm1', name: 'X', available: false })
  db.menuItem.delete.mockResolvedValue({ id: 'm1' })
})

describe('PUT /api/menu — owner-scoped (was unauthenticated)', () => {
  it('anonymous → 401, no update', async () => {
    anon()
    const res = await put({ id: 'm1', name: 'Hacked' })
    expect(res.status).toBe(401)
    expect(db.menuItem.update).not.toHaveBeenCalled()
  })
  it('consumer role → 403, no update', async () => {
    as('c1', 'consumer')
    const res = await put({ id: 'm1', name: 'Hacked' })
    expect(res.status).toBe(403)
    expect(db.menuItem.update).not.toHaveBeenCalled()
  })
  it('owner → 200, update runs', async () => {
    as('op1', 'restaurant'); dishOwnedBy('op1')
    const res = await put({ id: 'm1', name: 'New' })
    expect(res.status).toBe(200)
    expect(db.menuItem.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'm1' } }))
  })
  it('foreign operator → 404, NO update (IDOR closed)', async () => {
    as('op1', 'restaurant'); dishOwnedBy('op2')
    const res = await put({ id: 'm1', name: 'Hacked' })
    expect(res.status).toBe(404)
    expect(db.menuItem.update).not.toHaveBeenCalled()
  })
  it('admin → 200 even on a non-owned dish (superuser)', async () => {
    as('adm', 'admin'); dishOwnedBy('someone-else')
    const res = await put({ id: 'm1', name: 'New' })
    expect(res.status).toBe(200)
    expect(db.menuItem.update).toHaveBeenCalled()
  })
})

describe('DELETE /api/menu — owner-scoped (was unauthenticated)', () => {
  it('anonymous → 401, no delete', async () => {
    anon()
    const res = await del('m1')
    expect(res.status).toBe(401)
    expect(db.menuItem.delete).not.toHaveBeenCalled()
  })
  it('owner → 200, delete runs', async () => {
    as('op1', 'restaurant'); dishOwnedBy('op1')
    const res = await del('m1')
    expect(res.status).toBe(200)
    expect(db.menuItem.delete).toHaveBeenCalledWith({ where: { id: 'm1' } })
  })
  it('foreign operator → 404, NO delete (IDOR closed)', async () => {
    as('op1', 'restaurant'); dishOwnedBy('op2')
    const res = await del('m1')
    expect(res.status).toBe(404)
    expect(db.menuItem.delete).not.toHaveBeenCalled()
  })
  it('admin → 200 on a non-owned dish (superuser)', async () => {
    as('adm', 'admin'); dishOwnedBy('someone-else')
    const res = await del('m1')
    expect(res.status).toBe(200)
    expect(db.menuItem.delete).toHaveBeenCalled()
  })
})

describe('PATCH /api/menu/[id]/availability — cross-tenant now 404 (was 403)', () => {
  it('owner → 200, toggled', async () => {
    as('op1', 'restaurant'); dishOwnedBy('op1')
    const res = await avail('m1', false)
    expect(res.status).toBe(200)
    expect(db.menuItem.update).toHaveBeenCalled()
  })
  it('foreign operator → 404 (existence hidden), NO update', async () => {
    as('op1', 'restaurant'); dishOwnedBy('op2')
    const res = await avail('m1', false)
    expect(res.status).toBe(404)
    expect(db.menuItem.update).not.toHaveBeenCalled()
  })
  it('admin → 200 on a non-owned dish (superuser)', async () => {
    as('adm', 'admin'); dishOwnedBy('someone-else')
    const res = await avail('m1', true)
    expect(res.status).toBe(200)
    expect(db.menuItem.update).toHaveBeenCalled()
  })
})
