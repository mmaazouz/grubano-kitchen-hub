import { consumerOrigin } from '@/lib/referral-link'

// ── Chef page link builder (Mission 2 Creator Studio) ─────────────────────────
//
// The CHEF role's shareable link: {consumer origin}/chef/{slug} — the public
// page built in M1 (royalties + contribution tracking, /api/chef-visit).
// IMPORTS consumerOrigin from lib/referral-link (business.* host neutralized)
// WITHOUT modifying it — the influencer dashboard keeps depending on that
// module untouched. The two builders stay separate on purpose: two roles,
// two links, two rails.

/** Full shareable /chef page link for a creator slug — null when no slug. */
export function buildChefPageLink(slug: string | null | undefined): string | null {
  if (!slug) return null
  return `${consumerOrigin()}/chef/${encodeURIComponent(slug)}`
}
