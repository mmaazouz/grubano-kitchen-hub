import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── /api/prestataire/{approve,admin/status,profile} (P1, Agent 74) ────────────
// Admin routes are ADMIN-ONLY (403 otherwise) + flag-gated (404 when OFF). The profile
// route is OWNER-SCOPED (session e-mail only → no IDOR), WHITELISTS operational fields
// (identity/status never mutable), and flag-gated. NO money. Clone of the supplier routes.

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { db, ensureOp, propagate } = vi.hoisted(() => ({
  db: { prestataireProfile: { findUnique: vi.fn(), update: vi.fn() } },
  ensureOp: vi.fn(),
  propagate: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/prestataire-account', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('@/lib/prestataire-account')
  return { ...actual, ensurePrestataireOperator: ensureOp }
})
vi.mock('@/lib/identity-propagation', () => ({ propagateVerifiedCompanyIdentity: propagate }))

import { POST as approve } from '@/app/api/prestataire/approve/route'
import { POST as adminStatus } from '@/app/api/prestataire/admin/status/route'
import { GET as profileGet, PATCH as profilePatch } from '@/app/api/prestataire/profile/route'

const ON  = () => { process.env.PRESTATAIRE_ENABLED = 'true' }
const OFF = () => { delete process.env.PRESTATAIRE_ENABLED }
const json = (h: (r: Request) => Promise<Response>, body: unknown) =>
  h(new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  ON()
  db.prestataireProfile.findUnique.mockResolvedValue({ id: 'pp1', email: 'p@x.fr', companyName: 'Elec', contactName: 'Sami', status: 'pending', siren: '123456789', officialName: 'ELEC SARL', verificationStatus: 'verified' })
  db.prestataireProfile.update.mockResolvedValue({})
  ensureOp.mockResolvedValue({ ok: true })
  propagate.mockResolvedValue(undefined)
})
afterEach(() => { OFF() })

describe('POST /api/prestataire/approve — admin-only + flag-gated', () => {
  const admin = () => sessionMock.mockResolvedValue({ user: { role: 'admin' } })
  it('flag OFF → 404', async () => {
    OFF(); admin()
    expect((await json(approve, { email: 'p@x.fr' })).status).toBe(404)
  })
  it('non-admin → 403', async () => {
    sessionMock.mockResolvedValue({ user: { role: 'restaurant' } })
    expect((await json(approve, { email: 'p@x.fr' })).status).toBe(403)
  })
  it('admin → flips to active + activates the login (cumul-safe)', async () => {
    admin()
    const res = await json(approve, { email: 'p@x.fr' })
    expect((await res.json())).toMatchObject({ ok: true, status: 'active' })
    expect(db.prestataireProfile.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'active' } }))
    expect(ensureOp).toHaveBeenCalledWith('p@x.fr', 'Sami', { activate: true })
  })
})

describe('POST /api/prestataire/admin/status — admin-only + flag-gated', () => {
  const admin = () => sessionMock.mockResolvedValue({ user: { roles: ['admin'] } })
  it('flag OFF → 404', async () => {
    OFF(); admin()
    expect((await json(adminStatus, { email: 'p@x.fr', status: 'active' })).status).toBe(404)
  })
  it('non-admin → 403', async () => {
    sessionMock.mockResolvedValue({ user: { role: 'restaurant' } })
    expect((await json(adminStatus, { email: 'p@x.fr', status: 'suspended' })).status).toBe(403)
  })
  it('admin suspend → status updated, NO login activation (only active activates)', async () => {
    admin()
    const res = await json(adminStatus, { email: 'p@x.fr', status: 'suspended' })
    expect((await res.json())).toMatchObject({ ok: true, status: 'suspended' })
    expect(ensureOp).not.toHaveBeenCalled()
  })
  it('admin active → activates the login bridge', async () => {
    admin()
    await json(adminStatus, { email: 'p@x.fr', status: 'active' })
    expect(ensureOp).toHaveBeenCalledWith('p@x.fr', 'Sami', { activate: true })
  })
})

describe('/api/prestataire/profile — owner-scoped + whitelist + flag-gated', () => {
  it('GET flag OFF → 404', async () => {
    OFF(); sessionMock.mockResolvedValue({ user: { email: 'p@x.fr' } })
    expect((await profileGet()).status).toBe(404)
  })
  it('GET no session → 401', async () => {
    sessionMock.mockResolvedValue(null)
    expect((await profileGet()).status).toBe(401)
  })
  it('GET not a prestataire → 403', async () => {
    sessionMock.mockResolvedValue({ user: { email: 'x@x.fr' } })
    db.prestataireProfile.findUnique.mockResolvedValue(null)
    expect((await profileGet()).status).toBe(403)
  })
  it('PATCH whitelists operational fields ONLY — identity/status are ignored, never written', async () => {
    sessionMock.mockResolvedValue({ user: { email: 'p@x.fr' } })
    db.prestataireProfile.findUnique.mockResolvedValue({ id: 'pp1' })
    const res = await profilePatch(new Request('http://x', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      // attempt to mutate identity/status via the body — must be stripped
      body: JSON.stringify({ companyName: 'Elec Pro', contactName: 'Sami', modality: 'remote', siren: '999999999', status: 'active', verificationStatus: 'verified' }),
    }))
    expect(res.status).toBe(200)
    const data = db.prestataireProfile.update.mock.calls[0][0].data
    expect(data).toMatchObject({ companyName: 'Elec Pro', modality: 'remote' })
    expect(data.siren).toBeUndefined()              // identity NEVER written here
    expect(data.status).toBeUndefined()
    expect(data.verificationStatus).toBeUndefined()
  })
  it('PATCH owner-scoped: the update targets the SESSION email (no client id)', async () => {
    sessionMock.mockResolvedValue({ user: { email: 'p@x.fr' } })
    db.prestataireProfile.findUnique.mockResolvedValue({ id: 'pp1' })
    await profilePatch(new Request('http://x', {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ companyName: 'Elec Pro', contactName: 'Sami' }),
    }))
    expect(db.prestataireProfile.update.mock.calls[0][0].where).toEqual({ email: 'p@x.fr' })
  })
})
