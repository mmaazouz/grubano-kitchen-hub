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

import { orderRef } from '@/lib/order-ref'
import { prisma } from '@/lib/prisma'
import { sendOrderConfirmation, sendRestaurantNewOrderEmail } from '@/lib/transactional-emails'
import { sendAdminEmailGiveUpAlert } from '@/lib/admin-alerts'

// ── P0 OPERATIONAL (2026-09-05) — the sweep is now the RELIABILITY mechanism ─────
// It is driven server-side by lib/order-notification-scheduler (in-process timer, every
// 60 s per Next.js process) in addition to the admin route. Two hardening rules:
//   • NON-ACTIONABLE orders are excluded: 'expired' (ghost order, see P0-42 review) AND
//     'cancelled' — a restaurant must never receive « nouvelle commande à accepter » for an
//     order that no longer exists; the consumer already receives the cancellation email
//     (order_cancelled, same dedupeKey family) from the status route.
//   • BOUNDED RETRY / BACKOFF per (trigger, order): every failed attempt leaves an EmailLog
//     row (status 'failed', subject carries the GR- reference). Before retrying we read the
//     failed rows of the window: n ≥ MAX_ATTEMPTS ⇒ GIVE UP (durable marker in EmailDispatch
//     `<trigger>:gave_up` so no further attempt ever happens + ONE best-effort admin alert +
//     an [EMAIL GIVE-UP] log line); otherwise the next attempt is allowed only after
//     BACKOFF_MS[n] since the last failure (1 → 2 → 5 → 10 → 20 → 30 → 30 min). Reads are
//     best-effort: if EmailLog is unreadable we retry (never block a legitimate send).

const DEFAULT_WINDOW_HOURS = 48
const DEFAULT_TAKE         = 100
/** Attempts after which a (trigger, order) is abandoned with an admin alert. */
export const MAX_ATTEMPTS  = 8
/** Minimum spacing (ms) before attempt n+1 given n prior failures (index = n, capped). */
export const BACKOFF_MS: readonly number[] = [0, 60_000, 120_000, 300_000, 600_000, 1_200_000, 1_800_000, 1_800_000]
const NON_ACTIONABLE_STATUSES = ['expired', 'cancelled'] as const

export type SweepResult = {
  scanned:       number
  consumerSent:  number
  restoSent:     number
  alreadyDone:   number
  skippedNoEmail: number
  errors:        number
  /** Attempts deferred by the backoff schedule (will retry later). */
  backoffSkipped: number
  /** (trigger, order) pairs abandoned after MAX_ATTEMPTS — admin alerted once. */
  gaveUp:        number
}

/** Pure: given n prior failures (most recent at lastFailedAt), may we try again at `now`? */
export function retryDecision(n: number, lastFailedAt: Date | null, now: Date): 'try' | 'wait' | 'give_up' {
  if (n >= MAX_ATTEMPTS) return 'give_up'
  if (n === 0 || !lastFailedAt) return 'try'
  const wait = BACKOFF_MS[Math.min(n, BACKOFF_MS.length - 1)]
  return now.getTime() - lastFailedAt.getTime() >= wait ? 'try' : 'wait'
}

/** Best-effort read of prior failures for (trigger, GR-ref) inside the window. */
async function priorFailures(trigger: string, ref: string, since: Date): Promise<{ n: number; last: Date | null }> {
  try {
    const rows = await prisma.emailLog.findMany({
      where:   { trigger, status: 'failed', subject: { contains: ref }, sentAt: { gte: since } },
      select:  { sentAt: true },
      orderBy: { sentAt: 'desc' },
      take:    MAX_ATTEMPTS,
    })
    return { n: rows.length, last: rows[0]?.sentAt ?? null }
  } catch {
    return { n: 0, last: null } // unreadable audit log ⇒ never block a legitimate retry
  }
}

/** Durable give-up: claim `<trigger>:gave_up` / order:<id> (idempotent), alert admin ONCE. */
async function giveUp(trigger: string, orderId: string, ref: string, attempts: number): Promise<void> {
  console.error(`[EMAIL GIVE-UP] [${trigger}] ${attempts} failed attempts — abandoning`, JSON.stringify({ orderId, ref }))
  try {
    await prisma.emailDispatch.create({ data: { trigger: `${trigger}:gave_up`, dedupeKey: `order:${orderId}` } })
  } catch { /* P2002 = already marked (or store hiccup) — both fine */ }
  try { await sendAdminEmailGiveUpAlert({ trigger, orderId, orderRef: ref, attempts }) } catch { /* best-effort */ }
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
  // Revue P0-42 : status 'expired' EXCLU — le webhook ghost-order pose
  // transitoirement 'paid' sur une commande FANTÔME avant de la basculer
  // refunded/reconcile_manual ; sans cette exclusion, un sweep tombant dans la
  // fenêtre (ou après une mort du process entre les deux writes) enverrait
  // « commande confirmée » pour une commande jamais servie.
  const orders = await prisma.order.findMany({
    where:   { paymentStatus: 'paid', status: { notIn: [...NON_ACTIONABLE_STATUSES] }, updatedAt: { gte: since } },
    select:  {
      id: true, consumerId: true, total: true, fulfillmentType: true, items: true,
      restaurant: { select: { name: true, operator: { select: { email: true } } } },
    },
    orderBy: { updatedAt: 'desc' },
    take,
  })

  const result: SweepResult = {
    scanned: orders.length, consumerSent: 0, restoSent: 0,
    alreadyDone: 0, skippedNoEmail: 0, errors: 0, backoffSkipped: 0, gaveUp: 0,
  }
  if (orders.length === 0) return result

  // Une seule lecture des dispatchs existants pour tout le lot (pré-filtre de
  // confort : la CORRECTION vient de l'INSERT @@unique dans sendOnce, pas d'ici).
  const keys = orders.map((o) => `order:${o.id}`)
  const dispatches = await prisma.emailDispatch.findMany({
    where:  { dedupeKey: { in: keys }, trigger: { in: ['order_confirmation', 'resto_order_received', 'order_confirmation:gave_up', 'resto_order_received:gave_up'] } },
    select: { trigger: true, dedupeKey: true },
  })
  const done = new Set(dispatches.map((d) => `${d.trigger}|${d.dedupeKey}`))

  for (const order of orders) {
    const key = `order:${order.id}`
    const ref = orderRef(order.id)
    const items = (Array.isArray(order.items) ? (order.items as Array<Record<string, unknown>>) : [])
      .filter((it) => typeof it?.name === 'string')
      .map((it) => ({ name: String(it.name), qty: Number(it.qty) || 1 }))
    const needsConsumer = !done.has(`order_confirmation|${key}`)   && !done.has(`order_confirmation:gave_up|${key}`)
    const needsResto    = !done.has(`resto_order_received|${key}`) && !done.has(`resto_order_received:gave_up|${key}`)
    if (!needsConsumer && !needsResto) { result.alreadyDone++; continue }
    const now = new Date()

    // Restaurant d'abord (même ordre que /confirm) — best-effort par commande :
    // un échec est compté + tracé, ne bloque jamais le reste du lot.
    if (needsResto) {
      const prior = await priorFailures('resto_order_received', ref, since)
      const decision = retryDecision(prior.n, prior.last, now)
      if (decision === 'give_up') { result.gaveUp++; await giveUp('resto_order_received', order.id, ref, prior.n) }
      else if (decision === 'wait') { result.backoffSkipped++ }
      else try {
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
      const prior = await priorFailures('order_confirmation', ref, since)
      const decision = retryDecision(prior.n, prior.last, now)
      if (decision === 'give_up') { result.gaveUp++; await giveUp('order_confirmation', order.id, ref, prior.n) }
      else if (decision === 'wait') { result.backoffSkipped++ }
      else try {
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
