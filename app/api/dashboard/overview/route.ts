import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'

// Reading session → never statically prerendered.
export const dynamic = 'force-dynamic'

const round2 = (n: number) => Math.round(n * 100) / 100

// Roles allowed to see an operator's consolidated home.
const ALLOWED_ROLES = new Set(['restaurant', 'admin'])

// ── Types ─────────────────────────────────────────────────────────────────────

// LIVRABLE 1 — aggregates summed/averaged over ALL of the operator's
// establishments (operator.restaurants[]). Every figure is owner-scoped via the
// session operatorId — NEVER read from the request body.
type Aggregates = {
  establishmentsCount: number
  // Today's cumulated revenue: Σ Order.subtotal across all establishments, for
  // orders created today, excluding cancelled. SAME source/convention as
  // /api/finance/summary (subtotal, delivery fee excluded, not-cancelled).
  caJour: number
  // Volume over a rolling 7-day window (not the calendar week).
  orders7d: number
  // Average basket over the same 7-day window. null when there is no order in
  // the window (we do NOT fabricate a 0 € basket that never happened).
  avgBasket7d: number | null
  // Rating weighted by review count across establishments. null when the
  // operator has zero reviews (no Restaurant.reviewCount). Source: the
  // denormalized Restaurant.rating / Restaurant.reviewCount aggregates — there
  // is NO per-review table in the schema.
  avgRating: number | null
  totalReviews: number
}

// LIVRABLE 2 — level-1 alert signals. Each signal carries a count and enough to
// let the UI point at the relevant page. A signal that cannot be computed
// reliably from the current schema is returned as { available:false, reason }
// with count 0 — we never invent a value.
type UnlockReason = 'offline' | 'no_brand' | 'empty_menu'
type BrandToUnlock = {
  establishmentId:   string
  establishmentName: string
  reason:            UnlockReason
  detail:            string
}
type StockSeverity = 'out' | 'low'
type StockAlert = {
  stockItemId:  string
  name:         string
  brandId:      string
  brandName:    string
  quantity:     number
  unit:         string
  minThreshold: number
  severity:     StockSeverity
}
type Unavailable = { available: false; reason: string; count: 0 }
type Alerts = {
  brandsToUnlock:  { count: number; items: BrandToUnlock[] }
  stockOut:        { count: number; items: StockAlert[] }
  supplierToOrder: Unavailable
  reviewsToHandle: Unavailable
}

// LIVRABLE 3 — level-2 objective data. REAL progress values; the thresholds are
// PROVISIONAL (to be frozen in brique 9) and exposed so the UI can render the gap.
type Objectives = {
  franchisable: {
    thresholdsProvisional: true
    thresholds: { minAvgRating: number; minWeeklyOrders: number; minAccountAgeDays: number }
    values:     { avgRating: number | null; weeklyOrders: number; accountAgeDays: number }
    // ratingMet is null when the operator has no review at all (unknown, not "failed").
    criteria:   { ratingMet: boolean | null; volumeMet: boolean; ageMet: boolean }
  }
  creator: {
    adoptedRecipes: number   // active DishAdoption rows on the operator's brands
    linkedCreators: number   // distinct creators behind those adoptions
  }
  // No geo-matchable influencer data exists → neutral 0, never fabricated.
  localInfluencers: { available: false; reason: string; count: 0 }
}

type Overview = {
  aggregates: Aggregates
  alerts:     Alerts
  objectives: Objectives
  meta:       { window7dDays: number; generatedAt: string }
}

// Why each "unavailable" signal is unavailable — diagnostic strings for Agent 13
// / Agent 0, kept here so the honesty constraint is auditable in one place.
const SUPPLIER_UNAVAILABLE_REASON =
  "Aucun lien fiable proprietaire->fournisseur dans le schema : Supplier / SupplierOrder n'ont ni operatorId ni restaurantId, et StockItem n'a pas de supplierId. Signal non calculable de facon owner-scoped — non invente."
const REVIEWS_UNAVAILABLE_REASON =
  "Aucun modele Review : seules des donnees denormalisees Restaurant.rating / Restaurant.reviewCount existent (pas de lignes d'avis, pas de champ reponse/traitement, pas d'horodatage pour definir 'recent'). 'Avis a traiter' non calculable — non invente. Le total d'avis neutre est expose dans aggregates.totalReviews."
const INFLUENCERS_UNAVAILABLE_REASON =
  "Aucun modele Influencer ; Creator n'a ni ville ni lat/lng pour un matching geographique avec la zone de l'etablissement. Comptage d'influenceurs locaux non calculable — expose 0 neutre, non invente."

// PROVISIONAL franchisable thresholds — to be FROZEN in brique 9. Named constant
// so the values are tunable in one place without touching the logic below.
const FRANCHISABLE_THRESHOLDS = { minAvgRating: 4.5, minWeeklyOrders: 100, minAccountAgeDays: 180 }

function buildEmpty(): Overview {
  return {
    aggregates: {
      establishmentsCount: 0,
      caJour:              0,
      orders7d:            0,
      avgBasket7d:         null,
      avgRating:           null,
      totalReviews:        0,
    },
    alerts: {
      brandsToUnlock:  { count: 0, items: [] },
      stockOut:        { count: 0, items: [] },
      supplierToOrder: { available: false, reason: SUPPLIER_UNAVAILABLE_REASON, count: 0 },
      reviewsToHandle: { available: false, reason: REVIEWS_UNAVAILABLE_REASON, count: 0 },
    },
    objectives: {
      franchisable: {
        thresholdsProvisional: true,
        thresholds: { ...FRANCHISABLE_THRESHOLDS },
        values:     { avgRating: null, weeklyOrders: 0, accountAgeDays: 0 },
        criteria:   { ratingMet: null, volumeMet: false, ageMet: false },
      },
      creator: { adoptedRecipes: 0, linkedCreators: 0 },
      localInfluencers: { available: false, reason: INFLUENCERS_UNAVAILABLE_REASON, count: 0 },
    },
    meta: { window7dDays: 7, generatedAt: new Date().toISOString() },
  }
}

// ── GET /api/dashboard/overview ───────────────────────────────────────────────
// Consolidated home data for an operator: multi-establishment aggregates
// (LIVRABLE 1) + level-1 alert signals (LIVRABLE 2). Owner-scoped on the session
// operatorId. READ-ONLY: no write, no migration. Never 500s — degrades to a safe
// zero/null-filled shape so the home page always renders.
export async function GET() {
  const empty = buildEmpty()

  try {
    const session = await getServerSession(authOptions)
    if (!session?.user) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    const role = (session.user as { role?: string }).role
    if (!role || !ALLOWED_ROLES.has(role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }
    const operatorId = (session.user as { id?: string }).id
    if (!operatorId) {
      return NextResponse.json(empty)
    }

    const now         = new Date()
    const todayStart  = new Date(now); todayStart.setHours(0, 0, 0, 0)
    const windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    // ── Owner scope: this operator's establishments + brands ──────────────────
    const restaurants = await prisma.restaurant.findMany({
      where:  { operatorId, archivedAt: null },
      select: { id: true, name: true, isActive: true, rating: true, reviewCount: true },
    })
    const restaurantIds = restaurants.map(r => r.id)

    const brands = await prisma.brand.findMany({
      where:  { operatorId },
      select: { id: true, name: true, restaurantId: true },
    })
    const brandIds = brands.map(b => b.id)

    if (restaurantIds.length === 0) {
      // No establishment yet → valid empty shape (still report 0 establishments).
      return NextResponse.json(empty)
    }

    // ── LIVRABLE 1 — aggregates ───────────────────────────────────────────────
    // One query for the rolling 7-day orders; "today" is a subset of that window,
    // so caJour is derived without a second round-trip. Cancelled orders produce
    // no revenue and are excluded (same rule as /api/finance/summary).
    const orders7dRows = await prisma.order.findMany({
      where: {
        restaurantId: { in: restaurantIds },
        createdAt:    { gte: windowStart },
        // Ghost-orders fix: unpaid/abandoned card checkouts never count.
        status:       { notIn: ['cancelled', 'awaiting_payment', 'expired'] },
      },
      select: { subtotal: true, createdAt: true },
    })

    const orders7d = orders7dRows.length
    const sum7d    = orders7dRows.reduce((s, o) => s + o.subtotal, 0)
    const caJour   = round2(
      orders7dRows
        .filter(o => o.createdAt >= todayStart)
        .reduce((s, o) => s + o.subtotal, 0),
    )
    const avgBasket7d = orders7d > 0 ? round2(sum7d / orders7d) : null

    // Rating weighted by review count. Establishments with 0 reviews contribute
    // nothing; if the operator has no review at all, avgRating stays null.
    const totalReviews = restaurants.reduce((s, r) => s + r.reviewCount, 0)
    const avgRating = totalReviews > 0
      ? round2(
          restaurants.reduce((s, r) => s + r.rating * r.reviewCount, 0) / totalReviews,
        )
      : null

    const aggregates: Aggregates = {
      establishmentsCount: restaurants.length,
      caJour,
      orders7d,
      avgBasket7d,
      avgRating,
      totalReviews,
    }

    // ── LIVRABLE 2 — level-1 alerts ───────────────────────────────────────────

    // Available menu items per brand (to detect "has a brand but nothing to
    // sell"). groupBy keeps it to one round-trip.
    const availableByBrand = new Map<string, number>()
    if (brandIds.length > 0) {
      const grouped = await prisma.menuItem.groupBy({
        by:     ['brandId'],
        where:  { brandId: { in: brandIds }, available: true },
        _count: { _all: true },
      })
      for (const g of grouped) availableByBrand.set(g.brandId, g._count._all)
    }

    // MARQUE / ÉTABLISSEMENT À DÉBLOQUER.
    // HONESTY: there is no literal Brand.isActive / "missing-field reason" column.
    // The reasons below are DERIVED from real data, in priority order:
    //   no_brand   — the establishment has zero attached brand (Brand.restaurantId
    //                == establishment.id) → no menu container can exist.
    //   empty_menu — it has brand(s) but zero AVAILABLE MenuItem across them.
    //   offline    — Restaurant.isActive === false (operator-controlled toggle).
    const brandsToUnlock: BrandToUnlock[] = []
    for (const r of restaurants) {
      const own = brands.filter(b => b.restaurantId === r.id)
      if (own.length === 0) {
        brandsToUnlock.push({
          establishmentId:   r.id,
          establishmentName: r.name,
          reason:            'no_brand',
          detail:            'Aucune marque rattachée — créez une marque pour démarrer la carte.',
        })
        continue
      }
      const availableItems = own.reduce((s, b) => s + (availableByBrand.get(b.id) ?? 0), 0)
      if (availableItems === 0) {
        brandsToUnlock.push({
          establishmentId:   r.id,
          establishmentName: r.name,
          reason:            'empty_menu',
          detail:            'Aucun plat disponible — ajoutez un plat au menu.',
        })
        continue
      }
      if (!r.isActive) {
        brandsToUnlock.push({
          establishmentId:   r.id,
          establishmentName: r.name,
          reason:            'offline',
          detail:            'Établissement hors ligne — réactivez-le pour recevoir des commandes.',
        })
      }
    }

    // RUPTURE STOCK. HONESTY: StockItem has NO link to a MenuItem/dish, so we
    // cannot restrict to "on an available dish" — we flag low/out stock for the
    // operator's brands. Prisma cannot compare two columns in a where clause, so
    // the threshold test is done in JS over the operator-scoped rows.
    const stockOut: StockAlert[] = []
    if (brandIds.length > 0) {
      const brandName = new Map(brands.map(b => [b.id, b.name]))
      const stockItems = await prisma.stockItem.findMany({
        where:  { brandId: { in: brandIds } },
        select: { id: true, name: true, quantity: true, unit: true, minThreshold: true, brandId: true },
      })
      for (const s of stockItems) {
        let severity: StockSeverity | null = null
        if (s.quantity <= 0) severity = 'out'
        else if (s.minThreshold > 0 && s.quantity <= s.minThreshold) severity = 'low'
        if (severity) {
          stockOut.push({
            stockItemId:  s.id,
            name:         s.name,
            brandId:      s.brandId,
            brandName:    brandName.get(s.brandId) ?? '',
            quantity:     s.quantity,
            unit:         s.unit,
            minThreshold: s.minThreshold,
            severity,
          })
        }
      }
    }

    const alerts: Alerts = {
      brandsToUnlock:  { count: brandsToUnlock.length, items: brandsToUnlock },
      stockOut:        { count: stockOut.length, items: stockOut },
      supplierToOrder: { available: false, reason: SUPPLIER_UNAVAILABLE_REASON, count: 0 },
      reviewsToHandle: { available: false, reason: REVIEWS_UNAVAILABLE_REASON, count: 0 },
    }

    // ── LIVRABLE 3 — level-2 objectives ───────────────────────────────────────
    // Account age = operator account lifetime in days (real createdAt). weeklyOrders
    // reuses the rolling-7-day count; avgRating reuses the weighted rating above.
    const operator = await prisma.operator.findUnique({
      where:  { id: operatorId },
      select: { createdAt: true },
    })
    const accountAgeDays = operator
      ? Math.max(0, Math.floor((now.getTime() - operator.createdAt.getTime()) / 86_400_000))
      : 0

    // Adopted creator recipes (active) on the operator's brands + the distinct
    // creators behind them (DishAdoption → CreatorDish.creatorId).
    let adoptedRecipes = 0
    let linkedCreators = 0
    if (brandIds.length > 0) {
      const adoptions = await prisma.dishAdoption.findMany({
        where:  { brandId: { in: brandIds }, status: 'active' },
        select: { creatorDish: { select: { creatorId: true } } },
      })
      adoptedRecipes = adoptions.length
      linkedCreators = new Set(adoptions.map(a => a.creatorDish.creatorId)).size
    }

    const objectives: Objectives = {
      franchisable: {
        thresholdsProvisional: true,
        thresholds: { ...FRANCHISABLE_THRESHOLDS },
        values:     { avgRating, weeklyOrders: orders7d, accountAgeDays },
        criteria: {
          ratingMet: avgRating === null ? null : avgRating >= FRANCHISABLE_THRESHOLDS.minAvgRating,
          volumeMet: orders7d >= FRANCHISABLE_THRESHOLDS.minWeeklyOrders,
          ageMet:    accountAgeDays >= FRANCHISABLE_THRESHOLDS.minAccountAgeDays,
        },
      },
      creator: { adoptedRecipes, linkedCreators },
      localInfluencers: { available: false, reason: INFLUENCERS_UNAVAILABLE_REASON, count: 0 },
    }

    const payload: Overview = {
      aggregates,
      alerts,
      objectives,
      meta: { window7dDays: 7, generatedAt: now.toISOString() },
    }
    return NextResponse.json(payload)
  } catch (err) {
    // Never 500 the home: log and degrade to safe defaults.
    console.error('[GET /api/dashboard/overview]', err)
    return NextResponse.json(empty)
  }
}
