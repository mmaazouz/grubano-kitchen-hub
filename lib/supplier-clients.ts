import { prisma } from '@/lib/prisma'

// ── Supplier clients aggregation (B4, READ-ONLY). ────────────────────────────────
// A "client" is a restaurant (buyer Operator) that has placed at least one SupplyOrder
// with this supplier. Aggregated from real SupplyOrder rows, owner-scoped by the
// caller's supplierProfileId. All money is CENTS (display-only downstream). Pure read
// — no money is moved, nothing is written. When the B2B pipeline is gated OFF there
// are 0 orders → 0 clients → the honest empty state shows.

export interface SupplierClientOrder {
  id: string
  createdAt: string   // ISO
  itemCount: number
  totalCents: number
  status: string
}
export interface SupplierClient {
  operatorId: string
  name: string
  city: string | null
  email: string | null
  firstOrderAt: string // ISO
  orderCount: number
  totalCents: number
  avgCents: number
  orders: SupplierClientOrder[]
}

export async function aggregateSupplierClients(supplierProfileId: string): Promise<SupplierClient[]> {
  const rows = await prisma.supplyOrder.findMany({
    where:   { supplierProfileId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, operatorId: true, totalCents: true, status: true, createdAt: true,
      operator: { select: { name: true, city: true, email: true } },
      lines:    { select: { quantity: true } },
    },
  }).catch(() => [])

  const map = new Map<string, SupplierClient>()
  for (const o of rows) {
    let c = map.get(o.operatorId)
    if (!c) {
      c = {
        operatorId: o.operatorId,
        name:  o.operator?.name ?? '—',
        city:  o.operator?.city ?? null,
        email: o.operator?.email ?? null,
        firstOrderAt: o.createdAt.toISOString(),
        orderCount: 0, totalCents: 0, avgCents: 0, orders: [],
      }
      map.set(o.operatorId, c)
    }
    c.orderCount += 1
    c.totalCents += o.totalCents ?? 0
    if (o.createdAt.toISOString() < c.firstOrderAt) c.firstOrderAt = o.createdAt.toISOString()
    c.orders.push({
      id: o.id,
      createdAt: o.createdAt.toISOString(),
      itemCount: o.lines.reduce((s, l) => s + l.quantity, 0),
      totalCents: o.totalCents ?? 0,
      status: o.status,
    })
  }

  const clients = Array.from(map.values())
  for (const c of clients) c.avgCents = c.orderCount > 0 ? Math.round(c.totalCents / c.orderCount) : 0
  clients.sort((a, b) => b.totalCents - a.totalCents)
  return clients
}
