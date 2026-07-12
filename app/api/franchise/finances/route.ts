import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { gateFranchise } from '@/lib/franchise-pos'
import { isFranchiseRoyaltyEnabled, resolveFranchiseRate } from '@/lib/franchise-royalty'
import { getFranchiseEarnings, getFranchisePayouts } from '@/lib/franchise-earnings'

export const dynamic = 'force-dynamic'

// ── GET /api/franchise/finances — the SESSION franchisor's earnings + settlements ────
//
// READ-ONLY (B6, Agent 47). Returns the authoritative royalty totals (accrued / settled /
// pending, from FranchiseRoyalty) and the settlement history (Payout role='franchise'),
// for the signed-in franchisor ONLY. Owner-scoped via gateFranchise(): the operator id
// comes from the SESSION (never a client value → no IDOR) and the 'franchise' role is
// required (401 without a session, 403 without the role). No write, no settlement/transfer
// is ever triggered here — settlements run admin/cron (Franchise-B). `royaltyEnabled`
// surfaces the server-side held-back gate so the UI can label the figures honestly.
//
// Amounts are integer CENTS (the native unit of royaltyCents / Payout.amountCents); the
// page formats them to euros.

export async function GET() {
  const gate = await gateFranchise()
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.status === 401 ? 'Non autorisé' : 'Accès refusé' },
      { status: gate.status },
    )
  }

  const [earnings, payouts, royaltyGroups, brands] = await Promise.all([
    getFranchiseEarnings(gate.operatorId),
    getFranchisePayouts(gate.operatorId),
    // FR5 — per-POS breakdown from the REAL FranchiseRoyalty (owner-scoped). Empty when the
    // held-back rail is gated OFF (no rows) → honest empty breakdown, never a CA×rate recompute.
    prisma.franchiseRoyalty.groupBy({
      by:    ['pointOfSaleId'],
      where: { franchisorOperatorId: gate.operatorId },
      _sum:  { royaltyCents: true },
    }),
    // FR5 — the single displayed rate ONLY when unambiguous across franchised brands, else null.
    prisma.brand.findMany({ where: { operatorId: gate.operatorId, openToFranchise: true }, select: { royaltyPct: true } }),
  ])

  // Name the breakdown rows (POS ids come from the owner-scoped royalty rows → this franchisor's).
  const posIds = royaltyGroups.map((g) => g.pointOfSaleId)
  const pos = posIds.length
    ? await prisma.pointOfSale.findMany({ where: { id: { in: posIds } }, select: { id: true, name: true } })
    : []
  const nameById = new Map(pos.map((p) => [p.id, p.name]))
  const breakdown = royaltyGroups
    .map((g) => ({ posName: nameById.get(g.pointOfSaleId) ?? '—', royaltyCents: g._sum.royaltyCents ?? 0 }))
    .filter((b) => b.royaltyCents > 0)
    .sort((a, b) => b.royaltyCents - a.royaltyCents)

  const rates = Array.from(new Set(brands.map((b) => resolveFranchiseRate(b))))
  const ratePct = rates.length === 1 ? Math.round(rates[0] * 100) : null

  return NextResponse.json({
    royaltyEnabled: isFranchiseRoyaltyEnabled(),
    accruedCents:   earnings.accruedCents,
    settledCents:   earnings.settledCents,
    pendingCents:   earnings.pendingCents,
    payouts,
    // ── FR5 additive ──
    breakdown,
    ratePct,
  })
}
