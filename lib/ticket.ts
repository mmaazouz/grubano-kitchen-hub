// Shared helpers for the table-addition (TableTicket) endpoints.
import { prisma } from '@/lib/prisma'

export const round2 = (n: number) => Math.round(n * 100) / 100

// Fields returned to the UI / brique-2 consumer. No private data beyond the
// operator's own ticket (the routes owner-scope before selecting this).
export const ticketSelect = {
  id:                true,
  restaurantId:      true,
  restaurantTableId: true,
  reservationId:     true,
  status:            true,
  currency:          true,
  subtotal:          true,
  openedAt:          true,
  paidAt:            true,
  items: {
    select:  { id: true, menuItemId: true, name: true, unitPrice: true, quantity: true },
    orderBy: { createdAt: 'asc' as const },
  },
} as const

/**
 * Ensure exactly ONE open session-ticket exists for a table. If one is already
 * open, return it (uniqueness — never a 2nd open per table); otherwise create one
 * linked to `reservationId` (the precise arrived service) or null (explicit
 * walk-in). This is the single funnel both POST /api/tickets and the auto-open on
 * 'arrived' go through, so a table never mixes two services' bills.
 */
export async function ensureOpenTicket(opts: {
  restaurantTableId: string
  restaurantId: string
  reservationId: string | null
}): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.tableTicket.findFirst({
    where:  { restaurantTableId: opts.restaurantTableId, status: 'open' },
    select: { id: true },
  })
  if (existing) return { id: existing.id, created: false }

  const created = await prisma.tableTicket.create({
    data: {
      restaurantId:      opts.restaurantId,
      restaurantTableId: opts.restaurantTableId,
      reservationId:     opts.reservationId,
      status:            'open',
      currency:          'eur',
      subtotal:          0,
    },
    select: { id: true },
  })
  return { id: created.id, created: true }
}

/** Recompute subtotal = Σ(unitPrice * quantity) over the ticket's items, persist it,
 *  and return the rounded value. Called after every line mutation. */
export async function recomputeSubtotal(ticketId: string): Promise<number> {
  const items = await prisma.ticketItem.findMany({
    where:  { ticketId },
    select: { unitPrice: true, quantity: true },
  })
  const subtotal = round2(items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0))
  await prisma.tableTicket.update({ where: { id: ticketId }, data: { subtotal } })
  return subtotal
}
