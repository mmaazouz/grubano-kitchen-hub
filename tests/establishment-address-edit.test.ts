import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── B3 (beta-truth train) — post-onboarding address edit ─────────────────────
// The human rehearsal proved an operator who mistyped the address at onboarding
// (real case: city="30210" / postalCode="Fournès" ACCEPTED) was then LOCKED IN:
// no screen allowed fixing it. The fix extends the existing owner-scoped
// PATCH /api/restaurants/[id] with:
//   • strict-France validation (address plausible, CP = exactly 5 digits,
//     city non-empty and NOT purely numeric) — the exact inversion is refused;
//   • a MANDATORY re-geocode on any address/CP/city change, persisted in the
//     SAME write as the address (atomic). A geocode miss ('not_found' or
//     'unavailable') stores lat/lng = null — NEVER the obsolete coords;
//   • the existing authorization pattern (owner or admin; foreign → 403,
//     anonymous → 401) untouched.

const { db } = vi.hoisted(() => ({
  db: {
    operator:   { findUnique: vi.fn() },
    restaurant: { findUnique: vi.fn(), update: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))

const { sessionMock } = vi.hoisted(() => ({ sessionMock: vi.fn() }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

// Controllable geocoder: each test decides ok / not_found / unavailable.
// isPlausibleAddress stays REAL so the address-plausibility rule is exercised.
const { geocodeMock } = vi.hoisted(() => ({ geocodeMock: vi.fn() }))
vi.mock('@/lib/geocode', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/geocode')>()
  return { ...real, geocodeAddressDetailed: geocodeMock }
})

import { PATCH } from '@/app/api/restaurants/[id]/route'

const sess = (email: string) => sessionMock.mockResolvedValue({ user: { email } })

const patch = (body: Record<string, unknown>) =>
  PATCH(new Request('https://app.grubano.com/api/restaurants/r1', {
    method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  }), { params: { id: 'r1' } })

// The stored row BEFORE the edit — old address with OLD coords (45, 3): the
// obsolete-coords assertions below prove these never survive an address change
// whose geocode missed.
const storedRestaurant = {
  operatorId: 'op1',
  address:    '1 vieille rue',
  city:       'Ancienneville',
  isActive:   false,
  approvedAt: null,
  lat:        45.0,
  lng:        3.0,
}

const asOwner = () => {
  sess('owner@x')
  db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant' })
  db.restaurant.findUnique.mockResolvedValue({ ...storedRestaurant })
}

beforeEach(() => {
  vi.clearAllMocks()
  db.restaurant.update.mockResolvedValue({ id: 'r1' })
  geocodeMock.mockResolvedValue({ status: 'ok', coords: { latitude: 43.94, longitude: 4.54 } })
})

// ── Validation FRANCE stricte ────────────────────────────────────────────────
describe('B3 — strict France validation on PATCH /api/restaurants/[id]', () => {
  it('REFUSES the exact human-test inversion (city="30210", CP="Fournès") with a clear FR message', async () => {
    asOwner()
    const res = await patch({ address: '4 chemin des Oliviers', city: '30210', postalCode: 'Fournès' })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.reason).toBe('invalid_city')
    expect(String(json.error)).toMatch(/ville/i)
    expect(db.restaurant.update).not.toHaveBeenCalled()
  })

  it('refuses a non-5-digit postal code (CP="Fournès" with a valid city)', async () => {
    asOwner()
    const res = await patch({ address: '4 chemin des Oliviers', city: 'Fournès', postalCode: 'Fournès' })
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.reason).toBe('invalid_postal_code')
    expect(String(json.error)).toMatch(/code postal/i)
    expect(db.restaurant.update).not.toHaveBeenCalled()
  })

  it('refuses a postal code that is digits but not exactly 5 ("302")', async () => {
    asOwner()
    const res = await patch({ address: '4 chemin des Oliviers', city: 'Fournès', postalCode: '302' })
    expect(res.status).toBe(400)
    expect((await res.json()).reason).toBe('invalid_postal_code')
    expect(db.restaurant.update).not.toHaveBeenCalled()
  })

  it('refuses an implausible address ("gogo") before touching the DB', async () => {
    asOwner()
    const res = await patch({ address: 'gogo', city: 'Fournès', postalCode: '30210' })
    expect(res.status).toBe(400)
    expect((await res.json()).reason).toBe('invalid_address')
    expect(db.restaurant.update).not.toHaveBeenCalled()
  })

  it('ACCEPTS the corrected form (address + CP=30210 + city=Fournès) and trims the fields', async () => {
    asOwner()
    const res = await patch({ address: ' 4 chemin des Oliviers ', city: ' Fournès ', postalCode: ' 30210 ' })
    expect(res.status).toBe(200)
    expect(db.restaurant.update).toHaveBeenCalledTimes(1)
    const data = db.restaurant.update.mock.calls[0][0].data
    expect(data.address).toBe('4 chemin des Oliviers')
    expect(data.city).toBe('Fournès')
  })
})

// ── Autorisation (pattern existant de la route, verrouillé) ──────────────────
describe('B3 — authorization on the address edit', () => {
  const body = { address: '4 chemin des Oliviers', city: 'Fournès', postalCode: '30210' }

  it('anonymous → 401, no write', async () => {
    sessionMock.mockResolvedValue(null)
    const res = await patch(body)
    expect(res.status).toBe(401)
    expect(db.restaurant.update).not.toHaveBeenCalled()
  })

  it('operator of ANOTHER restaurant → 403, no write (no IDOR)', async () => {
    sess('intruder@x')
    db.operator.findUnique.mockResolvedValue({ id: 'intruder', role: 'restaurant' })
    db.restaurant.findUnique.mockResolvedValue({ ...storedRestaurant })
    const res = await patch(body)
    expect(res.status).toBe(403)
    expect(db.restaurant.update).not.toHaveBeenCalled()
  })

  it('owner → 200, write applied', async () => {
    asOwner()
    const res = await patch(body)
    expect(res.status).toBe(200)
    expect(db.restaurant.update).toHaveBeenCalledTimes(1)
  })

  it('admin (sibling-route pattern) → 200 even on a foreign restaurant', async () => {
    sess('admin@x')
    db.operator.findUnique.mockResolvedValue({ id: 'admin1', role: 'admin' })
    db.restaurant.findUnique.mockResolvedValue({ ...storedRestaurant })
    const res = await patch(body)
    expect(res.status).toBe(200)
    expect(db.restaurant.update).toHaveBeenCalledTimes(1)
  })
})

// ── Re-géocodage obligatoire + atomicité ─────────────────────────────────────
describe('B3 — mandatory re-geocode, never obsolete coords, atomic write', () => {
  const body = { address: '4 chemin des Oliviers', city: 'Fournès', postalCode: '30210' }

  it('geocode OK → NEW coords persisted in the SAME single write as the new address', async () => {
    asOwner()
    geocodeMock.mockResolvedValue({ status: 'ok', coords: { latitude: 43.94, longitude: 4.54 } })
    const res = await patch(body)
    expect(res.status).toBe(200)
    // The CP sharpens the BAN match — it must reach the geocoder.
    expect(geocodeMock).toHaveBeenCalledWith('4 chemin des Oliviers', 'Fournès', '30210')
    // ATOMIC: exactly one write carrying address AND coords together.
    expect(db.restaurant.update).toHaveBeenCalledTimes(1)
    const data = db.restaurant.update.mock.calls[0][0].data
    expect(data.address).toBe('4 chemin des Oliviers')
    expect(data.city).toBe('Fournès')
    expect(data.lat).toBe(43.94)
    expect(data.lng).toBe(4.54)
    expect((await res.json()).geocodeStatus).toBe('ok')
  })

  it("geocode 'not_found' → lat/lng = null WITH the new address (never the old 45/3)", async () => {
    asOwner()
    geocodeMock.mockResolvedValue({ status: 'not_found' })
    const res = await patch(body)
    expect(res.status).toBe(200)
    expect(db.restaurant.update).toHaveBeenCalledTimes(1)
    const data = db.restaurant.update.mock.calls[0][0].data
    expect(data.address).toBe('4 chemin des Oliviers')
    expect(data.lat).toBeNull()
    expect(data.lng).toBeNull()
    const json = await res.json()
    expect(json.geocodeStatus).toBe('not_found')
    expect(json.geocoded).toBe(false)
  })

  it("geocode 'unavailable' (IGN outage) → lat/lng = null too — obsolete coords NEVER survive an address change", async () => {
    asOwner()
    geocodeMock.mockResolvedValue({ status: 'unavailable' })
    const res = await patch(body)
    expect(res.status).toBe(200)
    const data = db.restaurant.update.mock.calls[0][0].data
    expect(data.lat).toBeNull()
    expect(data.lng).toBeNull()
    expect(data.lat).not.toBe(45.0)
    expect((await res.json()).geocodeStatus).toBe('unavailable')
  })

  it('a PATCH that does NOT touch the address (name only) never geocodes nor touches coords', async () => {
    asOwner()
    const res = await patch({ name: 'Nouveau nom' })
    expect(res.status).toBe(200)
    expect(geocodeMock).not.toHaveBeenCalled()
    const data = db.restaurant.update.mock.calls[0][0].data
    expect(data).not.toHaveProperty('lat')
    expect(data).not.toHaveProperty('lng')
  })

  it('fixing ONLY the postal code still re-geocodes (CP has no stored column to diff against)', async () => {
    asOwner()
    geocodeMock.mockResolvedValue({ status: 'ok', coords: { latitude: 43.94, longitude: 4.54 } })
    const res = await patch({ postalCode: '30210' })
    expect(res.status).toBe(200)
    // Geocodes with the STORED address/city + the new CP.
    expect(geocodeMock).toHaveBeenCalledWith('1 vieille rue', 'Ancienneville', '30210')
    const data = db.restaurant.update.mock.calls[0][0].data
    expect(data.lat).toBe(43.94)
    expect(data.lng).toBe(4.54)
  })
})

// ── Keep-on-outage quand le TEXTE d'adresse est inchangé (revue post-B3) ─────
// The obsolete-coords rule only holds when the address/city actually CHANGED.
// A no-op re-save (the UI always sends the CP) during a transient IGN/BAN
// outage must NOT wipe valid coords for an UNCHANGED address — that was the
// exact regression the WAVE 2 keep-on-outage rule prevented.
describe('B3 refined — outage on an UNCHANGED address keeps the valid coords', () => {
  it("re-saving the form byte-identical (address+city unchanged, CP present) during an outage KEEPS the coords", async () => {
    asOwner()
    geocodeMock.mockResolvedValue({ status: 'unavailable' })
    const res = await patch({ address: '1 vieille rue', city: 'Ancienneville', postalCode: '30210' })
    expect(res.status).toBe(200)
    expect(db.restaurant.update).toHaveBeenCalledTimes(1)
    const data = db.restaurant.update.mock.calls[0][0].data
    // Coords untouched by the write — the stored (45, 3) survive the outage.
    expect(data).not.toHaveProperty('lat')
    expect(data).not.toHaveProperty('lng')
    const json = await res.json()
    expect(json.geocodeStatus).toBe('unavailable')
    expect(json.coordsKept).toBe(true)
    expect(json.geocoded).toBe(false)
  })

  it('a CP-only save during an outage keeps the coords too (no text change at all)', async () => {
    asOwner()
    geocodeMock.mockResolvedValue({ status: 'unavailable' })
    const res = await patch({ postalCode: '30210' })
    expect(res.status).toBe(200)
    const data = db.restaurant.update.mock.calls[0][0].data
    expect(data).not.toHaveProperty('lat')
    expect(data).not.toHaveProperty('lng')
    expect((await res.json()).coordsKept).toBe(true)
  })

  it("BUT a positive 'not_found' on the unchanged address still nulls the coords (contradicting CP = user signal)", async () => {
    asOwner()
    geocodeMock.mockResolvedValue({ status: 'not_found' })
    const res = await patch({ address: '1 vieille rue', city: 'Ancienneville', postalCode: '75001' })
    expect(res.status).toBe(200)
    const data = db.restaurant.update.mock.calls[0][0].data
    expect(data.lat).toBeNull()
    expect(data.lng).toBeNull()
    expect((await res.json()).coordsKept).toBe(false)
  })

  it("and an outage on a CHANGED address still nulls the coords (they describe the OLD address)", async () => {
    asOwner()
    geocodeMock.mockResolvedValue({ status: 'unavailable' })
    const res = await patch({ address: '4 chemin des Oliviers', city: 'Fournès', postalCode: '30210' })
    expect(res.status).toBe(200)
    const data = db.restaurant.update.mock.calls[0][0].data
    expect(data.lat).toBeNull()
    expect(data.lng).toBeNull()
    expect((await res.json()).coordsKept).toBe(false)
  })
})

// ── Unicode-aware numeric-city gate + CP normalization (revue post-B3) ───────
describe('B3 refined — Unicode digits in the city field are refused too', () => {
  it("refuses a FULLWIDTH numeric city '３０２１０' (IME/mobile input)", async () => {
    asOwner()
    const res = await patch({ address: '4 chemin des Oliviers', city: '３０２１０', postalCode: '30210' })
    expect(res.status).toBe(400)
    expect((await res.json()).reason).toBe('invalid_city')
    expect(db.restaurant.update).not.toHaveBeenCalled()
  })

  it("refuses an ARABIC-INDIC numeric city '٣٠٢١٠'", async () => {
    asOwner()
    const res = await patch({ address: '4 chemin des Oliviers', city: '٣٠٢١٠', postalCode: '30210' })
    expect(res.status).toBe(400)
    expect((await res.json()).reason).toBe('invalid_city')
    expect(db.restaurant.update).not.toHaveBeenCalled()
  })

  it("accepts a FULLWIDTH postal code '３０２１０' and forwards it NFKC-normalized to the geocoder", async () => {
    asOwner()
    geocodeMock.mockResolvedValue({ status: 'ok', coords: { latitude: 43.94, longitude: 4.54 } })
    const res = await patch({ address: '4 chemin des Oliviers', city: 'Fournès', postalCode: '３０２１０' })
    expect(res.status).toBe(200)
    expect(geocodeMock).toHaveBeenCalledWith('4 chemin des Oliviers', 'Fournès', '30210')
  })
})
