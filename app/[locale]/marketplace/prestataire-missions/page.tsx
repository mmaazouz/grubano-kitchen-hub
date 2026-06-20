import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import RestoMissionsClient from './RestoMissionsClient'

// ── /marketplace/prestataire-missions — SERVER flag gate (P3, Agent 76) ──────
// The restaurateur's quote-request / mission history. Reachable inside the operator chrome
// (the /marketplace tree is operator-gated by middleware). Page-level PRESTATAIRE_ENABLED
// gate: 404s (notFound) when the flag is OFF — byte-identical to non-existent, no leak. The
// mission endpoints are independently 404-gated AND restaurant/admin-gated. NO money.
export const dynamic = 'force-dynamic'

export default function MarketplacePrestataireMissionsPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale)
  if (!isPrestataireEnabled()) notFound()

  return <RestoMissionsClient />
}
