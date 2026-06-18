import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isFranchiseSettlementEnabled, settleFranchisor, runFranchiseSettlements } from '@/lib/franchise-settlement'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/admin/franchise-settlements/run — settle franchise royalties (TEST) ─
// P4-Franchise-B. Moves REAL money (TEST mode) via lib/franchise-settlement (idempotent):
// transfers a franchisor's accrued FranchiseRoyalty 'pending' lines to their Connect
// account, records a Payout (role='franchise'), marks the lines 'settled'. NO UI —
// triggered by a cron OR an admin.
//
// GATE ORDER (all BEFORE any settlement work):
//   1. FRANCHISE_SETTLEMENT_ENABLED kill-switch (default OFF) → 403 gated, no Stripe, no write.
//   2. AUTH (mirror of creator-payouts/run): INTERNAL_CRON_TOKEN via X-Internal-Token
//      header, OR an ADMIN session. 401 without either; 403 for a non-admin session.
// Body: { operatorId } → settle that one franchisor; otherwise BATCH (all with pending).
// Idempotent at the run level (re-running settles nothing already settled).

export async function POST(req: Request) {
  // 1. Kill-switch — default OFF, checked before anything else.
  if (!isFranchiseSettlementEnabled()) {
    return NextResponse.json({ error: 'Règlement franchise indisponible', gated: true }, { status: 403 })
  }

  // 2. Auth — cron secret OR admin session.
  const internalToken    = req.headers.get('x-internal-token')
  const internalExpected = (process.env.INTERNAL_CRON_TOKEN ?? '').trim()
  const isInternal =
    internalExpected.length > 0 &&
    typeof internalToken === 'string' &&
    internalToken === internalExpected

  if (!isInternal) {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    const operator = await prisma.operator.findUnique({
      where:  { email: session.user.email },
      select: { role: true },
    })
    if (!operator || operator.role !== 'admin') {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }
  }

  try {
    const body = await req.json().catch(() => ({} as { operatorId?: unknown }))
    const operatorId = typeof (body as { operatorId?: unknown }).operatorId === 'string'
      ? (body as { operatorId: string }).operatorId
      : null

    if (operatorId) {
      const result = await settleFranchisor(operatorId)
      return NextResponse.json({ ok: true, mode: 'single', result })
    }

    const summary = await runFranchiseSettlements()
    return NextResponse.json({ ok: true, mode: 'batch', ...summary })
  } catch (err) {
    console.error('[franchise-settlements run]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
