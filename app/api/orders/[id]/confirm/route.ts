import { NextResponse } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { prisma } from '@/lib/prisma'
import { sendOrderConfirmation } from '@/lib/transactional-emails'
import type { NextRequest } from 'next/server'

// ── POST /api/orders/[id]/confirm — checkout C2 server-side confirmation ───────
//
// Called by the checkout confirmation screen right after Stripe Elements
// succeeds. The SOURCE OF TRUTH is Order.paymentStatus, which C1's webhook
// flips to 'paid' (this route never talks to Stripe and NEVER touches the
// webhook). Behaviour:
//   - payment not yet webhook-confirmed → { paymentStatus, emailSent:false }
//     (the UI retries a few times — webhook race, normally < 2 s).
//   - paymentStatus === 'paid' → send the order-confirmation email ONCE
//     (idempotence: an EmailLog row with this trigger + the order ref in the
//     subject means it already went out — re-POSTs are no-ops).
// Email is BEST-EFFORT as everywhere: a send failure never breaks the
// confirmation response ([EMAIL MISS] + EmailLog 'failed').

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Customer-facing short order ref — same derivation as the checkout UI. */
const orderRef = (id: string) => `#${id.slice(-6).toUpperCase()}`

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const token = await getToken({ req })
    if (!token?.sub) {
      return NextResponse.json({ error: 'Non connecté' }, { status: 401 })
    }

    const order = await prisma.order.findUnique({
      where:  { id: params.id },
      select: {
        id: true, consumerId: true, paymentStatus: true, total: true,
        fulfillmentType: true, items: true,
        restaurant: { select: { name: true } },
      },
    })
    if (!order) return NextResponse.json({ error: 'Commande introuvable' }, { status: 404 })
    if (order.consumerId !== token.sub) {
      return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
    }

    if (order.paymentStatus !== 'paid') {
      return NextResponse.json({ paymentStatus: order.paymentStatus ?? null, emailSent: false })
    }

    const ref = orderRef(order.id)

    // Idempotence — one confirmation email per order, ever. The ref lives in
    // the subject; recipient narrows it to this customer.
    const consumer = await prisma.operator.findUnique({
      where:  { id: order.consumerId },
      select: { email: true, name: true },
    })
    if (!consumer?.email) {
      return NextResponse.json({ paymentStatus: 'paid', emailSent: false })
    }
    // Idempotence (Email B0) — race-safe via the EmailDispatch @@unique claim performed INSIDE
    // sendOrderConfirmation(dedupeKey). This pre-check only drives the COSMETIC `alreadySent`
    // flag for the UI; correctness no longer depends on a read-then-write (the unique INSERT does).
    const dedupeKey = `order:${order.id}`
    const already = await prisma.emailDispatch.findFirst({
      where:  { trigger: 'order_confirmation', dedupeKey },
      select: { id: true },
    })
    if (already) {
      return NextResponse.json({ paymentStatus: 'paid', emailSent: true, alreadySent: true })
    }

    const rawItems = Array.isArray(order.items) ? (order.items as Array<Record<string, unknown>>) : []
    await sendOrderConfirmation({
      to:             consumer.email,
      customerName:   consumer.name,
      restaurantName: order.restaurant?.name ?? 'votre restaurant',
      orderRef:       ref,
      fulfillmentType: order.fulfillmentType,
      items: rawItems
        .filter((it) => typeof it?.name === 'string')
        .map((it) => ({ name: String(it.name), qty: Number(it.qty) || 1 })),
      paidCents: Math.round(order.total * 100),
      dedupeKey,
    })

    return NextResponse.json({ paymentStatus: 'paid', emailSent: true })
  } catch (err) {
    console.error('[POST /api/orders/[id]/confirm]', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
