import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isConnectOnboardingEnabled, startConnectOnboarding, syncConnectStatus } from '@/lib/connect-onboarding'

export const dynamic = 'force-dynamic'

// ── /api/creator/connect — Creator Stripe Connect onboarding (TEST, P4.1) ─────
// POST: start (or resume) the connected creator's OWN Express onboarding, gated by
// CREATOR_CONNECT_ENABLED (default OFF). GET: reflect the live onboarding status.
// Scoped to the SESSION creator (by email — never a body id). NO charge/payout
// here (= P4.3). Mirror of /api/supplier/connect.

function baseUrl(req: Request): string {
  const h = req.headers
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'app.grubano.com'
  return `${proto}://${host}`
}

async function callerCreator() {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return null
  return prisma.creator.findUnique({
    where:  { email },
    select: { id: true, stripeAccountId: true, payoutStatus: true },
  })
}

export async function POST(req: Request) {
  try {
    if (!isConnectOnboardingEnabled('creator')) {
      return NextResponse.json({ error: 'Onboarding paiements indisponible', gated: true }, { status: 403 })
    }
    const creator = await callerCreator()
    if (!creator) return NextResponse.json({ error: 'Profil créateur introuvable' }, { status: 401 })

    const origin = baseUrl(req)
    const { url, accountId } = await startConnectOnboarding(
      'creator',
      { id: creator.id, accountId: creator.stripeAccountId },
      {
        returnUrl:  `${origin}/creators/dashboard?connect=return`,
        refreshUrl: `${origin}/creators/dashboard?connect=refresh`,
      },
    )
    return NextResponse.json({ url, accountId })
  } catch (err) {
    console.error('[POST /api/creator/connect]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function GET() {
  const creator = await callerCreator()
  if (!creator) return NextResponse.json({ error: 'Profil créateur introuvable' }, { status: 401 })
  const status = await syncConnectStatus('creator', {
    id: creator.id, accountId: creator.stripeAccountId, status: creator.payoutStatus,
  })
  return NextResponse.json({ status, hasAccount: !!creator.stripeAccountId })
}
