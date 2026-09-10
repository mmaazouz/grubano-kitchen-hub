// tests/claims-resolve-stuck-route.test.ts — CLAIMS batch 2, re-audit fix
//
// The stuck-money escape hatch shipped with its own bespoke authorization: it re-read
// `Operator.role` from the DB and required it to equal 'admin'. That LOOKED stricter than every
// other admin route. It was in fact broken: `scripts/server/provision-admin.js` grants admin by
// INSERTING an OperatorRole row and deliberately never touches `Operator.role`. So the only
// admin the project's own script creates was refused 403 here — while still being able to
// approve claims and move real money through /arbitrate. The one door added to unblock stuck
// money was closed to the only person who could walk through it.
import { describe, it, expect, beforeEach, vi } from 'vitest'

const { resolveAdminMock } = vi.hoisted(() => ({ resolveAdminMock: vi.fn() }))
vi.mock('@/lib/admin-guard', () => ({ resolveAdmin: resolveAdminMock }))

const { resolveStuckMock } = vi.hoisted(() => ({ resolveStuckMock: vi.fn() }))
vi.mock('@/lib/claims', () => ({ resolveStuckClaim: resolveStuckMock }))

const { auditMock } = vi.hoisted(() => ({ auditMock: vi.fn() }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: auditMock }))

import { POST } from '@/app/api/admin/claims/[id]/resolve-stuck/route'

/** Exactly what provision-admin.js produces: primary role untouched, admin granted by row. */
const PROMOTED_ADMIN = { id: 'op1', role: 'restaurant', name: 'Founder', email: 'founder@example.test' }

const post = (body: unknown) =>
  POST(
    new Request('https://app.grubano.com/api/admin/claims/cl1/resolve-stuck', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }) as never,
    { params: { id: 'cl1' } },
  )

beforeEach(() => {
  vi.clearAllMocks()
  resolveAdminMock.mockResolvedValue(PROMOTED_ADMIN)
  resolveStuckMock.mockResolvedValue({ ok: true, claim: { id: 'cl1', status: 'refused_final' } })
  auditMock.mockResolvedValue(undefined)
})

describe('RE-AUDIT FIX — the admin the project actually provisions can reach the hatch', () => {
  it('an operator whose PRIMARY role is restaurant but who holds the admin GRANT is accepted', async () => {
    const res = await post({ resolution: 'closed_no_payment' })
    expect(res.status).toBe(200)
    expect(resolveStuckMock).toHaveBeenCalledWith(expect.objectContaining({ claimId: 'cl1', adminId: 'op1' }))
  })

  it('NEGATIVE CONTROL — the old primary-column rule would have refused that same operator', () => {
    const oldRule = (o: { role: string }) => o.role === 'admin'
    expect(oldRule(PROMOTED_ADMIN)).toBe(false) // ← the defect the re-audit found
  })
})

describe('the guard is still a guard', () => {
  it('a non-admin is refused 403 and nothing is resolved', async () => {
    resolveAdminMock.mockResolvedValue(null)
    const res = await post({ resolution: 'closed_no_payment' })
    expect(res.status).toBe(403)
    expect(resolveStuckMock).not.toHaveBeenCalled()
  })

  it('authorization is resolved from the SESSION and the DB, never from the request body', async () => {
    resolveAdminMock.mockResolvedValue(null)
    const res = await post({ resolution: 'closed_no_payment', adminId: 'op1', role: 'admin' })
    expect(res.status).toBe(403)
    expect(resolveStuckMock).not.toHaveBeenCalled()
  })

  it('an invalid resolution is rejected before any state change', async () => {
    const res = await post({ resolution: 'refund_it_again' })
    expect(res.status).toBe(400)
    expect(resolveStuckMock).not.toHaveBeenCalled()
  })

  it('a resolution the lib refuses is passed through with ITS status, not a 200', async () => {
    resolveStuckMock.mockResolvedValue({ ok: false, status: 409, error: 'pas bloquée' })
    const res = await post({ resolution: 'settled_out_of_band' })
    expect(res.status).toBe(409)
  })
})

describe('the hatch records the decision and never claims to have moved money', () => {
  it('the audit entry states moneyMoved: false', async () => {
    await post({ resolution: 'settled_out_of_band', reason: 'virement manuel' })
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action:   'claim.resolve_stuck',
      actorId:  'op1',
      metadata: expect.objectContaining({ moneyMoved: false, resolution: 'settled_out_of_band' }),
    }))
  })

  it('a failing audit never turns a completed resolution into an error', async () => {
    auditMock.mockRejectedValue(new Error('audit table down'))
    const res = await post({ resolution: 'closed_no_payment' })
    expect(res.status).toBe(200)
  })
})
