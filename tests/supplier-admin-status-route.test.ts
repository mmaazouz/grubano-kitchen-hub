import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ── POST /api/supplier/admin/status — admin moderation + SUSPEND (Agent 14) ───
// Admin-only. Sets the supplier BUSINESS status. 'active' also activates the
// passwordless login + grafts the role; 'suspended'/'rejected'/'pending' only set
// the profile status (→ hidden from discovery + payment blocked, both enforced
// elsewhere). Business status only — never touches money.

const { db, ensureOp, session } = vi.hoisted(() => ({
  db: { supplierProfile: { findUnique: vi.fn(), update: vi.fn() } },
  ensureOp: vi.fn(),
  session: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/supplier-account', () => ({ ensureSupplierOperator: ensureOp, isSupplierEnabled: () => process.env.SUPPLIER_ENABLED === 'true' }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('next-auth', () => ({ getServerSession: session }))

import { POST } from '@/app/api/supplier/admin/status/route'

// P0-06 — rôle(s) ouvert(s) pour ces tests : la surface est désormais derrière un
// flag de rôle (404 OFF — prouvé par tests/role-locks.test.ts) ; ici on teste la
// logique métier, donc on ouvre le rôle explicitement.
beforeEach(() => { process.env.SUPPLIER_ENABLED = 'true' })
afterEach(() => { delete process.env.SUPPLIER_ENABLED })

const post = (body: Record<string, unknown>) =>
  POST(new Request('http://x/api/supplier/admin/status', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }))

const PROFILE = { id: 'sp1', status: 'pending', email: 'm@x.fr', companyName: 'C', contactName: 'Nadia' }

beforeEach(() => {
  vi.clearAllMocks()
  db.supplierProfile.update.mockResolvedValue({})
  ensureOp.mockResolvedValue({ ok: true })
})

it('non-admin → 403, no write', async () => {
  session.mockResolvedValue({ user: { role: 'restaurant' } })
  const res = await post({ email: 'm@x.fr', status: 'suspended' })
  expect(res.status).toBe(403)
  expect(db.supplierProfile.update).not.toHaveBeenCalled()
})

describe('admin transitions', () => {
  beforeEach(() => { session.mockResolvedValue({ user: { role: 'admin' } }) })

  it('suspend → status suspended, NO login bridge', async () => {
    db.supplierProfile.findUnique.mockResolvedValue({ ...PROFILE, status: 'active' })
    const res = await post({ email: 'm@x.fr', status: 'suspended' })
    expect(res.status).toBe(200)
    expect(db.supplierProfile.update.mock.calls[0][0].data).toEqual({ status: 'suspended' })
    expect(ensureOp).not.toHaveBeenCalled()
  })

  it('activate → status active + login activated/role grafted', async () => {
    db.supplierProfile.findUnique.mockResolvedValue(PROFILE)
    const res = await post({ email: 'm@x.fr', status: 'active' })
    expect(res.status).toBe(200)
    expect(db.supplierProfile.update.mock.calls[0][0].data).toEqual({ status: 'active' })
    expect(ensureOp).toHaveBeenCalledWith('m@x.fr', 'Nadia', { activate: true })
  })

  it('reject → status rejected, NO bridge', async () => {
    db.supplierProfile.findUnique.mockResolvedValue(PROFILE)
    await post({ email: 'm@x.fr', status: 'rejected' })
    expect(db.supplierProfile.update.mock.calls[0][0].data).toEqual({ status: 'rejected' })
    expect(ensureOp).not.toHaveBeenCalled()
  })

  it('invalid status → 400', async () => {
    const res = await post({ email: 'm@x.fr', status: 'banished' })
    expect(res.status).toBe(400)
  })

  it('unknown supplier → 404', async () => {
    db.supplierProfile.findUnique.mockResolvedValue(null)
    const res = await post({ email: 'ghost@x.fr', status: 'active' })
    expect(res.status).toBe(404)
  })
})
