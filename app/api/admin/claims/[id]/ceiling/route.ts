import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { resolveAdmin } from '@/lib/admin-guard'
import { buildClaimScopeForOrder } from '@/lib/claims'
import { claimsSurfaceOpen } from '@/lib/claim-flags'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ── GET /api/admin/claims/[id]/ceiling (D′ L4 · spec v2 §7.4) — READ-ONLY ────────────────────
//
// What the admin needs on screen BEFORE approving an amount: what the customer asked for, what has
// already been refunded on this order, and what Stripe still says is refundable. It writes NOTHING —
// no claim, no refund row, no Stripe object, no e-mail — and it decides nothing: the server bound of
// an approval is the REQUESTED amount (T-07 / S-10), and this ceiling is displayed beside it.
//
// FAIL-CLOSED ON TRUTH, NOT ON AVAILABILITY. When live Stripe truth cannot be read, the response says
// so with `ceilingVerified: false` and the ceiling is the DB-derived cap, which ignores refunds issued
// outside the rail and can therefore be TOO HIGH. The console must word it neutrally; an estimate is
// never presented as confirmed cash. That is the T-59 contract, reused verbatim rather than re-derived.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const limited = rateLimit(req, 'admin_claims_ceiling', { limitDefault: 60, windowDefault: 60 })
  if (limited) return limited

  if (!claimsSurfaceOpen()) {
    return NextResponse.json({ error: 'Réclamations indisponibles', gated: true }, { status: 403 })
  }
  const operator = await resolveAdmin()
  if (!operator) return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })

  const claim = await prisma.claim.findUnique({
    where:  { id: params.id },
    select: { id: true, orderId: true, requestedAmountCents: true, status: true, approvedAmountCents: true },
  })
  if (!claim) return NextResponse.json({ error: 'Réclamation introuvable.' }, { status: 404 })

  const order = await prisma.order.findUnique({
    where:  { id: claim.orderId },
    select: { total: true, items: true, stripePaymentIntentId: true },
  })
  if (!order) return NextResponse.json({ error: 'Commande introuvable.' }, { status: 404 })

  // The SAME scope builder the customer path uses (lib/claim-scope): one ceiling definition in the
  // codebase, so the number the admin reads is the number the engine will re-check.
  let scope
  try {
    scope = await buildClaimScopeForOrder({
      orderId:               claim.orderId,
      orderTotalEur:         order.total,
      items:                 order.items,
      stripePaymentIntentId: order.stripePaymentIntentId,
    })
  } catch {
    // A ceiling that cannot be computed is reported as unknown — never as a number.
    return NextResponse.json({
      error: 'Plafond indisponible : la vérité financière de cette commande n’a pas pu être lue. Rien n’a été écrit.',
      reason: 'ceiling_unreadable',
    }, { status: 409 })
  }

  return NextResponse.json({
    claimId:              claim.id,
    status:               claim.status,
    requestedAmountCents: claim.requestedAmountCents,
    /** Already decided on this claim, when it is one of the ratified ones (null otherwise). */
    approvedAmountCents:  claim.approvedAmountCents,
    /** What is still refundable on the ORDER, all claims and rails included. */
    maxRefundableCents:   scope.maxAuthorityCents,
    alreadyRefundedCents: scope.alreadyRefundedCents,
    /** T-59: false ⇒ Stripe was not read (or the charge is disputed) — the cap is DB-derived and may be too high. */
    ceilingVerified:      scope.ceilingSource === 'stripe' && !scope.ceilingContested,
    /** The server bound of an approval is the requested amount, never this ceiling (T-07 / S-10). */
    approvalBoundCents:   claim.requestedAmountCents,
  })
}
