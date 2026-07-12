import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── WP-OPS-01 · GET /api/admin/reconcile-ghost-orders — read-only sweep ────────
// Lists expired+captured orders (status 'expired', paymentStatus 'paid'/'reconcile_manual')
// for the reconciliation queue. Auth mirrors the cron routes (X-Internal-Token OR admin).
// NO money action — a findMany + a best-effort daily digest.

const { db, session, alerts } = vi.hoisted(() => ({
  db: { order: { findMany: vi.fn() }, operator: { findUnique: vi.fn() } },
  session: vi.fn(),
  alerts: { sendAdminReconcileDigest: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth', () => ({ getServerSession: session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/admin-alerts', () => ({ sendAdminReconcileDigest: alerts.sendAdminReconcileDigest }))

import { GET } from '@/app/api/admin/reconcile-ghost-orders/route'

const get = (headers: Record<string, string> = {}) =>
  GET(new Request('http://x/api/admin/reconcile-ghost-orders', { headers }))

const ORDER = { id: 'o1', paymentStatus: 'reconcile_manual', total: 22, restaurantId: 'r1', createdAt: new Date(0) }

beforeEach(() => {
  vi.clearAllMocks()
  process.env.INTERNAL_CRON_TOKEN = 'tok'
  db.order.findMany.mockResolvedValue([])
  alerts.sendAdminReconcileDigest.mockResolvedValue({ status: 'sent' })
})
afterEach(() => { delete process.env.INTERNAL_CRON_TOKEN })

describe('auth', () => {
  it('no token + no session → 401', async () => {
    session.mockResolvedValue(null)
    expect((await get()).status).toBe(401)
  })
  it('wrong internal token + no session → 401', async () => {
    session.mockResolvedValue(null)
    expect((await get({ 'x-internal-token': 'nope' })).status).toBe(401)
  })
  it('consumer session → 403', async () => {
    session.mockResolvedValue({ user: { email: 'c@x.fr' } })
    db.operator.findUnique.mockResolvedValue({ role: 'consumer' })
    expect((await get()).status).toBe(403)
  })
  it('valid X-Internal-Token → 200 (no session lookup)', async () => {
    const res = await get({ 'x-internal-token': 'tok' })
    expect(res.status).toBe(200)
    expect(session).not.toHaveBeenCalled()
  })
  it('admin session → 200', async () => {
    session.mockResolvedValue({ user: { email: 'a@x.fr' } })
    db.operator.findUnique.mockResolvedValue({ role: 'admin' })
    expect((await get()).status).toBe(200)
  })
})

describe('sweep — read-only, scoped query, digest only when non-empty', () => {
  it('returns the expired+captured list and fires the digest when count>0', async () => {
    db.order.findMany.mockResolvedValue([ORDER])
    const res = await get({ 'x-internal-token': 'tok' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, count: 1 })
    // scoped exactly to expired + captured/flagged
    expect(db.order.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: 'expired', paymentStatus: { in: ['paid', 'reconcile_manual'] } },
    }))
    expect(alerts.sendAdminReconcileDigest).toHaveBeenCalledWith(expect.objectContaining({ count: 1 }))
  })
  it('empty → 200 count 0, NO digest', async () => {
    const res = await get({ 'x-internal-token': 'tok' })
    expect(await res.json()).toMatchObject({ ok: true, count: 0 })
    expect(alerts.sendAdminReconcileDigest).not.toHaveBeenCalled()
  })
})
