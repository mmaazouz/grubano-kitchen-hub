import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { callerPrestataireProfile } from '@/lib/prestataire-account'
import { isPrestataireConnectLive, startPrestataireOnboarding, syncPrestatairePayoutStatus } from '@/lib/prestataire-connect'

export const dynamic = 'force-dynamic'

// ── /api/prestataire/connect — services Stripe Connect onboarding (TEST, P7) ──
// CLONE of /api/supplier/connect. POST: start (or resume) the connected prestataire's
// OWN Express KYB onboarding. GET: reflect the live onboarding status. DOUBLE-FLAG gated
// (PRESTATAIRE_ENABLED + PRESTATAIRE_CONNECT_ENABLED) → 404 when either is OFF, before any
// work. Scoped to callerPrestataireProfile (SESSION — never a body id). ⚠️ ONBOARDING ONLY:
// NO charge / payout / transfer here. The real money movement is P8. SEPARATE services path.

function baseUrl(req: Request): string {
  const h = req.headers
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'app.grubano.com'
  return `${proto}://${host}`
}

export async function POST(req: Request) {
  // Double-flag gate (default CLOSED). OFF → the endpoint does not exist.
  if (!isPrestataireConnectLive()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const base = await callerPrestataireProfile()
    if (!base) return NextResponse.json({ error: 'Profil prestataire introuvable' }, { status: 401 })
    if (base.status !== 'active') {
      return NextResponse.json({ error: 'Compte prestataire non activé' }, { status: 403 })
    }

    const profile = await prisma.prestataireProfile.findUnique({
      where: { id: base.id }, select: { id: true, stripeAccountId: true },
    })
    if (!profile) return NextResponse.json({ error: 'Profil prestataire introuvable' }, { status: 404 })

    const origin = baseUrl(req)
    const { url, accountId } = await startPrestataireOnboarding(profile, {
      returnUrl:  `${origin}/prestataire/dashboard?connect=return`,
      refreshUrl: `${origin}/prestataire/dashboard?connect=refresh`,
    })
    return NextResponse.json({ url, accountId })
  } catch (err) {
    console.error('[POST /api/prestataire/connect]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function GET() {
  if (!isPrestataireConnectLive()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const base = await callerPrestataireProfile()
  if (!base) return NextResponse.json({ error: 'Profil prestataire introuvable' }, { status: 401 })
  const profile = await prisma.prestataireProfile.findUnique({
    where: { id: base.id }, select: { id: true, stripeAccountId: true, payoutStatus: true },
  })
  if (!profile) return NextResponse.json({ status: 'none', hasAccount: false })
  const status = await syncPrestatairePayoutStatus(profile)
  return NextResponse.json({ status, hasAccount: !!profile.stripeAccountId })
}
