import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'

// ── POST /api/tickets/purge-residual ──────────────────────────────────────────
// One-shot maintenance endpoint (OWNER-scoped). Voids RESIDUAL open session tickets
// left on the caller's tables (test data, or opens from before the session-ticket
// fix). Touches ONLY status='open' — never paid/void. Idempotent.
//
//   • default (safe): void an open ticket when it is EMPTY (subtotal ≤ 0 AND zero
//     items) OR its linked reservation is NOT 'arrived' (a stale/orphan link from the
//     old "open-by-table" model). Real in-progress bills (non-empty, bound to an
//     'arrived' reservation, or a non-empty explicit walk-in) are KEPT.
//   • { all: true }: void EVERY open ticket of the operator (full staging reset).
//
// Owner-scoped, so it can only ever touch the caller's own establishments' tickets.
// Run once via curl with the operator session cookie (see report).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({ all: z.boolean().optional() })

export async function POST(req: Request) {
  try {
    const scope = await resolveEstablishmentScope(null)
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })
    if (!scope.ownedIds.length) {
      return NextResponse.json({ ok: true, mode: 'none', scanned: 0, voided: 0, details: [] })
    }

    const parsed = bodySchema.safeParse(await req.json().catch(() => ({})))
    const all = parsed.success ? Boolean(parsed.data.all) : false

    const opens = await prisma.tableTicket.findMany({
      where:  { restaurantId: { in: scope.ownedIds }, status: 'open' },
      select: { id: true, restaurantTableId: true, reservationId: true, subtotal: true, _count: { select: { items: true } } },
    })

    // Batch the linked reservations' statuses (no N+1).
    const resaIds = Array.from(new Set(opens.map(o => o.reservationId).filter((x): x is string => Boolean(x))))
    const resaStatus = new Map<string, string>()
    if (resaIds.length) {
      const resas = await prisma.reservation.findMany({ where: { id: { in: resaIds } }, select: { id: true, status: true } })
      for (const r of resas) resaStatus.set(r.id, r.status)
    }

    const details: Array<Record<string, unknown>> = []
    const toVoid: string[] = []
    for (const o of opens) {
      const isEmpty = o.subtotal <= 0 && o._count.items === 0
      const linkedArrived = o.reservationId ? resaStatus.get(o.reservationId) === 'arrived' : false
      // Orphan = bound to a reservation that is not (or no longer) 'arrived'.
      const orphanLink = o.reservationId != null && !linkedArrived
      const reason = all ? 'all' : isEmpty ? 'empty' : orphanLink ? 'orphan_not_arrived' : null
      if (reason) {
        toVoid.push(o.id)
        details.push({ id: o.id, restaurantTableId: o.restaurantTableId, subtotal: o.subtotal, items: o._count.items, reservationId: o.reservationId, reason })
      }
    }

    if (toVoid.length) {
      await prisma.tableTicket.updateMany({ where: { id: { in: toVoid } }, data: { status: 'void' } })
    }

    return NextResponse.json({
      ok: true,
      mode: all ? 'all' : 'safe',
      scanned: opens.length,
      voided: toVoid.length,
      details,
    })
  } catch (err) {
    console.error('[purge-residual tickets]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
