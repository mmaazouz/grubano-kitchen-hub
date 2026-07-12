/**
 * Referral-link builder — single source of truth for every creator link the
 * UI displays (B1-bis fix, factored for the dashboard home + audience pages).
 *
 * Two rules, learned the hard way:
 *  1. PATH — the WORKING public attribution route is /ref/<slug>
 *     (app/[locale]/ref/[code] → /api/ref/[code], drops the first-touch
 *     cookie then redirects to /eat). Never /r/, never a hardcoded domain.
 *  2. ORIGIN — the page's real origin (so staging links stay on
 *     app.grubano.com), but with the partner/business browsing host
 *     NEUTRALIZED: a creator signed in via business.grubano.com must never
 *     propagate that host into a link CONSUMERS will open — the "business."
 *     subdomain is stripped back to the consumer app.
 *
 * Pure client-safe module: no server imports, usable from any 'use client'
 * component. During SSR/SSG (no window) it falls back to the production
 * consumer origin; client hydration recomputes with the real origin.
 */

export function consumerOrigin(): string {
  let origin = typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : 'https://grubano.com'
  try {
    const u = new URL(origin)
    if (u.hostname.startsWith('business.')) {
      u.hostname = u.hostname.replace(/^business\./, '')
      origin = u.origin
    }
  } catch { /* keep the origin as-is */ }
  return origin
}

/** Full copyable tracked link for a creator slug — null when no slug. */
export function buildReferralLink(slug: string | null | undefined): string | null {
  if (!slug) return null
  return `${consumerOrigin()}/ref/${encodeURIComponent(slug)}`
}
