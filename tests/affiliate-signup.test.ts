import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── lib/affiliate-signup — ensureAffiliateApplicant (Agent 118, incr. 1/3) ──
// The PRE-LOGIN bridge: provision a passwordless Operator BY EMAIL (active — affiliate is
// instant/no-vetting), then REUSE the existing idempotent ensureAffiliateOperator (mocked here)
// to grant the role + mint the Affiliate. It must NEVER fork the creation and NEVER touch money.

const { db, ensureOp, enabledFn } = vi.hoisted(() => ({
  db: { operator: { findUnique: vi.fn(), create: vi.fn() } },
  ensureOp: vi.fn(),
  enabledFn: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/affiliate-account', () => ({ isAffiliateEnabled: enabledFn, ensureAffiliateOperator: ensureOp }))

import { ensureAffiliateApplicant } from '@/lib/affiliate-signup'

const AFF_OK = { ok: true, created: true, roleAdded: true, affiliate: { operatorId: 'op1', referralCode: 'JEANX', referralLinkSlug: 'jeanx', status: 'active' } }

beforeEach(() => {
  vi.clearAllMocks()
  enabledFn.mockReturnValue(true)
  ensureOp.mockResolvedValue(AFF_OK)
})

describe('ensureAffiliateApplicant', () => {
  it('FLAG OFF → { ok:false, disabled }, never provisions nor creates an Affiliate', async () => {
    enabledFn.mockReturnValue(false)
    const res = await ensureAffiliateApplicant('jean@x.fr', 'Jean')
    expect(res).toEqual({ ok: false, reason: 'disabled' })
    expect(db.operator.findUnique).not.toHaveBeenCalled()
    expect(db.operator.create).not.toHaveBeenCalled()
    expect(ensureOp).not.toHaveBeenCalled()
  })

  it('fresh email → creates a PASSWORDLESS active Operator(role=affiliate) then delegates to ensureAffiliateOperator', async () => {
    db.operator.findUnique.mockResolvedValue(null)
    db.operator.create.mockResolvedValue({ id: 'opNew' })
    const res = await ensureAffiliateApplicant('jean@x.fr', 'Jean')
    const created = db.operator.create.mock.calls[0][0].data
    expect(created).toMatchObject({ name: 'Jean', email: 'jean@x.fr', role: 'affiliate', status: 'active' })
    expect('password' in created).toBe(false) // passwordless
    expect(ensureOp).toHaveBeenCalledWith('opNew')
    expect(res).toBe(AFF_OK)
  })

  it('existing email → REUSES the operator (no 2nd Operator) and delegates to ensureAffiliateOperator', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'op9' })
    await ensureAffiliateApplicant('jean@x.fr', 'Jean')
    expect(db.operator.create).not.toHaveBeenCalled()
    expect(ensureOp).toHaveBeenCalledWith('op9')
  })

  it('idempotence is delegated — a re-join returns ensureAffiliateOperator\'s result verbatim', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'op9' })
    ensureOp.mockResolvedValue({ ...AFF_OK, created: false })
    const res = await ensureAffiliateApplicant('jean@x.fr', 'Jean')
    expect(res).toMatchObject({ ok: true, created: false })
  })

  it('a provisioning DB error → { ok:false, error }, never calls ensureAffiliateOperator', async () => {
    db.operator.findUnique.mockRejectedValue(new Error('db down'))
    const res = await ensureAffiliateApplicant('jean@x.fr', 'Jean')
    expect(res).toEqual({ ok: false, reason: 'error' })
    expect(ensureOp).not.toHaveBeenCalled()
  })
})
