import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── B1.3-A — franchise approval wiring (Agent 30) ────────────────────────────
// POST /api/franchise/approve mirrors the supplier approval: admin-gated, grants
// the 'franchise' role via ensureFranchiseOperator (run for real here, with prisma
// + addRoleToOperator mocked), persists company identity, flips the application to
// 'approved'. These tests lock the security + idempotence + no-phantom-approval
// guarantees.

const { db } = vi.hoisted(() => ({
  db: {
    operator:             { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    franchiseApplication: { findUnique: vi.fn(), update: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { addRoleMock } = vi.hoisted(() => ({ addRoleMock: vi.fn() }))
vi.mock('@/lib/operator-roles', () => ({ addRoleToOperator: addRoleMock }))

const { setIdentityMock } = vi.hoisted(() => ({ setIdentityMock: vi.fn() }))
vi.mock('@/lib/operator-identity', () => ({ setVerifiedCompanyIdentity: setIdentityMock }))

import { POST } from '@/app/api/franchise/approve/route'

function post(body: Record<string, unknown>, user: { role?: string; roles?: string[] } | null) {
  sessionMock.mockResolvedValue(user ? { user } : null)
  return POST(new Request('https://app.grubano.com/api/franchise/approve', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  }))
}
const ADMIN = { role: 'admin' }

beforeEach(() => {
  vi.clearAllMocks()
  addRoleMock.mockResolvedValue(true)
  setIdentityMock.mockResolvedValue({})
  db.operator.create.mockResolvedValue({ id: 'op1' })
  db.operator.update.mockResolvedValue({})
  db.franchiseApplication.update.mockResolvedValue({})
})

describe('POST /api/franchise/approve', () => {
  it('(a) admin approves → fresh franchise Operator, role granted, identity verified, status approved', async () => {
    db.franchiseApplication.findUnique.mockResolvedValue({
      id: 'app1', email: 'Fr@X.com', name: 'Resto Co', siret: '123 456 789 00011', status: 'pending',
    })
    db.operator.findUnique.mockResolvedValue(null) // fresh email

    const res = await post({ applicationId: 'app1' }, ADMIN)
    expect(res.status).toBe(200)

    // fresh passwordless franchise account, normalized email
    expect(db.operator.create.mock.calls[0][0].data).toMatchObject({
      email: 'fr@x.com', role: 'franchise', status: 'active',
    })
    // role granted in the SET
    expect(addRoleMock).toHaveBeenCalledWith('op1', 'franchise')
    // company identity persisted (admin approval = manual verification)
    expect(setIdentityMock).toHaveBeenCalledWith('op1', expect.objectContaining({
      siren: '123456789', officialName: 'Resto Co', kybStatus: 'verified', kybVerifiedAt: expect.any(Date),
    }))
    // application marked approved
    expect(db.franchiseApplication.update).toHaveBeenCalledWith({ where: { id: 'app1' }, data: { status: 'approved' } })
  })

  it('(b) no session → 401, no writes', async () => {
    const res = await post({ applicationId: 'app1' }, null)
    expect(res.status).toBe(401)
    expect(db.franchiseApplication.findUnique).not.toHaveBeenCalled()
    expect(addRoleMock).not.toHaveBeenCalled()
    expect(db.franchiseApplication.update).not.toHaveBeenCalled()
  })

  it('(c) non-admin → 403, no writes (no IDOR, no self-approval)', async () => {
    const res = await post({ applicationId: 'app1' }, { role: 'restaurant' })
    expect(res.status).toBe(403)
    expect(db.franchiseApplication.findUnique).not.toHaveBeenCalled()
    expect(addRoleMock).not.toHaveBeenCalled()
    expect(db.franchiseApplication.update).not.toHaveBeenCalled()
  })

  it('(d) idempotent re-approval → no duplicate role, no error, status not rewritten', async () => {
    db.franchiseApplication.findUnique.mockResolvedValue({
      id: 'app1', email: 'fr@x.com', name: 'Resto Co', siret: null, status: 'approved',
    })
    db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'franchise', status: 'active' })

    const res = await post({ applicationId: 'app1' }, ADMIN)
    expect(res.status).toBe(200)
    expect(addRoleMock).toHaveBeenCalledTimes(1)
    expect(addRoleMock).toHaveBeenCalledWith('op1', 'franchise')
    expect(db.operator.create).not.toHaveBeenCalled()   // existing account, not recreated
    expect(db.operator.update).not.toHaveBeenCalled()   // already active
    expect(db.franchiseApplication.update).not.toHaveBeenCalled() // already approved
  })

  it('(e) role grant fails on an existing non-franchise account → 500, NO phantom approval', async () => {
    db.franchiseApplication.findUnique.mockResolvedValue({
      id: 'app1', email: 'fr@x.com', name: 'Resto Co', siret: null, status: 'pending',
    })
    db.operator.findUnique.mockResolvedValue({ id: 'op2', role: 'restaurant', status: 'active' })
    addRoleMock.mockResolvedValue(false) // OperatorRole upsert failed → role NOT in the SET

    const res = await post({ applicationId: 'app1' }, ADMIN)
    expect(res.status).toBe(500)
    expect(db.franchiseApplication.update).not.toHaveBeenCalled() // status stays 'pending'
    expect(setIdentityMock).not.toHaveBeenCalled()
  })

  it('(f) email normalized (case) → a single Operator looked up / created lowercase', async () => {
    db.franchiseApplication.findUnique.mockResolvedValue({
      id: 'app1', email: 'MixedCase@X.COM', name: 'Resto Co', siret: null, status: 'pending',
    })
    db.operator.findUnique.mockResolvedValue(null)

    const res = await post({ applicationId: 'app1' }, ADMIN)
    expect(res.status).toBe(200)
    expect(db.operator.findUnique.mock.calls[0][0].where).toEqual({ email: 'mixedcase@x.com' })
    expect(db.operator.create.mock.calls[0][0].data.email).toBe('mixedcase@x.com')
  })
})
