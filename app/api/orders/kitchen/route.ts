import { NextResponse } from 'next/server'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { buildOrderViews } from '@/lib/orders-feed'
import { isKitchenStatus } from '@/lib/kds'

// ── GET /api/orders/kitchen?locale= ───────────────────────────────────────────
// Phase 3 KDS read. Returns the CURRENT establishment's KITCHEN-active orders
// (received | preparing | ready) for the real-time cooking board (/prep, polled).
// REUSES the exact same scoping + feed as GET /api/orders/live (resolveEstablishmentScope
// = session + role restaurant/admin + establishment cookie, owner-scoped; buildOrderViews
// = ghost-filtered OrderView). This route only narrows the list to the kitchen slice —
// it adds NO new filtering/mapping and NO writes. Establishment is resolved via the
// SESSION/cookie, never from the client. Money-free (pure read).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const scope = await resolveEstablishmentScope(null)
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })
    if (!scope.restaurantId) return NextResponse.json({ orders: [] })

    const localeParam = new URL(req.url).searchParams.get('locale') ?? 'fr'
    const locale = /^[a-z]{2}$/i.test(localeParam) ? localeParam : 'fr'

    const all = await buildOrderViews({
      restaurantId: scope.restaurantId,
      operatorId:   scope.operatorId,
      locale,
    })
    const orders = all.filter(o => isKitchenStatus(o.status))
    return NextResponse.json({ orders })
  } catch (err) {
    console.error('[GET /api/orders/kitchen]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
