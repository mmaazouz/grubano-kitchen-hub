import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { callerOperator } from '@/lib/operator-session'
import { isPrestataireConnectLive } from '@/lib/prestataire-connect'
import { issueServiceInvoice } from '@/lib/service-invoice'
import { startServiceInvoiceCheckout, startServiceBalanceCheckout, MIN_SERVICE_CHARGE_CENTS } from '@/lib/service-payment'
import { computeDepositSplit } from '@/lib/service-deposit'

export const dynamic = 'force-dynamic'

// ── POST /api/prestataire-invoices/[missionId]/pay — pay a mission invoice (P8) ─
// The RESTO pays ITS OWN 'done' mission's issued invoice via Stripe Checkout (TEST), routing
// the payout to the PRESTATAIRE's Connect account (destination charge; Grubano keeps 5%).
// ⚠️ REAL MONEY (TEST). CLONE of /api/marketplace/orders/[id]/pay — same gate discipline:
//   (1) double flag (PRESTATAIRE_ENABLED + PRESTATAIRE_CONNECT_ENABLED) → 404 when OFF, no work
//   (2) the mission is 'done'
//   (3) the invoice is ISSUED and NOT already paid
//   (4) the prestataire is business-active AND Stripe payout-active (P7)
//   (5) the caller is the restaurant that OWNS the mission (SESSION — never a body id; no IDOR)
//   (6) the charged amount + fee come ONLY from the server (the issued invoice + computeServiceEconomics)
//   (7) idempotent: one Checkout session per invoice (idempotency key) → no double charge.

function baseUrl(req: Request): string {
  const h = req.headers
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'app.grubano.com'
  return `${proto}://${host}`
}

export async function POST(req: Request, { params }: { params: { missionId: string } }) {
  try {
    // (1) Double-flag gate — default CLOSED. No charge / lookup when off.
    if (!isPrestataireConnectLive()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const operator = await callerOperator()
    if (!operator) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    if (!['restaurant', 'admin'].includes(operator.role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const mission = await prisma.serviceMission.findUnique({
      where:  { id: params.missionId },
      select: {
        id: true, status: true, quoteAmountCents: true, restaurantOperatorId: true, prestataireProfileId: true,
        depositPct: true, depositStatus: true, // P8c — drive the balance vs full-quote completion charge
        prestataireProfile: { select: { status: true, stripeAccountId: true, payoutStatus: true } },
        invoice:            { select: { id: true, status: true } },
      },
    })
    if (!mission) return NextResponse.json({ error: 'Mission introuvable' }, { status: 404 })

    // (5) Owner-scope — pay only the invoice of YOUR OWN mission (session, never a body id).
    if (mission.restaurantOperatorId !== operator.id) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }
    // (2) The mission must be realised.
    if (mission.status !== 'done') {
      return NextResponse.json({ error: 'La mission doit être réalisée pour être payée' }, { status: 409 })
    }
    // (3a) There must be an agreed amount to bill.
    if (mission.quoteAmountCents == null) {
      return NextResponse.json({ error: 'Aucun montant convenu pour cette mission' }, { status: 409 })
    }
    // (3b) Not already paid (early read; re-checked after issuance against a race).
    if (mission.invoice?.status === 'paid') {
      return NextResponse.json({ error: 'Facture déjà payée' }, { status: 409 })
    }
    // (4a) The prestataire's BUSINESS status must be active (defence in depth — read-only).
    if (mission.prestataireProfile?.status !== 'active') {
      return NextResponse.json({ error: 'Le prestataire ne peut pas recevoir de paiements' }, { status: 403 })
    }
    // (4b) The prestataire must be payout-active on Stripe Connect (P7 — independent gate).
    if (!mission.prestataireProfile?.stripeAccountId || mission.prestataireProfile.payoutStatus !== 'active') {
      return NextResponse.json({ error: 'Le prestataire ne peut pas encore recevoir de paiements' }, { status: 403 })
    }
    // P8c — if this mission carries a DEPOSIT, the deposit MUST be settled before the balance.
    // A mission with NO deposit (depositPct=0) skips this and charges the FULL quote (= P8).
    if (mission.depositPct > 0 && mission.depositStatus !== 'paid') {
      return NextResponse.json({ error: 'L’acompte doit être réglé avant le solde' }, { status: 409 })
    }

    // (6) Server-side amounts. The COMPLETION charges the BALANCE (quote − deposit) with the
    // remaining fee (totalFee − depositFee), both derived by computeDepositSplit. For depositPct=0
    // the split is { balance: quote, balanceFee: totalFee } → the FULL P8 amount (byte-identical).
    const split = computeDepositSplit(mission.quoteAmountCents, mission.depositPct)
    if (split.balanceCents < MIN_SERVICE_CHARGE_CENTS) {
      return NextResponse.json({ error: 'Montant trop faible' }, { status: 400 })
    }

    // Ensure the invoice exists — IDEMPOTENT + gapless (P6). Paying a done mission issues its
    // invoice if absent; a re-issue returns the SAME invoice (stable id/number/amount).
    const invoice = await issueServiceInvoice({
      serviceMissionId:     mission.id,
      restaurantOperatorId: mission.restaurantOperatorId,
      prestataireProfileId: mission.prestataireProfileId,
      amountCents:          mission.quoteAmountCents,
    })
    // (3b, race-safe) Re-check the freshly-resolved invoice before charging.
    if (invoice.status === 'paid') {
      return NextResponse.json({ error: 'Facture déjà payée' }, { status: 409 })
    }

    // depositPct=0 → the EXACT P8 full-quote charge (startServiceInvoiceCheckout, UNCHANGED).
    // depositPct>0 (deposit settled above) → the BALANCE charge (quote − deposit, remaining fee).
    const { url } = mission.depositPct > 0
      ? await startServiceBalanceCheckout({
          invoice:              { id: invoice.id, number: invoice.number },
          balanceCents:         split.balanceCents,
          balanceFeeCents:      split.balanceFeeCents,
          prestataireAccountId: mission.prestataireProfile.stripeAccountId,
          origin:               baseUrl(req),
        })
      : await startServiceInvoiceCheckout({
          invoice:              { id: invoice.id, number: invoice.number, amountCents: invoice.amountCents },
          prestataireAccountId: mission.prestataireProfile.stripeAccountId,
          origin:               baseUrl(req),
        })
    return NextResponse.json({ url })
  } catch (err) {
    console.error('[POST /api/prestataire-invoices/[missionId]/pay]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
