import { NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'
import type { NextRequest } from 'next/server'

// ── GET /api/eat/my-session ───────────────────────────────────────────────────
// Étape 3 bloc C (Agent 13) — THE one new endpoint the brief authorises.
// READ-ONLY. The connected consumer retrieves their CURRENT table session from
// the SERVER (not localStorage): the most recent reservation linked to their
// account (Reservation.userId === token.sub) that is either waiting (confirmed)
// or seated (arrived), within a ±-recent window so yesterday's session never
// resurfaces.
//
// Response: { session: {
//   reservationId, tableId, tableName, restaurantId, restaurantName,
//   status ('confirmed'|'arrived'), date (ISO)
// } | null }
//
// AUTH: getToken (JWT) — /api is outside the middleware matcher, so the check
// lives here, mirroring POST /api/t/[tableId]/order. 401 when not connected.
// No private data beyond the caller's OWN reservation.

export const dynamic = 'force-dynamic'

// A session stays "current" from 12 hours before now (covers a long lunch
// that runs late) to 36 hours ahead (tomorrow's booking is visible but
// flagged 'confirmed' — the order button only unlocks at 'arrived').
const LOOKBACK_MS  = 12 * 60 * 60 * 1000
const LOOKAHEAD_MS = 36 * 60 * 60 * 1000

export async function GET(req: NextRequest) {
  try {
    const token = await getToken({ req })
    if (!token?.sub) {
      return NextResponse.json({ error: 'Non connecté' }, { status: 401 })
    }

    const now = Date.now()
    const reservation = await prisma.reservation.findFirst({
      where: {
        userId: token.sub,
        status: { in: ['confirmed', 'arrived'] },
        date: {
          gte: new Date(now - LOOKBACK_MS),
          lte: new Date(now + LOOKAHEAD_MS),
        },
      },
      orderBy: { date: 'desc' },
      select: {
        id:           true,
        tableId:      true,
        status:       true,
        date:         true,
        restaurantId: true,
        table:        { select: { name: true } },
        restaurant:   { select: { name: true, archivedAt: true } },
      },
    })

    if (!reservation) {
      return NextResponse.json({ session: null })
    }

    return NextResponse.json({
      session: {
        reservationId:  reservation.id,
        tableId:        reservation.tableId,
        tableName:      reservation.table?.name ?? '',
        restaurantId:   reservation.restaurantId,
        restaurantName:
          reservation.restaurant && !reservation.restaurant.archivedAt
            ? reservation.restaurant.name
            : '',
        status:         reservation.status,
        date:           reservation.date.toISOString(),
      },
    })
  } catch (err) {
    console.error('[GET /api/eat/my-session]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
