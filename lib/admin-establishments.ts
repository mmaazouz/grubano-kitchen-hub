import { prisma } from '@/lib/prisma'
import { isClaimsEnabled } from '@/lib/claims'
import { resolveCommissionRate, type CommissionChannel } from '@/lib/commission'

// ── Admin establishments — read-only, cross-operator (CD ADM2) ────────────────────
// Pure computation (the CALLER gates admin). READ-ONLY: only count/aggregate/findMany.
// Money figures are READ from stored LedgerEntry cents; commission is the REAL per-channel
// rate via resolveCommissionRate (never a hard-coded %). HONEST OMISSIONS (SIGNAL): no
// suspension status (no column), no plan/subscription (no column), no phone (not on
// Restaurant → owner email instead). Rating is shown only when the resto has real reviews.

const LIST_CAP = 200 // young platform; if total > cap, the list surfaces the first N (SIGNAL)
const GMV_TYPES = ['payment', 'deposit_capture', 'refund'] // refunds negative → SUM nets
// A claim is "open" while non-terminal (schema: refunded|refused|refused_final are terminal).
const OPEN_CLAIM_STATUSES = ['restaurant_review', 'approved', 'refunding', 'arbitration']

export type EstablishmentStatus = 'active' | 'pending' | 'paused'

function deriveStatus(r: { isActive: boolean; approvedAt: Date | null }): EstablishmentStatus {
  if (r.isActive) return 'active'
  if (r.approvedAt == null) return 'pending'
  return 'paused'
}

export interface AdminRestaurantRow {
  id: string
  name: string
  city: string
  brandName: string | null
  status: EstablishmentStatus
  createdAt: string
}
export interface AdminRestaurantsList {
  rows: AdminRestaurantRow[]
  stats: { total: number; active: number; pending: number }
  capped: boolean
}

export async function listAdminRestaurants(): Promise<AdminRestaurantsList> {
  const [rowsRaw, total, active, pending] = await Promise.all([
    prisma.restaurant.findMany({
      where:   { archivedAt: null },
      orderBy: { createdAt: 'desc' },
      take:    LIST_CAP,
      select:  {
        id: true, name: true, city: true, isActive: true, approvedAt: true, createdAt: true,
        brands: { select: { name: true }, take: 1 },
      },
    }),
    prisma.restaurant.count({ where: { archivedAt: null } }),
    prisma.restaurant.count({ where: { archivedAt: null, isActive: true } }),
    prisma.restaurant.count({ where: { archivedAt: null, isActive: false, approvedAt: null } }),
  ])

  const rows: AdminRestaurantRow[] = rowsRaw.map((r) => ({
    id: r.id,
    name: r.name,
    city: r.city,
    brandName: r.brands[0]?.name ?? null,
    status: deriveStatus(r),
    createdAt: r.createdAt.toISOString(),
  }))

  return { rows, stats: { total, active, pending }, capped: total > LIST_CAP }
}

export interface AdminRestaurantDetail {
  id: string
  name: string
  city: string
  address: string
  cuisine: string[]
  createdAt: string
  status: EstablishmentStatus
  owner: { name: string | null; email: string } | null
  brandName: string | null
  channels: { delivery: boolean; pickup: boolean; reservation: boolean }
  /** Real per-channel commission rates (0..1) — resolveCommissionRate, never hard-coded. */
  commission: { delivery: number; pickup: number; dinein: number }
  gmv30Cents: number
  orders30: number
  rating: number | null
  reviewCount: number
  openClaims: number
}

export async function getAdminRestaurantDetail(id: string): Promise<AdminRestaurantDetail | null> {
  const r = await prisma.restaurant
    .findFirst({
      where:  { id, archivedAt: null },
      select: {
        id: true, name: true, city: true, address: true, cuisine: true, createdAt: true,
        isActive: true, approvedAt: true, rating: true, reviewCount: true,
        deliveryEnabled: true, pickupEnabled: true, reservationEnabled: true,
        commissionRateDineIn: true, commissionRatePickup: true, commissionRateDelivery: true,
        commissionFreeUntil: true,
        operator: { select: { name: true, email: true } },
        brands: { select: { name: true }, take: 1 },
      },
    })
    .catch(() => null)
  if (!r) return null

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  const [gmvAgg, orders30, openClaims] = await Promise.all([
    prisma.ledgerEntry.aggregate({
      where: { restaurantId: id, type: { in: GMV_TYPES }, createdAt: { gte: since } },
      _sum: { grossAmount: true },
    }),
    prisma.order.count({ where: { restaurantId: id, createdAt: { gte: since } } }),
    isClaimsEnabled()
      ? prisma.claim.count({ where: { restaurantId: id, status: { in: OPEN_CLAIM_STATUSES } } })
      : Promise.resolve(0),
  ])

  const rate = (channel: CommissionChannel) =>
    resolveCommissionRate(
      {
        commissionRateDineIn:   r.commissionRateDineIn,
        commissionRatePickup:   r.commissionRatePickup,
        commissionRateDelivery: r.commissionRateDelivery,
        commissionFreeUntil:    r.commissionFreeUntil,
      },
      channel,
    )

  return {
    id: r.id,
    name: r.name,
    city: r.city,
    address: r.address,
    cuisine: Array.isArray(r.cuisine) ? (r.cuisine as unknown[]).filter((c): c is string => typeof c === 'string') : [],
    createdAt: r.createdAt.toISOString(),
    status: deriveStatus(r),
    owner: r.operator ? { name: r.operator.name, email: r.operator.email } : null,
    brandName: r.brands[0]?.name ?? null,
    channels: { delivery: r.deliveryEnabled, pickup: r.pickupEnabled, reservation: r.reservationEnabled },
    commission: { delivery: rate('delivery'), pickup: rate('pickup'), dinein: rate('dinein') },
    gmv30Cents: gmvAgg._sum.grossAmount ?? 0,
    orders30,
    rating: r.reviewCount > 0 ? r.rating : null,
    reviewCount: r.reviewCount,
    openClaims,
  }
}
