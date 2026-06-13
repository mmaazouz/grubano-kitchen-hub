// Affiliate-link builder (Dashboard Affiliés Slice 2a) — PURE, client-safe.
//
// Composes links on top of the EXISTING attribution rail (/ref/<slug> drops the
// first-touch grubano_ref cookie, then redirects — app/api/ref/[code]). We NEVER
// reimplement attribution here: we only build URLs the existing route already
// understands, including its OPTIONAL `?to=<same-origin path>` deep-link target
// (whitelisted server-side by app/api/ref/[code].pickToPath — mirrored here so
// the UI never surfaces a link the server would drop).
//
// Future-proof: deep links (a precise resto / campaign / dish), A/B variants and
// the future content studio all reuse buildAffiliateLink({ kind:'path', ... })
// with no schema and no new attribution code.

import { consumerOrigin } from '@/lib/referral-link'

export type AffiliateTarget =
  | { kind: 'home' }
  | { kind: 'path'; path: string }

/** Mirror of /api/ref/[code].pickToPath — a SAFE same-origin app path. */
export function isSafeToPath(p: unknown): p is string {
  if (typeof p !== 'string') return false
  if (p.length < 2 || p.length > 500) return false
  if (!p.startsWith('/')) return false
  if (p.startsWith('//')) return false
  if (p.startsWith('/api/')) return false
  if (p.includes('://')) return false
  return true
}

/** Full copyable affiliate link for a creator slug, optionally deep-linked to a
 *  same-origin target. null when no slug. An unsafe target degrades to the base
 *  link (never throws, never emits an unusable URL). */
export function buildAffiliateLink(slug: string | null | undefined, target: AffiliateTarget = { kind: 'home' }): string | null {
  if (!slug) return null
  const base = `${consumerOrigin()}/ref/${encodeURIComponent(slug)}`
  if (target.kind === 'path' && isSafeToPath(target.path)) {
    return `${base}?to=${encodeURIComponent(target.path)}`
  }
  return base
}

/** Convenience: an affiliate link that lands on a specific restaurant's consumer
 *  page (the existing /eat/r/[id] route), attribution cookie dropped en route. */
export function buildAffiliateRestaurantLink(
  slug: string | null | undefined,
  restaurantId: string | null | undefined,
  locale = 'fr',
): string | null {
  if (!slug) return null
  if (!restaurantId) return buildAffiliateLink(slug)
  return buildAffiliateLink(slug, { kind: 'path', path: `/${locale}/eat/r/${restaurantId}` })
}
