import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { callerOperator } from '@/lib/operator-session'
import { isPrestataireConnectLive } from '@/lib/prestataire-connect'
import { issueServiceInvoice } from '@/lib/service-invoice'
import { startServiceInvoiceCheckout, MIN_SERVICE_CHARGE_CENTS } from '@/lib/service-payment'

export const dynamic = 'force-dynamic'

// ── POST /api/prestataire-forfait/[offeringId]/order — order + pay a FORFAIT (P8b) ──
// The RESTO orders a FIXED-PRICE service offering (a forfait) and pays it UPFRONT via Stripe
// Checkout (TEST), routing the payout to the PRESTATAIRE's Connect account (destination charge;
// Grubano keeps 5%). ⚠️ REAL money (TEST). A SEPARATE path from the P8 pay-at-completion route —
// it REUSES issueServiceInvoice (P6) + startServiceInvoiceCheckout (P8) UNCHANGED, so the whole
// P8 money rail stays byte-identical. The forfait mission is created directly at 'accepted'
// (paymentTiming 'upfront'); the prestataire executes it (accepted → done) afterwards, with NO
// second charge (the issued invoice is already paid; the P8 route 409s on a paid invoice).
//
// GATES (mirror the P8 discipline): (1) double flag → 404; (2) the offering IS a forfait (a fixed
// price is set); (3) the prestataire is business-active AND payout-active; (4) the caller is a
// restaurant; (5) the amount + fee come ONLY from the server (the offering's fixedPriceCents +
// computeServiceEconomics, via the reused checkout); (6) idempotent: a re-order RESUMES the
// existing unpaid upfront mission → the SAME invoice → the SAME Checkout session (idempotency key)
// → exactly ONE charge. Once paid, a fresh order creates a new mission (a deliberate repeat order).

function baseUrl(req: Request): string {
  const h = req.headers
  const proto = h.get('x-forwarded-proto') ?? 'https'
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'app.grubano.com'
  return `${proto}://${host}`
}

export async function POST(req: Request, { params }: { params: { offeringId: string } }) {
  try {
    // (1) Double-flag gate — default CLOSED. No charge / lookup when off.
    if (!isPrestataireConnectLive()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const operator = await callerOperator()
    if (!operator) return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    if (!['restaurant', 'admin'].includes(operator.role)) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    const offering = await prisma.serviceOffering.findUnique({
      where:  { id: params.offeringId },
      select: {
        id: true, title: true, active: true, fixedPriceCents: true, prestataireProfileId: true,
        prestataireProfile: { select: { status: true, stripeAccountId: true, payoutStatus: true } },
      },
    })
    if (!offering) return NextResponse.json({ error: 'Service introuvable' }, { status: 404 })
    if (!offering.active) {
      return NextResponse.json({ error: 'Service indisponible' }, { status: 409 })
    }
    // (2) The offering must BE a forfait — a fixed price is set (else it is « sur devis », P3 flow).
    if (offering.fixedPriceCents == null) {
      return NextResponse.json({ error: 'Ce service n’est pas un forfait à prix fixe' }, { status: 409 })
    }
    // (5) Server-side amount — the charge derives from the offering, never the request body.
    if (offering.fixedPriceCents < MIN_SERVICE_CHARGE_CENTS) {
      return NextResponse.json({ error: 'Montant trop faible' }, { status: 400 })
    }
    // (3a) The prestataire's BUSINESS status must be active.
    if (offering.prestataireProfile?.status !== 'active') {
      return NextResponse.json({ error: 'Le prestataire ne peut pas recevoir de paiements' }, { status: 403 })
    }
    // (3b) The prestataire must be payout-active on Stripe Connect (P7).
    if (!offering.prestataireProfile?.stripeAccountId || offering.prestataireProfile.payoutStatus !== 'active') {
      return NextResponse.json({ error: 'Le prestataire ne peut pas encore recevoir de paiements' }, { status: 403 })
    }

    // (6) Idempotent resume: reuse an existing UNPAID upfront forfait mission for THIS caller +
    // offering, else create one. It is keyed on the UNPAID INVOICE and matches the mission whether
    // it is still 'accepted' OR already 'done' — the prestataire may mark a forfait done before the
    // resto pays, and a reorder must NOT then mint a second mission/invoice (which would let the
    // resto be billed twice for one forfait). A PAID one is excluded → a fresh order after payment
    // becomes a new, deliberate mission. (If both the forfait checkout and the P8 pay route target
    // the same unpaid invoice, the per-invoice idempotency key still yields exactly ONE charge.)
    // Scoped to the caller's id (no IDOR). NOTE: a true CONCURRENT first-order double-submit is a
    // residual buyer-self-harm edge to close with a DB-level guard before the flag is activated.
    const resumable = await prisma.serviceMission.findFirst({
      where: {
        restaurantOperatorId: operator.id,
        serviceOfferingId:    offering.id,
        paymentTiming:        'upfront',
        status:               { in: ['accepted', 'done'] },
        OR: [{ invoice: { is: null } }, { invoice: { status: { not: 'paid' } } }],
      },
      select:  { id: true },
      orderBy: { createdAt: 'desc' },
    })

    const mission = resumable ?? await prisma.serviceMission.create({
      data: {
        restaurantOperatorId: operator.id,                       // ← from the SESSION, never the body
        prestataireProfileId: offering.prestataireProfileId,
        serviceOfferingId:    offering.id,
        requestDetails:       offering.title,                    // the forfait being ordered
        quoteAmountCents:     offering.fixedPriceCents,          // = the fixed price (server)
        status:               'accepted',                        // a forfait is agreed by ordering
        paymentTiming:        'upfront',                          // ← marks the upfront-paid path
      },
      select: { id: true },
    })

    // Issue the invoice (idempotent, gapless — P6) for the FIXED price, then charge UPFRONT
    // (reuse the P8 destination-charge UNCHANGED: amount + 5% fee are server-derived).
    const invoice = await issueServiceInvoice({
      serviceMissionId:     mission.id,
      restaurantOperatorId: operator.id,
      prestataireProfileId: offering.prestataireProfileId,
      amountCents:          offering.fixedPriceCents,
    })
    if (invoice.status === 'paid') {
      return NextResponse.json({ error: 'Forfait déjà payé' }, { status: 409 })
    }

    const { url } = await startServiceInvoiceCheckout({
      invoice:              { id: invoice.id, number: invoice.number, amountCents: invoice.amountCents },
      prestataireAccountId: offering.prestataireProfile.stripeAccountId,
      origin:               baseUrl(req),
    })
    return NextResponse.json({ url })
  } catch (err) {
    console.error('[POST /api/prestataire-forfait/[offeringId]/order]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
