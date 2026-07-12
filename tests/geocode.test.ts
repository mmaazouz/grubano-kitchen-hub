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
