// ── B2B supply order — PURE helpers (marketplace Slice 2, Agent 14) ───────────
// No I/O. Builds the IMMUTABLE order-line snapshots from the supplier's catalogue
// items at order time, in integer CENTS. Separate from the B2C order pipeline —
// no loyalty / promo / referral / take-rate (Slice 5). Pure → node-testable.

export interface CatalogItemSnapshotSource {
  id: string
  name: string
  unit: string
  priceCents: number
  available: boolean
}

export interface OrderLineSpec {
  catalogItemId: string
  quantity: number
}

export interface BuiltLine {
  catalogItemId: string
  nameSnapshot: string
  unitSnapshot: string
  quantity: number
  unitPriceCents: number
  lineTotalCents: number
}

export interface BuildResult {
  ok: boolean
  lines: BuiltLine[]
  totalCents: number
  error?: string
}

/**
 * Build immutable order-line snapshots from the supplier's catalogue `items`
 * (already fetched + scoped to the supplier and filtered to available). Every
 * spec must match an AVAILABLE item; quantity must be a positive integer. Returns
 * ok:false (with a reason) if anything is missing/unavailable/invalid — the caller
 * then refuses the order. Prices are snapshotted in CENTS; the total is the sum of
 * line totals. No re-read of the catalogue afterwards — the snapshot is the truth.
 */
export function buildOrderLines(
  items: CatalogItemSnapshotSource[],
  specs: OrderLineSpec[],
): BuildResult {
  if (!specs.length) return { ok: false, lines: [], totalCents: 0, error: 'Panier vide' }
  const byId = new Map(items.map((i) => [i.id, i]))
  const lines: BuiltLine[] = []
  for (const spec of specs) {
    const item = byId.get(spec.catalogItemId)
    if (!item || !item.available) {
      return { ok: false, lines: [], totalCents: 0, error: 'Article indisponible' }
    }
    if (!Number.isInteger(spec.quantity) || spec.quantity < 1) {
      return { ok: false, lines: [], totalCents: 0, error: 'Quantité invalide' }
    }
    lines.push({
      catalogItemId: item.id,
      nameSnapshot: item.name,
      unitSnapshot: item.unit,
      quantity: spec.quantity,
      unitPriceCents: item.priceCents,
      lineTotalCents: item.priceCents * spec.quantity,
    })
  }
  const totalCents = lines.reduce((s, l) => s + l.lineTotalCents, 0)
  return { ok: true, lines, totalCents }
}

// ── Supply order state machine (Slice 3) ─────────────────────────────────────
// `status` is a free String column → these VALUES need no schema migration.
// FLOW: placed → confirmed → preparing → delivered (the supplier advances).
// Branches: the RESTO may CANCEL while still `placed` (before confirmation); the
// SUPPLIER may DECLINE while still `placed`. delivered / cancelled / declined are
// TERMINAL. Only VALID transitions are allowed (server + UI).

export type SupplyOrderStatus =
  | 'placed' | 'confirmed' | 'preparing' | 'delivered' | 'cancelled' | 'declined'

export const SUPPLY_ORDER_STATUSES: readonly SupplyOrderStatus[] =
  ['placed', 'confirmed', 'preparing', 'delivered', 'cancelled', 'declined'] as const

// Transitions the SUPPLIER (seller) may perform, keyed by the current status.
const SUPPLIER_TRANSITIONS: Record<string, SupplyOrderStatus[]> = {
  placed:    ['confirmed', 'declined'],
  confirmed: ['preparing'],
  preparing: ['delivered'],
}

// Transitions the OPERATOR (resto buyer) may perform — cancel only before confirmation.
const OPERATOR_TRANSITIONS: Record<string, SupplyOrderStatus[]> = {
  placed: ['cancelled'],
}

export type SupplyActor = 'supplier' | 'operator'

/** The statuses `actor` may move an order to FROM its current status. */
export function allowedTransitions(actor: SupplyActor, from: string): SupplyOrderStatus[] {
  const map = actor === 'supplier' ? SUPPLIER_TRANSITIONS : OPERATOR_TRANSITIONS
  return map[from] ?? []
}

/** True iff `actor` may move an order from `from` → `to` (the only gate). */
export function canTransition(actor: SupplyActor, from: string, to: string): boolean {
  return allowedTransitions(actor, from).includes(to as SupplyOrderStatus)
}

/** True iff the resto may still cancel an order in `from` (only while `placed`). */
export function canRestoCancel(from: string): boolean {
  return canTransition('operator', from, 'cancelled')
}

// ── Stock → reorder bridge (Slice 4) ──────────────────────────────────────────
// READ-ONLY helpers over the existing StockItem (quantity vs minThreshold). The
// status logic REPLICATES the /stocks page byte-for-byte (no new definition): a
// product is "low" when its status is not 'ok'. We never WRITE stock.

export type StockStatus = 'ok' | 'soon' | 'urgent'

/** Same thresholds as app/[locale]/stocks/page.tsx statusOf — kept in sync. */
export function stockStatus(quantity: number, minThreshold: number): StockStatus {
  if (quantity <= minThreshold * 0.4) return 'urgent'
  if (quantity < minThreshold) return 'soon'
  return 'ok'
}

/** A product is to-reorder when it is below (or far below) its threshold. */
export function isLowStock(quantity: number, minThreshold: number): boolean {
  return stockStatus(quantity, minThreshold) !== 'ok'
}

/** Case-insensitive substring match of a catalogue item name against a query. */
export function itemMatchesQuery(name: string, q: string): boolean {
  const needle = q.trim().toLowerCase()
  if (!needle) return false
  return name.toLowerCase().includes(needle)
}

/** The discovery search href that the reorder bridge points a low-stock item to. */
export function reorderSearchHref(name: string): string {
  return `/marketplace/suppliers?q=${encodeURIComponent(name.trim())}`
}
