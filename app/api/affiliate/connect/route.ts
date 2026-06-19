import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isAffiliateEnabled, getAffiliateByOperator } from '@/lib/affiliate-account'
import { isConnectOnboardingEnabled, startConnectOnboarding, syncConnectStatus } from '@/lib/connect-onboarding'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── /api/affiliate/connect — top-level affiliate Stripe Connect onboarding (Brique D2) ─
// POST: start (or resume) the SESSION affiliate's OWN Express onboarding (KYC, particulier
// via business_type:'individual' — D1's connect-onboarding 'affiliate' type). GET: reflect
// the live status. Owner-scoped: the operator is the SESSION operator id (never a body id
// → no IDOR). Gated by AFFILIATE_ENABLED (role) + AFFILIATE_CONNECT_ENABLED (payout rail),
// both default OFF. NO charge/payout here — that is /api/affiliate/withdraw. Mirror of
// /api/creator/connect; REUSES lib/connect-onboarding TEL QUEL (NOT modified).

function baseUrl(req: Request): string {
  const h = req.headers
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const host  = h.get('x-forwarded-host') ?? h.get('host') ?? 'app.grubano.com'
  return `${proto}://${host}`
}

function flagsOn(): boolean {
  return isAffiliateEnabled() && isConnectOnboardingEnabled('affiliate')
}

/** The SESSION operator (affiliate) + its affiliate Connect fields. Owner-scoped. */
async function callerOperator() {
  const session = await getServerSession(authOptions)
  const operatorId = (session?.user as { id?: string } | undefined)?.id
  if (!operatorId) return null
  // Must be a real affiliate (Brique A entity) to onboard the affiliate payout rail.
  const affiliate = await getAffiliateByOperator(operatorId)
  if (!affiliate) return null
  return prisma.operator.findUnique({
    where:  { id: operatorId },
    select: { id: true, affiliateStripeAccountId: true, affiliatePayoutStatus: true },
  })
}

export async function POST(req: Request) {
  try {
    if (!flagsOn()) return NextResponse.json({ error: 'Indisponible', gated: true }, { status: 404 })
    const op = await callerOperator()
    if (!op) return NextResponse.json({ error: 'Profil affilié introuvable' }, { status: 401 })

    const origin = baseUrl(req)
    const { url, accountId } = await startConnectOnboarding(
      'affiliate',
      { id: op.id, accountId: op.affiliateStripeAccountId },
      {
        returnUrl:  `${origin}/affiliate/dashboard?connect=return`,
        refreshUrl: `${origin}/affiliate/dashboard?connect=refresh`,
      },
    )
    return NextResponse.json({ url, accountId })
  } catch (err) {
    console.error('[POST /api/affiliate/connect]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function GET() {
  if (!flagsOn()) return NextResponse.json({ error: 'Indisponible', gated: true }, { status: 404 })
  const op = await callerOperator()
  if (!op) return NextResponse.json({ error: 'Profil affilié introuvable' }, { status: 401 })
  const status = await syncConnectStatus('affiliate', {
    id: op.id, accountId: op.affiliateStripeAccountId, status: op.affiliatePayoutStatus,
  })
  return NextResponse.json({ status, hasAccount: !!op.affiliateStripeAccountId })
}
