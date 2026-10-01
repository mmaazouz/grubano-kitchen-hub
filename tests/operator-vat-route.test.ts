import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── P4.4-A — POST/GET /api/operator/vat-number (owner-scoped) ────────────────────

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { db } = vi.hoisted(() => ({ db: { operator: { findUnique: vi.fn(), update: vi.fn() } } }))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { GET, POST } from '@/app/api/operator/vat-number/route'

const post = (body?: unknown) => POST({ json: async () => body ?? {} } as never)

beforeEach(() => {
  vi.clearAllMocks()
  sessionMock.mockResolvedValue({ user: { email: 'op@x' } })
  db.operator.findUnique.mockResolvedValue({ id: 'op1', vatNumber: 'FR123', country: 'FR' })
  db.operator.update.mockImplementation(({ data }: { data: { vatNumber: string | null } }) => Promise.resolve({ vatNumber: data.vatNumber }))
})

describe('GET', () => {
  it('no session → 401', async () => {
    sessionMock.mockResolvedValue(null)
    expect((await GET()).status).toBe(401)
  })
  it('session → returns own vatNumber + country', async () => {
    expect(await (await GET()).json()).toEqual({ vatNumber: 'FR123', country: 'FR' })
  })
})

describe('POST — owner-scoped', () => {
  it('no session → 401, no update', async () => {
    sessionMock.mockResolvedValue(null)
    expect((await post({ vatNumber: 'FR99' })).status).toBe(401)
    expect(db.operator.update).not.toHaveBeenCalled()
  })

  it('updates the SESSION operator only (where id = resolved op id, never a client id)', async () => {
    const res = await post({ vatNumber: 'FR 12 345 678 901' })
    expect(res.status).toBe(200)
    expect(db.operator.update.mock.calls[0][0].where).toEqual({ id: 'op1' })
    expect(db.operator.update.mock.calls[0][0].data).toEqual({ vatNumber: 'FR 12 345 678 901' })
  })

  it('empty value clears it (→ null)', async () => {
    await post({ vatNumber: '' })
    expect(db.operator.update.mock.calls[0][0].data).toEqual({ vatNumber: null })
  })

  it('invalid (illegal chars / too long) → 400, no update', async () => {
    expect((await post({ vatNumber: 'FR<script>' })).status).toBe(400)
    expect((await post({ vatNumber: 'X'.repeat(25) })).status).toBe(400)
    expect(db.operator.update).not.toHaveBeenCalled()
  })
})
