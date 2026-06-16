import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Logistics onboarding (courier / delivery partner — Slice 1, Agent 15) ─────
// Two units, both calqued on the supplier flow:
//   1. decideLogisticsOutcome — NAME-TOLERANT mapping of a verifyBusiness() result.
//      A declared name that differs from the official registry name must NEVER
//      reject a courier; only a not-found / ceased SIREN (officialName=null) does.
//   2. ensureLogisticsOperator — the auth bridge: fresh email → passwordless
//      logistics Operator; an existing OTHER-role account GAINS the 'logistics' role
//      on activation WITHOUT touching its primary role/password (multi-role cumul).

const { db } = vi.hoisted(() => ({
  db: {
    operator:     { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    operatorRole: { upsert: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { decideLogisticsOutcome, ensureLogisticsOperator } from '@/lib/logistics-account'
import type { BusinessVerificationResult } from '@/lib/business-verification'

const result = (over: Partial<BusinessVerificationResult>): BusinessVerificationResult => ({
  outcome: 'review', officialName: null, reason: 'x', ...over,
})

describe('decideLogisticsOutcome — NAME-TOLERANT gating', () => {
  it('verified → active + verificationStatus verified', () => {
    const d = decideLogisticsOutcome(result({ outcome: 'verified', officialName: 'TRANSPORT EXPRESS SARL' }))
    expect(d.status).toBe('active')
    expect(d.verificationStatus).toBe('verified')
  })

  it('NAME MISMATCH (rejected WITH an official name) → active, NOT rejected (declared name is a display name)', () => {
    // verifyBusiness rejects on a clear name mismatch but still returns the registry
    // officialName → the company EXISTS and is ACTIVE. A courier must not be rejected.
    const d = decideLogisticsOutcome(result({ outcome: 'rejected', officialName: 'TRANSPORT EXPRESS SARL', reason: 'Nom déclaré incohérent…' }))
    expect(d.status).toBe('active')
    expect(d.verificationStatus).toBe('verified')
  })

  it('SIREN not found / ceased (rejected with NO official name) → rejected', () => {
    const d = decideLogisticsOutcome(result({ outcome: 'rejected', officialName: null, reason: 'SIREN introuvable…' }))
    expect(d.status).toBe('rejected')
    expect(d.verificationStatus).toBe('rejected')
  })

  it('FAIL-SAFE: review (registry/LLM incident) → pending, never auto-reject', () => {
    const d = decideLogisticsOutcome(result({ outcome: 'review', officialName: null }))
    expect(d.status).toBe('pending')
    expect(d.verificationStatus).toBe('review')
  })

  it('FAIL-SAFE: review even with an official name (LLM down on an active company) → pending', () => {
    const d = decideLogisticsOutcome(result({ outcome: 'review', officialName: 'TRANSPORT EXPRESS SARL' }))
    expect(d.status).toBe('pending')
  })
})

describe('ensureLogisticsOperator — auth bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.operator.create.mockResolvedValue({ id: 'opNew' })
    db.operator.update.mockResolvedValue({})
    db.operatorRole.upsert.mockResolvedValue({})
  })

  it('fresh email + register (activate:false) → pending logistics, no password, role NOT yet granted', async () => {
    db.operator.findUnique.mockResolvedValue(null)
    const r = await ensureLogisticsOperator('l@x.fr', 'L', { activate: false })
    expect(r).toEqual({ ok: true, created: true, activated: false, roleAdded: false })
    const data = db.operator.create.mock.calls[0][0].data
    expect(data).toMatchObject({ role: 'logistics', status: 'pending' })
    expect(data.password).toBeUndefined()
    expect(db.operatorRole.upsert).not.toHaveBeenCalled() // role only on activation
  })

  it('fresh email + activation (activate:true) → active logistics + role recorded in the SET', async () => {
    db.operator.findUnique.mockResolvedValue(null)
    const r = await ensureLogisticsOperator('l@x.fr', 'L', { activate: true })
    expect(r).toEqual({ ok: true, created: true, activated: true, roleAdded: true })
    expect(db.operator.create.mock.calls[0][0].data.status).toBe('active')
    expect(db.operatorRole.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { operatorId_role: { operatorId: 'opNew', role: 'logistics' } },
    }))
  })

  it('existing ANOTHER-role account (restaurant) GAINS logistics on activation; primary untouched', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'opR', role: 'restaurant', status: 'active' })
    const r = await ensureLogisticsOperator('r@x.fr', 'R', { activate: true })
    expect(r).toEqual({ ok: true, created: false, activated: false, roleAdded: true })
    expect(db.operator.create).not.toHaveBeenCalled()
    expect(db.operator.update).not.toHaveBeenCalled()
    expect(db.operatorRole.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { operatorId_role: { operatorId: 'opR', role: 'logistics' } },
    }))
  })

  it('existing supplier becomes ALSO logistics (multi-role cumul) — primary role/password kept', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'opS', role: 'supplier', status: 'active' })
    const r = await ensureLogisticsOperator('s@x.fr', 'S', { activate: true })
    expect(r.ok).toBe(true)
    expect(db.operator.update).not.toHaveBeenCalled()
    expect(db.operatorRole.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { operatorId_role: { operatorId: 'opS', role: 'logistics' } },
    }))
  })

  it('existing PRIMARY logistics pending → activated on approval (never downgrades)', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'opL', role: 'logistics', status: 'pending' })
    const r = await ensureLogisticsOperator('l@x.fr', 'L', { activate: true })
    expect(r).toEqual({ ok: true, created: false, activated: true, roleAdded: true })
    expect(db.operator.update).toHaveBeenCalledWith({ where: { id: 'opL' }, data: { status: 'active' } })
  })

  it('best-effort: a DB error → { ok:false, reason:error }, no throw', async () => {
    db.operator.findUnique.mockRejectedValue(new Error('db down'))
    expect(await ensureLogisticsOperator('l@x.fr', 'L', { activate: true })).toEqual({ ok: false, reason: 'error' })
  })
})
