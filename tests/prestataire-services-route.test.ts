import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── /api/prestataire/services (P2, Agent 75) — owner-scoped CRUD, flag-gated, NO money ──
// CLONE of /api/supplier/catalog adapted to services. Every op is scoped to the caller's
// PrestataireProfile (session) — no IDOR. The whole route 404s when PRESTATAIRE_ENABLED is
// OFF. A service has NO price / stock. The REAL isPrestataireEnabled runs (env-controlled);
// callerPrestataireProfile is mocked.

const { db, caller } = vi.hoisted(() => ({
  db: { serviceOffering: { findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() } },
  caller: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/prestataire-account', async (importOriginal) => {
  const actual = await importOriginal() as typeof import('@/lib/prestataire-account')
  return { ...actual, callerPrestataireProfile: caller }
})

import { GET, POST, PATCH, DELETE } from '@/app/api/prestataire/services/route'

const ON  = () => { process.env.PRESTATAIRE_ENABLED = 'true' }
const OFF = () => { delete process.env.PRESTATAIRE_ENABLED }
const send = (h: (r: Request) => Promise<Response>, b: unknown, method = 'POST') =>
  h(new Request('http://x', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }))
const del = (qs: string) => DELETE(new Request(`http://x${qs}`, { method: 'DELETE' }))

beforeEach(() => {
  vi.clearAllMocks(); ON()
  caller.mockResolvedValue({ id: 'pp1', status: 'active' })
  db.serviceOffering.findMany.mockResolvedValue([])
  db.serviceOffering.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'so1', ...data }))
  db.serviceOffering.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'so1', ...data }))
  db.serviceOffering.delete.mockResolvedValue({})
})
afterEach(() => OFF())

describe('FLAG OFF → the role does not exist', () => {
  it('GET/POST/PATCH/DELETE all 404, no profile lookup, no DB write', async () => {
    OFF()
    expect((await GET()).status).toBe(404)
    expect((await send(POST, { title: 'x' })).status).toBe(404)
    expect((await send(PATCH, { id: '1', title: 'x' }, 'PATCH')).status).toBe(404)
    expect((await del('?id=1')).status).toBe(404)
    expect(caller).not.toHaveBeenCalled()
    expect(db.serviceOffering.create).not.toHaveBeenCalled()
  })
})

describe('CRUD owner-scoped (no IDOR) + NO money', () => {
  it('GET scopes to the caller profile only', async () => {
    db.serviceOffering.findMany.mockResolvedValue([{ id: 'so1', title: 'HACCP' }])
    const res = await GET()
    expect(res.status).toBe(200)
    expect(db.serviceOffering.findMany.mock.calls[0][0].where).toEqual({ prestataireProfileId: 'pp1' })
  })

  it('POST sets prestataireProfileId from the SESSION (not the body) and stores NO price/stock', async () => {
    const res = await send(POST, {
      title: 'Contrôle HACCP', category: 'haccp', modality: 'on_site',
      prestataireProfileId: 'EVIL', priceCents: 9999, available: false, // hostile extras → stripped
    })
    expect(res.status).toBe(201)
    const data = db.serviceOffering.create.mock.calls[0][0].data
    expect(data.prestataireProfileId).toBe('pp1')         // ← session, never 'EVIL'
    expect(data.title).toBe('Contrôle HACCP')
    expect(data).not.toHaveProperty('priceCents')          // NO money
    expect(data).not.toHaveProperty('available')
    expect(data).not.toHaveProperty('unit')
  })

  it('POST on a PENDING profile → 403 (must be active)', async () => {
    caller.mockResolvedValue({ id: 'pp1', status: 'pending' })
    expect((await send(POST, { title: 'x', category: 'haccp' })).status).toBe(403)
    expect(db.serviceOffering.create).not.toHaveBeenCalled()
  })

  it('POST with no prestataire session → 401', async () => {
    caller.mockResolvedValue(null)
    expect((await send(POST, { title: 'x' })).status).toBe(401)
  })

  it('POST invalid (empty title) → 400; invalid category enum → 400', async () => {
    expect((await send(POST, { title: '' })).status).toBe(400)
    expect((await send(POST, { title: 'x', category: 'not_a_trade' })).status).toBe(400)
  })

  it('POST duplicate title → 409', async () => {
    const { Prisma } = await import('@prisma/client')
    db.serviceOffering.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5.22.0' }),
    )
    expect((await send(POST, { title: 'dup', category: 'haccp' })).status).toBe(409)
  })

  it('PATCH another prestataire’s offering → 403 (IDOR blocked), no update', async () => {
    db.serviceOffering.findUnique.mockResolvedValue({ prestataireProfileId: 'OTHER' })
    expect((await send(PATCH, { id: 'soX', title: 'hijack' }, 'PATCH')).status).toBe(403)
    expect(db.serviceOffering.update).not.toHaveBeenCalled()
  })

  it('PATCH own offering → 200 (e.g. toggle active=false to hide)', async () => {
    db.serviceOffering.findUnique.mockResolvedValue({ prestataireProfileId: 'pp1' })
    const res = await send(PATCH, { id: 'so1', active: false }, 'PATCH')
    expect(res.status).toBe(200)
    expect(db.serviceOffering.update.mock.calls[0][0].where).toEqual({ id: 'so1' })
    expect(db.serviceOffering.update.mock.calls[0][0].data).toMatchObject({ active: false })
  })

  it('DELETE another prestataire’s offering → 403; own → 200', async () => {
    db.serviceOffering.findUnique.mockResolvedValue({ prestataireProfileId: 'OTHER' })
    expect((await del('?id=soX')).status).toBe(403)
    expect(db.serviceOffering.delete).not.toHaveBeenCalled()

    db.serviceOffering.findUnique.mockResolvedValue({ prestataireProfileId: 'pp1' })
    expect((await del('?id=so1')).status).toBe(200)
    expect(db.serviceOffering.delete).toHaveBeenCalledWith({ where: { id: 'so1' } })
  })
})

describe('P8b — fixedPriceCents (forfait), additive', () => {
  it('POST stores fixedPriceCents when set; null = « sur devis » when absent', async () => {
    let res = await send(POST, { title: 'Forfait HACCP', category: 'haccp', fixedPriceCents: 15000 })
    expect(res.status).toBe(201)
    expect(db.serviceOffering.create.mock.calls[0][0].data.fixedPriceCents).toBe(15000)

    vi.clearAllMocks(); caller.mockResolvedValue({ id: 'pp1', status: 'active' })
    db.serviceOffering.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => Promise.resolve({ id: 'so2', ...data }))
    res = await send(POST, { title: 'Sur devis', category: 'haccp' })
    expect(res.status).toBe(201)
    expect(db.serviceOffering.create.mock.calls[0][0].data.fixedPriceCents).toBeNull()
  })
  it('POST rejects a non-positive fixed price → 400 (no 0 / negative forfait)', async () => {
    expect((await send(POST, { title: 'x', category: 'haccp', fixedPriceCents: 0 })).status).toBe(400)
    expect((await send(POST, { title: 'x', category: 'haccp', fixedPriceCents: -100 })).status).toBe(400)
  })
  it('PATCH can set and CLEAR the fixed price (null → back to « sur devis »)', async () => {
    db.serviceOffering.findUnique.mockResolvedValue({ prestataireProfileId: 'pp1' })
    await send(PATCH, { id: 'so1', fixedPriceCents: 9900 }, 'PATCH')
    expect(db.serviceOffering.update.mock.calls[0][0].data).toMatchObject({ fixedPriceCents: 9900 })

    vi.clearAllMocks(); caller.mockResolvedValue({ id: 'pp1', status: 'active' })
    db.serviceOffering.findUnique.mockResolvedValue({ prestataireProfileId: 'pp1' })
    db.serviceOffering.update.mockResolvedValue({ id: 'so1' })
    await send(PATCH, { id: 'so1', fixedPriceCents: null }, 'PATCH')
    expect(db.serviceOffering.update.mock.calls[0][0].data).toMatchObject({ fixedPriceCents: null })
  })
})
