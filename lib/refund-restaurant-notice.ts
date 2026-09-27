// lib/refund-restaurant-notice.ts — D′ L9.1: the restaurant's POST-MONEY notice, WITHOUT a claim.
//
// THE CONTRADICTION THIS RESOLVES (founder arbitration of 2026-09-27). Spec v2 §6.3 asked the support notify
// route to send « resto (3) » AND forbade it from importing `lib/claim-emails` — the only module that
// contained that sender. Worse, the sender required a `claimId` and keyed its dedupe on
// `claim:<id>:resto_refunded:<re_>`, which a support refund cannot form: a `Refund` row created by
// /api/admin/refunds/run or by the abandoned-checkout path has no `Claim` behind it and must not acquire one.
// L9 stopped there and asked. The founder's answer: the product intent stands, the implementation was wrong —
// **the notice must not depend on a claim at all**, and no synthetic claim may be invented to carry it.
//
// SO THE IDENTITY OF THIS NOTICE IS THE REFUND, not the claim:
//   trigger   `claim_restaurant_refunded` (the historical value, KEPT — see the legacy section below)
//   dedupeKey `refund:<re_>`              (CANONICAL, derived from the Stripe object)
// Invariant: ONE real `re_` ⇒ AT MOST ONE restaurant post-money notice, whichever path discovers it — the
// claim closure path, the support route, or an admin replay.
//
// WHAT IT MAY BE CALLED FROM, and the list is closed (H15 stays an invariant):
//   • `lib/claim-emails.sendRestaurantRefundedEmail` — the claim closure path, which now delegates here so
//     there is ONE implementation rather than two that can drift;
//   • `app/api/admin/refunds/rows/[rowId]/notify` — the support path, for refunds with no claim.
// NEVER the Stripe webhook. A test asserts the closed importer list and a negative control asserts the
// webhook reaches neither this module nor the senders.
//
// WHAT IT NEVER IMPORTS: `lib/refund` (the engine), `lib/stripe` (any write path), `lib/claims`. It reads the
// LEDGER for its figures and the transactional rail to send. Asserted, not merely intended.
import { getTranslations } from 'next-intl/server'
import { prisma } from '@/lib/prisma'
import { sendTransactional, logEmailSkipped, type SendStatus } from '@/lib/transactional-emails'
import { orderRef } from '@/lib/order-ref'
import { resolveNudgeLocale } from '@/lib/onboarding-nudge'
import { claimShell, esc, euros } from '@/lib/claim-email-shell'
import {
  RESTAURANT_REFUNDED_TRIGGER, canonicalRestaurantNoticeKey, restaurantNoticeKeys, restaurantRefundedKey,
  legacyRestaurantNoticeKeySuffix,
} from '@/lib/claim-action-rules'
import {
  deriveFinancialEffect, type ClaimFinancialEffect, type RefundLedgerFacts,
} from '@/lib/claim-financial-effect'

/**
 * THE TRIGGER AND THE KEYS COME FROM `lib/claim-action-rules`, AND THAT IS THE WHOLE POINT OF THAT MODULE.
 *
 * The sender and the admin's « was the restaurant told? » lists must agree on the identity of a notice while
 * not importing each other. Restating the literals here would put a dedupe key in two places, and a dedupe
 * key that disagrees with itself sends twice or never — which is the defect this lot exists to remove, not
 * one to reintroduce two files later. The names below are spellings of ONE definition, kept because the
 * trigger's historical name still says « claim » (renaming it would orphan every notice L8 dispatched,
 * `EmailDispatch` being unique on the PAIR (trigger, dedupeKey)) while the notice no longer needs one.
 */
export const RESTAURANT_REFUND_NOTICE_TRIGGER = RESTAURANT_REFUNDED_TRIGGER
export { canonicalRestaurantNoticeKey, restaurantNoticeKeys }
export { restaurantRefundedKey as legacyRestaurantNoticeKey }

/** Has this refund's restaurant notice already gone out, under either shape? */
export async function restaurantNoticeAlreadySent(p: { stripeRefundId: string; claimId?: string | null }): Promise<boolean> {
  const n = await prisma.emailDispatch.count({
    where: {
      trigger: RESTAURANT_REFUND_NOTICE_TRIGGER,
      OR: [
        { dedupeKey: { in: restaurantNoticeKeys(p) } },
        // The claim-agnostic half: a legacy notice for THIS refund under ANY claim id. The support path has
        // no claim id to build that key with, so without this branch the one shape it cannot name is the one
        // it would duplicate. See `legacyRestaurantNoticeKeySuffix`.
        { dedupeKey: { endsWith: legacyRestaurantNoticeKeySuffix(p.stripeRefundId) } },
      ],
    },
  })
  return n > 0
}

/** Why the notice did not go out. Same vocabulary the claim sender reports, so one toast layer serves both. */
export type RestaurantNoticeWhy =
  /**
   * The CALLER's notice class was closed. Unreachable today (`claimNoticeGate('post_money'|'closure')` is
   * literally `true`) and deliberately its OWN value: reporting a closed gate as `ledger_incomplete` would
   * send an operator looking for a missing ledger line that is not missing. A diagnostic vocabulary that
   * lies about the reason is worse than none, because it is believed.
   */
  | 'notice_closed'
  | 'ledger_incomplete'
  | 'stripe_not_confirmed'
  | 'no_recipient'
  | 'smtp_disabled'
  | 'sender_error'
  | 'duplicate'

export type RestaurantNoticeResult =
  | { status: 'sent' }
  | { status: 'duplicate' }
  | { status: 'skipped'; why: RestaurantNoticeWhy }
  | { status: 'failed';  why: RestaurantNoticeWhy }

/** The recipient: the owning restaurant's operator address, name and e-mail locale. */
async function resolveRestaurantRecipient(restaurantId: string) {
  const resto = await prisma.restaurant.findUnique({
    where:  { id: restaurantId },
    select: { name: true, operator: { select: { email: true, locale: true } } },
  })
  const email = resto?.operator?.email
  if (!email) return null
  return {
    to: email,
    restaurantName: resto?.name ?? '',
    locale: resolveNudgeLocale(resto?.operator?.locale ?? null),
  }
}

/**
 * THE FIGURES COME FROM THE LEDGER LINE OF THE `re_`, AND FROM NOWHERE ELSE — L8's rule, unchanged.
 *
 * `Refund`'s own split columns are PREDICTIONS written before Stripe answered; the ledger line is written from
 * Stripe's object. A restaurant is told what a refund cost it only from the confirmed line, and when the line
 * is missing the answer is « not confirmed » rather than a smaller number. Claim-agnostic: it takes the
 * refund and the order, never a claim.
 */
export async function readRefundRestaurantEffect(p: {
  stripeRefundId: string
  orderId:        string
  /** `succeeded` in our own base, as the caller proved it. Anything else is not a settlement. */
  refundStatus:   string
  /** The order the refund row belongs to, for the same-order guard `deriveFinancialEffect` applies. */
  rowOrderId:     string
}): Promise<ClaimFinancialEffect> {
  let ledgerLines: RefundLedgerFacts[] | null = null
  if (p.refundStatus === 'succeeded') {
    try {
      const lines = await prisma.ledgerEntry.findMany({
        where:  { type: 'refund', sourceEventId: p.stripeRefundId },
        select: { grossAmount: true, applicationFeeAmount: true, netToRestaurant: true },
      })
      ledgerLines = lines.map((l) => ({
        grossAmount: l.grossAmount, applicationFeeAmount: l.applicationFeeAmount, netToRestaurant: l.netToRestaurant,
      }))
    } catch { ledgerLines = null }
  }
  // The fee ceiling: what Grubano CHARGED on this payment. It bounds the « fees returned » figure, so a
  // refund with no transfer reversal cannot label the whole give-back as a returned commission.
  let feeChargedCents: number | null = null
  try {
    const order = await prisma.order.findUnique({
      where: { id: p.orderId }, select: { stripePaymentIntentId: true },
    })
    if (order?.stripePaymentIntentId) {
      const agg = await prisma.ledgerEntry.aggregate({
        where: { type: { in: ['payment', 'deposit_capture'] }, stripePaymentIntentId: order.stripePaymentIntentId },
        _sum:  { applicationFeeAmount: true },
      })
      feeChargedCents = agg._sum.applicationFeeAmount ?? null
    }
  } catch { feeChargedCents = null }

  return deriveFinancialEffect({
    bound:            true,
    // No claim, so no binder count and no ambiguity FROM a binding: the refund names itself.
    ambiguousBinding: false,
    refundStatus:     p.refundStatus,
    stripeRefundId:   p.stripeRefundId,
    rowOrderId:       p.rowOrderId,
    claimOrderId:     p.orderId,
    ledgerLines,
    feeChargedCents,
  })
}

/**
 * SEND the restaurant's post-money notice for a real refund. Claim-agnostic.
 *
 * POST-MONEY, AND THAT IS THE WHOLE POINT: the money has already left, so no product flag may suppress it
 * (S-25). `noticeOpen` is still a parameter, checked, so the per-file notice-class pin stays meaningful and so
 * this sender behaves like every other one — callers pass `claimNoticeGate('post_money'|'closure')`, which is
 * literally `true`.
 *
 * `traceLabel` is for the EmailLog trail ONLY — a claim id when one exists, the refund row id otherwise. It is
 * never part of the dedupe key and never printed in the e-mail.
 */
export async function sendRefundRestaurantNotice(p: {
  restaurantId:   string
  orderId:        string
  /** The Stripe refund the caller PROVED succeeded. The dedupe anchor; never printed. */
  stripeRefundId: string
  /** The confirmed T-46 block. Only `confirmed: true` sends. */
  effect:         ClaimFinancialEffect
  noticeOpen:     boolean
  traceLabel:     string
  /** Present only on the claim path, and only so the LEGACY dedupe key can be checked. */
  claimId?:       string | null
}): Promise<RestaurantNoticeResult> {
  const trigger = RESTAURANT_REFUND_NOTICE_TRIGGER
  const miss = async (why: RestaurantNoticeWhy): Promise<RestaurantNoticeResult> => {
    try {
      await logEmailSkipped(trigger, `refund ${p.traceLabel}`, { traceLabel: p.traceLabel, reason: why }, why)
    } catch { /* best-effort trace */ }
    return { status: 'skipped', why }
  }
  if (!p.noticeOpen) return await miss('notice_closed')
  // §16 — Stripe saying succeeded is not sufficient. Without the ledger there are no numbers, and a financial
  // e-mail without numbers is not a lighter version of this one, it is a different message. The row stays
  // visible as `ledger_incomplete` in the admin list instead.
  if (!p.effect.confirmed) return await miss('ledger_incomplete')
  if (typeof p.stripeRefundId !== 'string' || p.stripeRefundId === '') return await miss('stripe_not_confirmed')

  // LEGACY COMPATIBILITY, checked BEFORE sending. A claim whose notice L8 already dispatched under
  // `claim:<id>:resto_refunded:<re_>` must not receive a second one now that the key is `refund:<re_>`: the
  // two shapes cannot collide, so only an explicit read of both prevents the duplicate.
  try {
    if (await restaurantNoticeAlreadySent({ stripeRefundId: p.stripeRefundId, claimId: p.claimId })) {
      return { status: 'duplicate' }
    }
  } catch { /* unreadable → fall through; sendTransactional's own claim still guards the canonical key */ }

  const resto = await resolveRestaurantRecipient(p.restaurantId)
  if (!resto) return await miss('no_recipient')

  const t = await getTranslations({ locale: resto.locale, namespace: 'claimEmails' })
  const ref = orderRef(p.orderId)
  const e = p.effect
  // The net impact is stored SIGNED and negative; it is printed as the signed figure so « −4,60 € » reads as a
  // debit and cannot be mistaken for something received.
  const rows: Array<[string, string]> = [
    [t('restaurantRefunded.lineRefund'), euros(resto.locale, e.customerRefundCents)],
    [t('restaurantRefunded.lineFee'),    euros(resto.locale, e.grubanoFeeReturnedCents)],
    [t('restaurantRefunded.lineNet'),    euros(resto.locale, e.restaurantNetImpactCents)],
  ]
  const bodyHtml =
    `<p>${esc(t('restaurantRefunded.body', { ref, resto: resto.restaurantName || t('theRestaurant') }))}</p>`
    + '<table style="font-size:14px;border-collapse:collapse;margin:8px 0">'
    + rows.map(([k, v]) => `<tr><td style="padding:2px 12px 2px 0;color:#6b7280">${esc(k)}</td><td style="padding:2px 0;font-weight:600">${esc(v)}</td></tr>`).join('')
    + '</table>'
    + `<p style="font-size:13px;color:#6b7280">${esc(t('restaurantRefunded.next', { ref }))}</p>`

  const r = await sendTransactional({
    to:        resto.to,
    subject:   t('restaurantRefunded.subject', { ref }),
    html:      claimShell({
      title:  t('restaurantRefunded.title'),
      bodyHtml,
      footer: t('footer'),
      rtl:    resto.locale === 'ar',
    }),
    trigger,
    // CANONICAL. A replay from any path lands on this same key and `sendTransactional` answers 'duplicate'.
    dedupeKey: canonicalRestaurantNoticeKey(p.stripeRefundId),
  })
  return transportResult(trigger, p.traceLabel, r)
}

/** `sendTransactional`'s answer, mapped. Its own EmailLog row exists for skipped / failed; a console line is added. */
function transportResult(trigger: string, label: string, r: { status: SendStatus }): RestaurantNoticeResult {
  if (r.status === 'skipped') {
    console.error(`[EMAIL MISS] [${trigger}] refund ${label} smtp_disabled`)
    return { status: 'skipped', why: 'smtp_disabled' }
  }
  if (r.status === 'failed') {
    console.error(`[EMAIL MISS] [${trigger}] refund ${label} sender_error`)
    return { status: 'failed', why: 'sender_error' }
  }
  if (r.status === 'duplicate') return { status: 'duplicate' }
  return { status: 'sent' }
}
