// Shared helpers for the table-addition (TableTicket) endpoints.
import { prisma } from '@/lib/prisma'

export const round2 = (n: number) => Math.round(n * 100) / 100

// Per-line fields exposed to the OPERATOR side (addition + history). Includes the
// premium-table additions (who added it, options/notes/allergies, soft-cancel
// status) so the dashboard can render a client order and a struck-through cancelled
// line. name + unitPrice stay the FROZEN copies taken at add time.
const itemSelect = {
  id:         true,
  menuItemId: true,
  name:       true,
  unitPrice:  true,
  quantity:   true,
  addedBy:    true,
  options:    true,
  notes:      true,
  allergies:  true,
  status:     true,
  cancelledAt: true,
  createdAt:  true,
} as const

// Fields returned to the UI / brique-2 consumer. No private data beyond the
// operator's own ticket (the routes owner-scope before selecting this).
// LIVE addition: only ACTIVE lines (a cancelled line is history — see
// ticketHistorySelect — and is already excluded from the subtotal).
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
  closedReason:      true,
  closedAt:          true,
  items: {
    where:   { status: 'active' },
    select:  itemSelect,
    orderBy: { createdAt: 'asc' as const },
  },
} as const

// HISTORY view (owner): every ticket of a reservation, INCLUDING cancelled lines
// and the closure trace. Never filters — the past consumption is shown whole.
export const ticketHistorySelect = {
  id:                true,
  restaurantId:      true,
  restaurantTableId: true,
  reservationId:     true,
  status:            true,
  currency:          true,
  subtotal:          true,
  openedAt:          true,
  paidAt:            true,
  closedReason:      true,
  closedAt:          true,
  amountPaid:        true,
  items: {
    select:  itemSelect,
    orderBy: { createdAt: 'asc' as const },
  },
} as const

// CONSUMER view (public /api/t/[tableId]): the bill the client sees + pays. Only
// active lines, and only the non-private fields (no menuItemId / addedBy / internal
// status). Mirrors the existing public GET shape, additively enriched with the
// per-line options/notes the client themselves submitted.
export const consumerTicketSelect = {
  id:            true,
  reservationId: true,
  status:        true,
  currency:      true,
  subtotal:      true,
  items: {
    where:   { status: 'active' },
    select:  { id: true, name: true, unitPrice: true, quantity: true, options: true, notes: true },
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

/** Recompute subtotal = Σ(unitPrice * quantity) over the ticket's ACTIVE items,
 *  persist it, and return the rounded value. Called after every line mutation.
 *  Cancelled lines are kept in the DB (trace) but EXCLUDED from the billed total. */
export async function recomputeSubtotal(ticketId: string): Promise<number> {
  const items = await prisma.ticketItem.findMany({
    where:  { ticketId, status: 'active' },
    select: { unitPrice: true, quantity: true },
  })
  const subtotal = round2(items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0))
  await prisma.tableTicket.update({ where: { id: ticketId }, data: { subtotal } })
  return subtotal
}
