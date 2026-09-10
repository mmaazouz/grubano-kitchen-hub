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
}

export type ClaimSelection = { index: number; qty: number }

export type ScopeResolution =
  | { ok: true; amountCents: number; breakdown: Array<{ index: number; qty: number; cents: number }>; wholeOrder: boolean }
  | { ok: false; error: string }

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

  const raw = Array.isArray(input.items) ? (input.items as RawOrderItem[]) : null
  if (!raw) return { orderTotalCents, alreadyRefundedCents, maxAuthorityCents, lines: [], linesUnavailable: true, ceilingSource, stripeRemainingCents }

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
  return { orderTotalCents, alreadyRefundedCents, maxAuthorityCents, lines, linesUnavailable: raw.length > 0 && lines.length === 0, ceilingSource, stripeRemainingCents }
}

/**
 * Turn a CLIENT SELECTION into a server-derived amount.
 *  • no selection            → the whole remaining authority (a full-order claim);
 *  • selection               → Σ unitCents × qty over the named lines, capped at the ceiling.
 * Every failure mode is a REJECTION, never a silent clamp upward:
 *  • an index that is not a line of THIS order;
 *  • a qty above what was actually purchased;
 *  • a duplicated line;
 *  • a non-integer / non-positive qty.
 * Client-sent prices, totals or amounts are not parameters here — they cannot be read.
 */
export function resolveClaimAmount(
  scope: ClaimScope,
  selection?: ClaimSelection[] | null,
  /**
   * What the consumer ASKED FOR, in cents, if their client sent an amount.
   *
   * P0 found by the adversarial audit of this batch: dropping the field outright meant that
   * every claim from the SHIPPED client (which sends an amount and no `items`) silently became
   * a claim for the WHOLE order — the change made authority WIDER, not narrower, and then
   * showed the inflated figure to the restaurant, the admin and the customer as "the amount you
   * requested". A requested amount is therefore honoured as a CAP REQUEST: it can only ever
   * LOWER the claim below the server ceiling. It can never raise it, and it is never the
   * source of authority — `maxAuthorityCents` is.
   */
  requestedCents?: number | null,
  /**
   * Authority scope of the REASON (batch 2). `ITEM_REQUIRED` means a whole-order ceiling is
   * not available for this reason: the claim must name the disputed lines. Without this, an
   * "article manquant" claim obtained authority over the entire order simply because the
   * client sent no selection — the remaining authority defect batch 1 left open.
   */
  scopeKind?: 'ITEM_REQUIRED' | 'ITEM_OPTIONAL' | 'ORDER_LEVEL' | null,
): ScopeResolution {
  if (scope.maxAuthorityCents <= 0) {
    return { ok: false, error: 'Cette commande n’a plus de montant remboursable.' }
  }
  if (scopeKind === 'ITEM_REQUIRED' && (!selection || selection.length === 0)) {
    if (!scope.lines.length) {
      // No readable lines ⇒ we cannot bound the claim to items, and we refuse to fall back to
      // the whole order for an item-level reason. Fail closed and say why.
      return { ok: false, error: 'Le détail des articles de cette commande est indisponible : ce motif ne peut pas être traité automatiquement, contactez le support.' }
    }
    return { ok: false, error: 'Indiquez le ou les articles concernés : ce motif ne permet pas de réclamer la commande entière.' }
  }
  const askedDown = (base: number) => {
    if (requestedCents == null) return base
    if (!Number.isInteger(requestedCents) || requestedCents <= 0) return base
    return Math.min(base, requestedCents) // REDUCTION ONLY — never an expansion
  }
  if (!selection || selection.length === 0) {
    const amountCents = askedDown(scope.maxAuthorityCents)
    return { ok: true, amountCents, breakdown: [], wholeOrder: amountCents === scope.maxAuthorityCents }
  }
  if (selection.length > scope.lines.length) {
    return { ok: false, error: 'Sélection d’articles invalide.' }
  }
  const seen = new Set<number>()
  const breakdown: Array<{ index: number; qty: number; cents: number }> = []
  let total = 0
  for (const sel of selection) {
    const index = Number(sel?.index)
    const qty = Number(sel?.qty)
    const line = scope.lines.find((l) => l.index === index)
    if (!Number.isInteger(index) || index < 0 || !line) {
      return { ok: false, error: 'Sélection d’articles invalide.' }
    }
    if (seen.has(index)) return { ok: false, error: 'Un même article est sélectionné plusieurs fois.' }
    seen.add(index)
    if (!Number.isInteger(qty) || qty <= 0) return { ok: false, error: 'Quantité invalide.' }
    if (qty > line.maxQty) {
      return { ok: false, error: `Quantité supérieure à la quantité commandée pour « ${line.name} » (maximum ${line.maxQty}).` }
    }
    const cents = line.unitCents * qty
    total += cents
    breakdown.push({ index, qty, cents })
  }
  if (total <= 0) return { ok: false, error: 'Sélection d’articles invalide.' }
  // The ceiling still applies: item lines are pre-discount/pre-fee, so a selection can
  // never exceed what remains refundable on the order.
  const amountCents = askedDown(Math.min(total, scope.maxAuthorityCents))
  return { ok: true, amountCents, breakdown, wholeOrder: false }
}

/** Public, client-safe view of the scope (what the claim form may render). */
export function publicClaimScope(scope: ClaimScope) {
  return {
    maxAuthorityCents: scope.maxAuthorityCents,
    alreadyRefundedCents: scope.alreadyRefundedCents,
    lines: scope.lines.map((l) => ({ index: l.index, name: l.name, maxQty: l.maxQty, unitCents: l.unitCents, lineCents: l.lineCents })),
    itemSelectionAvailable: scope.lines.length > 0,
  }
}
