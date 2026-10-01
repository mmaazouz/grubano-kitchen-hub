import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ── POST /api/franchise/apply — LEAN signup (Agent 115) ────────────────────────
// The franchisor application now collects ONLY name + email + brandName + motivation
// (+ optional siret/rib/hasKitchen). city + phone are DEFERRED to the dashboard (edited
// later on the Operator account via PATCH /api/franchise/profile). FranchiseApplication
// .city/phone are now nullable (migration) → the create omits them. The APPROVAL gate is
// UNCHANGED: the application is created with the default status 'pending' (the apply route
// never sets status → no auto-approval), and the admin /api/franchise/approve flow
// (which reads only email/name/siret) is byte-identical. NON-money.

const { db, getSession } = vi.hoisted(() => ({
  db: { franchiseApplication: { create: vi.fn() } },
  getSession: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth', () => ({ getServerSession: getSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

import { POST } from '@/app/api/franchise/apply/route'

// P0-06 — rôle(s) ouvert(s) pour ces tests : la surface est désormais derrière un
// flag de rôle (404 OFF — prouvé par tests/role-locks.test.ts) ; ici on teste la
// logique métier, donc on ouvre le rôle explicitement.
beforeEach(() => { process.env.FRANCHISE_ENABLED = 'true' })
afterEach(() => { delete process.env.FRANCHISE_ENABLED })

const BASE = {
  name: 'Jean Dupont', email: 'jean@exemple.fr',
  brandName: 'Gnocchi Bar', motivation: 'Je veux rejoindre le réseau Grubano.',
}
const post = (over: Record<string, unknown> = {}) =>
  POST(new Request('http://x/api/franchise/apply', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...BASE, ...over }),
  }))
const created = () => db.franchiseApplication.create.mock.calls[0]?.[0]?.data

beforeEach(() => {
  vi.clearAllMocks()
  getSession.mockResolvedValue(null) // anon by default
  db.franchiseApplication.create.mockResolvedValue({ id: 'fa1' })
})

describe('lean franchisor application', () => {
  it('creates a valid FranchiseApplication WITHOUT city/phone, status defaults to pending (approval preserved)', async () => {
    const res = await post()
    expect(res.status).toBe(201)
    const data = created()
    expect(data).toMatchObject({ name: 'Jean Dupont', email: 'jean@exemple.fr', brandName: 'Gnocchi Bar', motivation: 'Je veux rejoindre le réseau Grubano.' })
    // city/phone DEFERRED → omitted from the create (fall to null on the now-nullable columns).
    expect('city' in data).toBe(false)
    expect('phone' in data).toBe(false)
    // The apply route NEVER sets status → Prisma applies @default('pending'). A franchisor is
    // NEVER auto-approved; the admin /api/franchise/approve gate is preserved.
    expect('status' in data).toBe(false)
  })

  it('stale city/phone posted by a stale client are IGNORED (zod strips) — create still omits them', async () => {
    await post({ city: 'Paris', phone: '0612345678' })
    const data = created()
    expect('city' in data).toBe(false)
    expect('phone' in data).toBe(false)
  })

  it('keeps the optional business fields (siret/rib/hasKitchen) when provided', async () => {
    await post({ siret: '12345678901234', rib: 'FR76…', hasKitchen: true })
    const data = created()
    expect(data).toMatchObject({ siret: '12345678901234', rib: 'FR76…', hasKitchen: true })
  })

  it('operatorId comes FROM THE SESSION (links the candidacy to the connected account)', async () => {
    getSession.mockResolvedValue({ user: { id: 'op1' } })
    await post()
    expect(created().operatorId).toBe('op1')
  })

  it('anon (no session) → operatorId undefined (public self-serve candidacy)', async () => {
    await post()
    expect(created().operatorId).toBeUndefined()
  })

  it('rejects an invalid payload (name too short) → 400, no create', async () => {
    const res = await post({ name: 'J' })
    expect(res.status).toBe(400)
    expect(db.franchiseApplication.create).not.toHaveBeenCalled()
  })

  it('rejects a too-short motivation (< 10) → 400 (brandName + motivation stay the approval matter)', async () => {
    const res = await post({ motivation: 'court' })
    expect(res.status).toBe(400)
    expect(db.franchiseApplication.create).not.toHaveBeenCalled()
  })

  it('rejects a missing brandName → 400', async () => {
    const res = await post({ brandName: '' })
    expect(res.status).toBe(400)
    expect(db.franchiseApplication.create).not.toHaveBeenCalled()
  })
})
