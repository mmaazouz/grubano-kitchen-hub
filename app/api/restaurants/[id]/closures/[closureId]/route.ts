import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'

export const dynamic = 'force-dynamic'

// ── DELETE /api/restaurants/[id]/closures/[closureId] — remove an exception ────
// Owner-scoped. Deleting a closure simply re-opens the covered period (the weekly
// hours apply again). Reservations cancelled by the closure are NOT resurrected —
// the cancellation (and released empreintes) is final; the operator re-books if
// needed.
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string; closureId: string } },
) {
  try {
    const scope = await resolveEstablishmentScope(params.id)
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

    const closure = await prisma.closureException.findUnique({
      where:  { id: params.closureId },
      select: { id: true, restaurantId: true },
    })
    if (!closure || closure.restaurantId !== params.id) {
      return NextResponse.json({ error: 'Fermeture introuvable' }, { status: 404 })
    }

    await prisma.closureException.delete({ where: { id: params.closureId } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[DELETE /api/restaurants/[id]/closures/[closureId]]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
