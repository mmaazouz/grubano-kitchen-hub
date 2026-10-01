import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { isAffiliateEnabled } from '@/lib/affiliate-account'
import { payoutMinCents } from '@/lib/payout-threshold'
import AffiliateWithdrawalsClient from '@/components/affiliate/AffiliateWithdrawalsClient'
import './affiliate-withdrawals.css'

export const dynamic = 'force-dynamic'

// ── /affiliate/dashboard/retraits — AF4 « Retraits » 🔒 (display-only). ────────────
// Mounted inside the AffiliateShell (AF0 layout gates the surface with 404 when
// AFFILIATE_ENABLED is OFF). Passes the REAL server payout threshold (lib/payout-threshold
// — 25 € default / env, NEVER a hardcoded 50 €) to the client, which reads the real solde
// from /api/affiliate/stats and renders the honest gated state (empty payout history, INERT
// « Demander un retrait »/« Activer »). RE-SKIN — 0 migration, moteur d'argent NON touché.
export default function AffiliateWithdrawalsPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale)
  if (!isAffiliateEnabled()) notFound()
  return <AffiliateWithdrawalsClient thresholdCents={payoutMinCents()} />
}
