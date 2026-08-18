import { prisma } from '@/lib/prisma'

// ── Customer tenant scoping + PII masking (SEC / founder "hybrid" model) ───────
// Founder decision: a restaurateur NEVER sees a customer's contact details. He
// sees a masked identity (first name + last initial — "Mohammed M."), the history
// of HIS OWN orders, preferences and loyalty status. He does NOT see email, phone
// or personal address (the delivery address stays in the order/courier flow only).
//
// A LoyaltyCustomer "belongs" to a restaurateur iff they ordered at his
// establishment, through EITHER real order flow:
//   A. UberEats loyalty validation  → LoyaltyOrder.brandId → Brand.operatorId
//   B. Consumer /eat order           → Order.restaurantId → Restaurant.operatorId,
//      matched back to the LoyaltyCustomer by the consumer Operator's email
//      (the delivered-credit flow upserts LoyaltyCustomer BY EMAIL).
// Every function here is tenant-fenced and returns ZERO contact PII.

export type ScopedOperator = {
  id: string
  /** Full role set: Operator.role + OperatorRole rows (multi-role, Phase 1). */
  roles: string[]
}

// ── PII masking ───────────────────────────────────────────────────────────────
/**
 * "Mohammed Maazouz" → "Mohammed M." · "Mohammed" → "Mohammed" · a stored email
 * → its local part. NEVER returns an address/phone/email. Empty → "Client".
 */
export function maskCustomerName(raw: string | null | undefined): string {
  const s = (raw ?? '').trim()
  if (!s) return 'Client'
  const base = s.includes('@') ? s.split('@')[0]!.trim() : s
  const tokens = base.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return 'Client'
  const first = tokens[0]!
  const firstCap = first.charAt(0).toUpperCase() + first.slice(1)
  if (tokens.length === 1) return firstCap
  const lastInitial = tokens[tokens.length - 1]!.charAt(0).toUpperCase()
  return `${firstCap} ${lastInitial}.`
}

// ── /eat reservation masking (founder decision, dedicated pass) ───────────────
// The DIRECT reservation book stays intact: the staff typed the contact details
// themselves (direct resto↔client relation). Only CONSUMER bookings made through
// the public /eat flow are masked to the operator: masked name, no phone/email.
// Discriminator: Reservation.source === 'eat' (written by /api/reservations/public)
// OR userId != null (legacy consumer rows created before the source column).

export function isEatReservation(r: {
  source?: string | null
  userId?: string | null
}): boolean {
  return r.source === 'eat' || (typeof r.userId === 'string' && r.userId.length > 0)
}

/**
 * Mask an /eat reservation for an OPERATOR payload: masked customerName, phone
 * and email nulled (only when those keys exist on the row). A staff-entered
 * reservation is returned unchanged. Allergies/preOrder stay — they are
 * per-booking food-safety/service data, not contact PII.
 */
export function maskEatReservation<
  T extends { customerName: string; source?: string | null; userId?: string | null },
>(r: T): T {
  if (!isEatReservation(r)) return r
  const masked: T = { ...r, customerName: maskCustomerName(r.customerName) }
  if ('phone' in masked) (masked as Record<string, unknown>).phone = null
  if ('email' in masked) (masked as Record<string, unknown>).email = null
  return masked
}

// ── Tenant fence ────────────────────────────────────────────────────────────
/**
 * Build the Prisma `where` limiting LoyaltyCustomer rows to the operator's OWN
 * customers (paths A + B). Admin is handled by the caller — this always scopes.
 */
export async function loyaltyCustomerWhereForOperator(
  operatorId: string,
): Promise<Record<string, unknown>> {
  const emails = await customerEmailsFromEatOrders(operatorId)
  return {
    OR: [
      { orders: { some: { brand: { operatorId } } } },
      ...(emails.length > 0 ? [{ email: { in: emails } }] : []),
    ],
  }
}

/** Emails of consumers who ordered at ANY of the operator's establishments (path B). */
async function customerEmailsFromEatOrders(operatorId: string): Promise<string[]> {
  const restaurants = await prisma.restaurant.findMany({
    where:  { operatorId },
    select: { id: true },
  })
  if (restaurants.length === 0) return []
  const consumers = await prisma.order.findMany({
    where:    { restaurantId: { in: restaurants.map((r) => r.id) } },
    select:   { consumerId: true },
    distinct: ['consumerId'],
  })
  const ids = consumers.map((c) => c.consumerId).filter(Boolean)
  if (ids.length === 0) return []
  const ops = await prisma.operator.findMany({
    where:  { id: { in: ids } },
    select: { email: true },
  })
  return ops.map((o) => o.email)
}

export type OperatorTenant = { restaurantIds: string[]; brandIds: string[] }

/** The operator's own restaurant ids + brand ids — the fence for order aggregates. */
export async function getOperatorTenant(operatorId: string): Promise<OperatorTenant> {
  const [restaurants, brands] = await Promise.all([
    prisma.restaurant.findMany({ where: { operatorId }, select: { id: true } }),
    prisma.brand.findMany({ where: { operatorId }, select: { id: true } }),
  ])
  return {
    restaurantIds: restaurants.map((r) => r.id),
    brandIds:      brands.map((b) => b.id),
  }
}

// ── Relation aggregates (real, tenant-scoped) ─────────────────────────────────
export type CustomerAgg = {
  ordersCount:   number
  totalSpentCents: number      // exact sum — avg×count would lose the rounding
  avgBasketCents: number
  lastOrderAt:   string | null // ISO
  firstOrderAt:  string | null // ISO
}

/** One raw order row from either flow, normalized. Contains NO contact PII. */
type FlowOrder = { at: Date; totalCents: number; mode: string; customerId: string; items?: unknown }

/**
 * Collect this operator's orders for a set of loyalty customers, from BOTH flows,
 * keyed by LoyaltyCustomer.id. Batched — no N+1. Optionally include the parsed
 * cart items (detail view only).
 */
async function collectOrders(
  tenant: OperatorTenant,
  customers: { id: string; email: string }[],
  withItems: boolean,
): Promise<Map<string, FlowOrder[]>> {
  const byCustomer = new Map<string, FlowOrder[]>()
  const push = (o: FlowOrder) => {
    const list = byCustomer.get(o.customerId) ?? []
    list.push(o)
    byCustomer.set(o.customerId, list)
  }

  // Path B — /eat orders. Map consumer Operator.email → LoyaltyCustomer.id.
  if (tenant.restaurantIds.length > 0 && customers.length > 0) {
    const emailToCustomerId = new Map(customers.map((c) => [c.email, c.id]))
    const consumers = await prisma.operator.findMany({
      where:  { email: { in: customers.map((c) => c.email) } },
      select: { id: true, email: true },
    })
    const consumerIdToCustomerId = new Map<string, string>()
    for (const c of consumers) {
      const cid = emailToCustomerId.get(c.email)
      if (cid) consumerIdToCustomerId.set(c.id, cid)
    }
    if (consumerIdToCustomerId.size > 0) {
      const eatOrders = await prisma.order.findMany({
        where: {
          restaurantId: { in: tenant.restaurantIds },
          consumerId:   { in: Array.from(consumerIdToCustomerId.keys()) },
          status:       { notIn: ['awaiting_payment', 'expired', 'cancelled'] },
        },
        select: { consumerId: true, total: true, createdAt: true, fulfillmentType: true, ...(withItems ? { items: true } : {}) },
        orderBy: { createdAt: 'desc' },
      })
      for (const o of eatOrders) {
        const cid = consumerIdToCustomerId.get(o.consumerId)
        if (!cid) continue
        push({
          at:         o.createdAt,
          totalCents: Math.round(o.total * 100),
          mode:       o.fulfillmentType || 'delivery',
          customerId: cid,
          items:      withItems ? (o as { items?: unknown }).items : undefined,
        })
      }
    }
  }

  // Path A — UberEats loyalty orders on the operator's brands.
  if (tenant.brandIds.length > 0 && customers.length > 0) {
    const loyOrders = await prisma.loyaltyOrder.findMany({
      where:  { customerId: { in: customers.map((c) => c.id) }, brandId: { in: tenant.brandIds } },
      select: { customerId: true, amount: true, validatedAt: true },
      orderBy: { validatedAt: 'desc' },
    })
    for (const o of loyOrders) {
      push({ at: o.validatedAt, totalCents: Math.round(o.amount * 100), mode: 'delivery', customerId: o.customerId })
    }
  }

  return byCustomer
}

function summarize(orders: FlowOrder[]): CustomerAgg {
  if (orders.length === 0) {
    return { ordersCount: 0, totalSpentCents: 0, avgBasketCents: 0, lastOrderAt: null, firstOrderAt: null }
  }
  const spent = orders.reduce((s, o) => s + o.totalCents, 0)
  const times = orders.map((o) => o.at.getTime())
  return {
    ordersCount:    orders.length,
    totalSpentCents: spent,
    avgBasketCents: Math.round(spent / orders.length),
    lastOrderAt:    new Date(Math.max(...times)).toISOString(),
    firstOrderAt:   new Date(Math.min(...times)).toISOString(),
  }
}

// ── Customer LIST (masked, scoped, with real relation aggregates) ─────────────
export type ScopedCustomerRow = {
  id: string
  name: string          // MASKED (first name + last initial) — never the full name
  tier: string
  pointsBalance: number
  createdAt: string     // ISO
  ordersCount: number
  totalSpentCents: number
  avgBasketCents: number
  lastOrderAt: string | null
  // NB: NO email, NO phone, NO address — by construction, never selected out.
}

/** The four loyalty tiers — the only accepted values for the ?tier list filter. */
export const CUSTOMER_TIERS = ['bronze', 'silver', 'gold', 'platinum'] as const
export type CustomerTier = (typeof CUSTOMER_TIERS)[number]

export async function getScopedCustomers(
  operator: ScopedOperator,
  opts?: { tier?: CustomerTier },
): Promise<{ customers: ScopedCustomerRow[]; total: number }> {
  const isAdmin = operator.roles.includes('admin')
  const fence = isAdmin ? {} : await loyaltyCustomerWhereForOperator(operator.id)
  // The tier filter narrows the LIST server-side; `total` stays the UNfiltered
  // member count (it drives the empty state and equals the KPI « Membres fidélité »).
  const where = opts?.tier ? { AND: [fence, { tier: opts.tier }] } : fence

  const [rows, total] = await Promise.all([
    prisma.loyaltyCustomer.findMany({
      where,
      orderBy: { pointsBalance: 'desc' },
      take: 20,
      // email is selected ONLY to join orders server-side — it is NEVER returned.
      select: { id: true, name: true, email: true, pointsBalance: true, tier: true, createdAt: true },
    }),
    prisma.loyaltyCustomer.count({ where: fence }),
  ])

  // Real relation aggregates, batched. Admin (platform view) has no single tenant,
  // so aggregates are 0 for admin — the masked identity + loyalty still render.
  let aggByCustomer = new Map<string, CustomerAgg>()
  if (!isAdmin && rows.length > 0) {
    const tenant = await getOperatorTenant(operator.id)
    const orders = await collectOrders(tenant, rows.map((r) => ({ id: r.id, email: r.email })), false)
    aggByCustomer = new Map(Array.from(orders, ([id, list]) => [id, summarize(list)]))
  }

  return {
    customers: rows.map((c) => {
      const agg = aggByCustomer.get(c.id)
      return {
        id:             c.id,
        name:           maskCustomerName(c.name),   // MASKED
        tier:           c.tier,
        pointsBalance:  c.pointsBalance,
        createdAt:      c.createdAt.toISOString(),
        ordersCount:    agg?.ordersCount ?? 0,
        totalSpentCents: agg?.totalSpentCents ?? 0,
        avgBasketCents: agg?.avgBasketCents ?? 0,
        lastOrderAt:    agg?.lastOrderAt ?? null,
      }
    }),
    total,
  }
}

// ── Customer PROFILE (fiche client) — full relation, still ZERO contact PII ───
export type ProfileHistoryItem = {
  at: string            // ISO
  itemsPreview: string
  mode: string
  amountCents: number
  dietaryNote: string[] // per-order exclusions/notes (food safety) — NOT a stored health profile
}
export type CustomerProfile = {
  id: string
  name: string          // MASKED
  tier: string
  pointsBalance: number
  memberSince: string   // ISO (LoyaltyCustomer.createdAt)
  ordersCount: number
  avgBasketCents: number
  firstOrderAt: string | null
  lastOrderAt: string | null
  favorites: { name: string; count: number }[]
  usualMode: string | null
  recent: ProfileHistoryItem[]
}

type RawItem = { name?: string; qty?: number; options?: { exclusions?: unknown; note?: unknown }[] }

/**
 * Full fiche-client for ONE customer — 404 (null) if that customer is not in the
 * caller's tenant (the same fence as the list). Returns NO email/phone/address.
 */
export async function getCustomerProfile(
  operator: ScopedOperator,
  customerId: string,
): Promise<CustomerProfile | null> {
  const isAdmin = operator.roles.includes('admin')
  const fence = isAdmin ? {} : await loyaltyCustomerWhereForOperator(operator.id)

  const customer = await prisma.loyaltyCustomer.findFirst({
    where:  { AND: [{ id: customerId }, fence] },
    // email selected ONLY to join orders — never returned to the client.
    select: { id: true, name: true, email: true, pointsBalance: true, tier: true, createdAt: true },
  })
  if (!customer) return null

  const tenant = await getOperatorTenant(operator.id)
  const ordersMap = await collectOrders(tenant, [{ id: customer.id, email: customer.email }], true)
  const orders = ordersMap.get(customer.id) ?? []
  const agg = summarize(orders)

  // Favorites + usual mode + recent history from the parsed cart items.
  const itemTally = new Map<string, number>()
  const modeTally = new Map<string, number>()
  for (const o of orders) {
    modeTally.set(o.mode, (modeTally.get(o.mode) ?? 0) + 1)
    const items = Array.isArray(o.items) ? (o.items as RawItem[]) : []
    for (const it of items) {
      const name = String(it?.name ?? '').trim()
      if (name) itemTally.set(name, (itemTally.get(name) ?? 0) + Number(it?.qty ?? 1))
    }
  }
  const favorites = Array.from(itemTally, ([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
  const usualMode = Array.from(modeTally).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  const recent: ProfileHistoryItem[] = orders
    .slice()
    .sort((a, b) => b.at.getTime() - a.at.getTime())
    .slice(0, 5)
    .map((o) => {
      const items = Array.isArray(o.items) ? (o.items as RawItem[]) : []
      const preview =
        (items.slice(0, 3).map((i) => String(i?.name ?? '').trim()).filter(Boolean).join(', ')
          + (items.length > 3 ? ` +${items.length - 3}` : '')) || '—'
      const dietaryNote: string[] = []
      for (const it of items) {
        const opt = Array.isArray(it?.options) ? it.options[0] : undefined
        if (opt && Array.isArray(opt.exclusions)) dietaryNote.push(...opt.exclusions.map(String).filter(Boolean))
        if (opt && typeof opt.note === 'string' && opt.note.trim()) dietaryNote.push(opt.note.trim())
      }
      return {
        at:          o.at.toISOString(),
        itemsPreview: preview,
        mode:        o.mode,
        amountCents: o.totalCents,
        dietaryNote: Array.from(new Set(dietaryNote)),
      }
    })

  return {
    id:             customer.id,
    name:           maskCustomerName(customer.name),
    tier:           customer.tier,
    pointsBalance:  customer.pointsBalance,
    memberSince:    customer.createdAt.toISOString(),
    ordersCount:    agg.ordersCount,
    avgBasketCents: agg.avgBasketCents,
    firstOrderAt:   agg.firstOrderAt,
    lastOrderAt:    agg.lastOrderAt,
    favorites,
    usualMode,
    recent,
  }
}

// ── Screen stats (vague 2 — B + C) ────────────────────────────────────────────
// The four KPIs + per-tier counters ABOVE the customer list. RULE: they use
// EXACTLY the list's scope — the operator tenant (both order flows, same fence,
// same status exclusions as collectOrders). Counts are of PEOPLE (distinct by
// email across flows), never of orders. « Nouveaux ce mois » = FIRST order in
// scope falls in the current calendar month — NEVER LoyaltyCustomer.createdAt.
export type CustomerScreenStats = {
  totalCustomers: number   // KPI 1 — distinct persons with ≥1 order in scope
  newThisMonth: number     // KPI 2 — persons whose FIRST in-scope order is this month
  loyaltyMembers: number   // KPI 3 — programme members in scope (0-point balance counts)
  avgBasketCents: number   // KPI 4 — Σ order amounts ÷ order count (source amounts)
  tierCounts: Record<string, number> // per-tier member counts over the FULL fenced population
}

export async function getCustomerScreenStats(operator: ScopedOperator): Promise<CustomerScreenStats> {
  const isAdmin = operator.roles.includes('admin')
  const tenant = isAdmin ? null : await getOperatorTenant(operator.id)
  const fence = isAdmin ? {} : await loyaltyCustomerWhereForOperator(operator.id)
  // Same status exclusions as collectOrders — an unpaid/expired/cancelled order
  // never makes someone a « client ».
  const orderWhere = {
    ...(tenant ? { restaurantId: { in: tenant.restaurantIds } } : {}),
    status: { notIn: ['awaiting_payment', 'expired', 'cancelled'] },
  }
  const loyWhere = tenant ? { brandId: { in: tenant.brandIds } } : {}

  const [eatFirst, loyFirst, eatAgg, loyAgg, members, tierGroups] = await Promise.all([
    prisma.order.groupBy({ by: ['consumerId'], where: orderWhere, _min: { createdAt: true } }),
    prisma.loyaltyOrder.groupBy({ by: ['customerId'], where: loyWhere, _min: { validatedAt: true } }),
    prisma.order.aggregate({ where: orderWhere, _count: { _all: true }, _sum: { total: true } }),
    prisma.loyaltyOrder.aggregate({ where: loyWhere, _count: { _all: true }, _sum: { amount: true } }),
    prisma.loyaltyCustomer.count({ where: fence }),
    prisma.loyaltyCustomer.groupBy({ by: ['tier'], where: fence, _count: { _all: true } }),
  ])

  // Distinct PERSONS across both flows, deduplicated by email (the same person
  // can order via /eat AND hold loyalty orders — collectOrders' path-B join).
  const eatIds = eatFirst.map((g) => g.consumerId).filter(Boolean)
  const loyIds = loyFirst.map((g) => g.customerId)
  const [eatOps, loyCusts] = await Promise.all([
    eatIds.length ? prisma.operator.findMany({ where: { id: { in: eatIds } }, select: { id: true, email: true } }) : [],
    loyIds.length ? prisma.loyaltyCustomer.findMany({ where: { id: { in: loyIds } }, select: { id: true, email: true } }) : [],
  ])
  const eatEmail = new Map(eatOps.map((o) => [o.id, o.email]))
  const loyEmail = new Map(loyCusts.map((c) => [c.id, c.email]))

  const firstByPerson = new Map<string, number>()
  const keep = (key: string, at: Date | null) => {
    if (!at) return
    const t = at.getTime()
    const prev = firstByPerson.get(key)
    if (prev === undefined || t < prev) firstByPerson.set(key, t)
  }
  for (const g of eatFirst) keep(eatEmail.get(g.consumerId) ?? `consumer:${g.consumerId}`, g._min.createdAt)
  for (const g of loyFirst) keep(loyEmail.get(g.customerId) ?? `member:${g.customerId}`, g._min.validatedAt)

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  let newThisMonth = 0
  firstByPerson.forEach((t) => { if (t >= monthStart) newThisMonth++ })

  const orderCount = eatAgg._count._all + loyAgg._count._all
  const totalCents = Math.round((eatAgg._sum.total ?? 0) * 100) + Math.round((loyAgg._sum.amount ?? 0) * 100)

  const tierCounts: Record<string, number> = {}
  for (const g of tierGroups) tierCounts[g.tier] = g._count._all

  return {
    totalCustomers: firstByPerson.size,
    newThisMonth,
    loyaltyMembers: members,
    avgBasketCents: orderCount > 0 ? Math.round(totalCents / orderCount) : 0,
    tierCounts,
  }
}
