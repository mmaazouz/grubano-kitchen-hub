import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { isAffiliateEnabled } from '@/lib/affiliate-account'
import AffiliateInfluencerClient from '@/components/affiliate/AffiliateInfluencerClient'
import './affiliate-influencer.css'

export const dynamic = 'force-dynamic'

// ── /affiliate/dashboard/influenceur — AF5 « Devenir influenceur ». ────────────────
// Mounted inside the AffiliateShell (AF0 layout gates the surface with 404 when
// AFFILIATE_ENABLED is OFF). The client drives the REAL audience-verification flow via
// /api/affiliate/verify-request (gated INFLUENCER_ENABLED → the CTA is inert « bientôt »).
// RE-SKIN — 0 migration, moteur d'argent NON touché.
export default function AffiliateInfluencerPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale)
  if (!isAffiliateEnabled()) notFound()
  return <AffiliateInfluencerClient />
}
