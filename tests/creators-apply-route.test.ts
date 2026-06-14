import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── POST /api/creators/apply — Mission 14 (Agent 14) ──────────────────────────
// The dish-concepts "portfolio" is CHEF-only. A PURE influencer (influencer ✔ /
// chef ✘) submits ZERO concepts and MUST be accepted (201) — this is the server
// half of the onboarding fix (the wizard no longer shows the step, the route no
// longer rejects an empty portfolio). Chef, chef+influencer, and any legacy
// client that omits `roles` keep the ≥1 requirement (400) — the chef onboarding
// contract is byte-for-byte unchanged. Public route: no session. prisma is
// mocked; makeVerifyCode runs for real (total function, empty-secret fallback).

const { db } = vi.hoisted(() => ({
  db: {
    creatorApplication: { create: vi.fn() },
    // Phase 0 auth bridge — apply now also ensures a pending creator Operator.
    operator: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { POST } from '@/app/api/creators/apply/route'

const post = (body: Record<string, unknown>) =>
  POST(new Request('https://business.grubano.com/api/creators/apply', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  }))

const BASE = { name: 'Amina K.', email: 'amina@exemple.fr', bio: 'Je cuisine healthy depuis 10 ans, gourmand.' }
const CONCEPT = { name: 'Bowl healthy', description: 'Quinoa, avocat, poulet rôti.', cuisineType: 'healthy' }

beforeEach(() => {
  vi.clearAllMocks()
  db.creatorApplication.create.mockResolvedValue({ id: 'app1' })
  db.operator.findUnique.mockResolvedValue(null)   // no existing account → bridge creates a pending creator Operator
  db.operator.create.mockResolvedValue({ id: 'op1' })
  db.operator.update.mockResolvedValue({})
})

describe('pure influencer — portfolio skipped, no block', () => {
  it('accepts ZERO concepts when influencer-only (201) and stores an empty portfolio', async () => {
    const res = await post({ ...BASE, roles: { chef: false, influencer: true }, dishConcepts: [] })
    expect(res.status).toBe(201)
    const out = await res.json()
    expect(out.applicationId).toBe('app1')
    expect(typeof out.verifyCode).toBe('string')
    expect(db.creatorApplication.create).toHaveBeenCalledTimes(1)
    expect(db.creatorApplication.create.mock.calls[0][0].data.dishConcepts).toEqual([])
  })

  it('still accepts an influencer who DID add a concept (201)', async () => {
    const res = await post({ ...BASE, roles: { chef: false, influencer: true }, dishConcepts: [CONCEPT] })
    expect(res.status).toBe(201)
  })
})

describe('chef onboarding unchanged — portfolio required', () => {
  it('rejects ZERO concepts for chef-only (400, no row created)', async () => {
    const res = await post({ ...BASE, roles: { chef: true, influencer: false }, dishConcepts: [] })
    expect(res.status).toBe(400)
    expect(db.creatorApplication.create).not.toHaveBeenCalled()
  })

  it('rejects ZERO concepts for chef+influencer (400)', async () => {
    const res = await post({ ...BASE, roles: { chef: true, influencer: true }, dishConcepts: [] })
    expect(res.status).toBe(400)
    expect(db.creatorApplication.create).not.toHaveBeenCalled()
  })

  it('rejects ZERO concepts for a legacy client that omits roles (400)', async () => {
    const res = await post({ ...BASE, dishConcepts: [] })
    expect(res.status).toBe(400)
    expect(db.creatorApplication.create).not.toHaveBeenCalled()
  })

  it('accepts a chef with one complete concept (201)', async () => {
    const res = await post({ ...BASE, roles: { chef: true, influencer: false }, dishConcepts: [CONCEPT] })
    expect(res.status).toBe(201)
    expect(db.creatorApplication.create.mock.calls[0][0].data.dishConcepts).toHaveLength(1)
  })

  it('still enforces the max of 3 concepts (400)', async () => {
    const res = await post({ ...BASE, roles: { chef: true, influencer: false }, dishConcepts: [CONCEPT, CONCEPT, CONCEPT, CONCEPT] })
    expect(res.status).toBe(400)
  })
})

describe('auth bridge (Phase 0) — pending creator Operator', () => {
  it('creates a PASSWORDLESS Operator(role=creator, status=pending) when the email is free', async () => {
    const res = await post({ ...BASE, roles: { chef: false, influencer: true }, dishConcepts: [] })
    expect(res.status).toBe(201)
    expect((await res.json()).accountExists).toBe(false)
    expect(db.operator.create).toHaveBeenCalledTimes(1)
    const arg = db.operator.create.mock.calls[0][0]
    expect(arg.data.role).toBe('creator')
    expect(arg.data.status).toBe('pending')
    expect(arg.data.password).toBeUndefined() // passwordless — sign-in is via magic-link
  })

  it('does NOT clobber an existing non-creator account → accountExists:true, no create', async () => {
    db.operator.findUnique.mockResolvedValue({ id: 'opC', role: 'consumer', status: 'active' })
    const res = await post({ ...BASE, roles: { chef: false, influencer: true }, dishConcepts: [] })
    expect(res.status).toBe(201)
    expect((await res.json()).accountExists).toBe(true)
    expect(db.operator.create).not.toHaveBeenCalled()
  })

  it('the application is still created even if the bridge throws (best-effort)', async () => {
    db.operator.findUnique.mockRejectedValue(new Error('column not migrated'))
    const res = await post({ ...BASE, roles: { chef: false, influencer: true }, dishConcepts: [] })
    expect(res.status).toBe(201)
    expect(db.creatorApplication.create).toHaveBeenCalledTimes(1)
  })
})
