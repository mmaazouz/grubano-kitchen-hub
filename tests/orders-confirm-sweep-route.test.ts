import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── P0-42 — POST /api/admin/orders/confirm-sweep : auth calque ledger/check ────
// X-Internal-Token (cron, constant-time) OU session ADMIN ; jamais ouvert au
// monde si l'env est vide ; la lib est mockée (testée par order-email-sweep).

const { db } = vi.hoisted(() => ({
  db: { operator: { findUnique: vi.fn() } },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { sweepMock } = vi.hoisted(() => ({ sweepMock: vi.fn() }))
vi.mock('@/lib/order-email-sweep', () => ({ sweepUnconfirmedPaidOrders: sweepMock }))

import { POST } from '@/app/api/admin/orders/confirm-sweep/route'

const call = (headers: Record<string, string> = {}) =>
  POST(new Request('https://app.grubano.com/api/admin/orders/confirm-sweep', {
    method: 'POST', headers,
  }))

const RESULT = { scanned: 3, consumerSent: 1, restoSent: 2, alreadyDone: 1, skippedNoEmail: 0, errors: 0 }

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  sweepMock.mockResolvedValue(RESULT)
  sessionMock.mockResolvedValue(null)
})

describe('POST /api/admin/orders/confirm-sweep — auth', () => {
  it('⭐ token cron valide → 200 + compteurs, sans session', async () => {
    vi.stubEnv('INTERNAL_CRON_TOKEN', 'tok-cron-123')
    const res = await call({ 'x-internal-token': 'tok-cron-123' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, ...RESULT })
    expect(sweepMock).toHaveBeenCalledTimes(1)
    expect(sessionMock).not.toHaveBeenCalled()
  })

  it('token FAUX → retombe sur la garde session : 401 sans session, zéro sweep', async () => {
    vi.stubEnv('INTERNAL_CRON_TOKEN', 'tok-cron-123')
    const res = await call({ 'x-internal-token': 'wrong' })
    expect(res.status).toBe(401)
    expect(sweepMock).not.toHaveBeenCalled()
  })

  it('env INTERNAL_CRON_TOKEN VIDE → le header n’ouvre JAMAIS la route (pas de mode monde-entier accidentel)', async () => {
    vi.stubEnv('INTERNAL_CRON_TOKEN', '')
    const res = await call({ 'x-internal-token': '' })
    expect(res.status).toBe(401)
    expect(sweepMock).not.toHaveBeenCalled()
  })

  it('session ADMIN → 200', async () => {
    sessionMock.mockResolvedValue({ user: { email: 'admin@grubano.com' } })
    db.operator.findUnique.mockResolvedValue({ role: 'admin' })
    const res = await call()
    expect(res.status).toBe(200)
    expect(sweepMock).toHaveBeenCalledTimes(1)
  })

  it('session NON-admin (restaurant) → 403, zéro sweep', async () => {
    sessionMock.mockResolvedValue({ user: { email: 'resto@x.fr' } })
    db.operator.findUnique.mockResolvedValue({ role: 'restaurant' })
    const res = await call()
    expect(res.status).toBe(403)
    expect(sweepMock).not.toHaveBeenCalled()
  })

  it('erreur lib → 500 propre (jamais un rejet brut)', async () => {
    vi.stubEnv('INTERNAL_CRON_TOKEN', 'tok-cron-123')
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    sweepMock.mockRejectedValue(new Error('db down'))
    const res = await call({ 'x-internal-token': 'tok-cron-123' })
    expect(res.status).toBe(500)
    errSpy.mockRestore()
  })
})
