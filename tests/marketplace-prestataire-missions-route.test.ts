import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── /api/marketplace/prestataire-missions (P3, Agent 76) — resto side, flag-gated, NO money ──
// The restaurateur REQUESTS a quote, then ACCEPTS / DECLINES / CANCELS its own missions.
// restaurantOperatorId is the SESSION operator (no IDOR), only valid transitions. NO money.
// Real isPrestataireEnabled + canTransitionMission; prisma + callerOperator mocked.

const { db, op } = vi.hoisted(() => ({
  db: {
    serviceMission:     { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    prestataireProfile: { findUnique: vi.fn() },
    serviceOffering:    { findUnique: vi.fn() },
  },
  op: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/operator-session', () => ({ callerOperator: op }))

import { GET, POST } from '@/app/api/marketplace/prestataire-missions/route'
import { PATCH } from '@/app/api/marketplace/prestataire-missions/[id]/route'

const ON  = () => { process.env.PRESTATAIRE_ENABLED = 'true' }
const OFF = () => { delete process.env.PRESTATAIRE_ENABLED }
const post  = (body: unknown) => POST(new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
const patch = (body: unknown, id = 'm1') =>
  PATCH(new Request('http://x', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }), { params: { id } })

const REQ = { prestataireProfileId: 'pp1', requestDetails: 'Frigo en panne, intervention urgente' }

beforeEach(() => {
  vi.clearAllMocks(); ON()
  op.mockResolvedValue({ id: 'op1', role: 'restaurant' })
  db.prestataireProfile.findUnique.mockResolvedValue({ id: 'pp1', status: 'active' })
  db.serviceOffering.findUnique.mockResolvedValue({ prestataireProfileId: 'pp1', active: true })
  db.serviceMission.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'm1', ...data }))
  db.serviceMission.findMany.mockResolvedValue([])
  db.serviceMission.findUnique.mockResolvedValue({ restaurantOperatorId: 'op1', status: 'quoted', proposedDate: new Date('2026-07-01T09:00:00.000Z') })
  db.serviceMission.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'm1', ...data }))
})
afterEach(() => OFF())

describe('FLAG OFF → 404', () => {
  it('POST + GET + PATCH 404, no DB', async () => {
    OFF()
    expect((await post(REQ)).status).toBe(404)
    expect((await GET()).status).toBe(404)
    expect((await patch({ status: 'accepted' })).status).toBe(404)
    expect(db.serviceMission.create).not.toHaveBeenCalled()
  })
})

describe('POST — request a quote (operator-gated, session-scoped)', () => {
  it('non-restaurant/non-admin → 403; no session → 401', async () => {
    op.mockResolvedValue({ id: 'op1', role: 'supplier' })
    expect((await post(REQ)).status).toBe(403)
    op.mockResolvedValue(null)
    expect((await post(REQ)).status).toBe(401)
  })
  it('creates a ServiceMission in status requested with restaurantOperatorId from the SESSION', async () => {
    const res = await post({ ...REQ, restaurantOperatorId: 'EVIL' }) // hostile body id → ignored
    expect(res.status).toBe(201)
    const data = db.serviceMission.create.mock.calls[0][0].data
    expect(data.restaurantOperatorId).toBe('op1')   // ← session, never 'EVIL'
    expect(data.prestataireProfileId).toBe('pp1')
    expect(data.status).toBe('requested')
    expect(data).not.toHaveProperty('quoteAmountCents') // no money set at request time
  })
  it('an inactive / missing prestataire → 400', async () => {
    db.prestataireProfile.findUnique.mockResolvedValue({ id: 'pp1', status: 'pending' })
    expect((await post(REQ)).status).toBe(400)
  })
  it('an offering that belongs to ANOTHER prestataire → 400', async () => {
    db.serviceOffering.findUnique.mockResolvedValue({ prestataireProfileId: 'OTHER', active: true })
    expect((await post({ ...REQ, serviceOfferingId: 'soX' })).status).toBe(400)
  })
  it('empty requestDetails → 400', async () => {
    expect((await post({ prestataireProfileId: 'pp1', requestDetails: '' })).status).toBe(400)
  })
})

describe('GET — owner-scoped list', () => {
  it('scopes to the session operator', async () => {
    expect((await GET()).status).toBe(200)
    expect(db.serviceMission.findMany.mock.calls[0][0].where).toEqual({ restaurantOperatorId: 'op1' })
  })
})

describe('PATCH — accept / decline / cancel + state machine (a + b)', () => {
  it('quoted → accepted poses scheduledDate (body value, else proposedDate) → 200, NO money', async () => {
    const res = await patch({ status: 'accepted' })
    expect(res.status).toBe(200)
    const data = db.serviceMission.update.mock.calls[0][0].data
    expect(data.status).toBe('accepted')
    expect(data.scheduledDate).toEqual(new Date('2026-07-01T09:00:00.000Z')) // fell back to proposedDate
    expect(data).not.toHaveProperty('chargedCents')
  })
  it('quoted → accepted with an explicit scheduledDate uses it', async () => {
    await patch({ status: 'accepted', scheduledDate: '2026-08-15T10:00:00.000Z' })
    expect(db.serviceMission.update.mock.calls[0][0].data.scheduledDate).toEqual(new Date('2026-08-15T10:00:00.000Z'))
  })
  it('quoted → declined → 200', async () => {
    expect((await patch({ status: 'declined' })).status).toBe(200)
  })
  it('requested → cancelled → 200', async () => {
    db.serviceMission.findUnique.mockResolvedValue({ restaurantOperatorId: 'op1', status: 'requested', proposedDate: null })
    expect((await patch({ status: 'cancelled' })).status).toBe(200)
  })
  it('INVALID: accept a still-requested (un-quoted) mission → 409, no update', async () => {
    db.serviceMission.findUnique.mockResolvedValue({ restaurantOperatorId: 'op1', status: 'requested', proposedDate: null })
    expect((await patch({ status: 'accepted' })).status).toBe(409)
    expect(db.serviceMission.update).not.toHaveBeenCalled()
  })
})

describe('OWNER-SCOPING / IDOR + roles (c)', () => {
  it('another resto’s mission → 403, no update', async () => {
    db.serviceMission.findUnique.mockResolvedValue({ restaurantOperatorId: 'OTHER', status: 'quoted', proposedDate: null })
    expect((await patch({ status: 'accepted' })).status).toBe(403)
    expect(db.serviceMission.update).not.toHaveBeenCalled()
  })
  it('non-restaurant operator → 403', async () => {
    op.mockResolvedValue({ id: 'op1', role: 'supplier' })
    expect((await patch({ status: 'accepted' })).status).toBe(403)
  })
  it('the resto cannot quote/done (prestataire-only) → 400 (enum)', async () => {
    expect((await patch({ status: 'quoted' })).status).toBe(400)
    expect((await patch({ status: 'done' })).status).toBe(400)
  })
  it('unknown mission → 404', async () => {
    db.serviceMission.findUnique.mockResolvedValue(null)
    expect((await patch({ status: 'accepted' })).status).toBe(404)
  })
})
