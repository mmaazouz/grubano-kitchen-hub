import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ── V5-2 — le mode « Livraison » n'est proposé que si le serveur l'accepterait ─
// La fiche publique et le panier proposaient « Livraison » alors que P0-01 la
// refuse côté serveur (403 delivery_disabled, flag DELIVERY_FULFILLMENT_ENABLED
// défaut OFF). Ces tests verrouillent : (1) GET /api/restaurants/[id] expose
// fulfillment.delivery calculé par la MÊME source de vérité (lib/fulfillment,
// non mockée — pilotée par l'env) ; (2) les deux surfaces UI gatent leur chip
// livraison sur ce champ (garde source) ; (3) le retour post-pilote = une seule
// bascule d'env.

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
// ⚠️ @/lib/fulfillment N'EST PAS mocké — la source de vérité réelle est testée.

import { GET } from '@/app/api/restaurants/[id]/route'

const restaurantRow = (over: Record<string, unknown> = {}) => ({
  id: 'r1', name: 'Resto Test', description: '', coverPhoto: null, logo: null,
  cuisine: [], rating: 0, reviewCount: 0, deliveryTime: '20-30', minOrder: 0,
  deliveryFee: 2.5, city: 'Paris', address: '1 rue A', lat: null, lng: null,
  deliveryEnabled: true, pickupEnabled: true, archivedAt: null,
  brands: [],
  ...over,
})

const ORIG_FLAG = process.env.DELIVERY_FULFILLMENT_ENABLED

beforeEach(() => {
  vi.clearAllMocks()
  db.dishAdoption.findMany.mockResolvedValue([])
  db.restaurantTable.count.mockResolvedValue(0)
  delete process.env.DELIVERY_FULFILLMENT_ENABLED
})
afterEach(() => {
  if (ORIG_FLAG === undefined) delete process.env.DELIVERY_FULFILLMENT_ENABLED
  else process.env.DELIVERY_FULFILLMENT_ENABLED = ORIG_FLAG
})

const getJson = async () => {
  db.restaurant.findFirst.mockResolvedValue(restaurantRow())
  const res = await GET(new Request('http://x/api/restaurants/r1'), { params: { id: 'r1' } })
  return res.json()
}

describe('GET /api/restaurants/[id] — fulfillment.delivery (V5-2, même source que le refus P0-01)', () => {
  it('flag OFF (défaut pilote) → delivery false, même si la colonne resto est true', async () => {
    const j = await getJson()
    expect(j.fulfillment).toBeDefined()
    expect(j.fulfillment.delivery).toBe(false)
  })

  it('flag ON + colonne resto true → delivery true (retour post-pilote = une bascule)', async () => {
    process.env.DELIVERY_FULFILLMENT_ENABLED = 'true'
    const j = await getJson()
    expect(j.fulfillment.delivery).toBe(true)
  })

  it('flag ON mais colonne resto false → delivery false (2e étage de la garde)', async () => {
    process.env.DELIVERY_FULFILLMENT_ENABLED = 'true'
    db.restaurant.findFirst.mockResolvedValue(restaurantRow({ deliveryEnabled: false }))
    const res = await GET(new Request('http://x/api/restaurants/r1'), { params: { id: 'r1' } })
    const j = await res.json()
    expect(j.fulfillment.delivery).toBe(false)
  })
})

describe('V5-2 — gardes source : les 2 surfaces UI gatent leur chip livraison', () => {
  const ROOT = process.cwd()

  it('le panier ne rend le tab Livraison que sous deliveryAvailable, et démarre en pickup', () => {
    const src = fs.readFileSync(path.join(ROOT, 'app/[locale]/eat/cart/page.tsx'), 'utf8')
    expect(src).toMatch(/deliveryAvailable && \(\s*<button role="tab"[^>]*'delivery'/s)
    expect(src).toMatch(/useState<Fulfillment>\('pickup'\)/)
    expect(src).not.toMatch(/useState<Fulfillment>\('delivery'\)/)
  })

  it('la fiche publique filtre le chip delivery de MODES sur deliveryAvailable', () => {
    const src = fs.readFileSync(path.join(ROOT, 'app/[locale]/eat/r/[id]/page.tsx'), 'utf8')
    expect(src).toMatch(/MODES\.filter\(\(m\) => m !== 'delivery' \|\| deliveryAvailable\)/)
    expect(src).not.toMatch(/useState<Mode>\('delivery'\)/)
  })
})
