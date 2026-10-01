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
/**
 * SUPERSEDED BY L7 (T-50) — KEPT, BUT IT DRIVES NOTHING.
 *
 * This was batch 2's answer to « how wide may this reason's ceiling be », and `resolveClaimAmount` used
 * to branch on it. Since L7 the MODE is an explicit parameter, so nothing in the claim path consults
 * this taxonomy any more: `lib/claims` re-exports it for compatibility and never calls it, and a test
 * pins that (tests/claims-dprime-l7-selection, section E). It is left in place rather than deleted
 * because removing a public export is L8's business, not this lot's.
 *
 * WHY THAT MATTERS AND IS NOT MERELY TIDINESS: a rule kept in two copies eventually disagrees with
 * itself. `SCOPE` below and `REQUIREMENT` further down answer two DIFFERENT questions and are allowed to
 * differ (`quality` is ITEM_OPTIONAL here and 'explicit' there — « a whole-order ceiling is available »
 * is not « the whole order is the default »), but only one of them may decide anything. Today that is
 * `REQUIREMENT`. If a future lot starts branching on `authorityScope` again, the two will drift and the
 * silent whole-order claim comes back.
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

// ── L7 (T-50) — WHAT THE CUSTOMER MUST CHOOSE, per reason ─────────────────────────────
//
// `AuthorityScope` above answers « how wide may the ceiling be ». It is not the same question as
// « what must the customer deliberately say », and conflating the two is how a whole-order claim
// could be filed with no gesture at all: ORDER_LEVEL was read as « whole order is fine », so the
// form preselected it and the server accepted the silence.
//
// This taxonomy answers the second question, and it lives here so the per-reason decision has ONE
// owner. Both are exported; lib/claim-selection turns the requirement into a mode.
/**
 * L7 — the three shapes a claim can take. Declared HERE, beside the per-reason matrix that decides
 * which of them a reason may use, so that lib/claim-scope (which prices a mode) and
 * lib/claim-selection (which records one) can both import it without importing each other.
 */
export type ClaimScopeMode = 'items' | 'amount' | 'whole'
export const CLAIM_SCOPE_MODES: readonly ClaimScopeMode[] = ['items', 'amount', 'whole']

export type ScopeRequirement =
  /** The claim names lines. A whole-order ceiling is not available, so there is nothing to choose. */
  | 'items_only'
  /** Several scopes are genuinely possible ⇒ the customer chooses, and NOTHING is preselected. */
  | 'explicit'
  /** « whole » may be DERIVED from silence — the reason itself puts the whole order in question. */
  | 'whole_derived'
  /** Not a reason a customer may file. Readable for ever on existing rows; never offered. */
  | 'not_selectable'

const REQUIREMENT: Record<ClaimReason, ScopeRequirement> = {
  // The dispute is about named lines by construction.
  missing_item:      'items_only',
  wrong_item:        'items_only',
  wrong_quantity:    'items_only',
  // A quality, allergen or unclassified problem can be about one dish or the whole meal. Only the
  // customer knows which, so only the customer may say — no default either way.
  quality:           'explicit',
  allergen_safety:   'explicit',
  other:             'explicit',
  // « Marquée retirée mais non reçue »: nothing arrived, so the whole order IS the subject. Silence
  // means the whole order here, and that is a derivation the reason itself justifies.
  not_received:      'whole_derived',
  // A wait or a payment problem may concern the whole order or one part of it; the customer says.
  excessive_wait:    'explicit',
  payment_issue:     'explicit',
  // L7: REMOVED from the customer's choices. A paid order the restaurant cancelled is answered by
  // Grubano itself, through the SYSTEM claim raised by the status route — not by asking the customer
  // to file a claim about it. The value stays readable for ever on rows that already carry it.
  restaurant_closed: 'not_selectable',
}

export function scopeRequirement(reason: string): ScopeRequirement | null {
  const c = canonicalReason(reason)
  return c ? REQUIREMENT[c] : null
}

/**
 * The reasons a CUSTOMER may file, in the order a form should offer them. Deliberately a separate
 * list from ACCEPTED_REASONS: that one is what the API can still READ (legacy aliases included),
 * this one is what may be OFFERED. A reason leaving this list never invalidates an existing row.
 */
export const CUSTOMER_SELECTABLE_REASONS: readonly ClaimReason[] =
  CLAIM_REASONS.filter((r) => REQUIREMENT[r] !== 'not_selectable')

export function isCustomerSelectableReason(reason: string): boolean {
  const c = canonicalReason(reason)
  return !!c && REQUIREMENT[c] !== 'not_selectable'
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
