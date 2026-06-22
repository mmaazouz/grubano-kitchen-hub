import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// ── GET /api/marketplace/prestataires (P2, Agent 75) — discovery, flag-gated, gated resto/admin ──
// CLONE of /api/marketplace/suppliers adapted to services. Returns ACTIVE prestataires with
// ≥1 ACTIVE offering, filtered by ?category/?zone (pure lib/service-offering). 404 when the
// flag is OFF; 401/403 for non-restaurant/non-admin. NO money. Real isPrestataireEnabled
// (env); prisma + callerOperator mocked.

const { db, op } = vi.hoisted(() => ({
  db: { prestataireProfile: { findMany: vi.fn() } },
  op: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/operator-session', () => ({ callerOperator: op }))

import { GET } from '@/app/api/marketplace/prestataires/route'

const ON  = () => { process.env.PRESTATAIRE_ENABLED = 'true' }
const OFF = () => { delete process.env.PRESTATAIRE_ENABLED }
const get = (qs = '') => GET(new Request(`http://x/api/marketplace/prestataires${qs}`))
const ids = (d: { prestataires: { id: string }[] }) => d.prestataires.map((p) => p.id)

const ROWS = [
  {
    id: 'a', companyName: 'Froid Lyon', city: 'Lyon',
    serviceCategories: ['fridge_repair'], coverageZones: ['Lyon', '69003'], modality: 'on_site', indicativeRate: null,
    serviceOfferings: [{ id: 'o1', title: 'Dépannage frigo', description: null, category: 'fridge_repair', modality: 'on_site', indicativeRate: null }],
  },
  {
    id: 'b', companyName: 'HACCP Pro', city: 'Paris',
    serviceCategories: ['haccp'], coverageZones: ['Paris', '75'], modality: 'both', indicativeRate: null,
    serviceOfferings: [{ id: 'o2', title: 'Audit HACCP', description: null, category: 'haccp', modality: 'remote', indicativeRate: null }],
  },
]

beforeEach(() => {
  vi.clearAllMocks(); ON()
  op.mockResolvedValue({ id: 'op1', role: 'restaurant' })
  db.prestataireProfile.findMany.mockResolvedValue(ROWS)
})
afterEach(() => OFF())

describe('FLAG OFF → 404 (no query)', () => {
  it('OFF → 404, no DB', async () => {
    OFF()
    expect((await get()).status).toBe(404)
    expect(db.prestataireProfile.findMany).not.toHaveBeenCalled()
  })
})

describe('operator gate — restaurant/admin only (no IDOR)', () => {
  it('no session → 401', async () => { op.mockResolvedValue(null); expect((await get()).status).toBe(401) })
  it('non-restaurant/non-admin → 403', async () => { op.mockResolvedValue({ id: 'op1', role: 'supplier' }); expect((await get()).status).toBe(403) })
  it('admin allowed → 200', async () => { op.mockResolvedValue({ id: 'op1', role: 'admin' }); expect((await get()).status).toBe(200) })
})

describe('discovery — only active-with-services + filters', () => {
  it('queries status=active AND ≥1 active offering, selecting only active offerings', async () => {
    await get()
    const arg = db.prestataireProfile.findMany.mock.calls[0][0]
    expect(arg.where.status).toBe('active')
    expect(arg.where.marketplaceCoherencePending).toBe(false) // Agent 112 — visibility coherence gate
    expect(arg.where.serviceOfferings).toEqual({ some: { active: true } })
    expect(arg.select.serviceOfferings.where).toEqual({ active: true })
  })

  it('no filter → all rows', async () => {
    expect(ids(await (await get()).json())).toEqual(['a', 'b'])
  })

  it('?category=haccp → only the HACCP provider', async () => {
    expect(ids(await (await get('?category=haccp')).json())).toEqual(['b'])
  })

  it('?zone=lyon (case-insensitive substring) → only the Lyon provider', async () => {
    expect(ids(await (await get('?zone=lyon')).json())).toEqual(['a'])
  })

  it('combined ?category & ?zone are ANDed', async () => {
    expect(ids(await (await get('?category=haccp&zone=paris')).json())).toEqual(['b'])
    expect(ids(await (await get('?category=haccp&zone=lyon')).json())).toEqual([])
  })

  it('normalizes Json arrays to string[] (null / non-array → [])', async () => {
    db.prestataireProfile.findMany.mockResolvedValue([{ ...ROWS[0], coverageZones: null, serviceCategories: 'garbage' }])
    const d = await (await get()).json()
    expect(d.prestataires[0].coverageZones).toEqual([])
    expect(d.prestataires[0].serviceCategories).toEqual([])
  })

  // P4 (Agent 77) — the fiche shows the prestataire's DECLARED availability READ-ONLY.
  it('exposes declared availability (canonical weekdays + note) for the fiche', async () => {
    db.prestataireProfile.findMany.mockResolvedValue([{
      ...ROWS[0], availableWeekdays: ['fri', 'mon', 'mon', 'junk'], availabilityNote: '8h-18h',
    }])
    const d = await (await get()).json()
    expect(d.prestataires[0].availableWeekdays).toEqual(['mon', 'fri']) // normalized, unique, junk dropped
    expect(d.prestataires[0].availabilityNote).toBe('8h-18h')
  })
})
