import { NextResponse } from 'next/server'
import { resolveEstablishmentScope } from '@/lib/establishment-scope'
import { isClaimsEnabled, listRestaurantClaims } from '@/lib/claims'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET /api/claims/restaurant (P4.5-C1) ──────────────────────────────────────────
// The owning restaurant's claims. Gated by CLAIMS_ENABLED (OFF → enabled:false → the
// panel renders nothing). Owner-scoped: ONLY claims on the session operator's own
// restaurants (no IDOR). Default returns the ones awaiting a response.
export async function GET(req: Request) {
  if (!isClaimsEnabled()) return NextResponse.json({ enabled: false })
  const scope = await resolveEstablishmentScope(null)
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: scope.status })

  const statusParam = new URL(req.url).searchParams.get('status')
  const status = statusParam === 'all' ? undefined : (statusParam ?? 'restaurant_review')
  const claims = await listRestaurantClaims(scope.ownedIds, { status })
  return NextResponse.json({ enabled: true, claims })
}
