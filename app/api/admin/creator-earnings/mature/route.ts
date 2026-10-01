import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { matureCreatorEarnings } from '@/lib/creator-earnings'
import { rateLimit } from '@/lib/rate-limit'
import { recordAdminAudit, CRON_ACTOR_ID } from '@/lib/admin-audit'
import { safeEqual } from '@/lib/safe-compare'
import { isCreatorEnabled } from '@/lib/creator-account'

// ── POST /api/admin/creator-earnings/mature ───────────────────────────────────
// B2a — runs the daily maturation pass over every PENDING creator gain
// (ReferralOrder + DishSale): pending → matured / cancelled per the B0 rules in
// lib/creator-earnings (7 days after the order, order paid, not fully refunded
// [read from the ledger], not self-referral). IDEMPOTENT — re-running scans
// only what is still pending.
//
// AUTH — exact A6 dual gate (same as /api/admin/invoices/generate): the daily
// cron (scripts/cron/creator-earnings-mature.js) calls with a fixed-string
// X-Internal-Token header; only opens when INTERNAL_CRON_TOKEN is set AND
// matches exactly. Otherwise the operator session gate (admin|restaurant).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture (patron PRESTATAIRE_ENABLED).
  if (!isCreatorEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Flag-gated rate limit (ADM7; no-op when RATE_LIMIT_ENABLED is off → byte-identical).
  const limited = rateLimit(req, 'admin_creator_earnings_mature', { limitDefault: 20, windowDefault: 60 })
  if (limited) return limited

  try {
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
      if (!operator || !['admin', 'restaurant'].includes(operator.role)) {
        return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
      }
      actorId = operator.id
      actorEmail = session.user.email
    }

    const summary = await matureCreatorEarnings()
    await recordAdminAudit({ actorId, actorEmail, action: 'creator_earnings.mature', targetType: null, targetId: null, metadata: {}, req })
    return NextResponse.json({ ok: true, ...summary })
  } catch (err) {
    console.error('[creator-earnings mature]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
