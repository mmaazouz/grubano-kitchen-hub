import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ── POST /api/supplier/register — LEAN signup (Agent 111, étape 2) ─────────────
// The registration now collects ONLY the identity: companyName + contactName + email
// + SIREN + consent. Status is decided by the SIREN registry ALONE (verifyBusiness →
// decideSupplierOutcome) — the LLM COHERENCE check (vetSupplier) NO LONGER runs at
// signup: it is DEPLACED to the catalogue-publication trigger (lib/supplier-coherence,
// tested in supplier-coherence.test.ts). A fresh SIREN-verified supplier is created
// status='active' but marketplaceCoherencePending=true (HIDDEN from the marketplace)
// until that coherence check clears it — the anti-abuse is MOVED, never removed.
// Anti-bot (honeypot / too-fast) and a duplicate email never verify and never write.

const { db, ensureOp, verify } = vi.hoisted(() => ({
  db: { supplierProfile: { findUnique: vi.fn(), create: vi.fn() } },
  ensureOp: vi.fn(),
  verify: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
// Keep the REAL decideSupplierOutcome (pure) so the route test exercises the actual
// name-tolerant registry decision; only the side-effecting auth bridge is stubbed.
vi.mock('@/lib/supplier-account', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('@/lib/supplier-account')
  return { ...actual, ensureSupplierOperator: ensureOp }
})
vi.mock('@/lib/business-verification', () => ({ verifyBusiness: verify }))

import { POST } from '@/app/api/supplier/register/route'

// P0-06 — rôle(s) ouvert(s) pour ces tests : la surface est désormais derrière un
// flag de rôle (404 OFF — prouvé par tests/role-locks.test.ts) ; ici on teste la
// logique métier, donc on ouvre le rôle explicitement.
beforeEach(() => { process.env.SUPPLIER_ENABLED = 'true' })
afterEach(() => { delete process.env.SUPPLIER_ENABLED })

const BASE = {
  companyName: 'Primeurs Lyon', contactName: 'Marie', email: 'M@Primeurs.fr', siren: '123456789',
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
})

describe('lean registration → SIREN registry ALONE decides the status', () => {
  it('VERIFIED → status active + marketplaceCoherencePending=true (INVISIBLE) + vettingVerdict null; login activated', async () => {
    verify.mockResolvedValue({ outcome: 'verified', officialName: 'PRIMEURS LYON SARL', reason: 'Entreprise vérifiée' })
    const res = await post()
    expect((await res.json()).outcome).toBe('active')
    const data = db.supplierProfile.create.mock.calls[0][0].data
    expect(data).toMatchObject({
      status: 'active', verificationStatus: 'verified', officialName: 'PRIMEURS LYON SARL',
      siren: '123456789', email: 'm@primeurs.fr',
      // Lean signup: created active BUT hidden from the marketplace until the publication
      // coherence check clears it (the anti-abuse is moved, not removed).
      marketplaceCoherencePending: true,
      // No coherence verdict is produced at signup → null (idempotence marker for the trigger).
      vettingVerdict: null,
      vettingAt: null,
    })
    expect(data.verifiedAt).toBeInstanceOf(Date)
    expect(ensureOp).toHaveBeenCalledWith('m@primeurs.fr', 'Marie', { activate: true })
    // SIREN registry verification UNCHANGED: verifyBusiness gets the 9-digit SIREN + declared name…
    expect(verify.mock.calls[0][0]).toMatchObject({ siren: '123456789', declaredName: 'Primeurs Lyon' })
    // …and NO categories (deferred — only auxiliary name-match context, judged later on real data).
    expect('categories' in verify.mock.calls[0][0]).toBe(false)
  })

  it('REVIEW → status pending, login NOT activated, outcome pending', async () => {
    verify.mockResolvedValue({ outcome: 'review', officialName: null, reason: 'Vérification en cours' })
    const res = await post()
    expect((await res.json()).outcome).toBe('pending')
    expect(db.supplierProfile.create.mock.calls[0][0].data).toMatchObject({ status: 'pending', verificationStatus: 'review' })
    expect(ensureOp).toHaveBeenCalledWith('m@primeurs.fr', 'Marie', { activate: false })
  })

  it('REJECTED (SIREN not found / ceased, NO official name) → status rejected, NO login', async () => {
    verify.mockResolvedValue({ outcome: 'rejected', officialName: null, reason: 'SIREN introuvable' })
    const res = await post()
    expect((await res.json()).outcome).toBe('rejected')
    expect(db.supplierProfile.create.mock.calls[0][0].data).toMatchObject({ status: 'rejected', verificationStatus: 'rejected' })
    expect(ensureOp).not.toHaveBeenCalled()
  })

  it('NAME MISMATCH (rejected WITH an official name) → pending review, login NOT activated, NEVER auto-rejected', async () => {
    verify.mockResolvedValue({ outcome: 'rejected', officialName: 'PRIMEURS LYON SARL', reason: 'Nom déclaré incohérent…' })
    const res = await post()
    expect((await res.json()).outcome).toBe('pending')
    const data = db.supplierProfile.create.mock.calls[0][0].data
    expect(data).toMatchObject({ status: 'pending', verificationStatus: 'review', officialName: 'PRIMEURS LYON SARL' })
    expect(data.verifiedAt).toBeNull()
    expect(ensureOp).toHaveBeenCalledWith('m@primeurs.fr', 'Marie', { activate: false })
  })

  it('accepts a 14-digit SIRET and derives the 9-digit SIREN', async () => {
    verify.mockResolvedValue({ outcome: 'verified', officialName: 'X', reason: 'ok' })
    await post({ siren: '12345678900012' })
    expect(verify.mock.calls[0][0].siren).toBe('123456789')
  })
})

// ── Lean signup: the OFFER fields are DEFERRED + the COHERENCE check is MOVED OUT ──────────
describe('Agent 111 — lean signup defers the offer + moves the coherence check', () => {
  it('the create OMITS city/categories/deliveryZones/paymentTerms (fall back to schema defaults)', async () => {
    verify.mockResolvedValue({ outcome: 'verified', officialName: 'X', reason: 'ok' })
    await post()
    const data = db.supplierProfile.create.mock.calls[0][0].data
    expect('city' in data).toBe(false)
    expect('categories' in data).toBe(false)
    expect('deliveryZones' in data).toBe(false)
    expect('paymentTerms' in data).toBe(false)
    // and the Agent 109 deferrals stay deferred too
    expect('phone' in data).toBe(false)
    expect('minimumOrderCents' in data).toBe(false)
    expect('leadTimeDays' in data).toBe(false)
  })

  it('stale offer fields posted by a stale client are IGNORED (zod strips) — create still omits them', async () => {
    verify.mockResolvedValue({ outcome: 'verified', officialName: 'X', reason: 'ok' })
    await post({ city: 'Lyon', categories: ['fresh'], deliveryZones: ['Lyon'], paymentTerms: 'Net 30' })
    const data = db.supplierProfile.create.mock.calls[0][0].data
    expect('city' in data).toBe(false)
    expect('categories' in data).toBe(false)
    expect('deliveryZones' in data).toBe(false)
    expect('paymentTerms' in data).toBe(false)
    // the stale categories never reach verifyBusiness either (deferred to the publication trigger)
    expect('categories' in verify.mock.calls[0][0]).toBe(false)
  })

  it('the route NEVER vets at signup: no import of supplier-vetting and no llmComplete (coherence moved out)', async () => {
    // PROOF the coherence check was DEPLACED (not deleted): the signup route no longer IMPORTS the
    // vetting module nor calls the LLM gateway. The anti-abuse now lives in lib/supplier-coherence,
    // invoked at the catalogue-publication trigger (see supplier-coherence.test.ts). (The route's
    // prose comments may still mention "vetSupplier", so we assert the absence of the IMPORT path.)
    const fs = await import('node:fs')
    const src = fs.readFileSync(new URL('../app/api/supplier/register/route.ts', import.meta.url), 'utf8')
    expect(src).not.toContain('@/lib/supplier-vetting')
    expect(src).not.toContain('llmComplete')
  })
})

describe('anti-bot + duplicate never verify / never write (neutral pending)', () => {
  it('honeypot filled → pending, no verify, no create', async () => {
    const res = await post({ website: 'http://spam.example' })
    expect((await res.json()).outcome).toBe('pending')
    expect(verify).not.toHaveBeenCalled()
    expect(db.supplierProfile.create).not.toHaveBeenCalled()
  })

  it('too-fast submit → pending, no verify', async () => {
    const res = await post({ formStartedAt: Date.now() }) // < 2s ago
    expect((await res.json()).outcome).toBe('pending')
    expect(verify).not.toHaveBeenCalled()
  })

  it('duplicate email → pending, no verify, no create, login not activated', async () => {
    db.supplierProfile.findUnique.mockResolvedValue({ id: 'sp1' })
    const res = await post()
    expect((await res.json()).outcome).toBe('pending')
    expect(verify).not.toHaveBeenCalled()
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
