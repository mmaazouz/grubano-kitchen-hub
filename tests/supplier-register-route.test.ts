import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── POST /api/supplier/register — auto-onboarding flow (Agent 14) ─────────────
// A FRESH registration is vetted SYNCHRONOUSLY: legit → 'active' (+ login
// activated), doubt → 'pending', bad → 'rejected' (no login provisioned). Anti-bot
// (honeypot / too-fast) and a duplicate email never vet, never write, and return
// the neutral 'pending' outcome (no enumeration / fingerprint).

const { db, ensureOp, vet } = vi.hoisted(() => ({
  db: { supplierProfile: { findUnique: vi.fn(), create: vi.fn() } },
  ensureOp: vi.fn(),
  vet: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/supplier-account', () => ({ ensureSupplierOperator: ensureOp }))
vi.mock('@/lib/supplier-vetting', () => ({ vetSupplier: vet }))

import { POST } from '@/app/api/supplier/register/route'

const BASE = {
  companyName: 'Primeurs Lyon', contactName: 'Marie', email: 'M@Primeurs.fr',
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

describe('fresh registration → vetting decides the status', () => {
  it('LEGIT → status active, login activated + role grafted, outcome active', async () => {
    vet.mockResolvedValue({ verdict: 'legit', reason: 'entreprise crédible' })
    const res = await post()
    expect((await res.json()).outcome).toBe('active')
    expect(db.supplierProfile.create.mock.calls[0][0].data).toMatchObject({
      status: 'active', vettingVerdict: 'legit', email: 'm@primeurs.fr',
    })
    expect(ensureOp).toHaveBeenCalledWith('m@primeurs.fr', 'Marie', { activate: true })
  })

  it('DOUBT → status pending, login NOT activated, outcome pending', async () => {
    vet.mockResolvedValue({ verdict: 'doubt', reason: 'infos incomplètes' })
    const res = await post()
    expect((await res.json()).outcome).toBe('pending')
    expect(db.supplierProfile.create.mock.calls[0][0].data).toMatchObject({ status: 'pending', vettingVerdict: 'doubt' })
    expect(ensureOp).toHaveBeenCalledWith('m@primeurs.fr', 'Marie', { activate: false })
  })

  it('BAD → status rejected, NO login provisioned, outcome rejected', async () => {
    vet.mockResolvedValue({ verdict: 'bad', reason: 'spam' })
    const res = await post()
    expect((await res.json()).outcome).toBe('rejected')
    expect(db.supplierProfile.create.mock.calls[0][0].data).toMatchObject({ status: 'rejected', vettingVerdict: 'bad' })
    expect(ensureOp).not.toHaveBeenCalled()
  })

  it('FAIL-SAFE surrogate: vetSupplier returns doubt (its own error fallback) → pending, never active', async () => {
    vet.mockResolvedValue({ verdict: 'doubt', reason: 'vérification auto indisponible' })
    const res = await post()
    expect((await res.json()).outcome).toBe('pending')
    expect(ensureOp).toHaveBeenCalledWith('m@primeurs.fr', 'Marie', { activate: false })
  })
})

describe('anti-bot + duplicate never vet / never write (neutral pending)', () => {
  it('honeypot filled → pending, no vet, no create', async () => {
    const res = await post({ website: 'http://spam.example' })
    expect((await res.json()).outcome).toBe('pending')
    expect(vet).not.toHaveBeenCalled()
    expect(db.supplierProfile.create).not.toHaveBeenCalled()
  })

  it('too-fast submit → pending, no vet', async () => {
    const res = await post({ formStartedAt: Date.now() }) // < 2s ago
    expect((await res.json()).outcome).toBe('pending')
    expect(vet).not.toHaveBeenCalled()
  })

  it('duplicate email → pending, no vet, no create, login not activated (no clobber/leak)', async () => {
    db.supplierProfile.findUnique.mockResolvedValue({ id: 'sp1' })
    const res = await post()
    expect((await res.json()).outcome).toBe('pending')
    expect(vet).not.toHaveBeenCalled()
    expect(db.supplierProfile.create).not.toHaveBeenCalled()
    expect(ensureOp).toHaveBeenCalledWith('m@primeurs.fr', 'Marie', { activate: false })
  })

  it('invalid body (no consent) → 400, no vet', async () => {
    const res = await post({ consent: false })
    expect(res.status).toBe(400)
    expect(vet).not.toHaveBeenCalled()
  })
})
