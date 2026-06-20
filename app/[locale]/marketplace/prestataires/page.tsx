import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import PrestatairesDiscoverClient from './PrestatairesDiscoverClient'

// ── /marketplace/prestataires — SERVER flag gate (P2, Agent 75) ──────────────
// SERVICES discovery for restaurateurs. Reachable inside the operator chrome (the
// /marketplace tree is operator-gated by middleware). Page-level PRESTATAIRE_ENABLED gate:
// this server page 404s (notFound) when the flag is OFF — byte-identical to non-existent,
// no leak of the role's existence — and only mounts the client list when ON. The discovery
// endpoint /api/marketplace/prestataires is independently 404-gated AND restaurant/admin-
// gated. NO money here (services are « sur devis »).
export const dynamic = 'force-dynamic'

export default function MarketplacePrestatairesPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale)
  if (!isPrestataireEnabled()) notFound()

  return <PrestatairesDiscoverClient />
}
