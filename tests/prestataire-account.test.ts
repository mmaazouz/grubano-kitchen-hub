import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── Prestataire onboarding (P1, Agent 74) — pure decision + auth bridge ────────
// A 1:1 clone of the supplier units, adapted to services. decidePrestataireOutcome is
// CONSERVATIVE (name-mismatch on a confirmed company → 'pending', never auto-active);
// combineVettingDecision can ONLY HARDEN; ensurePrestataireOperator is the passwordless
// bridge with multi-role cumul (role granted only on approval). isPrestataireEnabled is
// the role kill-switch (default OFF). NO money anywhere.

const { db } = vi.hoisted(() => ({
  db: {
    operator:     { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    operatorRole: { upsert: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import {
  decidePrestataireOutcome, combineVettingDecision, ensurePrestataireOperator, isPrestataireEnabled,
  type PrestataireDecision,
} from '@/lib/prestataire-account'
import type { BusinessVerificationResult } from '@/lib/business-verification'

const vres = (over: Partial<BusinessVerificationResult>): BusinessVerificationResult => ({
  outcome: 'review', officialName: null, reason: 'x', ...over,
})

describe('isPrestataireEnabled — role kill-switch (default OFF)', () => {
  afterEach(() => { delete process.env.PRESTATAIRE_ENABLED })
  it('OFF by default; only the exact string "true" enables', () => {
    delete process.env.PRESTATAIRE_ENABLED;       expect(isPrestataireEnabled()).toBe(false)
    process.env.PRESTATAIRE_ENABLED = 'TRUE';      expect(isPrestataireEnabled()).toBe(false)
    process.env.PRESTATAIRE_ENABLED = '1';         expect(isPrestataireEnabled()).toBe(false)
    process.env.PRESTATAIRE_ENABLED = 'true';      expect(isPrestataireEnabled()).toBe(true)
  })
})

describe('decidePrestataireOutcome — CONSERVATIVE (name-tolerant → pending, never auto-active)', () => {
  it('verified → active + verificationStatus verified', () => {
    const d = decidePrestataireOutcome(vres({ outcome: 'verified', officialName: 'ELEC PRO SARL' }))
    expect(d).toMatchObject({ status: 'active', verificationStatus: 'verified' })
  })
  it('NAME MISMATCH (rejected WITH an official name) → pending review, NOT auto-active (supplier posture)', () => {
    const d = decidePrestataireOutcome(vres({ outcome: 'rejected', officialName: 'ELEC PRO SARL', reason: 'Nom déclaré incohérent…' }))
    expect(d.status).toBe('pending')
    expect(d.verificationStatus).toBe('review')
  })
  it('SIREN not found / ceased (rejected with NO official name) → rejected', () => {
    const d = decidePrestataireOutcome(vres({ outcome: 'rejected', officialName: null, reason: 'SIREN introuvable…' }))
    expect(d).toMatchObject({ status: 'rejected', verificationStatus: 'rejected' })
  })
  it('FAIL-SAFE: review (registry/LLM incident) → pending, never auto-reject', () => {
    expect(decidePrestataireOutcome(vres({ outcome: 'review', officialName: null })).status).toBe('pending')
    expect(decidePrestataireOutcome(vres({ outcome: 'review', officialName: 'ELEC PRO SARL' })).status).toBe('pending')
  })
})

describe('combineVettingDecision — the LLM verdict can only HARDEN', () => {
  const active:   PrestataireDecision = { status: 'active',   verificationStatus: 'verified', reason: 'ok' }
  const pending:  PrestataireDecision = { status: 'pending',  verificationStatus: 'review',   reason: 'r' }
  const rejected: PrestataireDecision = { status: 'rejected', verificationStatus: 'rejected', reason: 'introuvable' }

  it('legit → registry decision UNCHANGED', () => {
    expect(combineVettingDecision(active, 'legit', 'x')).toEqual(active)
    expect(combineVettingDecision(pending, 'legit', 'x')).toEqual(pending)
    expect(combineVettingDecision(rejected, 'legit', 'x')).toEqual(rejected)
  })
  it('doubt → softens ONLY an auto-activation to pending; never blocks/escalates', () => {
    expect(combineVettingDecision(active, 'doubt', 'doute')).toEqual({ status: 'pending', verificationStatus: 'verified', reason: 'doute' })
    expect(combineVettingDecision(pending, 'doubt', 'x')).toEqual(pending)
    expect(combineVettingDecision(rejected, 'doubt', 'x')).toEqual(rejected)
  })
  it('bad → keeps a definitive registry rejection; otherwise human-review pending', () => {
    expect(combineVettingDecision(rejected, 'bad', 'x')).toEqual(rejected)
    expect(combineVettingDecision(active, 'bad', 'abus')).toEqual({ status: 'pending', verificationStatus: 'verified', reason: 'abus' })
    expect(combineVettingDecision(pending, 'bad', 'abus')).toEqual({ status: 'pending', verificationStatus: 'review', reason: 'abus' })
  })
  it('NEVER auto-approves a refusal: no verdict turns rejected/pending into active', () => {
    for (const v of ['legit', 'doubt', 'bad'] as const) {
      expect(combineVettingDecision(rejected, v, 'x').status).not.toBe('active')
      expect(combineVettingDecision(pending, v, 'x').status).not.toBe('active')
    }
  })
})

describe('ensurePrestataireOperator — passwordless bridge + multi-role cumul', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.operator.create.mockResolvedValue({ id: 'opNew' })
    db.operator.update.mockResolvedValue({})
    db.operatorRole.upsert.mockResolvedValue({})
  })

  it('register (activate:false) → pending prestataire, no password, role NOT yet granted', async () => {
    db.operator.findUnique.mockResolvedValue(null)
    const r = await ensurePrestataireOperator('p@x.fr', 'P', { activate: false })
    expect(r).toEqual({ ok: true, created: true, activated: false, roleAdded: false })
    const data = db.operator.create.mock.calls[0][0].data
    expect(data).toMatchObject({ role: 'prestataire', status: 'pending' })
    expect(data.password).toBeUndefined()
    expect(db.operatorRole.upsert).not.toHaveBeenCalled()
  })

  it('approval (activate:true) → active prestataire + role recorded in the SET', async () => {
    db.operator.findUnique.mockResolvedValue(null)
    const r = await ensurePrestataireOperator('p@x.fr', 'P', { activate: true })
    expect(r).toEqual({ ok: true, created: true, activated: true, roleAdded: true })
    expect(db.operator.create.mock.calls[0][0].data.status).toBe('active')
    expect(db.operatorRole.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { operatorId_role: { operatorId: 'opNew', role: 'prestataire' } },
    }))
  })

  it('CUMUL: an existing RESTAURANT account GAINS prestataire on approval; primary role/password untouched', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'opR', role: 'restaurant', status: 'active' })
    const r = await ensurePrestataireOperator('r@x.fr', 'R', { activate: true })
    expect(r).toEqual({ ok: true, created: false, activated: false, roleAdded: true })
    expect(db.operator.create).not.toHaveBeenCalled()
    expect(db.operator.update).not.toHaveBeenCalled() // primary role/status/password never touched
    expect(db.operatorRole.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { operatorId_role: { operatorId: 'opR', role: 'prestataire' } },
    }))
  })

  it('at registration (activate:false) an existing other-role account does NOT gain the role', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'opR', role: 'restaurant', status: 'active' })
    const r = await ensurePrestataireOperator('r@x.fr', 'R', { activate: false })
    expect(r).toEqual({ ok: true, created: false, activated: false, roleAdded: false })
    expect(db.operatorRole.upsert).not.toHaveBeenCalled()
  })

  it('best-effort: a DB error → { ok:false, reason:error }, no throw', async () => {
    db.operator.findUnique.mockRejectedValue(new Error('db down'))
    expect(await ensurePrestataireOperator('p@x.fr', 'P', { activate: true })).toEqual({ ok: false, reason: 'error' })
  })
})
