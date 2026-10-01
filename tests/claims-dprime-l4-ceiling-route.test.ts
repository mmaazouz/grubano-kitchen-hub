// tests/claims-dprime-l4-ceiling-route.test.ts — D′ lot L4 (spec v2 §7.4).
//
// GET /api/admin/claims/[id]/ceiling is what the admin reads BEFORE deciding an amount. It must be
// three things at once: admin-only and gated like every other claims surface, strictly READ-ONLY, and
// HONEST — when live Stripe truth could not be read it says so instead of dressing a DB estimate as
// confirmed refundable cash (T-59). The approval bound it reports is the REQUESTED amount, never the
// ceiling: the ceiling is looser, and confusing the two is how an admin approves more than was asked.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const { db, adminMock, scopeMock } = vi.hoisted(() => ({
  db: {
    claim: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    order: { findUnique: vi.fn() },
    refund: { aggregate: vi.fn(), create: vi.fn() },
  },
  adminMock: vi.fn(),
  scopeMock: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/admin-guard', () => ({ resolveAdmin: adminMock }))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => null }))
vi.mock('@/lib/claims', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/claims')>()
  return { ...real, buildClaimScopeForOrder: (...a: unknown[]) => scopeMock(...a) }
})

import { GET as ceiling } from '@/app/api/admin/claims/[id]/ceiling/route'
import { openClaimsWindow, closeClaimsWindow } from './support/claims-window'

const CLAIM = { id: 'cl1', orderId: 'o1', requestedAmountCents: 500, status: 'arbitration', approvedAmountCents: null }
const ORDER = { total: 32.5, items: [{ itemId: 'm1', name: 'Gnocchi', qty: 1, price: 32.5 }], stripePaymentIntentId: 'pi_1' }
const SCOPE = (o: Record<string, unknown> = {}) => ({
  maxAuthorityCents: 3250, alreadyRefundedCents: 0, lines: [], ceilingSource: 'stripe', ceilingContested: false, ...o,
})
const get = (id = 'cl1') => ceiling(new Request(`https://app.grubano.com/api/admin/claims/${id}/ceiling`), { params: { id } })
/** Every write a Prisma double could record — the ceiling must trip none of them. */
const writes = () => [db.claim.create, db.claim.update, db.claim.updateMany, db.refund.create].reduce((n, m) => n + m.mock.calls.length, 0)

beforeEach(() => {
  vi.clearAllMocks()
  openClaimsWindow()
  adminMock.mockResolvedValue({ id: 'admin1', email: 'admin@grubano.test' })
  db.claim.findUnique.mockResolvedValue(CLAIM)
  db.order.findUnique.mockResolvedValue(ORDER)
  scopeMock.mockResolvedValue(SCOPE())
})
afterEach(() => { closeClaimsWindow(); delete process.env.CLAIMS_SURFACE_ENABLED })

describe('GET …/ceiling — gated, admin-only, read-only', () => {
  it('the claims SURFACE gates it: closed → 403 gated, and nothing is read', async () => {
    closeClaimsWindow()
    const res = await get()
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ gated: true })
    expect(adminMock).not.toHaveBeenCalled()
    expect(db.claim.findUnique).not.toHaveBeenCalled()
  })

  it('a non-admin session → 403, before any claim or order is read', async () => {
    adminMock.mockResolvedValue(null)
    expect((await get()).status).toBe(403)
    expect(db.claim.findUnique).not.toHaveBeenCalled()
  })

  it('an unknown claim → 404; an unknown order → 404; neither writes anything', async () => {
    db.claim.findUnique.mockResolvedValue(null)
    expect((await get()).status).toBe(404)
    db.claim.findUnique.mockResolvedValue(CLAIM)
    db.order.findUnique.mockResolvedValue(null)
    expect((await get()).status).toBe(404)
    expect(writes()).toBe(0)
  })

  it('the nominal answer carries the requested amount, the ceiling, what is already refunded — and the BOUND is the requested amount', async () => {
    const body = await (await get()).json()
    expect(body).toEqual({
      claimId: 'cl1', status: 'arbitration', requestedAmountCents: 500, approvedAmountCents: null,
      maxRefundableCents: 3250, alreadyRefundedCents: 0, ceilingVerified: true, approvalBoundCents: 500,
    })
    // the bound is the REQUESTED amount even though the ceiling is far higher (S-10): that difference
    // is exactly the mistake this field exists to prevent.
    expect(body.approvalBoundCents).toBe(body.requestedAmountCents)
    expect(body.approvalBoundCents).toBeLessThan(body.maxRefundableCents)
    expect(writes()).toBe(0)
  })

  it('T-59 — ceilingVerified is false when Stripe was not read, and when the charge is disputed', async () => {
    scopeMock.mockResolvedValue(SCOPE({ ceilingSource: 'db_only' }))
    expect((await (await get()).json()).ceilingVerified).toBe(false)
    scopeMock.mockResolvedValue(SCOPE({ ceilingSource: 'stripe', ceilingContested: true }))
    expect((await (await get()).json()).ceilingVerified).toBe(false)
    // NEGATIVE CONTROL — only « read AND not disputed » is verified.
    scopeMock.mockResolvedValue(SCOPE())
    expect((await (await get()).json()).ceilingVerified).toBe(true)
  })

  it('a ceiling that cannot be computed is reported as UNKNOWN, never as a number', async () => {
    scopeMock.mockRejectedValue(new Error('stripe unreachable'))
    const res = await get()
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body).toMatchObject({ reason: 'ceiling_unreadable' })
    expect(body).not.toHaveProperty('maxRefundableCents')
    expect(writes()).toBe(0)
  })

  it('it reports an amount already decided, so the dialog shows a ratification for what it is', async () => {
    db.claim.findUnique.mockResolvedValue({ ...CLAIM, status: 'approved', approvedAmountCents: 400 })
    expect(await (await get()).json()).toMatchObject({ status: 'approved', approvedAmountCents: 400, approvalBoundCents: 500 })
  })

  it('STATIC — the route writes nothing, sends nothing, and reuses the ONE scope builder', () => {
    const s = readFileSync('app/api/admin/claims/[id]/ceiling/route.ts', 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    expect(s).toMatch(/buildClaimScopeForOrder/)          // not a second ceiling definition
    expect(s).not.toMatch(/\.(create|update|updateMany|upsert|delete|deleteMany)\(/)
    expect(s).not.toMatch(/sendClaim|sendTransactional|triggerClaimRefund|executeRefund|refunds\.create/)
    expect(s).toMatch(/resolveAdmin\(\)/)
    expect(s).toMatch(/claimsSurfaceOpen\(\)/)
  })
})
