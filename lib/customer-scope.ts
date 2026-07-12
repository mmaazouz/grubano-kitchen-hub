import { prisma } from '@/lib/prisma'

// ── Tenant scoping for the operator CLIENTS screen (SEC — cross-resto PII) ─────
// A LoyaltyCustomer "belongs" to a restaurateur iff they actually ordered at his
// establishment, through EITHER of the two real order flows:
//   A. UberEats loyalty validation  → LoyaltyOrder.brandId → Brand.operatorId
//   B. Consumer /eat order           → Order.restaurantId → Restaurant.operatorId,
//      matched back to the LoyaltyCustomer by the consumer Operator's email
//      (the delivered-credit flow upserts LoyaltyCustomer BY EMAIL — see
//      app/api/orders/[id]/status; LoyaltyTransaction has no relation to join on).
// Path B is resolved in two bounded, indexed queries (distinct consumerIds of MY
// restaurant's orders → their emails) because LoyaltyCustomer has no FK to Order.
//
// Before this fix the /customers page ran an UNSCOPED findMany: any authenticated
// restaurateur saw the top-20 loyalty customers (name+email+phone) of the WHOLE
// platform. Cross-tenant PII — RGPD violation.

export type ScopedOperator = {
  id: string
  /** Full role set: Operator.role + OperatorRole rows (multi-role, Phase 1). */
  roles: string[]
}

export type ScopedCustomerRow = {
  id: string
  name: string
  email: string
  phone: string | null
  pointsBalance: number
  tier: string
  createdAt: Date
}

/**
 * Build the Prisma `where` limiting LoyaltyCustomer rows to the operator's OWN
 * customers (paths A + B above). Admin is handled by the caller — this function
 * always scopes.
 */
export async function loyaltyCustomerWhereForOperator(
  operatorId: string,
): Promise<Record<string, unknown>> {
  // Path B: emails of consumers who ordered at ANY of MY establishments
  // (Option B: an operator can own several restaurants — operatorId is indexed,
  // no longer unique).
  let emails: string[] = []
  const restaurants = await prisma.restaurant.findMany({
    where:  { operatorId },
    select: { id: true },
  })
  if (restaurants.length > 0) {
    const consumers = await prisma.order.findMany({
      where:    { restaurantId: { in: restaurants.map((r) => r.id) } },
      select:   { consumerId: true },
      distinct: ['consumerId'],
    })
    const ids = consumers.map((c) => c.consumerId).filter(Boolean)
    if (ids.length > 0) {
      const ops = await prisma.operator.findMany({
        where:  { id: { in: ids } },
        select: { email: true },
      })
      emails = ops.map((o) => o.email)
    }
  }

  return {
    OR: [
      // Path A — loyalty orders on one of my brands.
      { orders: { some: { brand: { operatorId } } } },
      // Path B — /eat orders at my restaurant (matched by email).
      ...(emails.length > 0 ? [{ email: { in: emails } }] : []),
    ],
  }
}

/**
 * Top-20 (by points) + member count, scoped to the operator's own customers.
 * Admin keeps the platform-wide view (their console spans all tenants); every
 * other role sees ONLY customers who ordered at their establishment — a
 * restaurateur can never see a customer who never ordered chez lui.
 */
export async function getScopedCustomers(
  operator: ScopedOperator,
): Promise<{ customers: ScopedCustomerRow[]; total: number }> {
  const isAdmin = operator.roles.includes('admin')
  const where = isAdmin ? {} : await loyaltyCustomerWhereForOperator(operator.id)

  const customers = await prisma.loyaltyCustomer.findMany({
    where,
    orderBy: { pointsBalance: 'desc' },
    take: 20,
  })
  const total = await prisma.loyaltyCustomer.count({ where })

  return {
    customers: customers.map((c) => ({
      id:            c.id,
      name:          c.name,
      email:         c.email,
      phone:         c.phone ?? null,
      pointsBalance: c.pointsBalance,
      tier:          c.tier,
      createdAt:     c.createdAt,
    })),
    total,
  }
}
