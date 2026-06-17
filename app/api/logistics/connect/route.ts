import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isConnectOnboardingEnabled, startConnectOnboarding, syncConnectStatus } from '@/lib/connect-onboarding'

export const dynamic = 'force-dynamic'

// ── /api/logistics/connect — Logistics Stripe Connect onboarding (TEST, P4.1) ─
// POST: start (or resume) the connected courier's OWN Express onboarding, gated by
// LOGISTICS_CONNECT_ENABLED (default OFF). GET: reflect the live onboarding status.
// Scoped to the SESSION logistics profile (by email — never a body id). NO
// charge/payout here (= P4.3). Mirror of /api/supplier/connect.

function baseUrl(req: Request): string {
  const h = req.headers
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'app.grubano.com'
  return `${proto}://${host}`
}

async function callerLogistics() {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) return null
  return prisma.logisticsProfile.findUnique({
    where:  { email },
    select: { id: true, status: true, stripeAccountId: true, payoutStatus: true },
  })
}

export async function POST(req: Request) {
  try {
    if (!isConnectOnboardingEnabled('logistics')) {
      return NextResponse.json({ error: 'Onboarding paiements indisponible', gated: true }, { status: 403 })
    }
    const profile = await callerLogistics()
    if (!profile) return NextResponse.json({ error: 'Profil logistique introuvable' }, { status: 401 })
    // Mirror the supplier gate: only an ACTIVE partner may start payout onboarding.
    if (profile.status !== 'active') {
      return NextResponse.json({ error: 'Compte logistique non activé' }, { status: 403 })
    }

    const origin = baseUrl(req)
    const { url, accountId } = await startConnectOnboarding(
      'logistics',
      { id: profile.id, accountId: profile.stripeAccountId },
      {
        returnUrl:  `${origin}/logistics/dashboard?connect=return`,
        refreshUrl: `${origin}/logistics/dashboard?connect=refresh`,
      },
    )
    return NextResponse.json({ url, accountId })
  } catch (err) {
    console.error('[POST /api/logistics/connect]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function GET() {
  const profile = await callerLogistics()
  if (!profile) return NextResponse.json({ error: 'Profil logistique introuvable' }, { status: 401 })
  const status = await syncConnectStatus('logistics', {
    id: profile.id, accountId: profile.stripeAccountId, status: profile.payoutStatus,
  })
  return NextResponse.json({ status, hasAccount: !!profile.stripeAccountId })
}
