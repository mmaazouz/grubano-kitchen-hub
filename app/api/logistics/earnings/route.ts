import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { computePartnerBalance } from '@/lib/partner-balance'
import { isLogisticsEnabled } from '@/lib/logistics-account'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET /api/logistics/earnings — the SESSION courier's earnings feed (P4.3 ÉTAPE 5) ─
// READ-ONLY twin of /api/affiliate/stats, for the LOGISTICS entity. The courier is
// resolved from the SESSION email → LogisticsProfile (never a client id → IDOR-safe).
// Feeds LO6 « Mes gains ». Returns the REAL money from the P4.3 rail — NOTHING invented:
//   • balance  = computePartnerBalance('logistics') → available (retirable) + paid.
//   • pending  = Σ CourierEarning.netCents status='pending' (not yet matured).
//   • earnings = the courier's CourierEarning rows (course: gross → −fee(comm) → net;
//                tip: 100 % net). Real Mission.id ref, real status/date. Server cents —
//                the client divides by 100 for DISPLAY only, NEVER recomputes.
// ZERO write, ZERO money movement. NOT hard-gated: when the accrual/payout rails are OFF
// the table is simply empty → the client shows an honest « aucun gain » state.

const EARNINGS_CAP = 60

export async function GET() {
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture (patron PRESTATAIRE_ENABLED).
  if (!isLogisticsEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const session = await getServerSession(authOptions)
    const email = session?.user?.email
    if (!email) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

    const profile = await prisma.logisticsProfile.findUnique({ where: { email }, select: { id: true } })
    if (!profile) return NextResponse.json({ error: 'Profil livreur introuvable' }, { status: 404 })

    // Owner-scoped reads, keyed on THIS courier's LogisticsProfile id.
    const [balance, rows] = await Promise.all([
      computePartnerBalance('logistics', profile.id), // available/paid (READ-ONLY)
      prisma.courierEarning.findMany({
        where:   { courierId: profile.id },
        orderBy: { createdAt: 'desc' },
        take:    EARNINGS_CAP,
        select: {
          id: true, type: true, grossCents: true, feeCents: true, netCents: true,
          status: true, missionId: true, orderId: true, maturesAt: true, createdAt: true,
        },
      }),
    ])

    // Pending (net, not-yet-matured) — the « En attente » balance. Integer cents.
    let pendingCents = 0
    for (const r of rows) if (r.status === 'pending') pendingCents += r.netCents

    const earnings = rows.map(r => ({
      id:         r.id,
      type:       r.type,        // 'course' | 'tip'
      grossCents: r.grossCents,
      feeCents:   r.feeCents,    // Grubano commission (0 for a tip)
      netCents:   r.netCents,    // what the courier is owed
      status:     r.status,      // pending | matured | paid
      missionId:  r.missionId,   // real Mission id (ref) — never a fabricated « MIS-… »
      orderId:    r.orderId,
      date:       r.createdAt.toISOString(),
      maturesAt:  r.maturesAt?.toISOString() ?? null,
    }))

    return NextResponse.json({
      balance:      { availableCents: balance.availableCents, paidCents: balance.paidCents },
      pendingCents,
      earnings,
    })
  } catch (err) {
    console.error('[GET /api/logistics/earnings]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
