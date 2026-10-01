import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'

// ── Courier onboarding — justificatifs + GATED admin activation (Agent 125) ────
// ⭐ The headline guardrail: admin activation is a STRICT NO-OP unless
// LOGISTICS_COURIER_ACTIVATION_ENABLED is ON. Plus: justificatifs owner-scoping, admin auth,
// column-tolerant GET, and "no activation without submitted justificatifs".

const { auth, db, logiAcct } = vi.hoisted(() => ({
  auth: { getServerSession: vi.fn() },
  db: { logisticsProfile: { findUnique: vi.fn(), update: vi.fn() } },
  logiAcct: { isLogisticsEnabled: () => process.env.LOGISTICS_ENABLED === 'true', isCourierActivationEnabled: vi.fn(), ensureLogisticsOperator: vi.fn() },
}))
vi.mock('next-auth', () => ({ getServerSession: auth.getServerSession }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/logistics-account', () => logiAcct)

import { GET as justGet, PATCH as justPatch } from '@/app/api/logistics/justificatifs/route'
import { POST as activate } from '@/app/api/admin/logistics/activation/route'

// P0-06 — rôle(s) ouvert(s) pour ces tests : la surface est désormais derrière un
// flag de rôle (404 OFF — prouvé par tests/role-locks.test.ts) ; ici on teste la
// logique métier, donc on ouvre le rôle explicitement.
beforeEach(() => { process.env.LOGISTICS_ENABLED = 'true' })
afterEach(() => { delete process.env.LOGISTICS_ENABLED })

const VALID = { insuranceInsurer: 'AXA', insurancePolicyNumber: 'P-123', insuranceExpiry: '2027-01-01', rcProInsurer: 'MAAF', rcProPolicyNumber: 'RC-9' }
const post = (body?: unknown) => new Request('http://t/x', { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const patch = (body?: unknown) => new Request('http://t/x', { method: 'PATCH', body: body === undefined ? undefined : JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  logiAcct.ensureLogisticsOperator.mockResolvedValue({ ok: true })
})

describe('⭐ GUARDRAIL — admin activation requires LOGISTICS_COURIER_ACTIVATION_ENABLED', () => {
  beforeEach(() => auth.getServerSession.mockResolvedValue({ user: { roles: ['admin'] } }))

  it('flag OFF → 409 activation_disabled, NO profile update, NO operator activation', async () => {
    logiAcct.isCourierActivationEnabled.mockReturnValue(false)
    const res = await activate(post({ email: 'c@x.fr' }))
    expect(res.status).toBe(409)
    expect((await res.json()).reason).toBe('activation_disabled')
    expect(db.logisticsProfile.update).not.toHaveBeenCalled()
    expect(logiAcct.ensureLogisticsOperator).not.toHaveBeenCalled()
    expect(db.logisticsProfile.findUnique).not.toHaveBeenCalled() // refused before any DB work
  })

  it('flag ON + submitted justificatifs → verified + active + login activated', async () => {
    logiAcct.isCourierActivationEnabled.mockReturnValue(true)
    db.logisticsProfile.findUnique.mockResolvedValueOnce({ id: 'p1', status: 'pending', contactName: 'Jo', justificatifsStatus: 'submitted' })
    db.logisticsProfile.update.mockResolvedValueOnce({})
    const res = await activate(post({ email: 'c@x.fr' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const data = db.logisticsProfile.update.mock.calls[0][0].data
    expect(data.status).toBe('active')
    expect(data.justificatifsStatus).toBe('verified')
    expect(logiAcct.ensureLogisticsOperator).toHaveBeenCalledWith('c@x.fr', 'Jo', { activate: true })
  })

  it('flag ON but justificatifs not submitted → 400 no_justificatifs, no activation', async () => {
    logiAcct.isCourierActivationEnabled.mockReturnValue(true)
    db.logisticsProfile.findUnique.mockResolvedValueOnce({ id: 'p1', status: 'pending', contactName: 'Jo', justificatifsStatus: 'none' })
    const res = await activate(post({ email: 'c@x.fr' }))
    expect(res.status).toBe(400)
    expect((await res.json()).reason).toBe('no_justificatifs')
    expect(db.logisticsProfile.update).not.toHaveBeenCalled()
    expect(logiAcct.ensureLogisticsOperator).not.toHaveBeenCalled()
  })
})

describe('admin activation — auth', () => {
  beforeEach(() => logiAcct.isCourierActivationEnabled.mockReturnValue(true))
  it('401 no session, 403 non-admin', async () => {
    auth.getServerSession.mockResolvedValueOnce(null)
    expect((await activate(post({ email: 'c@x.fr' }))).status).toBe(401)
    auth.getServerSession.mockResolvedValueOnce({ user: { roles: ['restaurant'] } })
    expect((await activate(post({ email: 'c@x.fr' }))).status).toBe(403)
  })
})

describe('justificatifs — owner-scoped deposit', () => {
  it('PATCH 401 no session, 403 no profile', async () => {
    auth.getServerSession.mockResolvedValueOnce(null)
    expect((await justPatch(patch(VALID))).status).toBe(401)
    auth.getServerSession.mockResolvedValueOnce({ user: { email: 'c@x.fr' } })
    db.logisticsProfile.findUnique.mockResolvedValueOnce(null)
    expect((await justPatch(patch(VALID))).status).toBe(403)
  })
  it('PATCH valid → marks submitted (own profile only), with timestamp', async () => {
    auth.getServerSession.mockResolvedValue({ user: { email: 'c@x.fr' } })
    db.logisticsProfile.findUnique.mockResolvedValueOnce({ id: 'p1' })
    db.logisticsProfile.update.mockResolvedValueOnce({})
    const res = await justPatch(patch(VALID))
    expect(res.status).toBe(200)
    const call = db.logisticsProfile.update.mock.calls[0][0]
    expect(call.where).toEqual({ email: 'c@x.fr' }) // scoped by session email, no client id
    expect(call.data.justificatifsStatus).toBe('submitted')
    expect(call.data.insuranceInsurer).toBe('AXA')
    expect(call.data.justificatifsSubmittedAt).toBeInstanceOf(Date)
  })
  it('PATCH invalid (missing insurer) → 400, no write', async () => {
    auth.getServerSession.mockResolvedValue({ user: { email: 'c@x.fr' } })
    db.logisticsProfile.findUnique.mockResolvedValueOnce({ id: 'p1' })
    const res = await justPatch(patch({ ...VALID, insuranceInsurer: '' }))
    expect(res.status).toBe(400)
    expect(db.logisticsProfile.update).not.toHaveBeenCalled()
  })
  it('GET is column-tolerant: a read error degrades to status "none" (pre-migration safe)', async () => {
    auth.getServerSession.mockResolvedValue({ user: { email: 'c@x.fr' } })
    db.logisticsProfile.findUnique.mockRejectedValueOnce(new Error('Unknown column'))
    const res = await justGet()
    expect(res.status).toBe(200)
    expect((await res.json()).justificatifs.status).toBe('none')
  })
})
