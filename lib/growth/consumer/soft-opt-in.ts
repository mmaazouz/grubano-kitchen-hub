// ── Growth / consumer — soft-opt-in eligibility (ePrivacy derogation) ─────────────────
//
// PURE. No I/O. The soft-opt-in rule allows a merchant to send commercial messages about
// OWN SIMILAR PRODUCTS to a customer WHO HAS ALREADY PURCHASED, provided (a) the customer
// was given a clear chance to refuse at collection AND (b) every subsequent message
// carries the same refusal mechanism. This file encodes (a) + the prior-purchase proof.
// Compliance of (b) is a template-render concern.
//
// Doctrine (sources: Art. L34-5 CPCE / ePrivacy Art. 13(2) + CNIL B2C 2026 guidance):
//   - A transactional email is NEVER soft-opt-in. The transactional purpose cannot carry
//     a marketing payload — repurposing it violates purpose limitation (Art. 5-1-b RGPD).
//   - "Prior similar purchase" is proven by at least ONE countable, paid, non-refunded
//     consumer order WITHIN THE SAME TENANT within `windowDays` (default 365). We NEVER
//     accept a cross-tenant purchase as proof: a Grubano consumer who bought from
//     restaurant X cannot be solicited by restaurant Y under soft-opt-in.
//   - The collection source MUST be in a documented allowlist. 'imported_list' is NEVER
//     a valid source. Any undocumented source fails closed.
//   - A deletion request (GDPR Art. 17) overrides every basis — soft-opt-in included.
//   - A suppression on the channel BLOCKS, same as regular consent.

import { isSuppressed } from '../policy'
import type { Consent, GrowthChannel, Suppression } from '../types'
import type { ConsumerOrderNet } from './money'

/**
 * Sources where the user was offered a clear opt-out at the moment of giving us their
 * contact detail. If the caller cannot name a source in this list, the derogation does
 * not apply — require explicit consent instead.
 */
export const SOFT_OPT_IN_SOURCES = [
  'signup_checkout',               // one-click order flow with a visible checkbox
  'order_confirmation_optional',   // post-order modal with a visible checkbox
  'reservation_optional',          // in-restaurant reservation form with a visible checkbox
] as const
export type SoftOptInSource = (typeof SOFT_OPT_IN_SOURCES)[number]

export interface SoftOptInInput {
  contactId:           string
  tenantRestaurantId:  string
  channel:             GrowthChannel
  nowMs:               number
  /** Normalised past orders for THIS contact at THIS tenant (output of normaliseOrderBatch). */
  orders:              readonly ConsumerOrderNet[]
  /** Suppressions (any). */
  suppressions:        readonly Suppression[]
  /** Existing consents (we check for a REVOCATION that would blow away soft-opt-in). */
  consents:            readonly Consent[]
  /** The claimed collection source. If it is not a SoftOptInSource we refuse. */
  source:              string
  /** GDPR Art. 17 — the contact asked to be forgotten. Fail closed. */
  gdprErased?:         boolean
  /** Soft-opt-in window from most recent purchase. Default 365 days. */
  windowDays?:         number
}

export type SoftOptInReason =
  | 'erased'
  | 'suppressed'
  | 'source_not_allowed'
  | 'no_prior_similar_purchase'
  | 'prior_purchase_outside_window'
  | 'cross_tenant_proof_rejected'
  | 'explicit_revocation'
  | 'ok'

export interface SoftOptInDecision {
  eligible: boolean
  reason:   SoftOptInReason
  /** For auditability: the orderId that satisfied the prior-similar-purchase proof. */
  proofOrderId: string | null
  /** The age in days of the proving order (for the audit trail). */
  proofOrderAgeDays: number | null
}

export function evaluateSoftOptIn(input: SoftOptInInput): SoftOptInDecision {
  const windowDays = input.windowDays ?? 365

  // 1. GDPR erasure overrides everything. Fail closed.
  if (input.gdprErased === true) {
    return { eligible: false, reason: 'erased', proofOrderId: null, proofOrderAgeDays: null }
  }

  // 2. Suppression on the channel is a hard block (we reach commercial scope here, so a
  //    'commercial'-scoped suppression DOES bite).
  if (isSuppressed(input.suppressions, input.contactId, input.channel, 'commercial')) {
    return { eligible: false, reason: 'suppressed', proofOrderId: null, proofOrderAgeDays: null }
  }

  // 3. Explicit revocation on (channel × commercial) blows away any soft-opt-in claim —
  //    a user who clicked unsubscribe cannot be re-enrolled by a later purchase.
  //    We look only at *revocation events* (not grants): if any revokedAt instant exists,
  //    assume the user said no. (A full consent-reinstatement goes through consent.ts.)
  const revoked = input.consents.some(
    (c) =>
      c &&
      c.contactId === input.contactId &&
      c.channel === input.channel &&
      c.purpose === 'commercial' &&
      typeof c.revokedAt === 'string' &&
      c.revokedAt.length > 0,
  )
  if (revoked) {
    return { eligible: false, reason: 'explicit_revocation', proofOrderId: null, proofOrderAgeDays: null }
  }

  // 4. The collection source MUST be documented.
  if (!SOFT_OPT_IN_SOURCES.includes(input.source as SoftOptInSource)) {
    return { eligible: false, reason: 'source_not_allowed', proofOrderId: null, proofOrderAgeDays: null }
  }

  // 5. Prior-similar-purchase proof: countable order AT THIS TENANT within window.
  //    Cross-tenant orders are rejected by order shape (contactId + tenantRestaurantId
  //    must match) but we explicitly re-check tenant here as a belt — a caller that
  //    assembled a mixed batch cannot sneak proof from a different restaurant.
  const windowStartMs = input.nowMs - windowDays * 86_400_000
  let latestProof: ConsumerOrderNet | null = null
  let sawPurchaseButOutsideWindow = false
  for (const o of input.orders) {
    if (!o.countable) continue
    if (o.tenantRestaurantId !== input.tenantRestaurantId || o.contactId !== input.contactId) {
      // Cross-tenant proof — explicitly rejected. Report distinctly so audits can see it.
      return {
        eligible: false,
        reason: 'cross_tenant_proof_rejected',
        proofOrderId: o.orderId,
        proofOrderAgeDays: Math.max(0, (input.nowMs - o.atMs) / 86_400_000),
      }
    }
    if (o.atMs < windowStartMs || o.atMs > input.nowMs) {
      sawPurchaseButOutsideWindow = true
      continue
    }
    if (latestProof === null || o.atMs > latestProof.atMs) latestProof = o
  }

  if (latestProof === null) {
    return {
      eligible: false,
      reason: sawPurchaseButOutsideWindow ? 'prior_purchase_outside_window' : 'no_prior_similar_purchase',
      proofOrderId: null,
      proofOrderAgeDays: null,
    }
  }

  return {
    eligible: true,
    reason: 'ok',
    proofOrderId: latestProof.orderId,
    proofOrderAgeDays: Math.max(0, (input.nowMs - latestProof.atMs) / 86_400_000),
  }
}
