// ── CLAIMS — CANONICAL REASONS AND THEIR FINANCIAL AUTHORITY SCOPE (batch 2) ─────────
//
// Batch 1 derived the ceiling from the order alone, with NO branching on the reason. Every
// claim therefore had a WHOLE-ORDER ceiling — including "article manquant", where only one
// line is actually in dispute. The client not sending an item selection was enough to obtain
// authority over the entire order. That is the remaining authority defect this file closes.
//
// The mapping below is a PRODUCT decision made explicit, not an inference: a reason whose
// semantics are order-level (the restaurant was closed, the order never arrived, the payment
// itself is wrong) legitimately puts the whole order in scope; a reason whose semantics name
// specific items must name them.

export const CLAIM_REASONS = [
  'missing_item',      // article manquant          — ITEM
  'wrong_item',        // mauvais article           — ITEM
  'wrong_quantity',    // mauvaise quantité         — ITEM
  'quality',           // qualité                   — ITEM preferred, order allowed
  'restaurant_closed', // restaurant fermé          — ORDER
  'excessive_wait',    // attente excessive         — ORDER
  'not_received',      // marqué retiré mais non reçu — ORDER
  'payment_issue',     // problème de paiement      — ORDER
  'allergen_safety',   // allergène / sécurité      — ITEM preferred, order allowed
  'other',             // autre                     — ITEM preferred, order allowed
] as const
export type ClaimReason = (typeof CLAIM_REASONS)[number]

/**
 * Values written by earlier versions. They stay READABLE for ever (existing rows and any
 * client still posting them) and resolve to their canonical successor. No migration.
 */
export const LEGACY_REASON_ALIASES: Record<string, ClaimReason> = {
  wrong_order:   'wrong_item',
  not_delivered: 'not_received',
}

/** Everything the API accepts, canonical first. */
export const ACCEPTED_REASONS: readonly string[] = [...CLAIM_REASONS, ...Object.keys(LEGACY_REASON_ALIASES)]

export function canonicalReason(reason: string): ClaimReason | null {
  if ((CLAIM_REASONS as readonly string[]).includes(reason)) return reason as ClaimReason
  return LEGACY_REASON_ALIASES[reason] ?? null
}

/**
 * ITEM_REQUIRED — the claim names specific purchased lines; a whole-order ceiling is NOT
 *                 available, because the dispute is by construction about part of the order.
 * ORDER_LEVEL   — the whole order is legitimately in scope.
 * ITEM_OPTIONAL — either: a selection narrows the ceiling, its absence means the whole order
 *                 really is in question (a quality problem can affect the entire order).
 */
export type AuthorityScope = 'ITEM_REQUIRED' | 'ITEM_OPTIONAL' | 'ORDER_LEVEL'

const SCOPE: Record<ClaimReason, AuthorityScope> = {
  missing_item:      'ITEM_REQUIRED',
  wrong_item:        'ITEM_REQUIRED',
  wrong_quantity:    'ITEM_REQUIRED',
  quality:           'ITEM_OPTIONAL',
  allergen_safety:   'ITEM_OPTIONAL',
  other:             'ITEM_OPTIONAL',
  restaurant_closed: 'ORDER_LEVEL',
  excessive_wait:    'ORDER_LEVEL',
  not_received:      'ORDER_LEVEL',
  payment_issue:     'ORDER_LEVEL',
}

export function authorityScope(reason: string): AuthorityScope | null {
  const c = canonicalReason(reason)
  return c ? SCOPE[c] : null
}

/** Reasons that must carry a line selection before any amount can be derived. */
export function requiresItemSelection(reason: string): boolean {
  return authorityScope(reason) === 'ITEM_REQUIRED'
}

/**
 * SAFETY — a food-safety / allergen claim is triaged FIRST and made loud to the operator.
 * It changes VISIBILITY and PRIORITY only. It grants no extra financial authority, triggers
 * no automatic refund, and states no medical conclusion: a human admin still decides.
 */
export function isSafetyReason(reason: string): boolean {
  return canonicalReason(reason) === 'allergen_safety'
}

/** Operator-facing French label (formal register). */
export const REASON_LABELS: Record<ClaimReason, string> = {
  missing_item:      'Article manquant',
  wrong_item:        'Mauvais article',
  wrong_quantity:    'Mauvaise quantité',
  quality:           'Qualité',
  restaurant_closed: 'Restaurant fermé',
  excessive_wait:    'Attente excessive',
  not_received:      'Marquée retirée mais non reçue',
  payment_issue:     'Problème de paiement',
  allergen_safety:   'Allergène / sécurité',
  other:             'Autre',
}

export function reasonLabel(reason: string): string {
  const c = canonicalReason(reason)
  return c ? REASON_LABELS[c] : reason
}
