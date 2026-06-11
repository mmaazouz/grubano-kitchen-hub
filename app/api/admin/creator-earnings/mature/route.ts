import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { prisma } from '@/lib/prisma'
import { authOptions } from '@/lib/auth'
import { matureCreatorEarnings } from '@/lib/creator-earnings'

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
  try {
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
      if (!operator || !['admin', 'restaurant'].includes(operator.role)) {
        return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
      }
    }

    const summary = await matureCreatorEarnings()
    return NextResponse.json({ ok: true, ...summary })
  } catch (err) {
    console.error('[creator-earnings mature]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
