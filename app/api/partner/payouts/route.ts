import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isConnectOnboardingEnabled } from '@/lib/connect-onboarding'

export const dynamic = 'force-dynamic'

// ── GET /api/partner/payouts — the SESSION creator's payout history (P4-UI) ───
// READ-ONLY. Returns whether the creator payout rail is enabled (the server-side
// CREATOR_CONNECT_ENABLED gate, surfaced so the client UI can hide the section
// cleanly) + the connected creator's OWN Payout rows. Owner-scoped: the creator is
// resolved from the SESSION email (never a client id → no IDOR); 401 without a
// session. NO write, NO money movement (payouts are triggered admin/cron — P4.3).

export async function GET() {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })

  const enabled = isConnectOnboardingEnabled('creator')

  const creator = await prisma.creator.findUnique({ where: { email }, select: { id: true } })
  const payouts = creator
    ? await prisma.payout.findMany({
        where:   { role: 'creator', creatorId: creator.id },
        orderBy: { createdAt: 'desc' },
        select:  { id: true, amountCents: true, currency: true, status: true, paidAt: true, stripeTransferId: true, createdAt: true },
      })
    : []

  return NextResponse.json({ enabled, payouts })
}
