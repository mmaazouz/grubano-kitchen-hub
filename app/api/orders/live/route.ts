import { NextResponse } from 'next/server'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { buildOrderViews } from '@/lib/orders-feed'

// ── GET /api/orders/live?locale= ──────────────────────────────────────────────
// Orders v2 — the LIGHT polling endpoint behind the resto Orders screen's
// near-real-time refresh (client polls every 15 s while the tab is visible).
// Returns the SAME filtered list the page renders, for the caller's CURRENT
// establishment (cookie-resolved, owner-scoped). Reuses buildOrderViews +
// HIDDEN_ORDER_STATUSES — zero duplicated filtering. Pure read, no writes.
// ?locale tunes the date/time labels (the client passes its active locale).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const scope = await resolveEstablishmentScope(null)
    if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })
    if (!scope.restaurantId) return NextResponse.json({ orders: [] })

    const localeParam = new URL(req.url).searchParams.get('locale') ?? 'fr'
    const locale = /^[a-z]{2}$/i.test(localeParam) ? localeParam : 'fr'

    const orders = await buildOrderViews({
      restaurantId: scope.restaurantId,
      operatorId:   scope.operatorId,
      locale,
    })
    return NextResponse.json({ orders })
  } catch (err) {
    console.error('[GET /api/orders/live]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
