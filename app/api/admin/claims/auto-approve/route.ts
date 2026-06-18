import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isClaimsEnabled, runClaimAutoApproval } from '@/lib/claims'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/admin/claims/auto-approve (P4.5-C1) ─────────────────────────────────
// Sweeps claims whose 24h restaurant-response window expired → auto-approves them (a
// resto can't block by ignoring) and drives any approved-but-unrefunded claim once
// REFUNDS_ENABLED is ON. Idempotent (atomic status guards in lib/claims). Triggered by
// the internal cron OR an admin — Mohammed wires the cron when CLAIMS_ENABLED is ON.
//
// GATE ORDER (all BEFORE any work):
//   1. CLAIMS_ENABLED kill-switch (default OFF) → 403 gated.
//   2. AUTH (mirror of creator-payouts/run): INTERNAL_CRON_TOKEN via X-Internal-Token,
//      OR an ADMIN session. 401 without either; 403 for a non-admin session.
export async function POST(req: Request) {
  if (!isClaimsEnabled()) {
    return NextResponse.json({ error: 'Réclamations indisponibles', gated: true }, { status: 403 })
  }

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
    const summary = await runClaimAutoApproval()
    return NextResponse.json({ ok: true, ...summary })
  } catch (err) {
    console.error('[claims auto-approve]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
