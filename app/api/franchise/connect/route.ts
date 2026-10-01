import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { readOperatorRoles } from '@/lib/operator-roles'
import { isConnectOnboardingEnabled, startConnectOnboarding, syncConnectStatus } from '@/lib/connect-onboarding'
import { isFranchiseEnabled } from '@/lib/franchise-account'

export const dynamic = 'force-dynamic'

// ── /api/franchise/connect — Franchise Stripe Connect onboarding (TEST, P4.1) ─
// The franchiseur has no dedicated entity → the connected account lives on the
// Operator under the franchise* fields (distinct from any Creator account the same
// human may hold). POST: start/resume onboarding, gated by FRANCHISE_CONNECT_ENABLED
// (default OFF). GET: live status. Scoped to the SESSION operator (by id) and
// requires the 'franchise' role (role SET via readOperatorRoles — mirror of the
// franchise profile gate). NO charge/payout here (= P4.3).

function baseUrl(req: Request): string {
  const h = req.headers
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'app.grubano.com'
  return `${proto}://${host}`
}

// Resolve the SESSION operator and require the 'franchise' role. Returns the
// operator (with its franchise* connect fields) or null (→ 401/403 by the caller).
async function callerFranchise() {
  const session = await getServerSession(authOptions)
  const id = (session?.user as { id?: string } | undefined)?.id
  if (!id) return null
  const op = await prisma.operator.findUnique({
    where:  { id },
    select: { id: true, role: true, status: true, franchiseStripeAccountId: true, franchisePayoutStatus: true },
  })
  if (!op) return null
  const roles = await readOperatorRoles(op.id, op.role)
  if (!roles.includes('franchise')) return null
  return op
}

export async function POST(req: Request) {
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture (patron PRESTATAIRE_ENABLED).
  if (!isFranchiseEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    if (!isConnectOnboardingEnabled('franchise')) {
      return NextResponse.json({ error: 'Onboarding paiements indisponible', gated: true }, { status: 403 })
    }
    const op = await callerFranchise()
    if (!op) return NextResponse.json({ error: 'Accès franchiseur requis' }, { status: 401 })
    // Mirror the supplier gate: only an ACTIVE account may start payout onboarding.
    if (op.status !== 'active') {
      return NextResponse.json({ error: 'Compte franchiseur non activé' }, { status: 403 })
    }

    const origin = baseUrl(req)
    const { url, accountId } = await startConnectOnboarding(
      'franchise',
      { id: op.id, accountId: op.franchiseStripeAccountId },
      {
        returnUrl:  `${origin}/franchise/dashboard?connect=return`,
        refreshUrl: `${origin}/franchise/dashboard?connect=refresh`,
      },
    )
    return NextResponse.json({ url, accountId })
  } catch (err) {
    console.error('[POST /api/franchise/connect]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function GET() {
  // P0-06 — rôle masqué (doctrine Q8) : indisponible côté serveur. 404 en PREMIÈRE
  // ligne — AVANT toute lecture de secret, session, body ou écriture (patron PRESTATAIRE_ENABLED).
  if (!isFranchiseEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const op = await callerFranchise()
  if (!op) return NextResponse.json({ error: 'Accès franchiseur requis' }, { status: 401 })
  const status = await syncConnectStatus('franchise', {
    id: op.id, accountId: op.franchiseStripeAccountId, status: op.franchisePayoutStatus,
  })
  return NextResponse.json({ status, hasAccount: !!op.franchiseStripeAccountId })
}
