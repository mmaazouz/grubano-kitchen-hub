import { describe, it, expect } from 'vitest'
import { haversineKm } from '@/lib/geocode'

// Distance helper drives /api/restaurants discovery sorting + radius tiers.
// A regression here silently mis-ranks restaurants by distance.
describe('haversineKm', () => {
  const orange   = { latitude: 44.1380, longitude: 4.8079 }
  const avignon  = { latitude: 43.9493, longitude: 4.8055 }
  const paris    = { latitude: 48.8566, longitude: 2.3522 }
  const london   = { latitude: 51.5074, longitude: -0.1278 }

  it('is zero for identical points', () => {
    expect(haversineKm(orange, orange)).toBe(0)
  })

  it('matches the known Orange→Avignon distance (~21 km)', () => {
    expect(haversineKm(orange, avignon)).toBeCloseTo(20.98, 1)
  })

  it('matches the known Paris→London distance (~343.6 km)', () => {
    expect(haversineKm(paris, london)).toBeCloseTo(343.56, 0)
  })

  it('is symmetric (a→b equals b→a)', () => {
    expect(haversineKm(orange, avignon)).toBeCloseTo(haversineKm(avignon, orange), 6)
  })
})

// ── WAVE 2 — reverseGeocode (coords → adresse lisible, Géoplateforme IGN) ────
// Mêmes conventions d'échec que le forward : 'not_found' = réponse propre sans
// résultat, 'unavailable' = panne/timeout/corps malformé (jamais bloquant).
import { vi, afterEach } from 'vitest'
import { reverseGeocode } from '@/lib/geocode'

describe('reverseGeocode', () => {
  afterEach(() => vi.unstubAllGlobals())

  const stub = (impl: (url: string) => any) => vi.stubGlobal('fetch', vi.fn(async (url: string) => impl(String(url))))

  it('hits the current Géoplateforme endpoint with lon (not lng) and returns the readable label', async () => {
    let seen = ''
    stub((url) => {
      seen = url
      return {
        ok: true,
        json: async () => ({ features: [{ properties: { label: '8 Place de l\'Hôtel de Ville 75004 Paris', city: 'Paris', postcode: '75004', district: 'Paris 4e Arrondissement' } }] }),
      }
    })
    const r = await reverseGeocode(48.8566, 2.3522)
    expect(seen).toContain('data.geopf.fr/geocodage/reverse/')
    expect(seen).toContain('lat=48.8566')
    expect(seen).toContain('lon=2.3522') // ⚠ l'API attend lon, pas lng
    expect(r).toEqual({ status: 'ok', label: '8 Place de l\'Hôtel de Ville 75004 Paris', city: 'Paris', postcode: '75004', district: 'Paris 4e Arrondissement' })
  })

  it('clean empty answer → not_found (never invents an address)', async () => {
    stub(() => ({ ok: true, json: async () => ({ features: [] }) }))
    expect((await reverseGeocode(0, 0)).status).toBe('not_found')
  })

  it('non-2xx (429/5xx) → unavailable (third-party outage, non-blocking)', async () => {
    stub(() => ({ ok: false, status: 429, json: async () => ({}) }))
    expect((await reverseGeocode(48.85, 2.35)).status).toBe('unavailable')
  })

  it('network throw → unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down') }))
    expect((await reverseGeocode(48.85, 2.35)).status).toBe('unavailable')
  })

  it('non-finite coords → not_found without calling the service', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    expect((await reverseGeocode(NaN, 2)).status).toBe('not_found')
    expect(f).not.toHaveBeenCalled()
  })
})
