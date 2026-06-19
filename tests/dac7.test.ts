import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── P4.4-C — DAC7 aggregation (READ-ONLY) + CSV export (Agent 56) ─────────────────
// Locks: per-seller per-quarter buckets from the ledger; signed sums (a refund REDUCES
// its quarter — no double-count); numberOfTransactions counts only payment/deposit_capture;
// SELLER = legal entity (operator), revenue summed across its restaurants; zero-activity
// sellers dropped; missingFields flagged (additive, never crashes); de-minimis OFF by
// default; config legal switches present + « à valider »; CSV escaping + leading note.

const { db } = vi.hoisted(() => ({
  db: {
    operator:    { findMany: vi.fn() },
    restaurant:  { findMany: vi.fn() },
    ledgerEntry: { findMany: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

import { aggregateDac7Year, toDac7Csv, DAC7_CONFIG, dac7Platform } from '@/lib/dac7'
import { LEGAL_INFO } from '@/lib/legal-info'

const OP = (over: Record<string, unknown> = {}) => ({
  id: 'op1', name: 'Resto Un', email: 'op1@x', officialName: 'Resto Un SARL', legalForm: 'SARL',
  siren: '123456789', vatNumber: 'FR123', country: 'FR', registeredAddress: '1 rue X',
  taxId: 'TIN1', taxIdCountry: 'FR', dateOfBirth: null, sellerType: 'entity', ...over,
})
const L = (over: Record<string, unknown> = {}) => ({
  restaurantId: 'r1', type: 'payment', grossAmount: 0, applicationFeeAmount: 0, netToRestaurant: 0,
  createdAt: new Date('2026-02-15T10:00:00Z'), ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  db.operator.findMany.mockResolvedValue([OP()])
  db.restaurant.findMany.mockResolvedValue([{ id: 'r1', operatorId: 'op1', stripeAccountId: 'acct_1' }])
  db.ledgerEntry.findMany.mockResolvedValue([])
})

describe('aggregateDac7Year — perimeter & config', () => {
  it('only reads operators whose role is in DAC7_CONFIG.reportableRoles', async () => {
    await aggregateDac7Year(2026)
    expect(db.operator.findMany.mock.calls[0][0].where).toEqual({ role: { in: DAC7_CONFIG.reportableRoles } })
  })

  it('queries the ledger only inside [yearStart, yearEnd) UTC', async () => {
    await aggregateDac7Year(2026)
    const where = db.ledgerEntry.findMany.mock.calls[0][0].where
    expect(where.createdAt.gte.toISOString()).toBe('2026-01-01T00:00:00.000Z')
    expect(where.createdAt.lt.toISOString()).toBe('2027-01-01T00:00:00.000Z')
    expect(where.restaurantId).toEqual({ in: ['r1'] })
  })

  it('legal switches are present and flagged « to validate » (no hardcoded decision)', () => {
    expect(DAC7_CONFIG.activityClassification).toBe('TO_VALIDATE')
    expect(DAC7_CONFIG.minimis.enabled).toBe(false)         // never wrongly omit a seller
    expect(DAC7_CONFIG.considerationBasis).toBe('gross')
    expect(Array.isArray(DAC7_CONFIG.reportableRoles)).toBe(true)
  })

  it('platform identity comes from LEGAL_INFO.editor (single source)', () => {
    expect(dac7Platform()).toEqual({
      name: LEGAL_INFO.editor.raisonSociale, siren: LEGAL_INFO.editor.siren,
      vat: LEGAL_INFO.editor.tvaIntra, country: 'FR',
    })
  })
})

describe('aggregateDac7Year — bucketing & signed sums', () => {
  it('buckets each line by its own quarter and sums gross/fees/net', async () => {
    db.ledgerEntry.findMany.mockResolvedValue([
      L({ grossAmount: 1000, applicationFeeAmount: 100, netToRestaurant: 900, createdAt: new Date('2026-02-10T00:00:00Z') }), // Q1
      L({ grossAmount: 2000, applicationFeeAmount: 200, netToRestaurant: 1800, createdAt: new Date('2026-05-10T00:00:00Z') }), // Q2
      L({ grossAmount: 3000, applicationFeeAmount: 300, netToRestaurant: 2700, createdAt: new Date('2026-12-31T23:00:00Z') }), // Q4
    ])
    const r = await aggregateDac7Year(2026)
    const s = r.sellers[0]
    expect(s.quarters.Q1.grossConsiderationCents).toBe(1000)
    expect(s.quarters.Q2.grossConsiderationCents).toBe(2000)
    expect(s.quarters.Q3.grossConsiderationCents).toBe(0)
    expect(s.quarters.Q4.grossConsiderationCents).toBe(3000)
    expect(s.totalGrossConsiderationCents).toBe(6000)
    expect(s.totalPlatformFeesCents).toBe(600)
    expect(s.totalNetCreditedCents).toBe(5400)
    expect(s.totalTransactions).toBe(3)
  })

  it('a refund line REDUCES its quarter (signed) and is NOT counted as a transaction', async () => {
    db.ledgerEntry.findMany.mockResolvedValue([
      L({ grossAmount: 5000, applicationFeeAmount: 500, netToRestaurant: 4500, type: 'payment',
          createdAt: new Date('2026-02-10T00:00:00Z') }),
      L({ grossAmount: -2000, applicationFeeAmount: -200, netToRestaurant: -1800, type: 'refund',
          createdAt: new Date('2026-03-10T00:00:00Z') }), // same Q1
    ])
    const s = (await aggregateDac7Year(2026)).sellers[0]
    expect(s.quarters.Q1.grossConsiderationCents).toBe(3000)   // 5000 − 2000, no double-count
    expect(s.quarters.Q1.platformFeesCents).toBe(300)
    expect(s.quarters.Q1.numberOfTransactions).toBe(1)         // only the payment counts
    expect(s.totalTransactions).toBe(1)
  })

  it('deposit_capture counts as a transaction; adjustment does not', async () => {
    db.ledgerEntry.findMany.mockResolvedValue([
      L({ grossAmount: 1000, type: 'deposit_capture' }),
      L({ grossAmount: 50, type: 'adjustment' }),
    ])
    const s = (await aggregateDac7Year(2026)).sellers[0]
    expect(s.totalTransactions).toBe(1)
    expect(s.totalGrossConsiderationCents).toBe(1050)
  })

  it('SELLER = operator: revenue is summed across ALL its restaurants', async () => {
    db.restaurant.findMany.mockResolvedValue([
      { id: 'r1', operatorId: 'op1', stripeAccountId: 'acct_1' },
      { id: 'r2', operatorId: 'op1', stripeAccountId: 'acct_2' },
    ])
    db.ledgerEntry.findMany.mockResolvedValue([
      L({ restaurantId: 'r1', grossAmount: 1000 }),
      L({ restaurantId: 'r2', grossAmount: 4000 }),
    ])
    const r = await aggregateDac7Year(2026)
    expect(r.sellers).toHaveLength(1)
    expect(r.sellers[0].totalGrossConsiderationCents).toBe(5000)
    expect(r.sellers[0].identity.financialAccountRefs).toEqual(['acct_1', 'acct_2'])
  })
})

describe('aggregateDac7Year — drop / keep & additivity', () => {
  it('drops a seller with no activity AND no consideration', async () => {
    db.ledgerEntry.findMany.mockResolvedValue([])
    expect((await aggregateDac7Year(2026)).sellers).toHaveLength(0)
  })

  it('keeps a seller with a net-zero gross but real transactions', async () => {
    db.ledgerEntry.findMany.mockResolvedValue([
      L({ grossAmount: 1000, type: 'payment' }),
      L({ grossAmount: -1000, type: 'refund' }),
    ])
    const r = await aggregateDac7Year(2026)
    expect(r.sellers).toHaveLength(1)
    expect(r.sellers[0].totalGrossConsiderationCents).toBe(0)
    expect(r.sellers[0].totalTransactions).toBe(1)
  })

  it('missing DAC7 fields are flagged, not fatal (additive collection)', async () => {
    db.operator.findMany.mockResolvedValue([
      OP({ officialName: null, registeredAddress: null, taxId: null, taxIdCountry: null, siren: null, vatNumber: null }),
    ])
    db.ledgerEntry.findMany.mockResolvedValue([L({ grossAmount: 1000 })])
    const s = (await aggregateDac7Year(2026)).sellers[0]
    expect(s.missingFields).toEqual(
      expect.arrayContaining(['officialName', 'registeredAddress', 'taxId', 'taxIdCountry', 'siren/vatNumber']),
    )
  })

  it('individual seller missing DOB is flagged; derives type from legalForm when unset', async () => {
    db.operator.findMany.mockResolvedValue([
      OP({ sellerType: null, legalForm: 'Auto-entrepreneur', dateOfBirth: null }),
    ])
    db.ledgerEntry.findMany.mockResolvedValue([L({ grossAmount: 1000 })])
    const s = (await aggregateDac7Year(2026)).sellers[0]
    expect(s.sellerType).toBe('individual')
    expect(s.missingFields).toContain('dateOfBirth')
  })

  it('de-minimis is OFF by default → a tiny seller is still reported', async () => {
    db.ledgerEntry.findMany.mockResolvedValue([L({ grossAmount: 100, type: 'payment' })])
    expect((await aggregateDac7Year(2026)).sellers).toHaveLength(1)
  })

  it('sellers are sorted by gross consideration desc', async () => {
    db.operator.findMany.mockResolvedValue([OP({ id: 'op1' }), OP({ id: 'op2', email: 'op2@x' })])
    db.restaurant.findMany.mockResolvedValue([
      { id: 'r1', operatorId: 'op1', stripeAccountId: null },
      { id: 'r2', operatorId: 'op2', stripeAccountId: null },
    ])
    db.ledgerEntry.findMany.mockResolvedValue([
      L({ restaurantId: 'r1', grossAmount: 100 }),
      L({ restaurantId: 'r2', grossAmount: 9000 }),
    ])
    const r = await aggregateDac7Year(2026)
    expect(r.sellers.map((s) => s.operatorId)).toEqual(['op2', 'op1'])
  })
})

describe('toDac7Csv — escaping & structure', () => {
  it('emits a leading # note, a header row, and one row per seller', async () => {
    db.ledgerEntry.findMany.mockResolvedValue([L({ grossAmount: 1000, applicationFeeAmount: 100, netToRestaurant: 900 })])
    const csv = toDac7Csv(await aggregateDac7Year(2026))
    const lines = csv.trimEnd().split('\n')
    expect(lines[0].startsWith('#')).toBe(true)
    expect(lines[1]).toContain('operatorId')
    expect(lines[1]).toContain('total_grossCents')
    expect(lines).toHaveLength(3) // note + header + 1 seller
  })

  it('escapes a field containing comma/quote/newline', async () => {
    db.operator.findMany.mockResolvedValue([OP({ registeredAddress: '1 rue "A", Paris' })])
    db.ledgerEntry.findMany.mockResolvedValue([L({ grossAmount: 1000 })])
    const csv = toDac7Csv(await aggregateDac7Year(2026))
    expect(csv).toContain('"1 rue ""A"", Paris"')
  })

  it('empty report still produces note + header (no rows)', async () => {
    db.ledgerEntry.findMany.mockResolvedValue([])
    const csv = toDac7Csv(await aggregateDac7Year(2026))
    expect(csv.trimEnd().split('\n')).toHaveLength(2)
  })
})
