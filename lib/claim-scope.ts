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
}): ClaimScope {
  const orderTotalCents = Math.max(0, toCents(input.orderTotalEur))
  const alreadyRefundedCents = Math.max(0, Math.trunc(input.alreadyRefundedCents) || 0)
  const maxAuthorityCents = Math.max(0, orderTotalCents - alreadyRefundedCents)

  const raw = Array.isArray(input.items) ? (input.items as RawOrderItem[]) : null
  if (!raw) return { orderTotalCents, alreadyRefundedCents, maxAuthorityCents, lines: [], linesUnavailable: true }

  const lines: ClaimScopeLine[] = []
  for (const it of raw) {
    if (!it || typeof it !== 'object') continue
    const qty = Number(it.qty)
    const price = Number(it.price)
    // A malformed line is DROPPED, never guessed: it can only shrink the item-level
    // surface, never invent authority.
    if (!Number.isInteger(qty) || qty <= 0) continue
    if (!Number.isFinite(price) || price < 0) continue
    const unitCents = toCents(price)
    lines.push({
      index:     lines.length,
      itemId:    typeof it.itemId === 'string' ? it.itemId : null,
      name:      typeof it.name === 'string' && it.name.trim() ? it.name : 'Article',
      maxQty:    qty,
      unitCents,
      lineCents: unitCents * qty,
    })
  }
  return { orderTotalCents, alreadyRefundedCents, maxAuthorityCents, lines, linesUnavailable: raw.length > 0 && lines.length === 0 }
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
): ScopeResolution {
  if (scope.maxAuthorityCents <= 0) {
    return { ok: false, error: 'Cette commande n’a plus de montant remboursable.' }
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
    if (!Number.isInteger(index) || index < 0 || index >= scope.lines.length) {
      return { ok: false, error: 'Sélection d’articles invalide.' }
    }
    if (seen.has(index)) return { ok: false, error: 'Un même article est sélectionné plusieurs fois.' }
    seen.add(index)
    const line = scope.lines[index]
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
