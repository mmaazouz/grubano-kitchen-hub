import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { callerSupplierProfile } from '@/lib/supplier-account'
import { isSupplierConnectEnabled, startSupplierOnboarding, syncSupplierPayoutStatus } from '@/lib/supplier-connect'

export const dynamic = 'force-dynamic'

// ── /api/supplier/connect — B2B Stripe Connect onboarding (TEST, Slice 5b) ────
// POST: start (or resume) the connected supplier's OWN Express KYB onboarding,
// gated by the immatriculation flag (isSupplierConnectEnabled). GET: reflect the
// live onboarding status. Scoped to callerSupplierProfile (session — never a body
// id). SEPARATE B2B path; no charge/payout (= 5c).

function baseUrl(req: Request): string {
  const h = req.headers
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'app.grubano.com'
  return `${proto}://${host}`
}

export async function POST(req: Request) {
  try {
    // Immatriculation gate (default CLOSED until Grubano is registered).
    if (!isSupplierConnectEnabled()) {
      return NextResponse.json({ error: 'Onboarding paiements indisponible', gated: true }, { status: 403 })
    }
    const base = await callerSupplierProfile()
    if (!base) return NextResponse.json({ error: 'Profil fournisseur introuvable' }, { status: 401 })
    if (base.status !== 'active') {
      return NextResponse.json({ error: 'Compte fournisseur non activé' }, { status: 403 })
    }

    const profile = await prisma.supplierProfile.findUnique({
      where: { id: base.id }, select: { id: true, stripeAccountId: true },
    })
    if (!profile) return NextResponse.json({ error: 'Profil fournisseur introuvable' }, { status: 404 })

    const origin = baseUrl(req)
    const { url, accountId } = await startSupplierOnboarding(profile, {
      returnUrl:  `${origin}/supplier/dashboard?connect=return`,
      refreshUrl: `${origin}/supplier/dashboard?connect=refresh`,
    })
    return NextResponse.json({ url, accountId })
  } catch (err) {
    console.error('[POST /api/supplier/connect]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function GET() {
  const base = await callerSupplierProfile()
  if (!base) return NextResponse.json({ error: 'Profil fournisseur introuvable' }, { status: 401 })
  const profile = await prisma.supplierProfile.findUnique({
    where: { id: base.id }, select: { id: true, stripeAccountId: true, payoutStatus: true },
  })
  if (!profile) return NextResponse.json({ status: 'none', hasAccount: false })
  const status = await syncSupplierPayoutStatus(profile)
  return NextResponse.json({ status, hasAccount: !!profile.stripeAccountId })
}
