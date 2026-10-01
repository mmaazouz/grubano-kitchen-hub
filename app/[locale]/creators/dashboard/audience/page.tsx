import { redirect } from 'next/navigation'

// ── /creators/dashboard/audience — legacy redirect (Brique C, Agent 60) ───────────────
// The old "Mon affiliation — Robinet B" page duplicated the richer Slice 2a–2d hub
// (links/QR, transparent gains on the NET, tiers/streak/badges, leaderboard, opportunities,
// AI studio) AND carried a stale "22%" fallback. We collapse the duplicate: a single nav
// entry now points at /affiliate, and any bookmarked /audience URL lands there. Same
// pattern as the /business/logistics-soon orphan redirect (explicit locale prefix).
export default function CreatorAudienceRedirect({ params: { locale } }: { params: { locale: string } }) {
  redirect(`/${locale}/creators/dashboard/affiliate`)
}
