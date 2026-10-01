import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── POST /api/prestataire/register — LEAN signup (Agent 112) ───────────────────
// The registration now collects ONLY the identity: companyName + contactName + email +
// SIREN + consent. Status is decided by the SIREN registry ALONE (verifyBusiness →
// decidePrestataireOutcome) — the LLM COHERENCE check (vetPrestataire) NO LONGER runs at
// signup: it is DEPLACED to the service-publication trigger (lib/prestataire-coherence,
// tested in prestataire-coherence.test.ts). A fresh SIREN-verified prestataire is created
// status='active' but marketplaceCoherencePending=true (HIDDEN from the directory) until
// that check clears it — the anti-abuse is MOVED, never removed. FLAG GATE: PRESTATAIRE_ENABLED
// OFF (default) → 404. Anti-bot / duplicate / create-if-absent preserved. NO money. The REAL
// decidePrestataireOutcome + isPrestataireEnabled run.

const { db, ensureOp, verify, propagate } = vi.hoisted(() => ({
  db: { prestataireProfile: { findUnique: vi.fn(), create: vi.fn() } },
  ensureOp: vi.fn(),
  verify: vi.fn(),
  propagate: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/prestataire-account', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('@/lib/prestataire-account')
  return { ...actual, ensurePrestataireOperator: ensureOp }
})
vi.mock('@/lib/business-verification', () => ({ verifyBusiness: verify }))
vi.mock('@/lib/identity-propagation', () => ({ propagateVerifiedCompanyIdentity: propagate }))

import { POST } from '@/app/api/prestataire/register/route'

const BASE = {
  companyName: 'Elec Pro', contactName: 'Sami', email: 'S@ElecPro.fr', siren: '123456789',
  consent: true, formStartedAt: 0,
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

describe('FLAG ON → lean registration: SIREN registry ALONE decides the status', () => {
  it('VERIFIED → active + marketplaceCoherencePending=true (INVISIBLE) + vettingVerdict null; login activated', async () => {
    verify.mockResolvedValue({ outcome: 'verified', officialName: 'ELEC PRO SARL', reason: 'Vérifiée' })
    const res = await post()
    expect((await res.json()).outcome).toBe('active')
    const data = created()
    expect(data).toMatchObject({
      status: 'active', verificationStatus: 'verified', officialName: 'ELEC PRO SARL', siren: '123456789',
      // Lean signup: created active BUT hidden from the directory until the publication coherence
      // check clears it (the anti-abuse is moved, not removed).
      marketplaceCoherencePending: true,
      vettingVerdict: null,
      vettingAt: null,
    })
    expect(data.verifiedAt).toBeInstanceOf(Date)
    expect(ensureOp).toHaveBeenCalledWith('s@elecpro.fr', 'Sami', { activate: true })
    // SIREN registry verification UNCHANGED: declaredName + 9-digit SIREN…
    expect(verify.mock.calls[0][0]).toMatchObject({ siren: '123456789', declaredName: 'Elec Pro' })
    // …and NO serviceCategories (deferred — only auxiliary name-match context, judged later).
    expect('categories' in verify.mock.calls[0][0]).toBe(false)
  })

  it('CONSERVATIVE: name mismatch on a confirmed company → pending review, login NOT activated', async () => {
    verify.mockResolvedValue({ outcome: 'rejected', officialName: 'ELEC PRO SARL', reason: 'Nom incohérent' })
    const res = await post()
    expect((await res.json()).outcome).toBe('pending')
    const data = created()
    expect(data).toMatchObject({ status: 'pending', verificationStatus: 'review', officialName: 'ELEC PRO SARL' })
    expect(data.verifiedAt).toBeNull()
    expect(ensureOp).toHaveBeenCalledWith('s@elecpro.fr', 'Sami', { activate: false })
  })

  it('SIREN not found (no official name) → rejected, NO login', async () => {
    verify.mockResolvedValue({ outcome: 'rejected', officialName: null, reason: 'SIREN introuvable' })
    const res = await post()
    expect((await res.json()).outcome).toBe('rejected')
    expect(created()).toMatchObject({ status: 'rejected', verificationStatus: 'rejected' })
    expect(ensureOp).not.toHaveBeenCalled()
  })

  it('REVIEW (registry incident) → pending (fail-safe), login NOT activated', async () => {
    verify.mockResolvedValue({ outcome: 'review', officialName: null, reason: 'Registre indisponible' })
    const res = await post()
    expect((await res.json()).outcome).toBe('pending')
    expect(ensureOp).toHaveBeenCalledWith('s@elecpro.fr', 'Sami', { activate: false })
  })

  it('invalid SIREN (3 digits) → 400, no verify', async () => {
    const res = await post({ siren: '123' })
    expect(res.status).toBe(400)
    expect(verify).not.toHaveBeenCalled()
  })
})

// ── Lean signup: the OFFER fields are DEFERRED + the COHERENCE check is MOVED OUT ──────────
describe('Agent 112 — lean signup defers the offer + moves the coherence check', () => {
  it('the create OMITS phone/city/serviceCategories/coverageZones/modality/indicativeRate (schema defaults)', async () => {
    verify.mockResolvedValue({ outcome: 'verified', officialName: 'X', reason: 'ok' })
    await post()
    const data = created()
    expect('phone' in data).toBe(false)
    expect('city' in data).toBe(false)
    expect('serviceCategories' in data).toBe(false)
    expect('coverageZones' in data).toBe(false)
    expect('modality' in data).toBe(false)
    expect('indicativeRate' in data).toBe(false)
  })

  it('stale offer fields posted by a stale client are IGNORED (zod strips) — create still omits them', async () => {
    verify.mockResolvedValue({ outcome: 'verified', officialName: 'X', reason: 'ok' })
    await post({ phone: '0600000000', city: 'Lyon', serviceCategories: ['electricity'], coverageZones: ['Lyon'], modality: 'remote', indicativeRate: 'dès 80€/h' })
    const data = created()
    expect('serviceCategories' in data).toBe(false)
    expect('coverageZones' in data).toBe(false)
    expect('modality' in data).toBe(false)
    // the stale categories never reach verifyBusiness either (deferred to the publication trigger)
    expect('categories' in verify.mock.calls[0][0]).toBe(false)
  })

  it('the route NEVER vets at signup: no import of prestataire-vetting and no llmComplete (coherence moved out)', async () => {
    // PROOF the coherence check was DEPLACED (not deleted): the signup route no longer IMPORTS the
    // vetting module nor calls the LLM gateway. The anti-abuse now lives in lib/prestataire-coherence,
    // invoked at the service-publication trigger (see prestataire-coherence.test.ts). (Prose comments
    // may still mention "vetPrestataire", so we assert the absence of the IMPORT path.)
    const fs = await import('node:fs')
    const src = fs.readFileSync(new URL('../app/api/prestataire/register/route.ts', import.meta.url), 'utf8')
    expect(src).not.toContain('@/lib/prestataire-vetting')
    expect(src).not.toContain('llmComplete')
  })
})

describe('anti-bot + duplicate preserved (uniform neutral pending, NO verify/create)', () => {
  it('honeypot filled → pending, no verify, no create', async () => {
    const res = await post({ website: 'http://spam.example' })
    expect((await res.json()).outcome).toBe('pending')
    expect(verify).not.toHaveBeenCalled()
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
