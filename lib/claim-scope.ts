// ── CLAIMS — SERVER-AUTHORITATIVE FINANCIAL SCOPE (Claims batch 1, 2026-09-10) ────────
//
// The client may DESCRIBE what happened. It must NEVER define financial authority.
// Baseline defect (BETA-CLAIMS-REFUND-FACTUAL-INVENTORY §3, reconfirmed 2026-09-07):
// `requestedAmountCents` came from the consumer and the server only CAPPED it at the
// order total. Any amount in [1, total] was therefore client-chosen.
//
// This module derives the whole financial scope from authoritative order state:
//   • eligible lines come from `Order.items`, whose unit `price` was re-written from the
//     DB at order creation (app/api/orders/route.ts — the client cart price is discarded),
//     so it is server truth, not client input;
//   • already-refunded cents come from SUCCEEDED `Refund` rows on the order;
//   • the ceiling is the order total minus what is already refunded.
//
// The client may only send a SELECTION — `[{ index, qty }]` pointing INTO the
// server-derived line list. Item ids, prices, line totals and amounts sent by the client
// are never read. A selection can only ever REDUCE the amount below the full ceiling.
//
// The refund engine remains the final authority at refund time (it re-reads live Stripe
// truth and its own cumulative cursor); this module decides what the CLAIM may ask for.

import type { ClaimScopeMode } from '@/lib/claim-reasons'

/** One line of `Order.items` as persisted (unit price in EUR, server-re-priced). */
type RawOrderItem = { itemId?: unknown; name?: unknown; qty?: unknown; price?: unknown }

export type ClaimScopeLine = {
  /** Position in THIS list — the only handle the client is given. */
  index: number
  itemId: string | null
  name: string
  /** Quantity actually purchased — the hard ceiling for a selection. */
  maxQty: number
  unitCents: number
  lineCents: number
}

export type ClaimScope = {
  orderTotalCents: number
  alreadyRefundedCents: number
  /** Order total minus what is already refunded — the absolute ceiling of a new claim. */
  maxAuthorityCents: number
  lines: ClaimScopeLine[]
  /** True when `Order.items` could not be read as a line list (legacy/malformed rows). */
  linesUnavailable: boolean
  /**
   * Where the ceiling came from (batch 2, T-? cumulative truth):
   *   'stripe'   — live Stripe cash truth was read and is the binding constraint;
   *   'db_only'  — Stripe could not be read; the ceiling is the DB view, which can be
   *                LARGER than reality if a refund was issued outside the rail. The engine
   *                still caps the actual money at refund time, but the claim's promise is
   *                not proven. Surfaced, never hidden.
   */
  ceilingSource: 'stripe' | 'db_only'
  /**
   * T-59 — the charge is DISPUTED (chargeback). Cash can leave on the dispute rail without
   * ever touching `amount_refunded` or creating a `Refund` row, so both ceilings are blind to
   * it and Stripe will refuse a refund on that charge anyway. The ceiling stays as computed
   * (never widened), but it is no longer PROVEN refundable cash.
   */
  ceilingContested: boolean
  /** Cash Stripe still considers refundable, minus anything already in flight. */
  stripeRemainingCents: number | null
}

/** Live Stripe cash truth for the order's charge, as read by the caller. */
export type StripeCashTruth = {
  /** charge.amount_captured (or amount) — what was actually taken. */
  capturedCents: number
  /** charge.amount_refunded — every succeeded refund, including ones the rail never created. */
  refundedCents: number
  /** Sum of refunds currently PENDING at Stripe: not yet money out, but already committed. */
  pendingCents: number
  /** charge.disputed — a chargeback takes cash out on a rail `amount_refunded` never records. */
  disputed?: boolean
}

export type ClaimSelection = { index: number; qty: number }

/**
 * L7 (T-50) — why every refusal carries a CODE. The client renders the refusal in the customer's own
 * language; a French sentence forwarded from the server is not a translation. The sentence travels
 * too, for a caller that cannot localise the code.
 */
export type ClaimAmountRefusalCode =
  | 'no_refundable_amount'
  | 'items_required'
  | 'item_lines_unavailable'
  | 'invalid_selection'
  | 'duplicate_selection'
  | 'invalid_qty'
  | 'qty_over_purchased'
  | 'amount_required'
  | 'amount_over_ceiling'
  | 'items_not_allowed'
  | 'amount_not_allowed'

export const CLAIM_AMOUNT_REFUSAL_TEXT: Record<ClaimAmountRefusalCode, string> = {
  no_refundable_amount:   'Cette commande n’a plus de montant remboursable.',
  items_required:         'Indiquez le ou les articles concernés : ce motif ne permet pas de réclamer la commande entière.',
  item_lines_unavailable: 'Le détail des articles de cette commande est indisponible : ce motif ne peut pas être traité automatiquement, contactez le support.',
  invalid_selection:      'Sélection d’articles invalide.',
  duplicate_selection:    'Un même article est sélectionné plusieurs fois.',
  invalid_qty:            'Quantité invalide.',
  qty_over_purchased:     'Quantité supérieure à la quantité commandée.',
  amount_required:        'Indiquez le montant que vous réclamez.',
  amount_over_ceiling:    'Le montant demandé dépasse ce qui peut encore être remboursé sur cette commande.',
  items_not_allowed:      'Cette portée ne porte pas sur des articles : retirez la sélection d’articles.',
  amount_not_allowed:     'Cette portée ne prend pas de montant libre : choisissez « un montant précis » pour en saisir un.',
}

export type ScopeResolution =
  | {
      ok: true
      amountCents: number
      breakdown: Array<{ index: number; qty: number; cents: number }>
      /** The mode this amount was resolved under — what the snapshot records. */
      mode: ClaimScopeMode
    }
  | { ok: false; code: ClaimAmountRefusalCode; error: string }

const toCents = (eur: number) => Math.round(eur * 100)

/** Build the authoritative scope. `items` is the raw `Order.items` JSON value. */
export function buildClaimScope(input: {
  items: unknown
  orderTotalEur: number
  alreadyRefundedCents: number
  /** Live Stripe truth when it could be read. Absent ⇒ the ceiling is DB-only (flagged). */
  stripe?: StripeCashTruth | null
}): ClaimScope {
  const orderTotalCents = Math.max(0, toCents(input.orderTotalEur))
  const alreadyRefundedCents = Math.max(0, Math.trunc(input.alreadyRefundedCents) || 0)
  const dbCeiling = Math.max(0, orderTotalCents - alreadyRefundedCents)

  // CUMULATIVE TRUTH (batch 2). The DB only knows refunds the rail itself created, so a
  // refund issued from the Stripe Dashboard is invisible to it and the DB ceiling overstates
  // what is really refundable. Stripe's own numbers are authoritative, and a PENDING refund
  // is subtracted too: it has not moved yet, but authorizing against it would let a claim
  // race an in-flight refund into an over-refund. Fail-closed = take the SMALLER of the two.
  let stripeRemainingCents: number | null = null
  if (input.stripe) {
    const s = input.stripe
    // AUDIT FIX (batch 2): Stripe already counts a PENDING refund inside amount_refunded
    // (REFUND-FINANCIAL-CONTRACT), so subtracting pendingCents again double-counted it and
    // understated the ceiling — blocking legitimate claims. Kept as a floor for the rare case
    // where a pending refund is reported outside amount_refunded: take the SMALLER remainder.
    const afterSucceeded = Math.max(0, (s.capturedCents || 0) - (s.refundedCents || 0))
    const afterPendingToo = Math.max(0, (s.capturedCents || 0) - Math.max(s.refundedCents || 0, s.pendingCents || 0))
    stripeRemainingCents = Math.min(afterSucceeded, afterPendingToo)
  }
  const maxAuthorityCents = stripeRemainingCents === null ? dbCeiling : Math.min(dbCeiling, stripeRemainingCents)
  const ceilingSource: 'stripe' | 'db_only' = stripeRemainingCents === null ? 'db_only' : 'stripe'
  // T-59: a disputed charge does not widen or narrow the cap — it only means the cap is not proven.
  const ceilingContested = input.stripe?.disputed === true

  const raw = Array.isArray(input.items) ? (input.items as RawOrderItem[]) : null
  if (!raw) return { orderTotalCents, alreadyRefundedCents, maxAuthorityCents, lines: [], linesUnavailable: true, ceilingSource, ceilingContested, stripeRemainingCents }

  const lines: ClaimScopeLine[] = []
  // AUDIT FIX (batch 2, P1) — PRICE BASIS. `Order.items[].price` is the MenuItem LIST price,
  // while `Order.total` is what the customer actually paid: promotions, referral discounts and
  // loyalty credit are all subtracted from the total but never from the lines. On any discounted
  // order Σ lines therefore EXCEEDS the total, and a one-line selection clamped straight onto the
  // whole-order ceiling — the exact "an item-specific claim cannot reach the whole order"
  // invariant this batch claims. Lines are scaled to what was really paid before anything is
  // priced. Scaling only ever shrinks: when Σ lines ≤ total (the normal case, fees sit on top)
  // the factor is 1 and nothing changes.
  let grossLineCents = 0
  for (const it of raw) {
    if (!it || typeof it !== 'object') continue
    const q = Number((it as RawOrderItem).qty)
    const p = Number((it as RawOrderItem).price)
    if (!Number.isInteger(q) || q <= 0) continue
    if (!Number.isFinite(p) || p < 0) continue
    grossLineCents += toCents(p) * q
  }
  const paidBasisCents = Math.max(0, toCents(input.orderTotalEur))
  const scale = grossLineCents > paidBasisCents && grossLineCents > 0 ? paidBasisCents / grossLineCents : 1

  for (let position = 0; position < raw.length; position++) {
    const it = raw[position]
    if (!it || typeof it !== 'object') continue
    const qty = Number(it.qty)
    const price = Number(it.price)
    // A malformed line is DROPPED, never guessed: it can only shrink the item-level
    // surface, never invent authority.
    if (!Number.isInteger(qty) || qty <= 0) continue
    if (!Number.isFinite(price) || price < 0) continue
    // Scaled to the price basis the customer actually paid (see the note above).
    const unitCents = Math.round(toCents(price) * scale)
    lines.push({
      // AUDIT FIX (batch 2): the index is the position in `Order.items` ITSELF, not in this
      // filtered list. A dropped malformed line used to shift every following index, so a
      // client indexing the order's own item array would silently point at a DIFFERENT line
      // — an aliasing hazard on the one handle the client is given.
      index:     position,
      itemId:    typeof it.itemId === 'string' ? it.itemId : null,
      name:      typeof it.name === 'string' && it.name.trim() ? it.name : 'Article',
      maxQty:    qty,
      unitCents,
      lineCents: unitCents * qty,
    })
  }
  return { orderTotalCents, alreadyRefundedCents, maxAuthorityCents, lines, linesUnavailable: raw.length > 0 && lines.length === 0, ceilingSource, ceilingContested, stripeRemainingCents }
}

/**
 * Turn a MODE plus what the request carried into a server-derived amount.
 *
 * ── L7 (T-50): THE MODE IS A PARAMETER, AND THAT IS THE POINT ─────────────────────────────
 * Until L7 this function inferred the scope from what the request did NOT contain: an empty
 * selection meant « the whole remaining authority ». So a customer who sent nothing — including one
 * whose form had silently preselected « toute la commande » — obtained a whole-order claim without
 * a single deliberate gesture, and the inferred scope was then thrown away, leaving a bare figure
 * that the restaurant, the admin and the customer each explained to themselves differently.
 *
 * The mode is now REQUIRED, so the implicit path is not expressible. lib/claim-selection decides the
 * mode from the reason and from what the customer explicitly said (refusing silence where several
 * scopes are possible); this function only prices it. Each mode admits exactly one shape of request,
 * and anything else is a REFUSAL with a code — never a silent narrowing, because narrowing answers a
 * question the customer did not ask:
 *   'items'  → at least one line, validated against the order; the amount is the priced selection,
 *              capped at the ceiling. A client amount beside it is REFUSED, never dropped: the
 *              selection IS the amount, and two fields setting it is a contradiction to report.
 *   'amount' → an explicit positive amount at or below the ceiling; a line selection is REFUSED,
 *              because then two things would claim to set the figure.
 *   'whole'  → the amount is the ceiling, derived by the server; both a client amount and a line
 *              selection are REFUSED (« a precise amount » is its own mode).
 * Client-sent prices, totals and line values are not parameters here — they cannot be read.
 */
export function resolveClaimAmount(
  scope: ClaimScope,
  input: {
    mode: ClaimScopeMode
    selection?: ClaimSelection[] | null
    /** What the consumer ASKED FOR, in cents. Authority only in 'amount' mode, and only downward. */
    requestedCents?: number | null
  },
): ScopeResolution {
  const refuse = (code: ClaimAmountRefusalCode, error?: string): ScopeResolution =>
    ({ ok: false, code, error: error ?? CLAIM_AMOUNT_REFUSAL_TEXT[code] })

  if (scope.maxAuthorityCents <= 0) return refuse('no_refundable_amount')
  const selection = input.selection ?? null
  const hasSelection = Array.isArray(selection) && selection.length > 0
  const asked = input.requestedCents

  // ── 'whole' — the server's own figure, and nothing else may speak ────────────────────────
  if (input.mode === 'whole') {
    if (hasSelection) return refuse('items_not_allowed')
    if (asked != null) return refuse('amount_not_allowed')
    return { ok: true, amountCents: scope.maxAuthorityCents, breakdown: [], mode: 'whole' }
  }

  // ── 'amount' — an explicit figure, capped, with nothing else competing to set it ─────────
  if (input.mode === 'amount') {
    if (hasSelection) return refuse('items_not_allowed')
    if (asked == null || !Number.isInteger(asked) || asked <= 0) return refuse('amount_required')
    if (asked > scope.maxAuthorityCents) return refuse('amount_over_ceiling')
    return { ok: true, amountCents: asked, breakdown: [], mode: 'amount' }
  }

  // ── 'items' — the named lines, priced by the server ──────────────────────────────────────
  // An amount sent alongside a line selection is REFUSED, not dropped. Dropping it was the first
  // version of this branch, and it re-created in one line the defect L7 exists to close: the customer
  // had typed a figure, the server used a different one, and nothing said so. Two fields both claiming
  // to set the amount is a contradiction only the customer can resolve. (Deliberate strengthening of
  // spec v2 §5, which says such a field is « ignoré » — see the L7 log.)
  if (asked != null) return refuse('amount_not_allowed')
  if (!hasSelection) {
    // Say which gesture is missing, and why. A reason that names lines cannot fall back to the
    // whole order — that is the authority defect this whole family of checks exists to close.
    return refuse(scope.lines.length ? 'items_required' : 'item_lines_unavailable')
  }
  if (selection!.length > scope.lines.length) return refuse('invalid_selection')

  const seen = new Set<number>()
  const breakdown: Array<{ index: number; qty: number; cents: number }> = []
  let total = 0
  for (const sel of selection!) {
    const index = Number(sel?.index)
    const qty = Number(sel?.qty)
    const line = scope.lines.find((l) => l.index === index)
    if (!Number.isInteger(index) || index < 0 || !line) return refuse('invalid_selection')
    if (seen.has(index)) return refuse('duplicate_selection')
    seen.add(index)
    if (!Number.isInteger(qty) || qty <= 0) return refuse('invalid_qty')
    if (qty > line.maxQty) {
      return refuse('qty_over_purchased', `Quantité supérieure à la quantité commandée pour « ${line.name} » (maximum ${line.maxQty}).`)
    }
    const cents = line.unitCents * qty
    total += cents
    breakdown.push({ index, qty, cents })
  }
  if (total <= 0) return refuse('invalid_selection')
  // The ceiling still applies: item lines are pre-discount/pre-fee, so a selection can never
  // exceed what remains refundable on the order.
  return { ok: true, amountCents: Math.min(total, scope.maxAuthorityCents), breakdown, mode: 'items' }
}

/**
 * T-59 — IS THIS CEILING PROVEN REFUNDABLE CASH? One definition, because there are now two readers.
 *
 * It is proven only when live Stripe truth was read (`db_only` means it was not: the ceiling then
 * ignores refunds issued outside the rail and can be TOO HIGH) AND the charge is not disputed (a
 * chargeback removes cash on a rail neither ceiling sees, and Stripe refuses a refund on it).
 *
 * L7 added the second reader: the persisted selection records the provenance of the ceiling that was
 * known at filing time. Writing the same expression there would have been a copy of a money rule, and a
 * money rule in two copies eventually disagrees with itself — one reader would keep saying « remboursable »
 * after the other had stopped.
 */
export function ceilingVerifiedOf(scope: Pick<ClaimScope, 'ceilingSource' | 'ceilingContested'>): boolean {
  return scope.ceilingSource === 'stripe' && !scope.ceilingContested
}

/** Public, client-safe view of the scope (what the claim form may render). */
export function publicClaimScope(scope: ClaimScope) {
  return {
    maxAuthorityCents: scope.maxAuthorityCents,
    alreadyRefundedCents: scope.alreadyRefundedCents,
    lines: scope.lines.map((l) => ({ index: l.index, name: l.name, maxQty: l.maxQty, unitCents: l.unitCents, lineCents: l.lineCents })),
    itemSelectionAvailable: scope.lines.length > 0,
    // T-59 — WHAT THE CEILING IS WORTH, not just how big it is. It is PROVEN refundable cash
    // only when live Stripe truth was read (`db_only` means it was not: the ceiling then ignores
    // refunds issued outside the rail and can be TOO HIGH) AND the charge is not disputed (a
    // chargeback removes cash on a rail neither ceiling sees, and Stripe refuses a refund on it).
    // The number is still the server's cap either way — the engine re-reads Stripe at refund
    // time — but nothing may present an unproven cap as verified refundable cash. A boolean only:
    // no Stripe amount, id or error ever crosses to the client.
    ceilingVerified: ceilingVerifiedOf(scope),
  }
}
