import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { callerOperator } from '@/lib/operator-session'
import { isSupplierConnectEnabled } from '@/lib/supplier-connect'
import { startSupplyOrderCheckout, MIN_SUPPLY_CHARGE_CENTS } from '@/lib/supply-payment'

export const dynamic = 'force-dynamic'

// ── POST /api/marketplace/orders/[id]/pay — pay a confirmed supply order (5c) ─
// The resto pays ITS OWN confirmed order via Stripe Checkout (TEST). GATED: the
// immatriculation flag AND the supplier being payout-active. Amounts come from the
// 5a engine (in lib/supply-payment). SEPARATE B2B path; no money moves until all
// gates pass.

function baseUrl(req: Request): string {
  const h = req.headers
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'app.grubano.com'
  return `${proto}://${host}`
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    // (c) Immatriculation gate — default CLOSED. No charge call when closed.
    if (!isSupplierConnectEnabled()) {
      return NextResponse.json({ error: 'Paiement indisponible', gated: true }, { status: 403 })
    }
    const operator = await callerOperator()
    if (!operator) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    if (!['restaurant', 'admin'].includes(operator.role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const order = await prisma.supplyOrder.findUnique({
      where:  { id: params.id },
      select: {
        id: true, operatorId: true, status: true, paymentStatus: true, totalCents: true,
        supplierProfile: { select: { status: true, stripeAccountId: true, payoutStatus: true } },
      },
    })
    if (!order) return NextResponse.json({ error: 'Commande introuvable' }, { status: 404 })
    if (order.operatorId !== operator.id) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 }) // pay only YOUR order
    }
    if (order.status !== 'confirmed') {
      return NextResponse.json({ error: 'Commande non payable (en attente de confirmation)' }, { status: 409 })
    }
    // Only a PAID order is refused. 'pending'/'failed' are intentionally allowed to
    // RESUME: startSupplyOrderCheckout uses the idempotency key `supply_pay_<id>`, so
    // a repeat returns the SAME Checkout session (one PaymentIntent) — and Stripe lets
    // a session complete only once. That (key + single-completion) is the double-charge
    // guard; rejecting 'pending' would instead strand an abandoned checkout forever.
    if (order.paymentStatus === 'paid') {
      return NextResponse.json({ error: 'Commande déjà payée' }, { status: 409 })
    }
    // (b1) The supplier's BUSINESS status must be active — a suspended/rejected
    // supplier cannot be paid even for an already-confirmed order (defence in depth;
    // this only READS the profile status, it never touches the money math / KYB).
    if (order.supplierProfile?.status !== 'active') {
      return NextResponse.json({ error: 'Le fournisseur ne peut pas recevoir de paiements' }, { status: 403 })
    }
    // (b2) The supplier must be payout-active (Stripe Connect KYB — independent gate).
    if (!order.supplierProfile?.stripeAccountId || order.supplierProfile.payoutStatus !== 'active') {
      return NextResponse.json({ error: 'Le fournisseur ne peut pas encore recevoir de paiements' }, { status: 403 })
    }
    if (order.totalCents < MIN_SUPPLY_CHARGE_CENTS) {
      return NextResponse.json({ error: 'Montant trop faible' }, { status: 400 })
    }

    const { url } = await startSupplyOrderCheckout({
      order:             { id: order.id, totalCents: order.totalCents },
      supplierAccountId: order.supplierProfile.stripeAccountId,
      origin:            baseUrl(req),
    })
    return NextResponse.json({ url })
  } catch (err) {
    console.error('[POST /api/marketplace/orders/[id]/pay]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
