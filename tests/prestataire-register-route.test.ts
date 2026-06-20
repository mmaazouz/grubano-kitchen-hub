import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── POST /api/prestataire/register (P1, Agent 74) — clone of supplier register ──
// FLAG GATE: PRESTATAIRE_ENABLED OFF (default) → 404 (the role does not exist). ON → a
// company is verified against the registry (verifyBusiness) + LLM-vetted, with the
// CONSERVATIVE supplier posture (name-mismatch → pending, never auto-active; vetting can
// only HARDEN). Anti-bot + anti-fingerprint + create-if-absent preserved. NO money.
// The REAL decidePrestataireOutcome + combineVettingDecision + isPrestataireEnabled run.

const { db, ensureOp, verify, vet, propagate } = vi.hoisted(() => ({
  db: { prestataireProfile: { findUnique: vi.fn(), create: vi.fn() } },
  ensureOp: vi.fn(),
  verify: vi.fn(),
  vet: vi.fn(),
  propagate: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/prestataire-account', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('@/lib/prestataire-account')
  return { ...actual, ensurePrestataireOperator: ensureOp }
})
vi.mock('@/lib/business-verification', () => ({ verifyBusiness: verify }))
vi.mock('@/lib/prestataire-vetting', () => ({ vetPrestataire: vet }))
vi.mock('@/lib/identity-propagation', () => ({ propagateVerifiedCompanyIdentity: propagate }))

import { POST } from '@/app/api/prestataire/register/route'

const BASE = {
  companyName: 'Elec Pro', contactName: 'Sami', email: 'S@ElecPro.fr', siren: '123456789',
  serviceCategories: ['electricity'], coverageZones: ['Lyon'], modality: 'on_site', consent: true, formStartedAt: 0,
}
const post = (over: Record<string, unknown> = {}) =>
  POST(new Request('http://x/api/prestataire/register', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...BASE, ...over }),
  }))
const created = () => db.prestataireProfile.create.mock.calls[0]?.[0]?.data

const ON  = () => { process.env.PRESTATAIRE_ENABLED = 'true' }
const OFF = () => { delete process.env.PRESTATAIRE_ENABLED }

beforeEach(() => {
  vi.clearAllMocks()
  ON() // default-ON for the behavioural cases; the OFF case toggles it
  db.prestataireProfile.findUnique.mockResolvedValue(null)
  db.prestataireProfile.create.mockResolvedValue({})
  ensureOp.mockResolvedValue({ ok: true })
  vet.mockResolvedValue({ verdict: 'legit', reason: 'Entreprise cohérente' })
  propagate.mockResolvedValue(undefined)
})
afterEach(() => { OFF() })

describe('FLAG OFF (default) → the role does not exist', () => {
  it('PRESTATAIRE_ENABLED OFF → 404, no verify, no create', async () => {
    OFF()
    const res = await post()
    expect(res.status).toBe(404)
    expect(verify).not.toHaveBeenCalled()
    expect(db.prestataireProfile.create).not.toHaveBeenCalled()
  })
})

describe('FLAG ON → registry + vetting decide (conservative)', () => {
  it('(a) VERIFIED company → active, profile created, vettingVerdict persisted, login activated', async () => {
    verify.mockResolvedValue({ outcome: 'verified', officialName: 'ELEC PRO SARL', reason: 'Vérifiée' })
    const res = await post()
    expect((await res.json()).outcome).toBe('active')
    const data = created()
    expect(data).toMatchObject({ status: 'active', verificationStatus: 'verified', officialName: 'ELEC PRO SARL', siren: '123456789', vettingVerdict: 'legit' })
    expect(data.verifiedAt).toBeInstanceOf(Date)
    expect(ensureOp).toHaveBeenCalledWith('s@elecpro.fr', 'Sami', { activate: true })
    expect(verify.mock.calls[0][0]).toMatchObject({ siren: '123456789', declaredName: 'Elec Pro' })
  })

  it('(b) CONSERVATIVE: name mismatch on a confirmed company → pending review, login NOT activated', async () => {
    verify.mockResolvedValue({ outcome: 'rejected', officialName: 'ELEC PRO SARL', reason: 'Nom incohérent' })
    const res = await post()
    expect((await res.json()).outcome).toBe('pending')
    const data = created()
    expect(data).toMatchObject({ status: 'pending', verificationStatus: 'review', officialName: 'ELEC PRO SARL' })
    expect(data.verifiedAt).toBeNull()
    expect(ensureOp).toHaveBeenCalledWith('s@elecpro.fr', 'Sami', { activate: false })
  })

  it('(c) VETTING bad on a registry-confirmed company → pending; NO auto-activation', async () => {
    verify.mockResolvedValue({ outcome: 'verified', officialName: 'ELEC PRO SARL', reason: 'ok' })
    vet.mockResolvedValue({ verdict: 'bad', reason: 'Contenu incohérent' })
    const res = await post()
    expect((await res.json()).outcome).toBe('pending')
    expect(created()).toMatchObject({ status: 'pending', vettingVerdict: 'bad' })
    expect(ensureOp).toHaveBeenCalledWith('s@elecpro.fr', 'Sami', { activate: false })
  })

  it('(c2) VETTING doubt → pending, registration NOT blocked', async () => {
    verify.mockResolvedValue({ outcome: 'verified', officialName: 'ELEC PRO SARL', reason: 'ok' })
    vet.mockResolvedValue({ verdict: 'doubt', reason: 'Activité peu claire' })
    const res = await post()
    expect(res.status).toBe(200)
    expect((await res.json()).outcome).toBe('pending')
  })

  it('(c3) FAIL-SAFE: vetPrestataire throws → treated as doubt → pending; registration completes', async () => {
    verify.mockResolvedValue({ outcome: 'verified', officialName: 'ELEC PRO SARL', reason: 'ok' })
    vet.mockRejectedValue(new Error('llm exploded'))
    const res = await post()
    expect(res.status).toBe(200)
    expect((await res.json()).outcome).toBe('pending')
    expect(ensureOp).toHaveBeenCalledWith('s@elecpro.fr', 'Sami', { activate: false })
  })

  it('(d) SIREN not found (no official name) → rejected, NO login', async () => {
    verify.mockResolvedValue({ outcome: 'rejected', officialName: null, reason: 'SIREN introuvable' })
    const res = await post()
    expect((await res.json()).outcome).toBe('rejected')
    expect(created()).toMatchObject({ status: 'rejected', verificationStatus: 'rejected' })
    expect(ensureOp).not.toHaveBeenCalled()
  })

  it('NEVER auto-approves a refusal: registry rejected + vetting legit → stays rejected', async () => {
    verify.mockResolvedValue({ outcome: 'rejected', officialName: null, reason: 'SIREN introuvable' })
    vet.mockResolvedValue({ verdict: 'legit', reason: 'semble ok' })
    const res = await post()
    expect((await res.json()).outcome).toBe('rejected')
    expect(ensureOp).not.toHaveBeenCalled()
  })

  it('invalid SIREN (3 digits) → 400, no verify', async () => {
    const res = await post({ siren: '123' })
    expect(res.status).toBe(400)
    expect(verify).not.toHaveBeenCalled()
  })
})

describe('anti-bot + duplicate preserved (uniform neutral pending, NO vet/create)', () => {
  it('honeypot filled → pending, no verify, no create', async () => {
    const res = await post({ website: 'http://spam.example' })
    expect((await res.json()).outcome).toBe('pending')
    expect(verify).not.toHaveBeenCalled()
    expect(vet).not.toHaveBeenCalled()
    expect(db.prestataireProfile.create).not.toHaveBeenCalled()
  })
  it('too-fast submit → pending, no verify', async () => {
    const res = await post({ formStartedAt: Date.now() })
    expect((await res.json()).outcome).toBe('pending')
    expect(verify).not.toHaveBeenCalled()
  })
  it('duplicate email → pending, no verify, no create, login not activated', async () => {
    db.prestataireProfile.findUnique.mockResolvedValue({ id: 'pp1' })
    const res = await post()
    expect((await res.json()).outcome).toBe('pending')
    expect(verify).not.toHaveBeenCalled()
    expect(db.prestataireProfile.create).not.toHaveBeenCalled()
    expect(ensureOp).toHaveBeenCalledWith('s@elecpro.fr', 'Sami', { activate: false })
  })
})
