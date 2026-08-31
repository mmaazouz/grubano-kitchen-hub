import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── P1-SEC — GET /api/menu : porte d'authentification + scope propriétaire ─────
// GET /api/menu n'avait AUCUN contrôle de session (POST/PUT/DELETE de la MÊME
// route ont été gatés en WP-SEC-02, le GET a été oublié). Conséquences fermées ici :
//   • `GET /api/menu` nu → `findMany({ where: {} })` sans take/skip = dump du
//     catalogue de TOUTE la plateforme, tous opérateurs confondus ;
//   • `GET /api/menu?brandId=<marque étrangère>` → carte complète servie, plats
//     `available:false` inclus (le brandId est publiquement divulgué par la fiche
//     conso, qui renvoie `brandId` sur chaque plat : aucune devinette nécessaire).
// Contrat retenu : endpoint DASHBOARD PARTENAIRE (le catalogue conso, lui, passe
// par GET /api/restaurants/:id — testé en non-régression en bas de ce fichier).
// Gate calqué sur les mutations : 401 anonyme → 403 mauvais rôle → 404 cross-tenant
// (jamais 403 : l'existence d'une marque étrangère n'est pas confirmée).

const { db, session } = vi.hoisted(() => ({
  db: {
    operator:        { findUnique: vi.fn() },
    menuItem:        { findMany: vi.fn() },
    brand:           { findFirst: vi.fn() },
    restaurant:      { findFirst: vi.fn() },
    dishAdoption:    { findMany: vi.fn() },
    restaurantTable: { count: vi.fn() },
    promotion:       { findMany: vi.fn() },
  },
  session: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth', () => ({ getServerSession: session }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/dish-photo', () => ({
  processDishImage: vi.fn(),
  ALLOWED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
}))
// Dépendances de la fiche conso (non-régression) — neutres, jamais la cible du test.
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
vi.mock('@/lib/fulfillment', () => ({ isDeliveryFulfillmentEnabled: () => false }))
vi.mock('@/lib/review-stats', () => ({ realReviewCounts: vi.fn().mockResolvedValue(new Map()) }))
vi.mock('@/lib/geocode', () => ({
  geocodeAddressDetailed: vi.fn(),
  isPlausibleAddress: () => true,
}))
vi.mock('@/lib/publication-rule', () => ({ decidePublication: vi.fn() }))
vi.mock('@/lib/address-validation', () => ({
  isNumericOnly: () => false,
  normalizeFrenchPostalCode: (s: string) => s,
  ADDRESS_FIELD_ERRORS: {},
}))

import { GET } from '@/app/api/menu/route'
import { GET as GET_RESTAURANT } from '@/app/api/restaurants/[id]/route'

// ── helpers ───────────────────────────────────────────────────────────────────

const get = (qs = '') => GET(new Request(`http://x/api/menu${qs}`))

const anon = () => session.mockResolvedValue(null)
const as = (id: string, role: string) => {
  session.mockResolvedValue({ user: { email: `${id}@x.fr` } })
  db.operator.findUnique.mockResolvedValue({ id, role })
}
/** La marque demandée appartient à `operatorId` : le findFirst owner-scopé du
 *  handler ne la trouve QUE si le caller est ce propriétaire (ou admin). */
const brandOwnedBy = (operatorId: string) =>
  db.brand.findFirst.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
    Promise.resolve(
      where.operatorId === undefined || where.operatorId === operatorId
        ? { id: where.id as string }
        : null,
    ),
  )
const brandNotFound = () => db.brand.findFirst.mockResolvedValue(null)

const dish = (over: Record<string, unknown> = {}) => ({
  id: 'm1', brandId: 'b1', name: 'Gnocchi', description: '', price: 12,
  comparePrice: null, category: 'Plats', calories: null, allergens: [], labels: [],
  photos: [], options: [], available: true, isPopular: false, prepTime: null,
  createdAt: new Date(), updatedAt: new Date(),
  ...over,
})

const argOf = () =>
  db.menuItem.findMany.mock.calls[0][0] as Record<string, unknown>
const whereOf = () =>
  (argOf() as { where: Record<string, unknown> }).where

beforeEach(() => {
  vi.clearAllMocks()
  db.menuItem.findMany.mockResolvedValue([])
  db.dishAdoption.findMany.mockResolvedValue([])
  db.restaurantTable.count.mockResolvedValue(0)
  db.promotion.findMany.mockResolvedValue([])
})

// ── 1. La porte ───────────────────────────────────────────────────────────────

describe('GET /api/menu — porte d\'authentification (était totalement ouverte)', () => {
  it('anonyme → 401 et AUCUNE lecture de plat', async () => {
    anon()
    const res = await get('?brandId=b1')
    expect(res.status).toBe(401)
    expect(db.menuItem.findMany).not.toHaveBeenCalled()
  })

  it('anonyme SANS paramètre → 401 : le dump plateforme est fermé', async () => {
    anon()
    const res = await get()
    expect(res.status).toBe(401)
    expect(db.menuItem.findMany).not.toHaveBeenCalled()
  })

  it('rôle consumer → 403 et AUCUNE lecture de plat', async () => {
    as('c1', 'consumer')
    const res = await get('?brandId=b1')
    expect(res.status).toBe(403)
    expect(db.menuItem.findMany).not.toHaveBeenCalled()
  })

  it('rôle creator → 403 (seuls restaurant|admin, comme POST/PUT/DELETE)', async () => {
    as('cr1', 'creator')
    const res = await get('?brandId=b1')
    expect(res.status).toBe(403)
    expect(db.menuItem.findMany).not.toHaveBeenCalled()
  })
})

// ── 2. Le propriétaire : comportement INCHANGÉ (non-régression dashboard) ──────

describe('GET /api/menu?brandId= — propriétaire : réponse inchangée', () => {
  it('propriétaire avec SA marque → 200 + ses plats, y compris available:false', async () => {
    as('op1', 'restaurant'); brandOwnedBy('op1')
    const indispo = dish({ id: 'm2', name: 'Rupture', available: false })
    db.menuItem.findMany.mockResolvedValue([dish(), indispo])

    const res = await get('?brandId=b1')
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.items).toHaveLength(2)
    // C'est SON dashboard : le plat en rupture DOIT rester visible (pas de filtre
    // available:true ici — ce filtre est celui de la fiche conso).
    expect(body.items.find((i: { id: string }) => i.id === 'm2').available).toBe(false)
    // Aucun select restrictif : le partenaire garde ses champs de gestion.
    expect(body.items[0]).toHaveProperty('createdAt')

    expect(whereOf()).toEqual({ brandId: 'b1' })
  })

  it('propriétaire + category → les DEUX filtres, toujours scopé à sa marque', async () => {
    as('op1', 'restaurant'); brandOwnedBy('op1')
    const res = await get('?brandId=b1&category=Desserts')
    expect(res.status).toBe(200)
    expect(whereOf()).toEqual({ brandId: 'b1', category: 'Desserts' })
  })
})

// ── 3. Cross-tenant ───────────────────────────────────────────────────────────

describe('GET /api/menu?brandId= — marque étrangère (IDOR de lecture)', () => {
  it('marque d\'un AUTRE opérateur → 404 exact, AUCUNE lecture de plat', async () => {
    as('op1', 'restaurant'); brandOwnedBy('op2')
    const res = await get('?brandId=b-etrangere')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Marque introuvable' })
    expect(db.menuItem.findMany).not.toHaveBeenCalled()
  })

  it('marque INEXISTANTE → 404 identique : aucun oracle d\'existence', async () => {
    as('op1', 'restaurant'); brandNotFound()
    const res = await get('?brandId=nawak')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Marque introuvable' })
    expect(db.menuItem.findMany).not.toHaveBeenCalled()
  })

  it('la vérification de propriété est bien owner-scopée en base', async () => {
    as('op1', 'restaurant'); brandOwnedBy('op1')
    await get('?brandId=b1')
    expect(db.brand.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'b1', operatorId: 'op1' } }),
    )
  })
})

// ── 4. Sans brandId : plus jamais le catalogue global ─────────────────────────

describe('GET /api/menu (sans brandId) — borné aux marques du caller', () => {
  it('restaurant → where scopé sur ses marques, JAMAIS un where vide', async () => {
    as('op1', 'restaurant')
    const res = await get()
    expect(res.status).toBe(200)

    const where = whereOf()
    expect(where).toEqual({ brand: { operatorId: 'op1' } })
    // Le bug d'origine : `where: {}` → tous les plats de tous les opérateurs.
    expect(Object.keys(where).length).toBeGreaterThan(0)
    // Et aucun filtre par marque n'est éludé au profit d'une lecture nue.
    expect(db.menuItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { brand: { operatorId: 'op1' } } }),
    )
  })

  it('restaurant + category, sans brandId → le scope propriétaire tient', async () => {
    as('op1', 'restaurant')
    await get('?category=Plats')
    expect(whereOf()).toEqual({ category: 'Plats', brand: { operatorId: 'op1' } })
  })

  it('admin → lecture non scopée conservée (superuser, comme PUT/DELETE)', async () => {
    as('adm', 'admin')
    const res = await get()
    expect(res.status).toBe(200)
    expect(whereOf()).toEqual({})
  })

  it('admin avec une marque qu\'il ne possède pas → 200 (superuser)', async () => {
    as('adm', 'admin'); brandOwnedBy('op2')
    const res = await get('?brandId=b1')
    expect(res.status).toBe(200)
    expect(db.brand.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'b1' } }),
    )
  })
})

// ── 4bis. Le paramètre ne peut pas être détourné ──────────────────────────────
// Deux pièges classiques d'un gate « vérifie X puis requête X » : la valeur vérifiée
// et la valeur requêtée peuvent diverger si un paramètre est DUPLIQUÉ, et un
// paramètre VIDE peut retomber sur une requête nue au lieu du scope propriétaire.

describe('GET /api/menu — brandId dupliqué ou vide', () => {
  /** Une seule marque possédée, identifiée par son id (le mock générique
   *  brandOwnedBy() ignore l'id : il ne prouverait rien ici). */
  const onlyOwns = (brandId: string, operatorId: string) =>
    db.brand.findFirst.mockImplementation(({ where }: { where: Record<string, unknown> }) =>
      Promise.resolve(
        where.id === brandId && (where.operatorId === undefined || where.operatorId === operatorId)
          ? { id: brandId }
          : null,
      ),
    )

  it('?brandId=mienne&brandId=étrangère → la vérification ET la requête portent sur la PREMIÈRE', async () => {
    as('op1', 'restaurant'); onlyOwns('b-mienne', 'op1')
    const res = await get('?brandId=b-mienne&brandId=b-etrangere')
    expect(res.status).toBe(200)
    // Aucune divergence : la marque vérifiée est celle qui part dans le where.
    expect(db.brand.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'b-mienne', operatorId: 'op1' } }),
    )
    expect(whereOf()).toEqual({ brandId: 'b-mienne' })
  })

  it('?brandId=étrangère&brandId=mienne → 404 : l\'ordre inverse ne contourne rien', async () => {
    as('op1', 'restaurant'); onlyOwns('b-mienne', 'op1')
    const res = await get('?brandId=b-etrangere&brandId=b-mienne')
    expect(res.status).toBe(404)
    expect(db.menuItem.findMany).not.toHaveBeenCalled()
  })

  it('?brandId= (vide) → repli sur le scope propriétaire, JAMAIS un where nu', async () => {
    as('op1', 'restaurant')
    const res = await get('?brandId=')
    expect(res.status).toBe(200)
    expect(whereOf()).toEqual({ brand: { operatorId: 'op1' } })
    // Un brandId vide n'est pas une marque à vérifier : aucun oracle déclenché.
    expect(db.brand.findFirst).not.toHaveBeenCalled()
  })
})

// ── 4ter. Lecture BORNÉE + réponse non mutualisable ───────────────────────────
// La fuite cross-tenant est fermée, mais la branche ADMIN atteignait encore
// `where: {}` SANS take/skip : un seul appel matérialisait toutes les lignes
// MenuItem de la plateforme (champs Json complets) dans le process Passenger.
// Et la charge utile étant devenue TENANT-PRIVÉE, un cache partagé en amont
// (LiteSpeed/Apache, CDN) indexé sur l'URL seule servirait la carte de A à B.

describe('GET /api/menu — bornage de la lecture', () => {
  it('propriétaire sans take → AUCUN take, AUCUN skip (dashboard byte-identique)', async () => {
    as('op1', 'restaurant'); brandOwnedBy('op1')
    await get('?brandId=b1')
    const arg = argOf()
    expect(arg).not.toHaveProperty('take')
    expect(arg).not.toHaveProperty('skip')
  })

  it('admin sans brandId → lecture plafonnée (plus de dump de table entière)', async () => {
    as('adm', 'admin')
    await get()
    expect(argOf().take).toBe(500)
  })

  it('take explicite honoré, et plafonné à 500 (un client ne peut pas élargir)', async () => {
    as('op1', 'restaurant'); brandOwnedBy('op1')
    await get('?brandId=b1&take=10')
    expect(argOf().take).toBe(10)

    db.menuItem.findMany.mockClear()
    await get('?brandId=b1&take=9999')
    expect(argOf().take).toBe(500)
  })

  it('skip explicite honoré ; take invalide → ignoré, pas de borne fantaisiste', async () => {
    as('op1', 'restaurant'); brandOwnedBy('op1')
    await get('?brandId=b1&skip=20&take=abc')
    const arg = argOf()
    expect(arg.skip).toBe(20)
    expect(arg).not.toHaveProperty('take')
  })

  it('la réponse 200 interdit explicitement tout cache partagé', async () => {
    as('op1', 'restaurant'); brandOwnedBy('op1')
    const res = await get('?brandId=b1')
    expect(res.headers.get('Cache-Control')).toBe('private, no-store')
  })
})

// ── 5. NON-RÉGRESSION — le catalogue CONSO reste public et intact ──────────────

describe('GET /api/restaurants/[id] — catalogue consommateur inchangé', () => {
  const restaurantRow = () => ({
    id: 'r1', name: 'Resto Test', description: '', coverPhoto: null, logo: null,
    cuisine: [], rating: 4.5, reviewCount: 12, deliveryTime: '20-30', minOrder: 0,
    deliveryFee: 2.5, city: 'Paris', address: '1 rue A', lat: null, lng: null,
    deliveryEnabled: true, archivedAt: null,
    brands: [{
      id: 'b1', name: 'Gnocchi Bar',
      menuItems: [{
        id: 'm1', name: 'Gnocchi', description: '', price: 12, comparePrice: null,
        category: 'Plats', calories: null, allergens: [], labels: [], photos: [],
        options: [], isPopular: false, prepTime: null,
      }],
    }],
  })
  const getResto = () =>
    GET_RESTAURANT(new Request('http://x/api/restaurants/r1'), { params: { id: 'r1' } })

  it('ANONYME → 200 + menu : la fiche conso reste publique', async () => {
    anon()
    db.restaurant.findFirst.mockResolvedValue(restaurantRow())

    const res = await getResto()
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.menu[0].category).toBe('Plats')
    expect(body.menu[0].items[0].name).toBe('Gnocchi')
    expect(body.itemCount).toBe(1)
    // Le brandId reste exposé (la fiche l'annote par plat) — ce n'est plus une
    // clé d'accès puisque GET /api/menu vérifie désormais la propriété.
    expect(body.menu[0].items[0].brandId).toBe('b1')
  })

  it('ses filtres de minimisation sont intacts (available + archivedAt + select)', async () => {
    anon()
    db.restaurant.findFirst.mockResolvedValue(restaurantRow())
    await getResto()

    const arg = db.restaurant.findFirst.mock.calls[0][0]
    expect(arg.where).toEqual({ id: 'r1', archivedAt: null })

    const menuSel = arg.include.brands.select.menuItems
    expect(menuSel.where).toEqual({ available: true })
    // select EXPLICITE : ni available, ni createdAt, ni updatedAt côté conso.
    expect(menuSel.select).not.toHaveProperty('available')
    expect(menuSel.select).not.toHaveProperty('createdAt')
    expect(menuSel.select).not.toHaveProperty('updatedAt')
    expect(menuSel.select.name).toBe(true)
  })

  it('établissement archivé/introuvable → 404 (comportement conservé)', async () => {
    anon()
    db.restaurant.findFirst.mockResolvedValue(null)
    const res = await getResto()
    expect(res.status).toBe(404)
  })
})
