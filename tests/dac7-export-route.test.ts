import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── P4.4-C — GET /api/admin/dac7/export (ADMIN-ONLY, anti-leak) ───────────────────
// The aggregate carries every reportable seller's fiscal identity + per-quarter revenue.
// These tests lock: 401 (no session), 403 (non-admin) BEFORE any aggregation runs, no
// IDOR (no client-supplied id selects another seller — params are year/format only),
// admin via role OR roles[] both pass, CSV vs JSON content-type + attachment + no-store.

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

const { aggregateMock } = vi.hoisted(() => ({ aggregateMock: vi.fn() }))
vi.mock('@/lib/dac7', async (orig) => {
  const actual = await orig<typeof import('@/lib/dac7')>()
  return { ...actual, aggregateDac7Year: aggregateMock }
})

import { GET } from '@/app/api/admin/dac7/export/route'

const REPORT = {
  year: 2025, generatedNote: 'note', config: {}, platform: { name: 'P', siren: 'S', vat: 'V', country: 'FR' },
  sellerCount: 1,
  sellers: [{
    operatorId: 'op1', name: 'R', email: 'r@x', sellerType: 'entity',
    identity: { officialName: 'R', legalForm: 'SARL', siren: '1', vatNumber: 'FR1', taxId: 'T', taxIdCountry: 'FR', country: 'FR', registeredAddress: 'a', dateOfBirth: null, financialAccountRefs: [] },
    missingFields: [], totalGrossConsiderationCents: 1000, totalPlatformFeesCents: 100, totalNetCreditedCents: 900, totalTransactions: 1,
    quarters: {
      Q1: { grossConsiderationCents: 1000, platformFeesCents: 100, netCreditedCents: 900, numberOfTransactions: 1 },
      Q2: { grossConsiderationCents: 0, platformFeesCents: 0, netCreditedCents: 0, numberOfTransactions: 0 },
      Q3: { grossConsiderationCents: 0, platformFeesCents: 0, netCreditedCents: 0, numberOfTransactions: 0 },
      Q4: { grossConsiderationCents: 0, platformFeesCents: 0, netCreditedCents: 0, numberOfTransactions: 0 },
    },
  }],
}

const req = (qs = '') => new Request(`https://app.grubano.com/api/admin/dac7/export${qs}`)
const call = (user: { role?: string; roles?: string[] } | null, qs = '') => {
  sessionMock.mockResolvedValue(user ? { user: { email: 'u@x', ...user } } : null)
  return GET(req(qs))
}
const ADMIN = { role: 'admin' }

beforeEach(() => {
  vi.clearAllMocks()
  aggregateMock.mockResolvedValue(REPORT)
})

describe('GET /api/admin/dac7/export — auth gate (anti-leak)', () => {
  it('no session → 401, BEFORE any aggregation', async () => {
    const res = await call(null)
    expect(res.status).toBe(401)
    expect(aggregateMock).not.toHaveBeenCalled()
  })

  it('non-admin (restaurant) → 403, BEFORE any aggregation (no seller data leaks)', async () => {
    const res = await call({ role: 'restaurant' })
    expect(res.status).toBe(403)
    expect(aggregateMock).not.toHaveBeenCalled()
  })

  it('consumer → 403', async () => {
    expect((await call({ role: 'consumer' })).status).toBe(403)
    expect(aggregateMock).not.toHaveBeenCalled()
  })

  it('admin via role → 200', async () => {
    expect((await call(ADMIN)).status).toBe(200)
  })

  it('admin via roles[] set → 200', async () => {
    expect((await call({ role: 'restaurant', roles: ['restaurant', 'admin'] })).status).toBe(200)
  })
})

describe('GET /api/admin/dac7/export — output', () => {
  it('default format is JSON, attachment, private no-store', async () => {
    const res = await call(ADMIN, '?year=2025')
    expect(res.headers.get('Content-Type')).toContain('application/json')
    expect(res.headers.get('Content-Disposition')).toContain('attachment; filename="dac7-2025.json"')
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
    expect((await res.json()).sellerCount).toBe(1)
  })

  it('format=csv → text/csv attachment with the # note', async () => {
    const res = await call(ADMIN, '?year=2025&format=csv')
    expect(res.headers.get('Content-Type')).toContain('text/csv')
    expect(res.headers.get('Content-Disposition')).toContain('attachment; filename="dac7-2025.csv"')
    const body = await res.text()
    expect(body.startsWith('#')).toBe(true)
    expect(body).toContain('operatorId')
  })

  it('aggregates the requested year', async () => {
    await call(ADMIN, '?year=2024')
    expect(aggregateMock).toHaveBeenCalledWith(2024)
  })

  it('an out-of-range / missing year falls back to last completed year (no crash)', async () => {
    await call(ADMIN, '?year=1999')
    const used = aggregateMock.mock.calls[0][0]
    expect(used).toBeLessThan(new Date().getUTCFullYear())
    expect(used).toBeGreaterThanOrEqual(2020)
  })
})
