import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// ── GET /api/t/[tableId]/ticket ───────────────────────────────────────────────
// PUBLIC. The "live bill" companion to the /t/[tableId] QR landing page (the
// dedicated endpoint Agent 2's /api/t/[tableId] comment anticipated). Returns the
// table's OPEN ticket (its lines + subtotal) so the consumer can see what they
// owe and pay it. Used by BOTH the QR page AND the consumer app (which knows the
// reservation's tableId). No private data — only the bill itself (line names,
// unit prices, quantities, subtotal); no customer/operator/revenue data.
//
// API routes are outside the middleware matcher → already public. The ticket id
// returned here is what the client POSTs to /api/tickets/[id]/pay.
export async function GET(
  _req: Request,
  { params }: { params: { tableId: string } },
) {
  try {
    // The table must exist + be active (mirror the identity endpoint's guard).
    const table = await prisma.restaurantTable.findUnique({
      where:  { id: params.tableId },
      select: { id: true, active: true },
    })
    if (!table || !table.active) {
      return NextResponse.json({ error: 'Table introuvable' }, { status: 404 })
    }

    // The single OPEN ticket for this table (the bill in progress). paid/void
    // tickets are history and are not returned. Newest open ticket wins.
    const ticket = await prisma.tableTicket.findFirst({
      where:   { restaurantTableId: table.id, status: 'open' },
      orderBy: { openedAt: 'desc' },
      select: {
        // reservationId exposed so the consumer UI can derive the short
        // session code (Agent 13 brique A). null = walk-in — the UI renders a
        // sober "Walk-in" pill instead of a code. No private data: the id is
        // a cuid that's already used as the URL token in /eat reservation
        // flows. Strictly additive.
        id: true, reservationId: true, status: true, currency: true, subtotal: true,
        items: {
          // ACTIVE lines only — a server-cancelled line is kept in the DB for the
          // trace but is already out of the subtotal and must never appear on the
          // client's bill. options/notes expose back what the client themselves
          // ordered from the app (size/extras), strictly additive.
          where:   { status: 'active' },
          select:  { id: true, name: true, unitPrice: true, quantity: true, options: true, notes: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    })

    // No open bill yet → ticket: null (the page shows "addition bientôt").
    return NextResponse.json({ ticket: ticket ?? null })
  } catch (err) {
    console.error('[GET /api/t/[tableId]/ticket]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
