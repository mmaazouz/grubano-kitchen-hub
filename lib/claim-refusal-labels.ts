// lib/claim-refusal-labels.ts — D′ L10 (founder §2): a refusal is a CODE, and the CODE picks the sentence.
//
// WHY THIS FILE EXISTS. The claims server answers a refusal as a machine code AND a French sentence. The
// code is the contract; the sentence is a convenience for logs and for an operator reading a 409. Two
// consumer surfaces render those refusals, and only one of them read the code:
//   • app/[locale]/eat/order/[orderId]/help — mapped the code to an i18n key (D′ L6);
//   • components/claims/ClaimSection (mounted on /eat/track) — rendered `data.error`, i.e. the server's
//     FRENCH sentence, to a customer reading the app in English, Spanish, Italian or Arabic.
// Measured before this lot: `toast.error(data.error || t('client.errorGeneric'))`. Every refusal a customer
// can hit on that surface — not delivered, window expired, nothing refundable, a claim already open — was
// French in all five locales, although the keys existed in all five.
//
// So the map moved OUT of the page into this module, and both surfaces read it. Not to avoid duplication for
// its own sake: two copies of a code→key map drift, and the drift is invisible (a missing entry does not
// throw, it silently falls back). One map, one fallback rule, asserted by a test that greps every claims
// surface for `data.error`.
//
// THE FALLBACK RULE, and it is the whole point: an unmapped code degrades to a LOCALIZED generic, never to
// the server's sentence. A French sentence shown to an Arabic reader is not a graceful degradation; it is the
// defect §2 names. The caller therefore gets `null` for an unknown code and renders its own generic key.
//
// A LEAF: zero imports. It is a lookup table over strings, usable from a client component, a server
// component and a test alike.

/**
 * The server's refusal CODE → the key under the surface's own namespace.
 *
 * The two families, kept apart on purpose because they answer different questions:
 *   (a) IS THIS ORDER CLAIMABLE — lib/claim-eligibility's `ClaimRefusalReason` (E1…E8) plus the intake gate;
 *   (b) IS *THIS* CLAIM WELL-FORMED — lib/claim-scope and lib/claim-selection (T-50 / L7).
 *
 * `not_delivered` and `window_expired` are DISTINCT entries and must stay distinct: one says nothing has
 * arrived to be judged yet, the other that the time to judge it has passed. The founder's §2 forbids merging
 * them, and a shared key would merge them in the only place the customer can see.
 */
export const CLAIM_REFUSAL_LABEL: Readonly<Record<string, string>> = Object.freeze({
  // ── (a) the order ───────────────────────────────────────────────────────────────────────────────
  not_owner:            'claimNotEligible',
  not_paid:             'claimNotPaid',
  not_delivered:        'claimNotDelivered',
  window_expired:       'claimWindowExpired',
  active_claim:         'claimAlreadyFiled',
  no_refundable_amount: 'claimNoRefundableAmount',
  intake_closed:        'claimIntakeClosed',
  // ── (b) the claim itself (L7 / T-50) ────────────────────────────────────────────────────────────
  scope_required:         'claimScopeRequired',
  scope_not_allowed:      'claimItemsRequired',
  items_required:         'claimItemsRequired',
  item_lines_unavailable: 'claimItemLinesUnavailable',
  invalid_selection:      'claimInvalidSelection',
  duplicate_selection:    'claimDuplicateSelection',
  invalid_qty:            'claimInvalidQty',
  qty_over_purchased:     'claimQtyOverPurchased',
  amount_required:        'claimAmountRequired',
  amount_over_ceiling:    'claimAmountOverCeiling',
  // D′ L10 — THE FOUR CODES THAT HAD NO KEY IN ANY LOCALE, and the previous note said so deliberately:
  // « writing five translations for a state no working client can reach is noise in five locales ». The
  // repository's own tests prove the route DOES forward all four (tests/claims-dprime-l7-selection.test.ts
  // asserts `reason` equals each of them), and the surface's fallback was the server's French sentence — so
  // the choice was not between five translations and noise, it was between five translations and French
  // prose in four locales. Twenty strings close the last French-authority path on the customer surface.
  invalid_scope:         'claimInvalidScope',
  reason_not_selectable: 'claimReasonNotSelectable',
  items_not_allowed:     'claimItemsNotAllowed',
  amount_not_allowed:    'claimAmountNotAllowed',
})

/**
 * The key for a refusal code, or `null` when the code is unknown to this build.
 *
 * `null` means « render your own localized generic ». It never means « render the server's sentence »: that
 * is the behaviour this module exists to remove.
 */
export function claimRefusalKey(code: unknown): string | null {
  return typeof code === 'string' && code in CLAIM_REFUSAL_LABEL ? CLAIM_REFUSAL_LABEL[code] : null
}

/**
 * D′ L10 — THE CONTEST REFUSALS, which had no code at all.
 *
 * `contestClaim` returned six French sentences and no machine code, so three localized clients echoed French
 * (`toast.error(data.error || …)`), and one of them carried a comment declaring it the project rule. One of
 * those sentences even interpolated a NUMBER into an untranslatable string
 * (`Le délai de contestation (48 h) est dépassé.`). The codes are now returned beside the sentences — the
 * sentence stays for the logs and for an operator reading a 409; the code is what the customer sees.
 */
export const CONTEST_REFUSAL_LABEL: Readonly<Record<string, string>> = Object.freeze({
  claim_not_found:      'contestNotFound',
  not_contestable:      'contestNotContestable',
  contest_window_over:  'contestWindowOver',
  already_processed:    'contestAlreadyProcessed',
  active_claim:         'contestActiveClaim',
})

/** The key for a contest refusal code, or `null` → the caller's own localized generic. */
export function contestRefusalKey(code: unknown): string | null {
  return typeof code === 'string' && code in CONTEST_REFUSAL_LABEL ? CONTEST_REFUSAL_LABEL[code] : null
}

/**
 * D′ L10 — THE RESTAURANT'S REFUSALS, which had no code either.
 *
 * `respondToClaim` answers exactly two facts — the claim is not this restaurant's (404, owner-scoped, so it
 * says nothing about whose it is) and the claim has already moved on. components/claims/RestaurantClaimsPanel
 * rendered `data.error` for both, i.e. French prose to a restaurateur reading the app in another language.
 *
 * The two sentences are the SAME facts the customer's contest path states, so the values are the ones already
 * translated and adversarially reviewed for `claims.client.contest*` — copied, not re-translated, because a
 * second translation of one sentence is a second thing to drift.
 */
export const RESPOND_REFUSAL_LABEL: Readonly<Record<string, string>> = Object.freeze({
  claim_not_found:   'respondNotFound',
  already_processed: 'respondAlreadyProcessed',
})

/** The key for a restaurant respond refusal, or `null` → the caller's own localized generic. */
export function respondRefusalKey(code: unknown): string | null {
  return typeof code === 'string' && code in RESPOND_REFUSAL_LABEL ? RESPOND_REFUSAL_LABEL[code] : null
}
