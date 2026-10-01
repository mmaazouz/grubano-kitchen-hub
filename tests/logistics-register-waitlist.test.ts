import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── POST /api/logistics/register — DEFENSIVE WAITLIST (LA, Agent 72) ───────────
// Courier activation is gated OFF (LOGISTICS_COURIER_ACTIVATION_ENABLED). The page
// stays OPEN (candidates collected) but NO applicant becomes active: every fresh
// registration lands on the non-active 'pending' WAITLIST, the name-tolerant auto-
// activation is NEUTRALISED, and the login is provisioned with activate:false (never
// the active SET role). Anti-bot + anti-fingerprint + duplicate-neutral invariants are
// preserved. 100% off-money. Under flag ON (future) the prior activation is restored.
// The REAL decideLogisticsOutcome + applyCourierActivationGate + isCourierActivationEnabled
// run; only the side-effecting bridge + registry + identity copy are stubbed.

const { db, ensureOp, verify, propagate } = vi.hoisted(() => ({
  db: { logisticsProfile: { findUnique: vi.fn(), create: vi.fn() } },
  ensureOp: vi.fn(),
  verify: vi.fn(),
  propagate: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/logistics-account', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('@/lib/logistics-account')
  return { ...actual, ensureLogisticsOperator: ensureOp }
})
vi.mock('@/lib/business-verification', () => ({ verifyBusiness: verify }))
vi.mock('@/lib/identity-propagation', () => ({ propagateVerifiedCompanyIdentity: propagate }))

import { POST } from '@/app/api/logistics/register/route'

// P0-06 — rôle(s) ouvert(s) pour ces tests : la surface est désormais derrière un
// flag de rôle (404 OFF — prouvé par tests/role-locks.test.ts) ; ici on teste la
// logique métier, donc on ouvre le rôle explicitement.
beforeEach(() => { process.env.LOGISTICS_ENABLED = 'true' })
afterEach(() => { delete process.env.LOGISTICS_ENABLED })

const BASE = {
  partnerType: 'independent', contactName: 'Karim', contactEmail: 'K@Course.fr', siren: '123456789',
  missionTypes: ['repas'], vehicleTypes: ['velo'], zones: ['Lyon'], consent: true, formStartedAt: 0,
}
const post = (over: Record<string, unknown> = {}) =>
  POST(new Request('http://x/api/logistics/register', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...BASE, ...over }),
  }))
const created = () => db.logisticsProfile.create.mock.calls[0]?.[0]?.data

const ON  = () => { process.env.LOGISTICS_COURIER_ACTIVATION_ENABLED = 'true' }
const OFF = () => { delete process.env.LOGISTICS_COURIER_ACTIVATION_ENABLED }

beforeEach(() => {
  vi.clearAllMocks()
  OFF() // default: activation gated OFF → waitlist regime
  db.logisticsProfile.findUnique.mockResolvedValue(null) // fresh email
  db.logisticsProfile.create.mockResolvedValue({})
  ensureOp.mockResolvedValue({ ok: true })
  propagate.mockResolvedValue(undefined)
})
afterEach(() => { OFF() })

describe('flag OFF (default) → non-activating WAITLIST', () => {
  it('(a) a registry-VERIFIED courier (would-be active) → WAITLIST: status pending, login NOT activated, waitlist:true', async () => {
    verify.mockResolvedValue({ outcome: 'verified', officialName: 'TRANSPORT EXPRESS SARL', reason: 'ok' })
    const res = await post()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.outcome).toBe('pending')        // NOT 'active'
    expect(json.waitlist).toBe(true)
    expect(json.officialName).toBeUndefined()    // anti-enumeration: only echoed for 'active'
    expect(created()).toMatchObject({ status: 'pending', verificationStatus: 'verified' })
    expect(ensureOp).toHaveBeenCalledWith('k@course.fr', 'Karim', { activate: false }) // never activated
  })

  it('(b) AUTO-ACTIVE NEUTRALISED: name-mismatch on a confirmed company (auto-activated before) → WAITLIST now', async () => {
    verify.mockResolvedValue({ outcome: 'rejected', officialName: 'TRANSPORT EXPRESS SARL', reason: 'Nom déclaré incohérent…' })
    const res = await post()
    const json = await res.json()
    expect(json.outcome).toBe('pending') // would have been 'active' via the name-tolerant path
    expect(json.waitlist).toBe(true)
    expect(created().status).toBe('pending')
    expect(ensureOp).toHaveBeenCalledWith('k@course.fr', 'Karim', { activate: false })
  })

  it('(c) PAGE OPEN: registration still completes (200) and the candidate profile is created (waitlist)', async () => {
    verify.mockResolvedValue({ outcome: 'review', officialName: null, reason: 'en cours' })
    const res = await post()
    expect(res.status).toBe(200)
    expect(db.logisticsProfile.create).toHaveBeenCalled()
    expect(created().status).toBe('pending')
    expect((await res.json()).waitlist).toBe(true)
  })

  it('(d) HORS ARGENT: no Connect/payout is ever touched (the register only writes the profile + bridges the login)', async () => {
    verify.mockResolvedValue({ outcome: 'verified', officialName: 'X', reason: 'ok' })
    await post()
    // The only side effects are the profile create + the (non-activating) bridge + identity copy.
    // No payment/Connect model is even referenced (db only exposes logisticsProfile here).
    expect(Object.keys(db)).toEqual(['logisticsProfile'])
    expect(ensureOp.mock.calls[0][2]).toEqual({ activate: false })
  })

  it('(e) genuine registry rejection (bad SIREN) stays rejected, no login — not waitlisted', async () => {
    verify.mockResolvedValue({ outcome: 'rejected', officialName: null, reason: 'SIREN introuvable' })
    const res = await post()
    expect((await res.json()).outcome).toBe('rejected')
    expect(created().status).toBe('rejected')
    expect(ensureOp).not.toHaveBeenCalled()
  })
})

describe('anti-bot + duplicate preserved (uniform neutral pending, NO vet/create, waitlist:true)', () => {
  it('honeypot filled → pending, no verify, no create', async () => {
    const res = await post({ website: 'http://spam.example' })
    const json = await res.json()
    expect(json.outcome).toBe('pending')
    expect(json.waitlist).toBe(true)
    expect(verify).not.toHaveBeenCalled()
    expect(db.logisticsProfile.create).not.toHaveBeenCalled()
  })
  it('too-fast submit → pending, no verify', async () => {
    const res = await post({ formStartedAt: Date.now() })
    expect((await res.json()).outcome).toBe('pending')
    expect(verify).not.toHaveBeenCalled()
  })
  it('duplicate email → pending neutral, no verify, no create, login not activated', async () => {
    db.logisticsProfile.findUnique.mockResolvedValue({ id: 'lp1' })
    const res = await post()
    const json = await res.json()
    expect(json.outcome).toBe('pending')
    expect(json.waitlist).toBe(true)
    expect(verify).not.toHaveBeenCalled()
    expect(db.logisticsProfile.create).not.toHaveBeenCalled()
    expect(ensureOp).toHaveBeenCalledWith('k@course.fr', 'Karim', { activate: false })
  })
})

describe('flag ON (future, post-legal) → activation restored (reversible)', () => {
  beforeEach(() => ON())
  it('(f) a verified courier → active again; login activated; waitlist:false', async () => {
    verify.mockResolvedValue({ outcome: 'verified', officialName: 'TRANSPORT EXPRESS SARL', reason: 'ok' })
    const res = await post()
    const json = await res.json()
    expect(json.outcome).toBe('active')
    expect(json.waitlist).toBe(false)
    expect(created().status).toBe('active')
    expect(ensureOp).toHaveBeenCalledWith('k@course.fr', 'Karim', { activate: true })
  })
})
