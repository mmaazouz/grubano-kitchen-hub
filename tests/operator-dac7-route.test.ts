import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── P4.4-C — GET/POST /api/operator/dac7 (OWNER-SCOPED collection) ────────────────
// The partner self-declares THEIR OWN DAC7 fields. Locks: 401 without session; update is
// scoped to where:{ id: <session operator> } (never a client id → no IDOR); zod whitelist
// (empty clears → null, illegal chars / overlong → 400, no write); DOB validation;
// money-neutral (no ledger / amount touched — the route only touches operator identity).

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { db } = vi.hoisted(() => ({ db: { operator: { findUnique: vi.fn(), update: vi.fn() } } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { GET, POST } from '@/app/api/operator/dac7/route'

const post = (body?: unknown) => POST({ json: async () => body ?? {} } as never)
const OWN = { id: 'op1', registeredAddress: '1 rue X', taxId: 'TIN1', taxIdCountry: 'FR', dateOfBirth: null, sellerType: 'entity' }

beforeEach(() => {
  vi.clearAllMocks()
  sessionMock.mockResolvedValue({ user: { email: 'op@x' } })
  db.operator.findUnique.mockResolvedValue(OWN)
  db.operator.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ registeredAddress: null, taxId: null, taxIdCountry: null, dateOfBirth: null, sellerType: null, ...data }))
})

describe('GET', () => {
  it('no session → 401', async () => {
    sessionMock.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
  })
  it('session → returns own DAC7 fields as strings', async () => {
    expect(await (await GET()).json()).toEqual({
      registeredAddress: '1 rue X', taxId: 'TIN1', taxIdCountry: 'FR', dateOfBirth: '', sellerType: 'entity',
    })
  })
  it('a Date DOB is serialized to yyyy-mm-dd', async () => {
    db.operator.findUnique.mockResolvedValue({ ...OWN, sellerType: 'individual', dateOfBirth: new Date('1990-05-04T00:00:00Z') })
    expect((await (await GET()).json()).dateOfBirth).toBe('1990-05-04')
  })
})

describe('POST — owner-scoped', () => {
  it('no session → 401, no update', async () => {
    sessionMock.mockResolvedValue(null)
    expect((await post({ taxId: 'X' })).status).toBe(401)
    expect(db.operator.update).not.toHaveBeenCalled()
  })

  it('updates the SESSION operator only (where id = resolved op id, never a client id)', async () => {
    const res = await post({ registeredAddress: '9 av Y', taxId: 'TIN9', taxIdCountry: 'be', sellerType: 'entity' })
    expect(res.status).toBe(200)
    expect(db.operator.update.mock.calls[0][0].where).toEqual({ id: 'op1' })
    const data = db.operator.update.mock.calls[0][0].data
    expect(data.registeredAddress).toBe('9 av Y')
    expect(data.taxIdCountry).toBe('BE') // uppercased ISO
  })

  it('a client-supplied id in the body is IGNORED (no IDOR)', async () => {
    await post({ id: 'op999', taxId: 'TIN9' })
    expect(db.operator.update.mock.calls[0][0].where).toEqual({ id: 'op1' })
  })

  it('empty values clear the fields (→ null)', async () => {
    await post({ registeredAddress: '', taxId: '', taxIdCountry: '', sellerType: '' })
    const data = db.operator.update.mock.calls[0][0].data
    expect(data).toMatchObject({ registeredAddress: null, taxId: null, taxIdCountry: null, sellerType: null })
  })

  it('valid DOB is stored as a Date; clearing it → null', async () => {
    await post({ sellerType: 'individual', dateOfBirth: '1990-05-04' })
    expect(db.operator.update.mock.calls[0][0].data.dateOfBirth).toBeInstanceOf(Date)
    await post({ dateOfBirth: '' })
    expect(db.operator.update.mock.calls[1][0].data.dateOfBirth).toBeNull()
  })

  it('illegal taxId chars → 400, no write', async () => {
    expect((await post({ taxId: 'FR<script>' })).status).toBe(400)
    expect(db.operator.update).not.toHaveBeenCalled()
  })

  it('overlong registeredAddress → 400, no write', async () => {
    expect((await post({ registeredAddress: 'x'.repeat(301) })).status).toBe(400)
    expect(db.operator.update).not.toHaveBeenCalled()
  })

  it('bad sellerType enum → 400, no write', async () => {
    expect((await post({ sellerType: 'corporation' })).status).toBe(400)
    expect(db.operator.update).not.toHaveBeenCalled()
  })

  it('malformed DOB → 400, no write', async () => {
    expect((await post({ dateOfBirth: '04/05/1990' })).status).toBe(400)
    expect(db.operator.update).not.toHaveBeenCalled()
  })
})
