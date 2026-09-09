import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { isClaimsEnabled, listArbitrationQueue, listPendingRestaurantClaims, listActionableRefundClaims, listSilenceExpiredClaims } from '@/lib/claims'

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

  // P0-39 (vague 3) — ADDITIF : la file d'arbitrage est inchangée ; `pending`
  // expose EN PLUS les réclamations en attente du restaurant (lecture seule,
  // aucune action possible dessus — l'admin VOIT, il ne se substitue pas).
  // Claims batch 1 — the queue now also carries the claims a restaurant never answered
  // (silence past the deadline is admin-actionable, it no longer blocks for ever) and a
  // MONEY list: refunds stuck pending, failed, or succeeded-but-unreconciled. The badge
  // must count every actionable claim, not arbitration alone.
  const [claims, pending, actionableRefunds, silenceExpired] = await Promise.all([
    listArbitrationQueue(), listPendingRestaurantClaims(), listActionableRefundClaims(), listSilenceExpiredClaims(),
  ])
  const actionableCount = claims.length + actionableRefunds.length
  return NextResponse.json({
    enabled: true,
    claims,
    pending,
    actionableRefunds,
    silenceExpired,
    counts: {
      arbitration:       claims.filter((c) => c.status === 'arbitration').length,
      silenceExpired:    silenceExpired.length,
      legacyPendingMoney: claims.filter((c) => c.queueReason === 'legacy_pending_money_decision').length,
      actionableRefunds: actionableRefunds.length,
      /** What the admin badge must show. */
      actionableTotal:   actionableCount,
    },
  })
}
