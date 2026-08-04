// ── P0-42 (vague 2) — rattrapage SERVEUR des confirmations de commande ─────────
//
// CONSTAT (vérifié en exécution par le fondateur) : order_confirmation (client)
// et resto_order_received (restaurant) ne partent que si POST
// /api/orders/[id]/confirm est appelée — et ses SEULS appelants sont deux pages
// client qui interrogent le serveur toutes les 2 s. Onglet fermé avant le
// webhook Stripe ⇒ personne n'est notifié, et un restaurant peut RATER une
// commande payée. Ce sweep garantit l'émission CÔTÉ SERVEUR, dans un délai
// borné (cron groupe `sweep`, toutes les 20 min).
//
// RÈGLES TENUES :
//   • le webhook Stripe n'envoie TOUJOURS aucun email (règle d'or, verrouillée
//     par tests source-scan) — le sweep est une route/cron SÉPARÉE qui lit
//     Order.paymentStatus, la vérité que le webhook a posée ;
//   • IDEMPOTENCE : le sweep appelle les MÊMES senders que la route /confirm
//     (sendOrderConfirmation / sendRestaurantNewOrderEmail), qui passent par
//     sendOnce avec les MÊMES (trigger, dedupeKey=order:<id>) @@unique — un
//     poll qui a déjà réussi rend le sweep no-op ; une course sweep/poll est
//     tranchée par l'INSERT unique, jamais par un read-then-write ;
//   • PAS une automatisation de type P0-07 (email-agent LLM retiré) : contenus
//     transactionnels FIXES du rail B1/B2 déjà en production, déclenchés par un
//     paiement RÉEL confirmé par webhook — aucun contenu généré, aucun argent.
//
// La route /confirm reste BYTE-IDENTIQUE (ses invariants sont verrouillés par
// tests/email-idempotency.test.ts et tests/email-resto-notif.test.ts) — la
// composition est volontairement dupliquée ici À L'IDENTIQUE ; toute divergence
// est inoffensive côté doublons (même dedupeKey) et épinglée par les tests.

import { prisma } from '@/lib/prisma'
import { sendOrderConfirmation, sendRestaurantNewOrderEmail } from '@/lib/transactional-emails'

/** Customer-facing short order ref — same derivation as /confirm + the checkout UI. */
const orderRef = (id: string) => `#${id.slice(-6).toUpperCase()}`

const DEFAULT_WINDOW_HOURS = 48
const DEFAULT_TAKE         = 100

export type SweepResult = {
  scanned:       number
  consumerSent:  number
  restoSent:     number
  alreadyDone:   number
  skippedNoEmail: number
  errors:        number
}

/** Balaye les commandes PAYÉES récentes et émet les confirmations manquantes.
 *  Sans danger à rejouer (sendOnce) ; borné (fenêtre + take). */
export async function sweepUnconfirmedPaidOrders(opts?: {
  windowHours?: number
  take?: number
}): Promise<SweepResult> {
  const windowHours = opts?.windowHours ?? DEFAULT_WINDOW_HOURS
  const take        = Math.min(opts?.take ?? DEFAULT_TAKE, 500)
  const since       = new Date(Date.now() - windowHours * 3600 * 1000)

  // paymentStatus 'paid' est posé par le webhook (source de vérité) ; updatedAt
  // borne la fenêtre (les commandes plus vieilles ont eu 48 h de polls + sweeps).
  const orders = await prisma.order.findMany({
    where:   { paymentStatus: 'paid', updatedAt: { gte: since } },
    select:  {
      id: true, consumerId: true, total: true, fulfillmentType: true, items: true,
      restaurant: { select: { name: true, operator: { select: { email: true } } } },
    },
    orderBy: { updatedAt: 'desc' },
    take,
  })

  const result: SweepResult = {
    scanned: orders.length, consumerSent: 0, restoSent: 0,
    alreadyDone: 0, skippedNoEmail: 0, errors: 0,
  }
  if (orders.length === 0) return result

  // Une seule lecture des dispatchs existants pour tout le lot (pré-filtre de
  // confort : la CORRECTION vient de l'INSERT @@unique dans sendOnce, pas d'ici).
  const keys = orders.map((o) => `order:${o.id}`)
  const dispatches = await prisma.emailDispatch.findMany({
    where:  { dedupeKey: { in: keys }, trigger: { in: ['order_confirmation', 'resto_order_received'] } },
    select: { trigger: true, dedupeKey: true },
  })
  const done = new Set(dispatches.map((d) => `${d.trigger}|${d.dedupeKey}`))

  for (const order of orders) {
    const key = `order:${order.id}`
    const ref = orderRef(order.id)
    const items = (Array.isArray(order.items) ? (order.items as Array<Record<string, unknown>>) : [])
      .filter((it) => typeof it?.name === 'string')
      .map((it) => ({ name: String(it.name), qty: Number(it.qty) || 1 }))
    const needsConsumer = !done.has(`order_confirmation|${key}`)
    const needsResto    = !done.has(`resto_order_received|${key}`)
    if (!needsConsumer && !needsResto) { result.alreadyDone++; continue }

    // Restaurant d'abord (même ordre que /confirm) — best-effort par commande :
    // un échec est compté + tracé, ne bloque jamais le reste du lot.
    if (needsResto) {
      try {
        const ownerEmail = order.restaurant?.operator?.email
        if (ownerEmail) {
          await sendRestaurantNewOrderEmail({
            orderId:         order.id,
            to:              ownerEmail,
            restaurantName:  order.restaurant?.name ?? 'votre restaurant',
            orderRef:        ref,
            fulfillmentType: order.fulfillmentType,
            items,
            totalCents:      Math.round(order.total * 100),
          })
          result.restoSent++
        } else {
          result.skippedNoEmail++
          console.warn(`[order-email-sweep] [P0-42] resto sans email — resto_order_received non émis (order ${order.id})`)
        }
      } catch (e) {
        result.errors++
        console.error('[EMAIL MISS] [order-email-sweep] resto email failed (non-fatal):',
          order.id, e instanceof Error ? e.message : e)
      }
    }

    if (needsConsumer) {
      try {
        const consumer = await prisma.operator.findUnique({
          where:  { id: order.consumerId },
          select: { email: true, name: true },
        })
        if (consumer?.email) {
          await sendOrderConfirmation({
            to:              consumer.email,
            customerName:    consumer.name,
            restaurantName:  order.restaurant?.name ?? 'votre restaurant',
            orderRef:        ref,
            fulfillmentType: order.fulfillmentType,
            items,
            paidCents:       Math.round(order.total * 100),
            dedupeKey:       key,
          })
          result.consumerSent++
        } else {
          result.skippedNoEmail++
          console.warn(`[order-email-sweep] [P0-42] client sans email — order_confirmation non émis (order ${order.id})`)
        }
      } catch (e) {
        result.errors++
        console.error('[EMAIL MISS] [order-email-sweep] consumer email failed (non-fatal):',
          order.id, e instanceof Error ? e.message : e)
      }
    }
  }

  return result
}
