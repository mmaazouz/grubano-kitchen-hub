import { NextResponse } from 'next/server'
import { resolveAdmin } from '@/lib/admin-guard'
import {
  listArbitrationQueue, listPendingRestaurantClaims, listActionableRefundClaims, listSilenceExpiredClaims,
  // D′ L4 (§8.5): the « À rembourser » queue and its « À ratifier » sub-list — READ-ONLY in this lot.
  listApprovedAwaitingPayment, listAwaitingRatification,
} from '@/lib/claims'
import { claimsSurfaceOpen } from '@/lib/claim-flags'
// D′ L4: the two D′ queues put approvedAmountCents into a Prisma where/select. A client that does not
// know the column REJECTS such a query, which would take down this whole route — including its money
// list. The probe decides whether to read them; it never decides whether to show the rest.
import { schemaReady } from '@/lib/schema-ready'

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

  // D′ L4: read the D′ queues only when the running process can actually use the column. Not ready ⇒
  // they come back EMPTY and the payload says so (`schemaReady:false`), so the console can explain why
  // instead of implying there is nothing to pay. Everything that predates D′ keeps answering.
  const dprimeReady = (await schemaReady()).ready
  const awaitingPaymentRead = () => (dprimeReady ? listApprovedAwaitingPayment() : Promise.resolve([]))
  const awaitingRatificationRead = () => (dprimeReady ? listAwaitingRatification() : Promise.resolve([]))

  if (!surfaceOpen) {
    // Kill-switch shape: no workflow, money only (S-12 (b), spec v2 §3.2 « scindé »).
    // D′ L4: « À rembourser » is MONEY — a decided, unpaid claim stays visible when the feature is off,
    // exactly like the actionable refunds beside it. Hiding a payable decision behind a feature flag is
    // how one goes silent. The ratification sub-list is workflow (and those claims already appear in
    // actionableRefunds as approved-unpaid), so it stays empty here.
    const [actionableRefunds, awaitingPayment] = await Promise.all([
      listActionableRefundClaims(), awaitingPaymentRead(),
    ])
    return NextResponse.json({
      enabled: false,
      schemaReady: dprimeReady,
      claims: [], pending: [], actionableRefunds, silenceExpired: [],
      awaitingPayment, awaitingRatification: [],
      counts: {
        arbitration: 0, silenceExpired: 0, legacyPendingMoney: 0,
        actionableRefunds: actionableRefunds.length,
        awaitingPayment: awaitingPayment.length, awaitingRatification: 0,
        actionableTotal: actionableRefunds.length,
      },
    })
  }

  // P0-39 (vague 3) — ADDITIF : la file d'arbitrage est inchangée ; `pending`
  // expose EN PLUS les réclamations en attente du restaurant (lecture seule,
  // aucune action possible dessus — l'admin VOIT, il ne se substitue pas).
  // Claims batch 1 — the queue now also carries the claims a restaurant never answered
  // (silence past the deadline is admin-actionable, it no longer blocks for ever) and a
  // MONEY list: refunds stuck pending, failed, or succeeded-but-unreconciled. The badge
  // must count every actionable claim, not arbitration alone.
  const [claims, pending, actionableRefunds, silenceExpired, awaitingPayment, awaitingRatification] = await Promise.all([
    listArbitrationQueue(), listPendingRestaurantClaims(), listActionableRefundClaims(), listSilenceExpiredClaims(),
    // D′ L4: what the financial rail WILL select (§8.5), and the legacy approvals whose amount was never
    // fixed — listed apart because the rail refuses them (amount_not_ratified) until an admin ratifies.
    awaitingPaymentRead(), awaitingRatificationRead(),
  ])
  const actionableCount = claims.length + actionableRefunds.length
  return NextResponse.json({
    enabled: true,
    // D′ L4: false ⇒ the two D′ queues below are empty because the column is unusable in this process,
    // NOT because nothing is waiting. The console must say the difference.
    schemaReady: dprimeReady,
    claims,
    pending,
    actionableRefunds,
    silenceExpired,
    awaitingPayment,
    awaitingRatification,
    counts: {
      arbitration:       claims.filter((c) => c.status === 'arbitration').length,
      silenceExpired:    silenceExpired.length,
      // D′ L4 (§7.4 relabel): same population, named for what it is — a decision awaiting the rail.
      // The key keeps its name so no consumer of this payload breaks on a rename it did not ask for.
      legacyPendingMoney: claims.filter((c) => c.queueReason === 'awaiting_payment').length,
      actionableRefunds: actionableRefunds.length,
      // D′ L4: the two D′ queues, counted so the console can title them without re-deriving anything.
      awaitingPayment:      awaitingPayment.length,
      awaitingRatification: awaitingRatification.length,
      /** What the admin badge must show. */
      actionableTotal:   actionableCount,
    },
  })
}
