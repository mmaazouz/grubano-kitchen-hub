import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Beta-truth train (review fix) — strict-FR gates on CREATE ────────────────
// The exact human-rehearsal trap (inverted fields: city="30210" /
// postalCode="Fournès") was fixed on the EDIT path (PATCH /api/restaurants/[id],
// B3) but stayed CREATABLE at onboarding: POST /api/restaurants never received
// the strict-France validation. These tests lock the prevention mirror:
//   • a purely NUMERIC city (ASCII, fullwidth or Arabic-Indic digits) → 400
//     invalid_city — a postal code is not a city name;
//   • a provided postalCode must be EXACTLY 5 digits (NFKC-normalized) → 400
//     invalid_postal_code otherwise;
//   • the pre-existing gates (cuisine-word city, implausible address) hold.
// Rules live in lib/address-validation, SHARED with the PATCH route (no drift).

const { db } = vi.hoisted(() => ({
  db: {
    operator:   { findUnique: vi.fn() },
    restaurant: { findFirst: vi.fn(), create: vi.fn() },
    brand:      { updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

// Controllable geocoder; isPlausibleAddress stays REAL so the address gate is
// exercised for real (same pattern as establishment-address-edit.test.ts).
const { geocodeMock } = vi.hoisted(() => ({ geocodeMock: vi.fn() }))
vi.mock('@/lib/geocode', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/geocode')>()
  return { ...real, geocodeAddressDetailed: geocodeMock }
})

import { POST } from '@/app/api/restaurants/route'

const create = (body: Record<string, unknown>) =>
  POST(new Request('https://app.grubano.com/api/restaurants', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  }))

const asPartner = () => {
  sessionMock.mockResolvedValue({ user: { email: 'partner@x' } })
  db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant' })
  db.restaurant.findFirst.mockResolvedValue(null) // no duplicate
}

beforeEach(() => {
  vi.clearAllMocks()
  db.restaurant.create.mockResolvedValue({ id: 'r1' })
  db.brand.updateMany.mockResolvedValue({ count: 0 })
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db))
  geocodeMock.mockResolvedValue({ status: 'ok', coords: { latitude: 43.94, longitude: 4.54 } })
})

const VALID = { name: 'Chez Nous', city: 'Fournès', address: '4 chemin des Oliviers' }

describe('POST /api/restaurants — numeric city refused at CREATION (rehearsal trap)', () => {
  it('refuses the exact rehearsal inversion: city="30210" → 400 invalid_city, nothing written', async () => {
    asPartner()
    const res = await create({ ...VALID, city: '30210', postalCode: 'Fournès' })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.reason).toBe('invalid_city')
    expect(String(json.error)).toMatch(/ville/i)
    expect(db.restaurant.create).not.toHaveBeenCalled()
  })

  it("refuses a FULLWIDTH numeric city '３０２１０' (IME/mobile input)", async () => {
    asPartner()
    const res = await create({ ...VALID, city: '３０２１０' })
    expect(res.status).toBe(400)
    expect((await res.json()).reason).toBe('invalid_city')
    expect(db.restaurant.create).not.toHaveBeenCalled()
  })

  it("refuses an ARABIC-INDIC numeric city '٣٠٢١٠'", async () => {
    asPartner()
    const res = await create({ ...VALID, city: '٣٠٢١٠' })
    expect(res.status).toBe(400)
    expect((await res.json()).reason).toBe('invalid_city')
    expect(db.restaurant.create).not.toHaveBeenCalled()
  })

  it('still refuses a cuisine keyword as city ("burger") — pre-existing gate kept', async () => {
    asPartner()
    const res = await create({ ...VALID, city: 'burger' })
    expect(res.status).toBe(400)
    expect((await res.json()).reason).toBe('invalid_city')
    expect(db.restaurant.create).not.toHaveBeenCalled()
  })
})

describe('POST /api/restaurants — postal code gate at CREATION', () => {
  it('refuses the inverted CP ("Fournès") → 400 invalid_postal_code, nothing written', async () => {
    asPartner()
    const res = await create({ ...VALID, postalCode: 'Fournès' })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.reason).toBe('invalid_postal_code')
    expect(String(json.error)).toMatch(/code postal/i)
    expect(db.restaurant.create).not.toHaveBeenCalled()
  })

  it('refuses a CP that is digits but not exactly 5 ("302")', async () => {
    asPartner()
    const res = await create({ ...VALID, postalCode: '302' })
    expect(res.status).toBe(400)
    expect((await res.json()).reason).toBe('invalid_postal_code')
    expect(db.restaurant.create).not.toHaveBeenCalled()
  })

  it('accepts a valid CP (trimmed) and forwards it to the geocoder', async () => {
    asPartner()
    const res = await create({ ...VALID, postalCode: ' 30210 ' })
    expect(res.status).toBe(201)
    expect(geocodeMock).toHaveBeenCalledWith('4 chemin des Oliviers', 'Fournès', '30210')
    expect(db.restaurant.create).toHaveBeenCalledTimes(1)
  })

  it('a create WITHOUT postal code still works (the wizard sends undefined when empty)', async () => {
    asPartner()
    const res = await create(VALID)
    expect(res.status).toBe(201)
    expect(geocodeMock).toHaveBeenCalledWith('4 chemin des Oliviers', 'Fournès', undefined)
    expect(db.restaurant.create).toHaveBeenCalledTimes(1)
  })
})
