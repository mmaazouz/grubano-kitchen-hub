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

export type EnsureTicketResult =
  | { ok: true;  id: string; created: boolean }
  | { ok: false; blocked: true; code: 'table_has_unpaid_previous'; existingTicketId: string; existingSubtotal: number }

/**
 * Ensure the CURRENT session's open ticket for a table — bound to the precise
 * reservation, never re-serving another service's bill (the confidentiality fix).
 *
 * With an open ticket already on the table:
 *   • SAME session (its reservationId === the current one, or both null=walk-in)
 *     → reuse it.
 *   • OTHER session (a different reservation, or a leftover open while a reservation
 *     now arrives):
 *       – EMPTY (subtotal ≤ 0 AND zero items) → auto-void it (nothing to lose) and
 *         create a fresh ticket for the current session.
 *       – WITH items (subtotal > 0) → DON'T touch it, DON'T create a new one;
 *         return a blocked signal so the operator settles/voids it first.
 * With no open ticket → create a fresh one bound to the current reservation (or null
 * for an explicit walk-in).
 */
export async function ensureOpenTicket(opts: {
  restaurantTableId: string
  restaurantId: string
  reservationId: string | null
}): Promise<EnsureTicketResult> {
  const existing = await prisma.tableTicket.findFirst({
    where:  { restaurantTableId: opts.restaurantTableId, status: 'open' },
    select: { id: true, reservationId: true, subtotal: true, _count: { select: { items: true } } },
  })

  if (existing) {
    const sameSession = existing.reservationId === opts.reservationId
    if (sameSession) return { ok: true, id: existing.id, created: false }

    // Different session: a residual / previous-service open on this table.
    const isEmpty = existing.subtotal <= 0 && existing._count.items === 0
    if (!isEmpty) {
      return {
        ok: false, blocked: true, code: 'table_has_unpaid_previous',
        existingTicketId: existing.id, existingSubtotal: round2(existing.subtotal),
      }
    }
    // Empty residual → void it, then fall through to create a clean ticket.
    await prisma.tableTicket.update({ where: { id: existing.id }, data: { status: 'void' } })
  }

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
  return { ok: true, id: created.id, created: true }
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
