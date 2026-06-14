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
