import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isClaimsEnabled, listArbitrationQueue } from '@/lib/claims'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET /api/admin/claims (P4.5-C2) ───────────────────────────────────────────────
// The neutral admin's ARBITRATION QUEUE: contested claims awaiting a decision, each
// enriched with both parties' read-only abuse signals. ADMIN-ONLY (never the resto or
// the client). Gated by CLAIMS_ENABLED (OFF → enabled:false → the console renders nothing).
export async function GET() {
  if (!isClaimsEnabled()) return NextResponse.json({ enabled: false })

  const session = await getServerSession(authOptions)
  const user = session?.user as { role?: string; roles?: string[] } | undefined
  if (!user) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
  const isAdmin = user.role === 'admin' || (Array.isArray(user.roles) && user.roles.includes('admin'))
  if (!isAdmin) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const claims = await listArbitrationQueue()
  return NextResponse.json({ enabled: true, claims })
}
