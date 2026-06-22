import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── POST /api/supplier/register — automatic business-identity verification ─────
// A FRESH registration is verified against the official registry (+ LLM name match)
// via verifyBusiness, then re-interpreted NAME-TOLERANTLY (decideSupplierOutcome,
// P2): verified → 'active' (login activated); rejected WITH an officialName (name
// mismatch on a confirmed active company) → 'pending' (human review, login NOT
// activated, never auto-rejected); rejected with NO officialName (not-found/ceased)
// → 'rejected' (no login); review → 'pending'. Anti-bot (honeypot / too-fast) and a
// duplicate email never verify, never write, and return the neutral 'pending'.

const { db, ensureOp, verify, vet } = vi.hoisted(() => ({
  db: { supplierProfile: { findUnique: vi.fn(), create: vi.fn() } },
  ensureOp: vi.fn(),
  verify: vi.fn(),
  vet: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
// Keep the REAL decideSupplierOutcome + combineVettingDecision (pure) so the route test
// exercises the actual decision + conservative-combination logic; only the side-effecting
// auth bridge is stubbed.
vi.mock('@/lib/supplier-account', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('@/lib/supplier-account')
  return { ...actual, ensureSupplierOperator: ensureOp }
})
vi.mock('@/lib/business-verification', () => ({ verifyBusiness: verify }))
// S2 — the LLM trust-&-safety vetting is mocked (no real LLM in tests). Default 'legit'
// → the registry decision stands, so the registry-only assertions below are byte-identical.
vi.mock('@/lib/supplier-vetting', () => ({ vetSupplier: vet }))

import { POST } from '@/app/api/supplier/register/route'

const BASE = {
  companyName: 'Primeurs Lyon', contactName: 'Marie', email: 'M@Primeurs.fr', siren: '123456789',
  categories: ['fresh'], deliveryZones: ['Lyon'], minimumOrderEur: 50, leadTimeDays: 1,
  consent: true, formStartedAt: 0, // 0 → submitted "long ago", not too-fast
}
const post = (over: Record<string, unknown> = {}) =>
  POST(new Request('http://x/api/supplier/register', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...BASE, ...over }),
  }))

beforeEach(() => {
  vi.clearAllMocks()
  db.supplierProfile.findUnique.mockResolvedValue(null) // default: fresh email
  db.supplierProfile.create.mockResolvedValue({})
  ensureOp.mockResolvedValue({ ok: true })
  vet.mockResolvedValue({ verdict: 'legit', reason: 'Entreprise cohérente' }) // default: no hardening
})

describe('fresh registration → registry verification decides the status', () => {
  it('VERIFIED → status active (+ siren/officialName/verifiedAt), login activated, outcome active', async () => {
    verify.mockResolvedValue({ outcome: 'verified', officialName: 'PRIMEURS LYON SARL', reason: 'Entreprise vérifiée' })
    const res = await post()
    expect((await res.json()).outcome).toBe('active')
    const data = db.supplierProfile.create.mock.calls[0][0].data
    expect(data).toMatchObject({
      status: 'active', verificationStatus: 'verified', officialName: 'PRIMEURS LYON SARL',
      siren: '123456789', email: 'm@primeurs.fr',
    })
    expect(data.verifiedAt).toBeInstanceOf(Date)
    expect(data.vettingVerdict).toBe('legit') // S2 — the verdict is persisted
    expect(ensureOp).toHaveBeenCalledWith('m@primeurs.fr', 'Marie', { activate: true })
    // verifyBusiness got the derived 9-digit SIREN + declared name
    expect(verify.mock.calls[0][0]).toMatchObject({ siren: '123456789', declaredName: 'Primeurs Lyon' })
  })

  it('REVIEW → status pending, login NOT activated, outcome pending', async () => {
    verify.mockResolvedValue({ outcome: 'review', officialName: null, reason: 'Vérification en cours' })
    const res = await post()
    expect((await res.json()).outcome).toBe('pending')
    expect(db.supplierProfile.create.mock.calls[0][0].data).toMatchObject({ status: 'pending', verificationStatus: 'review' })
    expect(ensureOp).toHaveBeenCalledWith('m@primeurs.fr', 'Marie', { activate: false })
  })

  it('REJECTED (SIREN not found / ceased, NO official name) → status rejected, NO login, outcome rejected', async () => {
    verify.mockResolvedValue({ outcome: 'rejected', officialName: null, reason: 'SIREN introuvable' })
    const res = await post()
    expect((await res.json()).outcome).toBe('rejected')
    expect(db.supplierProfile.create.mock.calls[0][0].data).toMatchObject({ status: 'rejected', verificationStatus: 'rejected' })
    expect(ensureOp).not.toHaveBeenCalled()
  })

  it('NAME MISMATCH (rejected WITH an official name) → pending review, login NOT activated, NEVER auto-rejected', async () => {
    // Real + active company, commercial name ≠ legal name: name-tolerant → pending.
    verify.mockResolvedValue({ outcome: 'rejected', officialName: 'PRIMEURS LYON SARL', reason: 'Nom déclaré incohérent…' })
    const res = await post()
    expect((await res.json()).outcome).toBe('pending')
    const data = db.supplierProfile.create.mock.calls[0][0].data
    expect(data).toMatchObject({ status: 'pending', verificationStatus: 'review', officialName: 'PRIMEURS LYON SARL' })
    expect(data.verifiedAt).toBeNull()
    expect(ensureOp).toHaveBeenCalledWith('m@primeurs.fr', 'Marie', { activate: false })
  })

  it('FAIL-SAFE: a registry/LLM incident surfaces as review → pending, never active', async () => {
    verify.mockResolvedValue({ outcome: 'review', officialName: null, reason: 'Registre indisponible' })
    const res = await post()
    expect((await res.json()).outcome).toBe('pending')
    expect(ensureOp).toHaveBeenCalledWith('m@primeurs.fr', 'Marie', { activate: false })
  })

  it('accepts a 14-digit SIRET and derives the 9-digit SIREN', async () => {
    verify.mockResolvedValue({ outcome: 'verified', officialName: 'X', reason: 'ok' })
    await post({ siren: '12345678900012' })
    expect(verify.mock.calls[0][0].siren).toBe('123456789')
  })
})

describe('S2 — LLM vetting only HARDENS the onboarding decision (never money)', () => {
  beforeEach(() => {
    // Registry says VERIFIED (would be 'active') for this whole block; the vetting verdict
    // is what varies — proving it can only make the gate more prudent, never the reverse.
    verify.mockResolvedValue({ outcome: 'verified', officialName: 'PRIMEURS LYON SARL', reason: 'Entreprise vérifiée' })
  })

  it('(a) legit → follows the registry (active); verdict persisted', async () => {
    vet.mockResolvedValue({ verdict: 'legit', reason: 'ok' })
    const res = await post()
    expect((await res.json()).outcome).toBe('active')
    const data = db.supplierProfile.create.mock.calls[0][0].data
    expect(data).toMatchObject({ status: 'active', vettingVerdict: 'legit', verificationStatus: 'verified' })
    expect(ensureOp).toHaveBeenCalledWith('m@primeurs.fr', 'Marie', { activate: true })
    // vetSupplier received the registration fields (owner/legitimacy signal)
    expect(vet.mock.calls[0][0]).toMatchObject({ companyName: 'Primeurs Lyon', categories: ['fresh'] })
  })

  it('(b) bad on a registry-confirmed company → NEVER auto-active: pending review, login NOT activated', async () => {
    vet.mockResolvedValue({ verdict: 'bad', reason: 'Contenu incohérent' })
    const res = await post()
    expect((await res.json()).outcome).toBe('pending')
    const data = db.supplierProfile.create.mock.calls[0][0].data
    expect(data).toMatchObject({ status: 'pending', vettingVerdict: 'bad', vettingReason: 'Contenu incohérent' })
    // registry identity stays the registry's own verdict (unchanged by vetting)
    expect(data.verificationStatus).toBe('verified')
    expect(ensureOp).toHaveBeenCalledWith('m@primeurs.fr', 'Marie', { activate: false })
  })

  it('(c) doubt → pending review, registration NOT blocked, login NOT activated', async () => {
    vet.mockResolvedValue({ verdict: 'doubt', reason: 'Activité peu claire' })
    const res = await post()
    expect(res.status).toBe(200)
    expect((await res.json()).outcome).toBe('pending')
    const data = db.supplierProfile.create.mock.calls[0][0].data
    expect(data).toMatchObject({ status: 'pending', vettingVerdict: 'doubt' })
    expect(ensureOp).toHaveBeenCalledWith('m@primeurs.fr', 'Marie', { activate: false })
  })

  it('(d) FAIL-SAFE: vetSupplier throws → treated as doubt → pending; registration completes, never auto-reject/auto-activate', async () => {
    vet.mockRejectedValue(new Error('llm exploded'))
    const res = await post()
    // The call-site .catch falls back to 'doubt' → registration COMPLETES (no crash), and a
    // registry-active company is routed to human-review pending (never rejected, never active).
    expect(res.status).toBe(200)
    expect((await res.json()).outcome).toBe('pending')
    expect(db.supplierProfile.create.mock.calls[0][0].data).toMatchObject({ status: 'pending', vettingVerdict: 'doubt' })
    expect(ensureOp).toHaveBeenCalledWith('m@primeurs.fr', 'Marie', { activate: false })
  })

  it('(e) NEVER auto-approve a refusal: registry rejected + vetting legit → stays rejected', async () => {
    verify.mockResolvedValue({ outcome: 'rejected', officialName: null, reason: 'SIREN introuvable' })
    vet.mockResolvedValue({ verdict: 'legit', reason: 'semble ok' })
    const res = await post()
    expect((await res.json()).outcome).toBe('rejected')
    expect(db.supplierProfile.create.mock.calls[0][0].data).toMatchObject({ status: 'rejected', vettingVerdict: 'legit' })
    expect(ensureOp).not.toHaveBeenCalled() // no login for a registry rejection
  })

  it('(f) bad + registry rejected → rejected (both negative), no login', async () => {
    verify.mockResolvedValue({ outcome: 'rejected', officialName: null, reason: 'SIREN introuvable' })
    vet.mockResolvedValue({ verdict: 'bad', reason: 'spam' })
    const res = await post()
    expect((await res.json()).outcome).toBe('rejected')
    expect(ensureOp).not.toHaveBeenCalled()
  })

  it('(g) PLAFOND LLM: the route NEVER calls llmComplete directly — vetting goes through the capped gateway', async () => {
    // The route imports vetSupplier (which alone calls the capped llmComplete). It must not
    // bypass the cap by calling the gateway itself.
    const fs = await import('node:fs')
    const src = fs.readFileSync(new URL('../app/api/supplier/register/route.ts', import.meta.url), 'utf8')
    expect(src).toContain('vetSupplier')
    expect(src).not.toContain('llmComplete')
  })
})

describe('anti-bot + duplicate never verify / never write (neutral pending)', () => {
  it('honeypot filled → pending, no verify, NO LLM vetting, no create', async () => {
    const res = await post({ website: 'http://spam.example' })
    expect((await res.json()).outcome).toBe('pending')
    expect(verify).not.toHaveBeenCalled()
    expect(vet).not.toHaveBeenCalled() // S2 — bot traffic never burns an LLM call
    expect(db.supplierProfile.create).not.toHaveBeenCalled()
  })

  it('too-fast submit → pending, no verify, NO LLM vetting', async () => {
    const res = await post({ formStartedAt: Date.now() }) // < 2s ago
    expect((await res.json()).outcome).toBe('pending')
    expect(verify).not.toHaveBeenCalled()
    expect(vet).not.toHaveBeenCalled() // S2 — too-fast bot never burns an LLM call
  })

  it('duplicate email → pending, no verify, NO LLM vetting, no create, login not activated', async () => {
    db.supplierProfile.findUnique.mockResolvedValue({ id: 'sp1' })
    const res = await post()
    expect((await res.json()).outcome).toBe('pending')
    expect(verify).not.toHaveBeenCalled()
    expect(vet).not.toHaveBeenCalled() // S2 — a re-post never re-vets (no clobber, no LLM)
    expect(db.supplierProfile.create).not.toHaveBeenCalled()
    expect(ensureOp).toHaveBeenCalledWith('m@primeurs.fr', 'Marie', { activate: false })
  })

  it('invalid SIREN (3 digits) → 400, no verify', async () => {
    const res = await post({ siren: '123' })
    expect(res.status).toBe(400)
    expect(verify).not.toHaveBeenCalled()
  })

  it('invalid body (no consent) → 400, no verify', async () => {
    const res = await post({ consent: false })
    expect(res.status).toBe(400)
    expect(verify).not.toHaveBeenCalled()
  })
})

// ── Agent 109 — LEAN signup: phone / minimumOrderEur / leadTimeDays DEFERRED ───────────
// The supplier registration no longer collects phone / minimum-order / lead-time (deferred to
// /supplier/dashboard/profil). They are NOT inputs to verifyBusiness / vetSupplier → the SIREN
// verification + vetting + status decision stay BYTE-IDENTICAL. The create omits them so Prisma
// uses the schema defaults (minimumOrderCents @default(0), leadTimeDays @default(1)); phone → null.
describe('Agent 109 — lean signup (deferred operational fields)', () => {
  // A lean payload: NO phone / minimumOrderEur / leadTimeDays. The 4 vetting-input fields
  // (categories, city, deliveryZones, paymentTerms) are KEPT (they feed verifyBusiness/vetSupplier).
  const LEAN = {
    companyName: 'Primeurs Lyon', contactName: 'Marie', email: 'M@Primeurs.fr', siren: '123456789',
    categories: ['fresh'], deliveryZones: ['Lyon'], city: 'Lyon', paymentTerms: 'Net 30',
    consent: true, formStartedAt: 0,
  }
  const postLean = (over: Record<string, unknown> = {}) =>
    POST(new Request('http://x/api/supplier/register', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...LEAN, ...over }),
    }))

  it('(a) lean payload creates a valid SupplierProfile WITHOUT phone/minimumOrderCents/leadTimeDays (schema defaults apply)', async () => {
    verify.mockResolvedValue({ outcome: 'verified', officialName: 'PRIMEURS LYON SARL', reason: 'ok' })
    const res = await postLean()
    expect(res.status).toBe(200)
    expect((await res.json()).outcome).toBe('active')
    const data = db.supplierProfile.create.mock.calls[0][0].data
    // Required fields present; deferred fields OMITTED → Prisma falls back to @default / null.
    expect(data).toMatchObject({ email: 'm@primeurs.fr', companyName: 'Primeurs Lyon', contactName: 'Marie', status: 'active' })
    expect('phone' in data).toBe(false)
    expect('minimumOrderCents' in data).toBe(false)
    expect('leadTimeDays' in data).toBe(false)
    expect(ensureOp).toHaveBeenCalledWith('m@primeurs.fr', 'Marie', { activate: true })
  })

  it('(b) SIREN/vetting inputs UNCHANGED: verifyBusiness gets categories; vetSupplier gets the 4 kept fields', async () => {
    verify.mockResolvedValue({ outcome: 'verified', officialName: 'PRIMEURS LYON SARL', reason: 'ok' })
    await postLean()
    expect(verify.mock.calls[0][0]).toMatchObject({ siren: '123456789', declaredName: 'Primeurs Lyon', categories: ['fresh'] })
    expect(vet.mock.calls[0][0]).toMatchObject({
      companyName: 'Primeurs Lyon', contactName: 'Marie', city: 'Lyon', categories: ['fresh'],
      deliveryZones: ['Lyon'], paymentTerms: 'Net 30',
    })
    // the deferred fields are NOT passed to the vetting (they never were)
    expect('phone' in vet.mock.calls[0][0]).toBe(false)
  })

  it('(c) stale phone/minimumOrderEur/leadTimeDays in the body are IGNORED (zod strips) — create still omits them', async () => {
    verify.mockResolvedValue({ outcome: 'verified', officialName: 'X', reason: 'ok' })
    await postLean({ phone: '0600000000', minimumOrderEur: 999, leadTimeDays: 9 })
    const data = db.supplierProfile.create.mock.calls[0][0].data
    expect('phone' in data).toBe(false)
    expect('minimumOrderCents' in data).toBe(false)
    expect('leadTimeDays' in data).toBe(false)
  })
})
