import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Le choix des modes de retrait de l'onboarding est desormais PERSISTE ──────
// Les colonnes deliveryEnabled / pickupEnabled existent depuis toujours sur
// Restaurant et gouvernent la creation de commande (lib/fulfillment), mais
// POST /api/restaurants ne les acceptait pas : un etablissement cree par
// /business/onboarding gardait pickupEnabled=false (defaut) tandis que
// DELIVERY_FULFILLMENT_ENABLED (defaut OFF) refuse la livraison pour tous — il
// ne pouvait donc recevoir AUCUNE commande. La regle metier ne change pas :
// le flag pilote prime toujours, et isActive reste force a false.

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
  db.restaurant.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'r1', ...data }))
  db.brand.findFirst.mockResolvedValue(null)
  db.brand.updateMany.mockResolvedValue({ count: 0 })
  // Interactive transaction → replay the callback against the same mock client.
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db))
})

const createdData = () => db.restaurant.create.mock.calls[0][0].data as Record<string, unknown>

describe('POST /api/restaurants — modes de retrait', () => {
  it('persiste le choix du partenaire (retrait seul)', async () => {
    const res = await createRestaurant(post({ ...base, deliveryEnabled: false, pickupEnabled: true }))
    expect(res.status).toBe(201)
    expect(createdData().pickupEnabled).toBe(true)
    expect(createdData().deliveryEnabled).toBe(false)
  })

  it('persiste aussi le cas inverse (livraison seule)', async () => {
    await createRestaurant(post({ ...base, deliveryEnabled: true, pickupEnabled: false }))
    expect(createdData().deliveryEnabled).toBe(true)
    expect(createdData().pickupEnabled).toBe(false)
  })

  it('champs omis → aucune valeur forcee, les defauts du schema s appliquent', async () => {
    await createRestaurant(post(base))
    expect(createdData()).not.toHaveProperty('deliveryEnabled')
    expect(createdData()).not.toHaveProperty('pickupEnabled')
  })

  it('isActive reste FORCE a false — l activation demeure admin-only', async () => {
    await createRestaurant(post({ ...base, pickupEnabled: true, isActive: true }))
    expect(createdData().isActive).toBe(false)
  })

  it('valeurs non booleennes rejetees par zod (400)', async () => {
    const res = await createRestaurant(post({ ...base, pickupEnabled: 'oui' }))
    expect(res.status).toBe(400)
    expect(db.restaurant.create).not.toHaveBeenCalled()
  })
})
