import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { isAffiliateEnabled } from '@/lib/affiliate-account'
import AffiliateLinksClient from '@/components/affiliate/AffiliateLinksClient'
import './affiliate-links.css'

export const dynamic = 'force-dynamic'

// ── /affiliate/dashboard/liens — AF2 « Mes liens » (volumes-only, 0 €). ────────────
// Mounted inside the AffiliateShell (AF0 layout, which resolves the owner-scoped identity
// + gates the whole surface with 404 when AFFILIATE_ENABLED is OFF). This page adds the
// belt-and-suspenders flag gate and mounts the client, which fetches /api/affiliate/stats
// (owner-scoped, IDOR-safe) and renders the real link + « Nouveaux clients » + leaderboard
// (rank/name/tier), with the volume funnel + dedicated links + share-kit assets as honest
// « bientôt ». NO € on this screen. RE-SKIN — 0 migration, moteur d'argent NON touché.
export default function AffiliateLinksPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale)
  if (!isAffiliateEnabled()) notFound()
  return <AffiliateLinksClient />
}
