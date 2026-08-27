import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── P0 golden path : la marque du wizard est RATTACHEE a l'etablissement ──────
// /business/onboarding cree la Brand AVANT le Restaurant : POST /api/brands la
// stocke avec restaurantId:null, et AUCUN writer ne posait ensuite ce lien
// (PATCH /api/brands/[id] ne l'accepte pas). Or le menu consommateur
// (GET /api/restaurants/[id]) ne lit QUE les brands rattachees → un partenaire
// onboarde plein rail obtenait une fiche publique a menu VIDE, donc zero
// commande possible. Desormais POST /api/restaurants (creation non-additional)
// rattache les marques orphelines de l'operateur dans la MEME transaction.

const { db, geo } = vi.hoisted(() => ({
  db: {
    operator:   { findUnique: vi.fn() },
    restaurant: { findFirst: vi.fn(), create: vi.fn() },
    brand:      { findFirst: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
  geo: {
    geocodeAddressDetailed: vi.fn(async () => ({ status: 'ok', latitude: 1, longitude: 2 })),
    geocodeAddress:         vi.fn(async () => ({ latitude: 1, longitude: 2 })),
    isPlausibleAddress:     vi.fn(() => true),
    haversineKm:            vi.fn(() => 1),
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => ({ user: { email: 'op@x.zz' } })) }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/geocode', () => geo)

import { POST as createRestaurant } from '@/app/api/restaurants/route'

const post = (body: Record<string, unknown>) =>
  new Request('http://t/api/restaurants', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
const base = { name: 'Chez Test', city: 'Paris', address: '1 rue de la Paix', cuisine: ['pizza'] }

beforeEach(() => {
  vi.clearAllMocks()
  db.operator.findUnique.mockResolvedValue({ id: 'op1', role: 'restaurant', status: 'active' })
  db.restaurant.findFirst.mockResolvedValue(null)
  db.restaurant.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'r-new', ...data }))
  db.brand.findFirst.mockResolvedValue(null)
  db.brand.updateMany.mockResolvedValue({ count: 1 })
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db))
})

describe('POST /api/restaurants — rattachement des marques orphelines', () => {
  it('creation wizard (non-additional) → les brands orphelines de CET operateur sont rattachees au nouvel etablissement', async () => {
    const res = await createRestaurant(post({ ...base, pickupEnabled: true }))
    expect(res.status).toBe(201)
    expect(db.brand.updateMany).toHaveBeenCalledTimes(1)
    expect(db.brand.updateMany).toHaveBeenCalledWith({
      where: { operatorId: 'op1', restaurantId: null },
      data:  { restaurantId: 'r-new' },
    })
  })

  it('le rattachement se fait DANS la transaction de creation (tout ou rien)', async () => {
    await createRestaurant(post(base))
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    // updateMany n'a ete appele qu'a l'interieur du callback transactionnel
    // (le mock $transaction rejoue le callback sur le meme client).
    const txOrder = db.$transaction.mock.invocationCallOrder[0]
    const upOrder = db.brand.updateMany.mock.invocationCallOrder[0]
    expect(upOrder).toBeGreaterThan(txOrder)
  })

  it('creation deliberee d un etablissement SUPPLEMENTAIRE (additional:true) → ne re-route JAMAIS les orphelines', async () => {
    db.restaurant.findFirst.mockResolvedValue({ id: 'r-old' })
    const res = await createRestaurant(post({ ...base, additional: true }))
    expect(res.status).toBe(201)
    expect(db.brand.updateMany).not.toHaveBeenCalled()
  })

  it('echec du rattachement → la creation echoue aussi (pas d etablissement a menu condamne)', async () => {
    db.brand.updateMany.mockRejectedValue(new Error('db down'))
    const res = await createRestaurant(post(base))
    expect(res.status).toBe(500)
  })

  it('isActive reste FORCE a false meme avec le rattachement', async () => {
    await createRestaurant(post({ ...base, isActive: true }))
    const data = db.restaurant.create.mock.calls[0][0].data as Record<string, unknown>
    expect(data.isActive).toBe(false)
  })
})
