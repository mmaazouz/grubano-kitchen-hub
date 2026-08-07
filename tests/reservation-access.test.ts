import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ── V5-1b — le parcours de réservation devient ATTEIGNABLE, mais seulement ────
// quand il est OPÉRABLE. L'audit AE-0 a établi : l'unique entrée vivait dans le
// panneau panier vide (desktop only, display:none <1080) et le chip « Sur
// place » était VISUAL ONLY. Ces tests verrouillent : (1) GET /api/restaurants/
// [id] expose reservable = « au moins une table configurée » (dark kitchen = 0
// table → false, jamais d'entrée vers un parcours qui échouera) ; (2) le chip
// « Sur place » navigue vers /reserver quand reservable (mobile ET desktop —
// même barre de modes) ; (3) le bouton du panneau vide est gaté pareil.

const { db, sessionMock } = vi.hoisted(() => ({
  db: {
    restaurant:      { findFirst: vi.fn() },
    dishAdoption:    { findMany: vi.fn().mockResolvedValue([]) },
    restaurantTable: { count: vi.fn().mockResolvedValue(0) },
  },
  sessionMock: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/opening-hours', () => ({
  publicHoursSummary: vi.fn().mockResolvedValue({
    hoursConfigured: false, isOpenNow: null, nextOpening: null, weeklyHours: [], currentClosure: null,
  }),
}))
vi.mock('@/lib/promotions', () => ({
  fetchActivePromotions: vi.fn().mockResolvedValue([]),
  evaluatePromotion: vi.fn().mockReturnValue(0),
  round2: (n: number) => Math.round(n * 100) / 100,
}))
vi.mock('@/lib/pricing', () => ({
  smallOrderFeeConfigCents: () => 0,
  smallOrderThresholdCents: () => 0,
}))
vi.mock('@/lib/tips', () => ({ isTipsEnabled: () => false }))
vi.mock('@/lib/review-stats', () => ({ realReviewCounts: vi.fn().mockResolvedValue(new Map()) }))
vi.mock('@/lib/geocode', () => ({
  geocodeAddressDetailed: vi.fn(),
  isPlausibleAddress: () => true,
}))
vi.mock('@/lib/publication-rule', () => ({ decidePublication: vi.fn() }))

import { GET } from '@/app/api/restaurants/[id]/route'

const restaurantRow = () => ({
  id: 'r1', name: 'Resto Test', description: '', coverPhoto: null, logo: null,
  cuisine: [], rating: 0, reviewCount: 0, deliveryTime: '20-30', minOrder: 0,
  deliveryFee: 2.5, city: 'Paris', address: '1 rue A', lat: null, lng: null,
  deliveryEnabled: true, pickupEnabled: true, archivedAt: null, brands: [],
})

beforeEach(() => {
  vi.clearAllMocks()
  db.dishAdoption.findMany.mockResolvedValue([])
  db.restaurant.findFirst.mockResolvedValue(restaurantRow())
})

const getJson = async () => {
  const res = await GET(new Request('http://x/api/restaurants/r1'), { params: { id: 'r1' } })
  return res.json()
}

describe('GET /api/restaurants/[id] — reservable (V5-1b, garde d’opérabilité)', () => {
  it('au moins une table configurée → reservable true', async () => {
    db.restaurantTable.count.mockResolvedValue(3)
    const j = await getJson()
    expect(j.reservable).toBe(true)
    expect(db.restaurantTable.count).toHaveBeenCalledWith({ where: { restaurantId: 'r1' } })
  })

  it('0 table (dark kitchen) → reservable false : aucun point d’entrée vers un parcours qui échouera', async () => {
    db.restaurantTable.count.mockResolvedValue(0)
    const j = await getJson()
    expect(j.reservable).toBe(false)
  })

  it('échec du count → false (l’entrée se cache, la fiche ne casse jamais)', async () => {
    db.restaurantTable.count.mockRejectedValue(new Error('db down'))
    const j = await getJson()
    expect(j.reservable).toBe(false)
    expect(j.restaurant?.id).toBe('r1')
  })
})

describe('V5-1b — gardes source : les points d’entrée sont gatés et le chip navigue', () => {
  const ROOT = process.cwd()
  const src = () => fs.readFileSync(path.join(ROOT, 'app/[locale]/eat/r/[id]/page.tsx'), 'utf8')

  it('le chip « Sur place » navigue vers /reserver quand reservable (sinon comportement visuel inchangé)', () => {
    expect(src()).toMatch(/m === 'dinein' && reservable \? router\.push\(`\/eat\/r\/\$\{id\}\/reserver`\) : setMode\(m\)/)
  })

  it('le bouton « Réserver une table » du panneau vide est gaté sur reservable', () => {
    expect(src()).toMatch(/\{reservable && \([\s\S]{0,300}?reserver`\)\}>/)
  })

  it('la fiche lit d.reservable de façon tolérante (absent ⇒ caché)', () => {
    expect(src()).toMatch(/if \(d\.reservable === true\) setReservable\(true\)/)
  })
})
