import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { isAffiliateEnabled } from '@/lib/affiliate-account'
import AffiliateEarningsClient from '@/components/affiliate/AffiliateEarningsClient'
import './affiliate-earnings.css'

export const dynamic = 'force-dynamic'

// ── /affiliate/dashboard/gains — AF3 « Mes gains » 🔒 (display-only). ──────────────
// Mounted inside the AffiliateShell (AF0 layout gates the surface with 404 when
// AFFILIATE_ENABLED is OFF). The client fetches /api/affiliate/stats (owner-scoped) and
// renders the REAL earnings (server cents/100, never recomputed) with honest posture: no
// fabricated payout date, INERT « Retrait manuel », empty « Versements reçus » while the
// payout rail (AFFILIATE_CONNECT_ENABLED) is OFF. RE-SKIN — 0 migration, moteur d'argent
// NON touché.
export default function AffiliateEarningsPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale)
  if (!isAffiliateEnabled()) notFound()
  return <AffiliateEarningsClient />
}
