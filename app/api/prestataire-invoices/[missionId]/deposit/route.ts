import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { callerOperator } from '@/lib/operator-session'
import { isPrestataireConnectLive } from '@/lib/prestataire-connect'
import { issueServiceInvoice } from '@/lib/service-invoice'
import { startServiceDepositCheckout, MIN_SERVICE_CHARGE_CENTS } from '@/lib/service-payment'
import { computeDepositSplit } from '@/lib/service-deposit'

export const dynamic = 'force-dynamic'

// ── POST /api/prestataire-invoices/[missionId]/deposit — pay the DEPOSIT (P8c) ──
// The RESTO pays the DEPOSIT (acompte) of ITS OWN mission at ACCEPTANCE, routing the payout to the
// PRESTATAIRE's Connect account (destination charge; Grubano keeps the deposit's share of the 5%).
// ⚠️ REAL money (TEST). Same gate discipline as the P8 pay route; the deposit amount + fee are
// SERVER-derived (computeDepositSplit on the agreed quote × depositPct) — NEVER the body. The
// ServiceInvoice is NOT marked 'paid' by the deposit — that happens only after the BALANCE.

function baseUrl(req: Request): string {
  const h = req.headers
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'app.grubano.com'
  return `${proto}://${host}`
}

export async function POST(req: Request, { params }: { params: { missionId: string } }) {
  try {
    // (1) Double-flag gate — default CLOSED.
    if (!isPrestataireConnectLive()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const operator = await callerOperator()
    if (!operator) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    if (!['restaurant', 'admin'].includes(operator.role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const mission = await prisma.serviceMission.findUnique({
      where:  { id: params.missionId },
      select: {
        id: true, status: true, quoteAmountCents: true, depositPct: true, depositStatus: true,
        restaurantOperatorId: true, prestataireProfileId: true,
        prestataireProfile: { select: { status: true, stripeAccountId: true, payoutStatus: true } },
        invoice:            { select: { id: true, status: true } },
      },
    })
    if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

    // (5) Owner-scope — pay only YOUR OWN mission (session, never a body id).
    if (mission.restaurantOperatorId !== operator.id) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }
    // The quote must carry a deposit (else there is nothing to pay up front).
    if (mission.depositPct <= 0) {
      return NextResponse.json({ error: 'Ce devis ne comporte pas d’acompte' }, { status: 409 })
    }
    // The deposit is settled between ACCEPTANCE and completion (accepted / done, while live).
    if (!['accepted', 'done'].includes(mission.status)) {
      return NextResponse.json({ error: 'L’acompte se règle après acceptation du devis' }, { status: 409 })
    }
    if (mission.quoteAmountCents == null) {
      return NextResponse.json({ error: 'Aucun montant convenu pour cette mission' }, { status: 409 })
    }
    // Already fully paid, or the deposit already settled → nothing to do.
    if (mission.invoice?.status === 'paid') {
      return NextResponse.json({ error: 'Facture déjà payée' }, { status: 409 })
    }
    if (mission.depositStatus === 'paid') {
      return NextResponse.json({ error: 'Acompte déjà réglé' }, { status: 409 })
    }
    // (4) The prestataire must be business-active AND Stripe payout-active (P7).
    if (mission.prestataireProfile?.status !== 'active') {
      return NextResponse.json({ error: 'Le prestataire ne peut pas recevoir de paiements' }, { status: 403 })
    }
    if (!mission.prestataireProfile?.stripeAccountId || mission.prestataireProfile.payoutStatus !== 'active') {
      return NextResponse.json({ error: 'Le prestataire ne peut pas encore recevoir de paiements' }, { status: 403 })
    }

    // (6) SERVER-derived split — the deposit amount + fee come ONLY from the quote × depositPct.
    const split = computeDepositSplit(mission.quoteAmountCents, mission.depositPct)
    if (split.depositCents < MIN_SERVICE_CHARGE_CENTS) {
      return NextResponse.json({ error: 'Acompte trop faible' }, { status: 400 })
    }

    // Ensure the invoice exists — IDEMPOTENT (P6). The invoice covers the FULL quote; the deposit is
    // a partial payment against it (the invoice flips 'paid' only after the balance).
    const invoice = await issueServiceInvoice({
      serviceMissionId:     mission.id,
      restaurantOperatorId: mission.restaurantOperatorId,
      prestataireProfileId: mission.prestataireProfileId,
      amountCents:          mission.quoteAmountCents,
    })
    if (invoice.status === 'paid') {
      return NextResponse.json({ error: 'Facture déjà payée' }, { status: 409 })
    }

    const { url } = await startServiceDepositCheckout({
      missionId:            mission.id,
      invoice:              { id: invoice.id, number: invoice.number },
      depositCents:         split.depositCents,
      depositFeeCents:      split.depositFeeCents,
      prestataireAccountId: mission.prestataireProfile.stripeAccountId,
      origin:               baseUrl(req),
    })
    return NextResponse.json({ url })
  } catch (err) {
    console.error('[POST /api/prestataire-invoices/[missionId]/deposit]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
