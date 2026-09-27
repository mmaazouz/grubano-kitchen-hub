// lib/support-refund-notices.ts — D′ L9 / E3: the SUPPORT half of the deferred customer notices.
//
// THE DEFECT (spec v2 §6.3, founder root D-6, invariant FIN-EMAIL-01). A support refund that Stripe accepts
// but does not settle synchronously returns 202 with NO e-mail — truthfully, because at that instant the
// money has not reached the customer. The webhook that later finalises the row to `succeeded` sends nothing,
// and it MUST send nothing: H15 forbids any e-mail from the webhook, and that ban is load-bearing (a webhook
// retry storm must never become a mail storm). The same is true of the abandoned-checkout auto-refund, whose
// only notification is an ADMIN alert.
//
// So real money reached a customer's bank with no `refund_confirmation` ever dispatched. E3 closes it with a
// HUMAN-TRIGGERED route instead of an automatic sender: an admin sees the list, presses the button, and the
// route re-reads Stripe before writing anything to anyone.
//
// WHAT THIS MODULE IS NOT. It does not send. It does not read Stripe. It lists and it re-checks eligibility,
// so the route can ask the same question twice — once to render, once to act — and get the same answer from
// one implementation rather than two.
import { prisma } from '@/lib/prisma'
import { provenStripeRefundId } from '@/lib/claim-action-rules'
import { orderRef } from '@/lib/order-ref'

/** The dispatch trigger every customer refund confirmation has always used. */
export const REFUND_CONFIRMATION_TRIGGER = 'refund_confirmation'

/** The mirror prefix — `adoptStripeRefundForClaim` writes it on a row copied from a Dashboard refund. */
export const EXTERNAL_KEY_PREFIX = 'external:'

/** Cap on the ITEMS this list returns, the same number as the closure lists. */
export const SUPPORT_NOTICE_CAP = 200

/**
 * Cap on the rows SCANNED to find those items, and the two are not the same number for a reason. The first
 * version applied one cap to the raw candidate population — every succeeded support refund ever made — and
 * then filtered. A build with 200 already-notified refunds would therefore show an EMPTY list while the 201st,
 * un-notified one waited: the section would read « nothing to send » precisely when there was something. The
 * exclusions (bound, already announced) are the expensive part to know and the cheap part to apply, so the
 * scan is wider than the page and `scanTruncated` reports when even the wider scan ran out.
 */
export const SUPPORT_NOTICE_SCAN_CAP = 2000

/**
 * EVERY dedupe key under which this refund may ALREADY have been announced.
 *
 * The spec's set is `{refund:<re_>, refund:<rowId>}` — `refundEmailDedupeKey` prefers the Stripe id and
 * falls back to our row id, so both shapes exist in the wild.
 *
 * AND THE LEGACY KEY, which the spec's set omits and which matters (founder §22: « avec compatibilité de la
 * clé legacy/fallback »). Before T-47 (`ae98239`, 2026-09-10) the key was `order:<orderId>:<amountCents>`,
 * and the clean-room runbook records that those pilot dispatches exist and are NEVER deleted. Checking only
 * the two new shapes would therefore report a row notified in the pilot as « non notifiée » and send that
 * customer a SECOND confirmation for money announced weeks earlier. A new key cannot collide with an old
 * one, so the only way not to re-announce is to look for the old one too.
 */
export function refundNoticeKeys(row: { id: string; stripeRefundId: string | null; orderId: string; amountCents: number; createdAt?: Date | null }): string[] {
  const keys = [`refund:${row.id}`]
  if (row.stripeRefundId) keys.unshift(`refund:${row.stripeRefundId}`)
  // THE LEGACY KEY IS CONSULTED ONLY FOR A ROW THAT COULD OWN ONE, and the condition is the point. The first
  // version appended it unconditionally, which re-opened the very bug T-47 was created to fix: two DISTINCT
  // legitimate refunds of the SAME amount on one order share `order:<id>:<cents>`. Concretely — a 500 c refund
  // announced in the pilot leaves `order:O:500`; a SECOND, unrelated 500 c refund settling today would match
  // that dispatch, be dropped from this list, answer 409 `already_sent`, and the customer would never be told
  // about the second 500 c. A row created AFTER the T-47 cutoff cannot ever have been announced under a legacy
  // key, so consulting it carries no compatibility benefit and only that false-negative risk.
  if (!row.createdAt || row.createdAt.getTime() < LEGACY_DEDUPE_KEY_UNTIL_MS) {
    keys.push(`order:${row.orderId}:${row.amountCents}`)
  }
  return keys
}

/**
 * T-47 shipped in `ae98239` on 2026-09-10 and replaced `order:<orderId>:<amountCents>` with `refund:<identity>`.
 * Only a refund row created before that boundary can have a legacy dispatch, and the clean-room runbook records
 * that those pilot rows exist and are NEVER deleted — which is why the key is still consulted at all.
 */
export const LEGACY_DEDUPE_KEY_UNTIL_MS = Date.parse('2026-09-11T00:00:00.000Z')

/** Why a row is NOT eligible. Each value is a 409 code the route returns verbatim. */
export type SupportNoticeRefusal =
  | 'row_missing'
  | 'not_succeeded'
  | 'refund_id_unknown'
  | 'claim_bound'
  | 'external_mirror'
  | 'already_sent'
  | 'order_missing'
  | 'no_recipient'

export interface SupportNoticeRow {
  rowId:          string
  /** The PUBLIC order reference — never the raw cuid, and never the Stripe id. */
  orderRef:       string
  restaurantName: string | null
  amountCents:    number
  /** Whether part of the payment remains, for the « partiel » wording. Derived, not guessed. */
  partial:        boolean
  settledAt:      string | null
  /** Where the refund came from, as far as an admin needs: this list is support-only by construction. */
  origin:         'support' | 'system'
}

export interface SupportNoticeList {
  items:         SupportNoticeRow[]
  total:         number
  scanTruncated: boolean
}

/** The reason literal the abandoned-checkout auto-refund stamps. */
const SYSTEM_REASON = 'ghost_order_expired'

/**
 * THE POPULATION, exactly as spec v2 §6.3 defines it.
 *
 *   Refund.status = 'succeeded'
 *   ∧ stripeRefundId ≠ null            (and a VALID `re_` — a row we cannot name cannot be re-read)
 *   ∧ reason NOT LIKE 'claim:%'        (a claim row is the closure-notice path's business, never this one)
 *   ∧ idempotencyKey NOT LIKE 'external:%'
 *   ∧ no binder (no Claim.refundId = row.id)
 *   ∧ no EmailDispatch(refund_confirmation, k) for any k the row could have been announced under
 *
 * THE MYSQL NULL TRAP, and it would have hidden the commonest row in this list. `reason` is nullable and
 * `/api/admin/refunds/run` makes it OPTIONAL, so the great majority of support rows have `reason = NULL`.
 * Translating « NOT LIKE 'claim:%' » to Prisma as `{ reason: { not: { startsWith: 'claim:' } } }` compiles to
 * `reason NOT LIKE 'claim:%'`, and in MySQL `NULL NOT LIKE 'x%'` is NULL — not TRUE — so every one of those
 * rows would silently vanish from a list whose whole purpose is to find un-notified refunds. The explicit
 * null branch is mandatory; it is the same `BINDER_OR` shape lib/claim-closure-lists already uses, for the
 * same reason.
 */
export async function listPendingSupportRefundNotices(): Promise<SupportNoticeList> {
  const candidates = await prisma.refund.findMany({
    where: {
      status: 'succeeded',
      stripeRefundId: { not: null },
      idempotencyKey: { not: { startsWith: EXTERNAL_KEY_PREFIX } },
      OR: [{ reason: null }, { NOT: { reason: { startsWith: 'claim:' } } }],
    },
    orderBy: [{ settledAt: 'desc' }, { createdAt: 'desc' }],
    take: SUPPORT_NOTICE_SCAN_CAP + 1,
    select: {
      id: true, orderId: true, amountCents: true, stripeRefundId: true, settledAt: true,
      createdAt: true, reason: true,
    },
  })
  const scanTruncated = candidates.length > SUPPORT_NOTICE_SCAN_CAP
  const page = candidates.slice(0, SUPPORT_NOTICE_SCAN_CAP)
    // A legacy id that is not a `re_` cannot be re-read at Stripe, so it can never be notified by this
    // route; excluding it here keeps the list actionable rather than showing a row whose button must fail.
    .filter((r) => provenStripeRefundId(r.stripeRefundId))
  if (page.length === 0) return { items: [], total: 0, scanTruncated }

  const rowIds = page.map((r) => r.id)
  const orderIds = Array.from(new Set(page.map((r) => r.orderId)))

  // The binder read: a row any Claim points at belongs to the closure-notice path (§21) — EXCEPT a claim the
  // engine DISOWNED. `refundError` starting with `resume_mismatch` is the engine saying « that row is not this
  // claim's », and every other module in the repository excludes such a claim from a binder count for exactly
  // that reason (`BINDER_OR` in lib/claim-closure-lists, `binderWhere` in lib/claim-emails, lib/claims-census).
  // Counting it here SUPPRESSED a row from this list, i.e. made the repair button unreachable for a customer
  // who was refunded and never told — the precise gap L9 exists to close. Reachable run: a 500 c support refund
  // is left pending; a later 300 c claim's RESUME-FIRST adopts that row, cannot match the amount, and is marked
  // `resume_mismatch`; the support row is settled but now has a « binder » that no other module recognises.
  // The explicit null branch is mandatory: Prisma's NOT(LIKE) drops NULL rows on MySQL.
  const bound = new Set((await prisma.claim.findMany({
    where: {
      refundId: { in: rowIds },
      OR: [{ refundError: null }, { NOT: { refundError: { startsWith: 'resume_mismatch' } } }],
    },
    select: { refundId: true },
  })).map((c) => c.refundId as string))

  // Every key any of these rows could already have been announced under, in ONE read.
  const allKeys = page.flatMap((r) => refundNoticeKeys(r))
  const sent = new Set((await prisma.emailDispatch.findMany({
    where: { trigger: REFUND_CONFIRMATION_TRIGGER, dedupeKey: { in: allKeys } },
    select: { dedupeKey: true },
  })).map((d) => d.dedupeKey))

  // The orders, for the public reference, the restaurant name and the « partiel » decision.
  const orders = await prisma.order.findMany({
    where: { id: { in: orderIds } },
    select: { id: true, total: true, restaurant: { select: { name: true } } },
  })
  const orderById = new Map(orders.map((o) => [o.id, o] as const))

  // How much of each order has ALREADY been refunded in total, so « partiel » is measured and not assumed.
  const refundedByOrder = new Map<string, number>()
  for (const g of await prisma.refund.groupBy({
    by: ['orderId'], where: { orderId: { in: orderIds }, status: 'succeeded' }, _sum: { amountCents: true },
  })) {
    refundedByOrder.set(g.orderId, g._sum.amountCents ?? 0)
  }

  const items: SupportNoticeRow[] = []
  for (const r of page) {
    if (bound.has(r.id)) continue
    if (refundNoticeKeys(r).some((k) => sent.has(k))) continue
    const order = orderById.get(r.orderId)
    const chargeCents = order ? Math.max(0, Math.round(Number(order.total) * 100)) : 0
    items.push({
      rowId:          r.id,
      orderRef:       orderRef(r.orderId),
      restaurantName: order?.restaurant?.name ?? null,
      amountCents:    r.amountCents,
      partial:        chargeCents > 0 && (refundedByOrder.get(r.orderId) ?? 0) < chargeCents,
      settledAt:      (r.settledAt ?? r.createdAt)?.toISOString() ?? null,
      origin:         r.reason === SYSTEM_REASON ? 'system' : 'support',
    })
  }
  // `total` is the number of items FOUND in the scanned window, and `scanTruncated` says the window was not
  // the whole population — so a reader is never shown a count that quietly means « at least ».
  return { items: items.slice(0, SUPPORT_NOTICE_CAP), total: items.length, scanTruncated }
}

export interface SupportNoticeTarget {
  rowId:          string
  orderId:        string
  orderRef:       string
  /** D′ L9.1: the owning restaurant, for the claim-agnostic post-money notice. */
  restaurantId:   string
  stripeRefundId: string
  /** OUR amount. The route sends the amount it re-reads from STRIPE, never this one (§20). */
  rowAmountCents: number
  partial:        boolean
  recipient:      string
  customerName:   string
  restaurantName: string
  dedupeKey:      string
}

/**
 * RE-CHECK one row and resolve everything the send needs. Read-only; no Stripe.
 *
 * The route calls this immediately before acting, so the answer it renders and the answer it acts on come
 * from the same implementation. A row that became claim-bound or was announced between the two is refused
 * here rather than double-notified.
 */
export async function resolveSupportNoticeTarget(
  rowId: string,
): Promise<{ ok: true; target: SupportNoticeTarget } | { ok: false; refusal: SupportNoticeRefusal }> {
  const row = await prisma.refund.findUnique({
    where: { id: rowId },
    // `createdAt` decides whether the legacy dedupe key may be consulted for this row (see refundNoticeKeys).
    select: { id: true, orderId: true, amountCents: true, status: true, stripeRefundId: true, reason: true, idempotencyKey: true, createdAt: true },
  })
  if (!row) return { ok: false, refusal: 'row_missing' }
  if (row.status !== 'succeeded') return { ok: false, refusal: 'not_succeeded' }
  if (!provenStripeRefundId(row.stripeRefundId)) return { ok: false, refusal: 'refund_id_unknown' }
  if ((row.idempotencyKey ?? '').startsWith(EXTERNAL_KEY_PREFIX)) return { ok: false, refusal: 'external_mirror' }
  // §21: a claim-bound row stays with the closure-notice path. Both the reason stamp and a live binder are
  // checked — the stamp is what the engine writes, the binder is what the admin console may have attached.
  if ((row.reason ?? '').startsWith('claim:')) return { ok: false, refusal: 'claim_bound' }
  // Same disowned-claim exclusion as the list, and the same shape — the preview and the act must answer the
  // same question. A `resume_mismatch` claim is not a binder anywhere else in this repository either.
  if (await prisma.claim.count({
    where: {
      refundId: row.id,
      OR: [{ refundError: null }, { NOT: { refundError: { startsWith: 'resume_mismatch' } } }],
    },
  }) > 0) return { ok: false, refusal: 'claim_bound' }

  const keys = refundNoticeKeys(row)
  const already = await prisma.emailDispatch.count({
    where: { trigger: REFUND_CONFIRMATION_TRIGGER, dedupeKey: { in: keys } },
  })
  if (already > 0) return { ok: false, refusal: 'already_sent' }

  const order = await prisma.order.findUnique({
    where: { id: row.orderId },
    select: {
      id: true, total: true, consumerId: true, restaurantId: true,
      restaurant: { select: { name: true } },
    },
  })
  if (!order) return { ok: false, refusal: 'order_missing' }

  const consumer = order.consumerId
    ? await prisma.operator.findUnique({ where: { id: order.consumerId }, select: { email: true, name: true } })
    : null
  if (!consumer?.email) return { ok: false, refusal: 'no_recipient' }

  const chargeCents = Math.max(0, Math.round(Number(order.total) * 100))
  const totalRefunded = (await prisma.refund.aggregate({
    where: { orderId: order.id, status: 'succeeded' }, _sum: { amountCents: true },
  }))._sum.amountCents ?? 0

  return {
    ok: true,
    target: {
      rowId:          row.id,
      orderId:        row.orderId,
      orderRef:       orderRef(row.orderId),
      restaurantId:   order.restaurantId,
      stripeRefundId: row.stripeRefundId as string,
      rowAmountCents: row.amountCents,
      partial:        chargeCents > 0 && totalRefunded < chargeCents,
      recipient:      consumer.email,
      customerName:   consumer.name ?? '',
      restaurantName: order.restaurant?.name ?? '',
      // The Stripe id is the identity of the refund, so it is the identity of its notice (T-47).
      dedupeKey:      `refund:${row.stripeRefundId}`,
    },
  }
}
