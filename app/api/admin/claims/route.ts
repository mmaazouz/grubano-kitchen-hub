import { NextResponse } from 'next/server'
import { resolveAdmin } from '@/lib/admin-guard'
import { listArbitrationQueue, listPendingRestaurantClaims, listActionableRefundClaims, listSilenceExpiredClaims } from '@/lib/claims'
import { claimsSurfaceOpen } from '@/lib/claim-flags'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET /api/admin/claims (P4.5-C2) ───────────────────────────────────────────────
// The neutral admin's ARBITRATION QUEUE: contested claims awaiting a decision, each
// enriched with both parties' read-only abuse signals. ADMIN-ONLY (never the resto or
// the client). D′ L1 (spec v2 §3.2) — the answer is SPLIT by the claims SURFACE: when it is closed
// (kill-switch) the WORKFLOW lists are empty and enabled:false, but the MONEY list (actionableRefunds)
// is still returned and counted — an unresolved money case never hides behind a feature flag.
export async function GET() {
  const surfaceOpen = claimsSurfaceOpen()

  // ROUND-12 AUDIT FIX (P3): this was the one admin claims route still authorizing from the sign-in JWT's
  // roles, which are never refreshed. Like every other admin claims route, the role set is re-read.
  const operator = await resolveAdmin()
  if (!operator) return NextResponse.json(surfaceOpen ? { error: 'Accès refusé' } : { enabled: false }, { status: surfaceOpen ? 403 : 200 })

  if (!surfaceOpen) {
    // Kill-switch shape: no workflow, money only (S-12 (b), spec v2 §3.2 « scindé »).
    const actionableRefunds = await listActionableRefundClaims()
    return NextResponse.json({
      enabled: false,
      claims: [], pending: [], actionableRefunds, silenceExpired: [],
      counts: { arbitration: 0, silenceExpired: 0, legacyPendingMoney: 0, actionableRefunds: actionableRefunds.length, actionableTotal: actionableRefunds.length },
    })
  }

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
