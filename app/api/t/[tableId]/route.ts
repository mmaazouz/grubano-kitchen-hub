import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

// ── GET /api/t/[tableId] ──────────────────────────────────────────────────────
// PUBLIC, read-only companion to the /t/[tableId] QR landing page. Returns ONLY
// what that page needs: the table label and (when available) its establishment
// name. It NEVER exposes private data — no email, no revenue, no orders, no
// operator. (API routes are outside the middleware matcher → already public.)
// For pérennité: the future payment flow reads the live bill from a dedicated
// endpoint, so this minimal identity endpoint never has to change.
export async function GET(
  _req: Request,
  { params }: { params: { tableId: string } },
) {
  try {
    const table = await prisma.restaurantTable.findUnique({
      where:  { id: params.tableId },
      select: { name: true, active: true, restaurant: { select: { name: true, archivedAt: true } } },
    })
    if (!table || !table.active) {
      return NextResponse.json({ error: 'Table introuvable' }, { status: 404 })
    }
    return NextResponse.json({
      tableName:         table.name,
      establishmentName: table.restaurant && !table.restaurant.archivedAt ? table.restaurant.name : null,
      active:            true,
    })
  } catch (err) {
    console.error('[GET /api/t/[tableId]]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
