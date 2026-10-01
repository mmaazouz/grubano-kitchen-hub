import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { callerOperator } from '@/lib/operator-session'
import { stockStatus, isLowStock } from '@/lib/marketplace'

export const dynamic = 'force-dynamic'

// ── GET /api/marketplace/reorder — the resto's LOW-STOCK products (Slice 4) ───
// READ-ONLY bridge over the existing StockItem: it READS the connected operator's
// stock (via Brand.operatorId — properly session-scoped, unlike the legacy
// /api/stocks which trusts a client brandId) and returns only the items that are
// below threshold, most-critical first. It NEVER writes stock. The reorder action
// then reuses the Slice-2 discovery/order flow (no order logic here).
export async function GET() {
  const operator = await callerOperator()
  if (!operator) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  if (!['restaurant', 'admin'].includes(operator.role)) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  // READ-ONLY: scope to the operator's brands. No create/update/delete on stock.
  const items = await prisma.stockItem
    .findMany({
      where:  { brand: { operatorId: operator.id } },
      select: { id: true, name: true, quantity: true, unit: true, minThreshold: true, dlc: true },
    })
    .catch(() => [])

  const low = items
    .filter((i) => isLowStock(i.quantity, i.minThreshold))
    .map((i) => ({ ...i, status: stockStatus(i.quantity, i.minThreshold) }))
    .sort((a, b) => {
      const ra = a.minThreshold > 0 ? a.quantity / a.minThreshold : 1
      const rb = b.minThreshold > 0 ? b.quantity / b.minThreshold : 1
      return ra - rb // most critical (lowest ratio) first
    })

  return NextResponse.json({ items: low })
}
