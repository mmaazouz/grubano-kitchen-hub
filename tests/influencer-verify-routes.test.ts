import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── /api/affiliate/verify-request + /api/admin/influencer-verifications (INF-1, Agent 66) ─
// Proves the gates: INFLUENCER_ENABLED OFF → 404 (byte-identical); owner-scoped request
// (operator from the SESSION, never a body id); admin approval is admin-only (401/403, no
// auto-approval). The lib is mocked — this pins the route wiring/auth, not the state machine.

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { enabledMock, stateMock, createMock, listMock, decideMock } = vi.hoisted(() => ({
  enabledMock: vi.fn(), stateMock: vi.fn(), createMock: vi.fn(), listMock: vi.fn(), decideMock: vi.fn(),
}))
vi.mock('@/lib/influencer-verification', () => ({
  isInfluencerEnabled: enabledMock,
  getVerificationState: stateMock,
  createVerificationRequest: createMock,
  listVerificationRequests: listMock,
  decideVerification: decideMock,
  VERIFY_PLATFORMS: ['youtube', 'instagram', 'tiktok', 'other'],
}))

import { GET as affGET, POST as affPOST } from '@/app/api/affiliate/verify-request/route'
import { GET as admGET, POST as admPOST } from '@/app/api/admin/influencer-verifications/route'

const affPost = (body: unknown) =>
  affPOST(new Request('https://app.grubano.com/api/affiliate/verify-request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
const admPost = (body: unknown) =>
  admPOST(new Request('https://app.grubano.com/api/admin/influencer-verifications', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))
const admGet = () => admGET(new Request('https://app.grubano.com/api/admin/influencer-verifications'))

beforeEach(() => {
  vi.clearAllMocks()
  enabledMock.mockReturnValue(true)
  sessionMock.mockResolvedValue({ user: { id: 'op1' } })
  stateMock.mockResolvedValue({ verified: false, request: null })
  createMock.mockResolvedValue({ ok: true, status: 'pending' })
  listMock.mockResolvedValue([])
  decideMock.mockResolvedValue({ ok: true, status: 'approved' })
})

describe('affiliate verify-request — flag + owner-scoping', () => {
  it('flag OFF → GET + POST 404, lib untouched', async () => {
    enabledMock.mockReturnValue(false)
    expect((await affGET()).status).toBe(404)
    expect((await affPost({ platform: 'instagram', handle: '@me', declaredFollowers: 10 })).status).toBe(404)
    expect(createMock).not.toHaveBeenCalled()
  })
  it('no session → 401', async () => {
    sessionMock.mockResolvedValue(null)
    expect((await affPost({ platform: 'instagram', handle: '@me', declaredFollowers: 10 })).status).toBe(401)
  })
  it('valid POST → createVerificationRequest with the SESSION operator id (owner-scoped)', async () => {
    const res = await affPost({ platform: 'instagram', handle: '@me', declaredFollowers: 12000, proofUrl: 'https://x' })
    expect(res.status).toBe(200)
    expect(createMock).toHaveBeenCalledWith('op1', expect.objectContaining({ platform: 'instagram', handle: '@me', declaredFollowers: 12000 }))
  })
  it('already_pending → 409', async () => {
    createMock.mockResolvedValue({ ok: false, reason: 'already_pending' })
    expect((await affPost({ platform: 'youtube', handle: 'c', declaredFollowers: 5 })).status).toBe(409)
  })
  it('invalid body → 400', async () => {
    expect((await affPost({ platform: 'myspace', handle: '', declaredFollowers: -1 })).status).toBe(400)
    expect(createMock).not.toHaveBeenCalled()
  })
})

describe('admin influencer-verifications — admin-only', () => {
  it('flag OFF → 404', async () => {
    enabledMock.mockReturnValue(false)
    expect((await admGet()).status).toBe(404)
    expect((await admPost({ id: 'r1', action: 'approve' })).status).toBe(404)
    expect(decideMock).not.toHaveBeenCalled()
  })
  it('no session → 401', async () => {
    sessionMock.mockResolvedValue(null)
    expect((await admPost({ id: 'r1', action: 'approve' })).status).toBe(401)
    expect(decideMock).not.toHaveBeenCalled()
  })
  it('signed-in NON-admin → 403, NO decision (no auto-approval)', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'op1', role: 'affiliate', roles: ['affiliate'] } })
    expect((await admPost({ id: 'r1', action: 'approve' })).status).toBe(403)
    expect(decideMock).not.toHaveBeenCalled()
  })
  it('admin approve → decideVerification(id, action, adminId)', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'adm1', roles: ['admin'] } })
    const res = await admPost({ id: 'r1', action: 'approve' })
    expect(res.status).toBe(200)
    expect(decideMock).toHaveBeenCalledWith('r1', 'approve', 'adm1')
  })
  it('admin via role==="admin" can list', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'adm1', role: 'admin' } })
    expect((await admGet()).status).toBe(200)
    expect(listMock).toHaveBeenCalled()
  })
})
