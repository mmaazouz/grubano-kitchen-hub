import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── PHASE 1 — POST /api/admin/loyalty/waiver (D3 goodwill waiver, matrix O/P) ──
// Admin-only; reduces the recovery offset once; idempotent replay via the keyed
// LoyaltyTransaction (P2002 → idempotentReplay, offset forgiven exactly once);
// audited (recordAdminAudit). Security: a non-admin session is 403.

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { auditMock } = vi.hoisted(() => ({ auditMock: vi.fn() }))
vi.mock('@/lib/admin-audit', () => ({ recordAdminAudit: auditMock }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => null }))

const { db, store } = vi.hoisted(() => {
  const store = { offset: 20, keys: new Set<string>() }
  const db = {
    loyaltyCustomer: {
      findUnique: vi.fn(async () => ({ id: 'lc1', recoveryOffsetPoints: store.offset })),
      update: vi.fn(async ({ data }: { data: { recoveryOffsetPoints?: { decrement?: number } } }) => {
        if (data.recoveryOffsetPoints?.decrement) store.offset -= data.recoveryOffsetPoints.decrement
        return {}
      }),
    },
    loyaltyTransaction: {
      create: vi.fn(async ({ data }: { data: { sourceEventId: string; type: string } }) => {
        const k = `${data.sourceEventId}|${data.type}`
        if (store.keys.has(k)) { const e = new Error('dup') as Error & { code: string }; e.code = 'P2002'; throw e }
        store.keys.add(k); return data
      }),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      const snap = { offset: store.offset, keys: new Set(store.keys) }
      try { return await fn(db) } catch (e) { store.offset = snap.offset; store.keys = snap.keys; throw e }
    }),
  }
  return { db, store }
})
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { POST } from '@/app/api/admin/loyalty/waiver/route'

const post = (body: unknown) => POST(new Request('https://app.grubano.com/api/admin/loyalty/waiver', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
}))

beforeEach(() => {
  store.offset = 20; store.keys = new Set()
  sessionMock.mockReset(); auditMock.mockReset()
  db.loyaltyCustomer.findUnique.mockClear(); db.loyaltyCustomer.update.mockClear(); db.loyaltyTransaction.create.mockClear()
})

describe('waiver — security', () => {
  it('non-admin session → 403, no mutation', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'u1', role: 'restaurant' } })
    const res = await post({ customerId: 'lc1', amountPoints: 5, reason: 'x', idempotencyKey: 'w1' })
    expect(res.status).toBe(403)
    expect(db.loyaltyTransaction.create).not.toHaveBeenCalled()
  })
  it('anonymous → 401', async () => {
    sessionMock.mockResolvedValue(null)
    expect((await post({ customerId: 'lc1', amountPoints: 5, reason: 'x', idempotencyKey: 'w1' })).status).toBe(401)
  })
})

describe('waiver — O. admin goodwill waiver', () => {
  beforeEach(() => sessionMock.mockResolvedValue({ user: { id: 'adm1', role: 'admin', email: 'a@grubano.com' } }))

  it('forgives min(amount, offset) and audits it', async () => {
    const res = await post({ customerId: 'lc1', amountPoints: 8, reason: 'geste commercial', idempotencyKey: 'w1' })
    const j = await res.json()
    expect(res.status).toBe(200)
    expect(j.waivedPoints).toBe(8)
    expect(j.remainingOffsetPoints).toBe(12)
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'loyalty.waiver', targetId: 'lc1' }))
  })

  it('clamps to the current offset (never negative)', async () => {
    const res = await post({ customerId: 'lc1', amountPoints: 999, reason: 'tout', idempotencyKey: 'w2' })
    const j = await res.json()
    expect(j.waivedPoints).toBe(20)
    expect(j.remainingOffsetPoints).toBe(0)
  })
})

describe('waiver — P. retry/replay is idempotent', () => {
  beforeEach(() => sessionMock.mockResolvedValue({ user: { id: 'adm1', role: 'admin', email: 'a@grubano.com' } }))

  it('same idempotencyKey twice forgives once', async () => {
    const first = await (await post({ customerId: 'lc1', amountPoints: 8, reason: 'r', idempotencyKey: 'wX' })).json()
    const second = await (await post({ customerId: 'lc1', amountPoints: 8, reason: 'r', idempotencyKey: 'wX' })).json()
    expect(first.waivedPoints).toBe(8)
    expect(second.idempotentReplay).toBe(true)
    expect(second.waivedPoints).toBe(0)
    expect(store.offset).toBe(12) // forgiven exactly once, not 20−8−8
    expect(auditMock).toHaveBeenCalledTimes(1) // no second audit on replay
  })
})
