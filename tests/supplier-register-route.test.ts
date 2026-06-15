import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── POST /api/supplier/register — automatic business-identity verification ─────
// A FRESH registration is verified against the official registry (+ LLM name match)
// via verifyBusiness: verified → 'active' (login activated), review → 'pending',
// rejected → 'rejected' (no login). Anti-bot (honeypot / too-fast) and a duplicate
// email never verify, never write, and return the neutral 'pending' outcome.

const { db, ensureOp, verify } = vi.hoisted(() => ({
  db: { supplierProfile: { findUnique: vi.fn(), create: vi.fn() } },
  ensureOp: vi.fn(),
  verify: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/supplier-account', () => ({ ensureSupplierOperator: ensureOp }))
vi.mock('@/lib/business-verification', () => ({ verifyBusiness: verify }))

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

  it('REJECTED → status rejected, NO login provisioned, outcome rejected', async () => {
    verify.mockResolvedValue({ outcome: 'rejected', officialName: null, reason: 'SIREN introuvable' })
    const res = await post()
    expect((await res.json()).outcome).toBe('rejected')
    expect(db.supplierProfile.create.mock.calls[0][0].data).toMatchObject({ status: 'rejected', verificationStatus: 'rejected' })
    expect(ensureOp).not.toHaveBeenCalled()
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
