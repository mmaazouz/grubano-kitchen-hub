import { NextResponse } from 'next/server'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { listRestaurantClaims, type RestaurantClaimsView } from '@/lib/claims'
import { claimsSurfaceOpen } from '@/lib/claim-flags'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET /api/claims/restaurant (P4.5-C1 · D′ L8 S-19) ─────────────────────────────
//
// The owning restaurant's claims. Owner-scoped: ONLY claims on the session operator's own restaurants
// (anti-IDOR, `resolveEstablishmentScope`). The payload is the CURATED view built by
// lib/claim-restaurant-view — never a Claim row.
//
// D′ L8, THE TWO CHANGES AT THIS BOUNDARY:
//
//  1. `?status=<anything>` IS GONE. It used to pass a client string straight into the Prisma `where`
//     (`status=all` ⇒ no filter at all), so the caller chose which claims — and therefore which
//     `refundError` texts — came back. The parameter is now `view`, whitelisted to two values, and an
//     unknown value falls back to 'pending' rather than widening anything. What the restaurant may see is
//     decided by the server in both cases; the parameter only says WHICH half of its own claims.
//
//  2. SURFACE, and only SURFACE. `claimsSurfaceOpen()` is the product kill-switch for the restaurant
//     workflow (D′ L1). INTAKE is deliberately NOT consulted: intake closes the DOOR to new claims and has
//     no business hiding a file the restaurant is already expected to answer — a restaurateur left with an
//     open deadline and an invisible claim is how a silence becomes an arbitration. REFUNDS_ENABLED has no
//     role here either: this route reads, and reading a claim is not a refund.
export async function GET(req: Request) {
  if (!claimsSurfaceOpen()) return NextResponse.json({ enabled: false }) // D′ L1: SURFACE
  const scope = await resolveEstablishmentScope(null)
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

  const raw = new URL(req.url).searchParams.get('view')
  const view: RestaurantClaimsView = raw === 'history' ? 'history' : 'pending'
  const claims = await listRestaurantClaims(scope.ownedIds, { view })
  return NextResponse.json({ enabled: true, view, claims })
}
