import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// ── V4-2 (vague 4) — notes fabriquées (décision fondateur CONSERVATRICE) ──────
// La base contient ZÉRO avis réel mais le listing public affichait et TRIAIT
// sur Restaurant.rating/reviewCount, colonnes héritées du seed (4,7-4,8 sur
// « 120+ avis ») et jamais recalculées. Contrat photographié ici :
//   1. AUCUNE note servie sans avis réel (table Review, status published) ;
//      le compteur servi est TOUJOURS le compteur réel.
//   2. Le listing public ne s'ordonne PLUS JAMAIS sur la colonne fabriquée —
//      repli honnête = nouveauté (createdAt desc), même si un ancien client
//      demande encore sort=rating.
//   3. Un restaurant avec de VRAIS avis garde sa note (rien n'est cassé).
// ⚠️ AUCUN recalcul d'agrégat n'est construit (interdit par le ticket) : le
// gate se contente de compter les avis réels (lib/review-stats).

const { db } = vi.hoisted(() => ({
  db: {
    restaurant: { findMany: vi.fn(), count: vi.fn() },
    review:     { groupBy: vi.fn() },
  },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
// Le module route importe next-auth/lib auth pour son POST — inertes ici.
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

import { GET } from '@/app/api/restaurants/route'
import { honestRating } from '@/lib/review-stats'

const ROW = (id: string) => ({
  id, name: `Resto ${id}`,
  coverPhoto: null, logo: null, cuisine: ['italian'],
  rating: 4.7, reviewCount: 127,          // ← les valeurs FABRIQUÉES du seed
  deliveryTime: 25, minOrder: 10, deliveryFee: 1.99,
  city: 'Orange', address: 'x', isActive: true,
  lat: 44.14, lng: 4.81, createdAt: new Date('2026-07-01T00:00:00Z'),
})

const call = (qs = '') => GET(new Request(`https://app.grubano.com/api/restaurants${qs}`))

beforeEach(() => {
  vi.clearAllMocks()
  db.restaurant.findMany.mockResolvedValue([ROW('r1'), ROW('r2')])
  db.restaurant.count.mockResolvedValue(2)
  db.review.groupBy.mockResolvedValue([]) // base réelle : ZÉRO avis
})

describe('V4-2 — le listing public ne sert AUCUNE note sans avis réel', () => {
  it('⭐ zéro avis réel → rating null et reviewCount 0 sur chaque ligne (la valeur seedée 4,7/127 ne sort jamais)', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    const { restaurants } = await res.json()
    expect(restaurants).toHaveLength(2)
    for (const r of restaurants) {
      expect(r.rating).toBeNull()
      expect(r.reviewCount).toBe(0)
    }
  })

  it('⭐ un restaurant avec de VRAIS avis garde sa note et sert le compteur RÉEL (pas le compteur seedé)', async () => {
    db.review.groupBy.mockResolvedValue([{ restaurantId: 'r1', _count: { _all: 3 } }])
    const { restaurants } = await (await call()).json()
    const r1 = restaurants.find((r: { id: string }) => r.id === 'r1')
    const r2 = restaurants.find((r: { id: string }) => r.id === 'r2')
    expect(r1.rating).toBe(4.7)      // rien n'est cassé quand des avis réels existent
    expect(r1.reviewCount).toBe(3)   // …mais le compteur affiché est le compteur RÉEL
    expect(r2.rating).toBeNull()
    expect(r2.reviewCount).toBe(0)
  })

  it('le gate ne compte que les avis PUBLIÉS du bon restaurant (where restaurantId in + status published)', async () => {
    await call()
    expect(db.review.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { restaurantId: { in: ['r1', 'r2'] }, status: 'published' },
      }),
    )
  })

  it('la branche GÉO applique le même gate (rating null, compteur réel)', async () => {
    const { restaurants } = await (await call('?lat=44.1380&lng=4.8079')).json()
    expect(restaurants.length).toBeGreaterThan(0)
    for (const r of restaurants) {
      expect(r.rating).toBeNull()
      expect(r.reviewCount).toBe(0)
    }
  })
})

describe('V4-2 — le listing public ne s’ordonne PLUS sur la valeur fabriquée', () => {
  it('⭐ défaut (aucun sort) → orderBy createdAt desc (nouveauté), jamais rating', async () => {
    await call()
    expect(db.restaurant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
    )
  })

  it("⭐ sort=rating (ancien client) → retombe sur createdAt desc — la colonne fabriquée n'ordonne plus rien", async () => {
    await call('?sort=rating')
    expect(db.restaurant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
    )
  })

  it('sort=delivery reste intact (deliveryTime est une config opérateur, pas une valeur fabriquée)', async () => {
    await call('?sort=delivery')
    expect(db.restaurant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { deliveryTime: 'asc' } }),
    )
  })
})

describe('V4-2 — helper honestRating (lib/review-stats)', () => {
  it('0 avis réel → note masquée + compteur 0 ; N avis réels → note conservée + compteur N', () => {
    const row = { rating: 4.8, reviewCount: 42 }
    expect(honestRating(row, 0)).toEqual({ rating: null, reviewCount: 0 })
    expect(honestRating(row, 5)).toEqual({ rating: 4.8, reviewCount: 5 })
  })
})

describe('V4-2 — les surfaces conso ne demandent plus le tri fabriqué (épinglage source)', () => {
  const root = join(__dirname, '..')
  it("⭐ /eat home et /eat/search ne demandent plus sort=rating ; l'option de tri « Note » est retirée de la recherche", () => {
    const home = readFileSync(join(root, 'app', '[locale]', 'eat', 'page.tsx'), 'utf8')
    expect(home).not.toContain("sp.set('sort', 'rating')")
    expect(home).toContain("sp.set('sort', 'newest')")

    const search = readFileSync(join(root, 'app', '[locale]', 'eat', 'search', 'page.tsx'), 'utf8')
    expect(search).not.toContain("useState('rating')")
    expect(search).not.toContain("value: 'rating'")
  })

  it('les 4 pages /eat qui affichent une note la gardent derrière un garde null (aucun .toFixed/.toLocaleString sur une note absente)', () => {
    for (const rel of [
      ['app', '[locale]', 'eat', 'page.tsx'],
      ['app', '[locale]', 'eat', 'search', 'page.tsx'],
      ['app', '[locale]', 'eat', 'favorites', 'page.tsx'],
      ['app', '[locale]', 'eat', 'r', '[id]', 'page.tsx'],
    ] as const) {
      const src = readFileSync(join(root, ...rel), 'utf8')
      expect(src, rel.join('/')).toContain('rating != null')
      expect(src, rel.join('/')).toContain('rating: number | null')
    }
  })
})
