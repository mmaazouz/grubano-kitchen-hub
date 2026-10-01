// ── Service offerings — pure constants + discovery filter (P2, Agent 75) ──────
// The SERVICES analogue of lib/supplier-catalog (products). SHARED by the prestataire
// CRUD (/api/prestataire/services), the discovery API + pages (/marketplace/prestataires),
// and the i18n labels. PURE + deterministic (no I/O) → unit-tested. NO money: a service
// has NO fixed price and NO stock — it is « sur devis » (priced per quote, a P3+ brick).

/** The canonical service families a prestataire can list. Mirrors the P1 register form's
 *  SERVICE_CATEGORIES (kept in sync by value, not imported, so neither file mutates the
 *  other). Used as the Zod enum for the CRUD + the category filter for discovery. */
export const SERVICE_CATEGORIES = [
  'electricity', 'plumbing', 'haccp', 'cleaning', 'pest_control',
  'fridge_repair', 'kitchen_maintenance', 'accounting', 'training', 'other',
] as const
export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number]

/** How a service is delivered. Mirrors PrestataireProfile.modality (P1). */
export const SERVICE_MODALITIES = ['on_site', 'remote', 'both'] as const
export type ServiceModality = (typeof SERVICE_MODALITIES)[number]

export function isServiceCategory(v: string): v is ServiceCategory {
  return (SERVICE_CATEGORIES as readonly string[]).includes(v)
}
export function isServiceModality(v: string): v is ServiceModality {
  return (SERVICE_MODALITIES as readonly string[]).includes(v)
}

/** Coerce a Prisma Json column (coverageZones / serviceCategories) to a clean string[]. */
export function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

// ── Discovery filter — PURE (clone of the supplier ?q filter, adapted) ────────
// A prestataire matches the `category` filter when ANY of its (already active) offerings
// is in that category; it matches the `zone` filter when one of its coverageZones CONTAINS
// the trimmed, case-insensitive query as a substring (forgiving — cities / postal areas).
// Empty / missing filters match everything. Used by the discovery route AND the page AND
// the tests, so the behaviour is single-sourced.

export interface DiscoverablePrestataire {
  coverageZones: string[]
  serviceOfferings: { category: string }[]
}

export function offeringMatchesCategory(offerings: { category: string }[], category?: string | null): boolean {
  const c = (category ?? '').trim().toLowerCase()
  if (!c) return true
  return offerings.some((o) => o.category.toLowerCase() === c)
}

export function zonesMatch(zones: string[], zone?: string | null): boolean {
  const q = (zone ?? '').trim().toLowerCase()
  if (!q) return true
  return zones.some((z) => z.toLowerCase().includes(q))
}

export function filterPrestataires<T extends DiscoverablePrestataire>(
  list: T[],
  filters: { category?: string | null; zone?: string | null },
): T[] {
  return list.filter(
    (p) => offeringMatchesCategory(p.serviceOfferings, filters.category) && zonesMatch(p.coverageZones, filters.zone),
  )
}
