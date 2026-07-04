import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isCreatorPayoutEnabled, payCreator, runCreatorPayouts } from '@/lib/creator-payout'
import { rateLimit } from '@/lib/rate-limit'
import { recordAdminAudit, CRON_ACTOR_ID } from '@/lib/admin-audit'
import { safeEqual } from '@/lib/safe-compare'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── POST /api/admin/creator-payouts/run — execute creator payouts (TEST, P4.3) ─
// Moves REAL money (TEST mode) via lib/creator-payout (idempotent). NO user "withdraw"
// UI — triggered by the daily cron OR an admin.
//
// GATE ORDER (all BEFORE any payout work):
//   1. CREATOR_PAYOUT_ENABLED kill-switch (default OFF) → 403 gated.
//   2. AUTH (mirror of the maturation cron): INTERNAL_CRON_TOKEN via X-Internal-Token
//      header, OR an ADMIN session. 401 without either; 403 for a non-admin session.
// Body: { creatorId } → pay that one; otherwise BATCH (all active-Connect creators).
// Idempotent at the run level (re-running pays nothing already paid).

export async function POST(req: Request) {
  // 0. Flag-gated rate limit (ADM7; no-op when RATE_LIMIT_ENABLED is off → byte-identical).
  const limited = rateLimit(req, 'admin_creator_payouts_run', { limitDefault: 20, windowDefault: 60 })
  if (limited) return limited

  // 1. Kill-switch — default OFF, checked before anything else.
  if (!isCreatorPayoutEnabled()) {
    return NextResponse.json({ error: 'Versements créateur indisponibles', gated: true }, { status: 403 })
  }

  // 2. Auth — cron secret OR admin session.
  const internalToken    = req.headers.get('x-internal-token')
  const internalExpected = (process.env.INTERNAL_CRON_TOKEN ?? '').trim()
  const isInternal =
    internalExpected.length > 0 &&
    typeof internalToken === 'string' &&
    safeEqual(internalToken, internalExpected) // ADM7: constant-time

  let actorId = CRON_ACTOR_ID
  let actorEmail: string | null = null
  if (!isInternal) {
    const session = await getServerSession(authOptions)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }
    const operator = await prisma.operator.findUnique({
      where:  { email: session.user.email },
      select: { id: true, role: true },
    })
    if (!operator || operator.role !== 'admin') {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }
    actorId = operator.id
    actorEmail = session.user.email
  }

  try {
    const body = await req.json().catch(() => ({} as { creatorId?: unknown }))
    const creatorId = typeof (body as { creatorId?: unknown }).creatorId === 'string'
      ? (body as { creatorId: string }).creatorId
      : null

    if (creatorId) {
      const result = await payCreator(creatorId)
      await recordAdminAudit({ actorId, actorEmail, action: 'creator_payout.run', targetType: 'creator', targetId: creatorId, metadata: { mode: 'single' }, req })
      return NextResponse.json({ ok: true, mode: 'single', result })
    }

    const summary = await runCreatorPayouts()
    await recordAdminAudit({ actorId, actorEmail, action: 'creator_payout.run', targetType: 'creator', targetId: null, metadata: { mode: 'batch' }, req })
    return NextResponse.json({ ok: true, mode: 'batch', ...summary })
  } catch (err) {
    console.error('[creator-payouts run]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
