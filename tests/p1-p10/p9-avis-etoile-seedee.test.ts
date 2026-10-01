import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ── P9 — AVIS & ★ SEEDÉE — characterization tests (Sprint 0) ─────────────────
// Route under test: app/api/restaurants/[id]/reviews/route.ts (GET public + POST).
//
// Audit verdicts encoded below (tests are GREEN today — they photograph the
// CURRENT behaviour; every [FAIL-ATTENDU] must be INVERTED after the
// post-arbitrage fix):
//   1. POST is gated by session PRESENCE only: no role check, no ownership
//      check, and the optional `orderId` is stored VERBATIM without ever
//      querying prisma.order — a restaurant operator can 5-star their own
//      restaurant, and anyone with a session can review without any linked
//      (or even existing) order.
//   2. The restaurant headline star (Restaurant.rating, seeded at insert time)
//      is NEVER recomputed after a review: the route calls neither
//      prisma.restaurant.update nor any review aggregate. The public
//      restaurant sheet (app/api/restaurants/[id]/route.ts) serves the stored
//      column verbatim.
//
// Reality check vs the raw audit verdict (the tests encode the CODE):
//   • Verdict (1) is CONFIRMED by the code — prisma/schema.prisma even calls
//     Review.orderId a "soft link to the order reviewed (optional)".
//   • Verdict (2) is CONFIRMED, with a nuance: the route header comment says
//     the headline aggregate is "intentionally left untouched" (merging
//     on-platform reviews into it = later product decision). Behaviour is the
//     same (seeded ★ never moves), but the fix arbitrage may be either a real
//     recompute or an explicit product acceptance.
//   • A public GET DOES exist (published reviews + per-star distribution) —
//     characterized below.
//
// Statuses (encoded in each test title):
//   [PASS-ACTUEL]   current behaviour is the wanted behaviour.
//   [FAIL-ATTENDU]  asserts the CURRENT (broken) behaviour so it is GREEN
//                   today; invert after the post-arbitrage fix.
//   [NON-TESTABLE]  browser-only UI → it.todo.

const ROOT = process.cwd()

// Mock pattern copied from tests/admin-restaurant-approve-route.test.ts (same
// getServerSession(authOptions) + prisma shape). order.* mocks exist ONLY as
// never-called witnesses; restaurant.update / review.aggregate likewise.
const { db, sessionMock } = vi.hoisted(() => ({
  db: {
    review:     { findMany: vi.fn(), upsert: vi.fn(), aggregate: vi.fn() },
    restaurant: { findUnique: vi.fn(), update: vi.fn() },
    order:      { findUnique: vi.fn(), findFirst: vi.fn() },
  },
  sessionMock: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('next-auth', () => ({ getServerSession: sessionMock }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))

import { GET, POST } from '@/app/api/restaurants/[id]/reviews/route'

// Row shape returned by prisma (matches the route's SELECT).
const row = (
  id: string,
  rating: number,
  text: string | null,
  tags: unknown,
  operatorName: string | null,
) => ({
  id, rating, text, tags,
  createdAt: new Date('2026-07-27T10:00:00Z'),
  operator: { name: operatorName },
})

const postReview = (id: string, body: unknown) =>
  POST(
    new Request(`http://x/api/restaurants/${id}/reviews`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: { id } },
  )

const getReviews = (id: string) =>
  GET(new Request(`http://x/api/restaurants/${id}/reviews`), { params: { id } })

beforeEach(() => {
  vi.clearAllMocks()
  // Default: authenticated CONSUMER, restaurant exists, upsert succeeds.
  sessionMock.mockResolvedValue({ user: { id: 'u1', role: 'consumer' } })
  db.restaurant.findUnique.mockResolvedValue({ id: 'r1' })
  db.review.upsert.mockResolvedValue(row('rev1', 5, 'Excellent', ['taste'], 'Alice Dupont'))
})

// ════════════════════════════════════════════════════════════════════════════
describe('P9 — POST /api/restaurants/[id]/reviews : les gardes qui existent', () => {
  it('[PASS-ACTUEL] sans session → 401, aucune lecture ni écriture DB', async () => {
    sessionMock.mockResolvedValue(null)
    const res = await postReview('r1', { rating: 5 })
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
    expect(db.restaurant.findUnique).not.toHaveBeenCalled()
    expect(db.review.upsert).not.toHaveBeenCalled()
  })

  it('[PASS-ACTUEL] rating hors bornes (0, 6) ou absent → 400, aucune écriture', async () => {
    for (const body of [{ rating: 0 }, { rating: 6 }, {}]) {
      const res = await postReview('r1', body)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'invalid' })
    }
    expect(db.review.upsert).not.toHaveBeenCalled()
  })

  it('[PASS-ACTUEL] restaurant inexistant → 404, aucune écriture', async () => {
    db.restaurant.findUnique.mockResolvedValue(null)
    const res = await postReview('r-ghost', { rating: 5 })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
    expect(db.review.upsert).not.toHaveBeenCalled()
  })

  it('[PASS-ACTUEL] un seul avis éditable par (user, restaurant) : upsert sur la clé composée userId_restaurantId', async () => {
    const res = await postReview('r1', { rating: 4, text: 'Bien' })
    expect(res.status).toBe(201)
    expect(db.review.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_restaurantId: { userId: 'u1', restaurantId: 'r1' } },
      }),
    )
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('P9 — POST : orderId jamais vérifié + aucun check de rôle (auto-avis possible)', () => {
  it("[FAIL-ATTENDU: orderId jamais vérifié] un orderId fantôme est stocké verbatim, prisma.order n'est JAMAIS consulté → 201", async () => {
    // AUDIT: the caller can attach ANY orderId string (existing or not, theirs
    // or not, delivered or not, for another restaurant) — the route persists
    // it as-is without a single prisma.order query. After the post-arbitrage
    // fix (verify the order exists, belongs to the caller, targets this
    // restaurant, and is delivered), INVERT: a phantom orderId must be
    // rejected and prisma.order must be consulted.
    const res = await postReview('r1', { rating: 5, orderId: 'cmd-fantome-123' })
    expect(res.status).toBe(201)
    expect(db.order.findUnique).not.toHaveBeenCalled()
    expect(db.order.findFirst).not.toHaveBeenCalled()
    expect(db.review.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ orderId: 'cmd-fantome-123' }),
        create: expect.objectContaining({ orderId: 'cmd-fantome-123' }),
      }),
    )
  })

  it('[FAIL-ATTENDU: avis sans commande liée] orderId omis → avis accepté avec orderId null, aucune preuve d’achat exigée → 201', async () => {
    // AUDIT: a session is the ONLY requirement — no linked order at all is
    // needed to publish a review. After fix: invert (an order proof becomes
    // mandatory, or the product explicitly accepts orderless reviews).
    const res = await postReview('r1', { rating: 5, text: 'Jamais commandé ici' })
    expect(res.status).toBe(201)
    expect(db.review.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ orderId: null, status: 'published' }),
      }),
    )
    expect(db.order.findFirst).not.toHaveBeenCalled()
  })

  it('[FAIL-ATTENDU: aucun check de rôle → auto-avis] une session role "restaurant" peut se noter 5★ elle-même → 201', async () => {
    // AUDIT: the route reads session.user.id ONLY — never the role, never the
    // restaurant's operatorId (it selects { id: true } alone, so it could not
    // even compare). A restaurant operator can therefore 5-star their own
    // restaurant. After fix: invert (role gate 'consumer' and/or ownership
    // exclusion → 403 here).
    sessionMock.mockResolvedValue({ user: { id: 'op-owner-1', role: 'restaurant' } })
    db.review.upsert.mockResolvedValue(row('rev-self', 5, 'Parfait', [], 'Owner'))
    const res = await postReview('r1', { rating: 5, text: 'Parfait' })
    expect(res.status).toBe(201)
    expect(db.restaurant.findUnique).toHaveBeenCalledWith({
      where: { id: 'r1' }, select: { id: true }, // no operatorId → ownership uncheckable
    })
    expect(db.review.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ userId: 'op-owner-1', restaurantId: 'r1', rating: 5 }),
      }),
    )
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('P9 — ★ de tête : Restaurant.rating (seedé) jamais recalculé', () => {
  it("[FAIL-ATTENDU: Restaurant.rating seedé jamais recalculé] après un POST réussi, ni restaurant.update ni review.aggregate ne sont appelés", async () => {
    // AUDIT: publishing a review changes NOTHING on the headline aggregate —
    // Restaurant.rating / reviewCount keep their seeded values forever. The
    // route comment even documents it ("intentionally left untouched").
    // After the post-arbitrage fix (recompute on write, cron, or explicit
    // product acceptance), INVERT: a successful POST must trigger the
    // recompute path (or this test gets replaced by the accepted design).
    const res = await postReview('r1', { rating: 1, text: 'Terrible' })
    expect(res.status).toBe(201)
    expect(db.review.upsert).toHaveBeenCalledTimes(1)
    expect(db.restaurant.update).not.toHaveBeenCalled()
    expect(db.review.aggregate).not.toHaveBeenCalled()
  })

  it('[PASS-ACTUEL — INVERSION V4-2] la fiche publique ne sert PLUS la ★ stockée sans avis réel — preuve source : /api/restaurants/[id] gate la colonne seedée, la route reviews reste sans recalcul', () => {
    // V4-2 (vague 4, décision fondateur) : l'assertion d'origine photographiait
    // la fiche servant restaurant.rating/reviewCount VERBATIM (colonnes seedées
    // 4,7-4,8 / « 120+ avis » avec ZÉRO avis réel en base). INVERSÉE : la fiche
    // applique désormais le gate d'honnêteté (rating null + compteur RÉEL via
    // lib/review-stats tant qu'aucun avis publié n'existe). La colonne stockée
    // reste NON recalculée — le défaut d'agrégat demeure documenté ci-dessous
    // (aucun recalcul construit : décision produit ultérieure, hors V4-2).
    const sheetSrc = fs.readFileSync(
      path.join(ROOT, 'app', 'api', 'restaurants', '[id]', 'route.ts'), 'utf-8')
    expect(sheetSrc).not.toMatch(/rating:\s+restaurant\.rating/)       // plus de colonne servie verbatim
    expect(sheetSrc).not.toMatch(/reviewCount:\s+restaurant\.reviewCount/)
    expect(sheetSrc).toContain("from '@/lib/review-stats'")            // le gate d'honnêteté est branché
    expect(sheetSrc).toMatch(/rating:\s+realCount > 0 \? restaurant\.rating : null/)

    const reviewsSrc = fs.readFileSync(
      path.join(ROOT, 'app', 'api', 'restaurants', '[id]', 'reviews', 'route.ts'), 'utf-8')
    expect(reviewsSrc).not.toContain('restaurant.update')
    expect(reviewsSrc).not.toContain('.aggregate(') // the word only appears in the comment
    expect(reviewsSrc).toContain('intentionally left untouched') // documented deferral
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('P9 — GET /api/restaurants/[id]/reviews : lecture publique', () => {
  it("[PASS-ACTUEL] GET public : la session n'est jamais consultée ; seuls les avis 'published' sont lus, cap 50, tri récent d'abord", async () => {
    db.review.findMany.mockResolvedValue([])
    const res = await getReviews('r1')
    expect(res.status).toBe(200)
    expect(sessionMock).not.toHaveBeenCalled()
    expect(db.review.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { restaurantId: 'r1', status: 'published' },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    )
    expect(await res.json()).toEqual({
      reviews: [], distribution: { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 }, count: 0,
    })
  })

  it('[PASS-ACTUEL] payload public : distribution par étoile sur les lignes renvoyées, prénom seul (privacy), text null → "", tags non-tableau → []', async () => {
    db.review.findMany.mockResolvedValue([
      row('rev1', 5, 'Excellent', ['taste'], 'Alice Dupont'),
      row('rev2', 4, null, 'not-an-array', 'Bob'),
      row('rev3', 5, 'Top', [], null),
    ])
    const res = await getReviews('r1')
    const body = await res.json()
    expect(body.count).toBe(3)
    expect(body.distribution).toEqual({ '1': 0, '2': 0, '3': 0, '4': 1, '5': 2 })
    expect(body.reviews[0]).toMatchObject({ authorName: 'Alice', text: 'Excellent', tags: ['taste'] })
    expect(body.reviews[1]).toMatchObject({ authorName: 'Bob', text: '', tags: [] })
    expect(body.reviews[2]).toMatchObject({ authorName: null })
  })
})

// ════════════════════════════════════════════════════════════════════════════
describe('P9 — UI (navigateur requis)', () => {
  it.todo("[NON-TESTABLE: UI navigateur] parcours de saisie d'avis côté /eat (tap étoiles, chips « qu'avez-vous aimé », envoi) — à vérifier au navigateur")
})
