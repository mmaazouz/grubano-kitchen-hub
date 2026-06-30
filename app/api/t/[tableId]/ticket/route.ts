import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { isDineInServiceEnabled, dineInServiceCents } from '@/lib/dinein-service'

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
        // restaurantId: needed to read the dine-in service rate (G1). Not exposed.
        id: true, restaurantId: true, reservationId: true, status: true, currency: true, subtotal: true,
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
    if (!ticket) return NextResponse.json({ ticket: null })

    // ── G1 — DINE-IN SERVICE CHARGE on the bill (resto-bound, flag + rate gated) ─
    // Read the establishment's configurable service rate ONLY behind the flag.
    // With DINEIN_SERVICE_ENABLED OFF (or the rate null/0) serviceCents is 0 and
    // we expose serviceRatePct 0 → the client renders NO service line and the
    // total equals the subtotal → BYTE-IDENTICAL to pre-G1. Guarded read so a
    // deploy before the db push (column absent) degrades to 0. The service is
    // DERIVED at read time from subtotal × rate (never stored as a ticket item).
    let serviceRatePct = 0
    if (isDineInServiceEnabled()) {
      try {
        // Cast intentional (see /api/tickets/[id]/pay): dineInServiceRatePct is
        // added by the G1 schema merge, absent from the generated Prisma type until
        // regen; the try/catch also tolerates the column being absent at RUNTIME
        // (deploy before the db push) → degrades to 0 (inert).
        const r = await prisma.restaurant.findUnique({
          where:  { id: ticket.restaurantId },
          select: { dineInServiceRatePct: true } as any,
        }) as { dineInServiceRatePct: number | null } | null
        serviceRatePct = r?.dineInServiceRatePct ?? 0
      } catch { /* column missing pre-db-push → 0 (inert) */ }
    }
    const subtotalCents = Math.round(ticket.subtotal * 100)
    const serviceCents  = dineInServiceCents(subtotalCents, serviceRatePct) // 0 when off / rate 0
    const totalCents    = subtotalCents + serviceCents

    // Strip the internal restaurantId; enrich with the service breakdown (integer
    // cents — the client formats in euros). serviceRatePct/serviceCents stay 0 in
    // the inert path so the bill is unchanged.
    const { restaurantId: _restaurantId, ...publicTicket } = ticket
    return NextResponse.json({
      ticket: {
        ...publicTicket,
        serviceRatePct,
        serviceCents,
        subtotalCents,
        totalCents,
      },
    })
  } catch (err) {
    console.error('[GET /api/t/[tableId]/ticket]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
