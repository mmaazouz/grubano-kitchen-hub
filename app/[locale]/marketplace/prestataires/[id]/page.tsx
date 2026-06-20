import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import { isPrestataireConnectLive } from '@/lib/prestataire-connect'
import PrestataireDetailClient from './PrestataireDetailClient'

// ── /marketplace/prestataires/[id] — SERVER flag gate (P2, Agent 75) ─────────
// Read-only prestataire fiche for a restaurateur. Operator-gated by middleware
// (/marketplace tree). Page-level PRESTATAIRE_ENABLED gate: 404s (notFound) when the flag
// is OFF — byte-identical to non-existent. The id is passed to the client, which reuses the
// ACTIVE-only + restaurant/admin-gated discovery endpoint. NO money (services are « sur
// devis » — the quote flow is P3+).
export const dynamic = 'force-dynamic'

export default function MarketplacePrestataireDetailPage({ params }: { params: { locale: string; id: string } }) {
  setRequestLocale(params.locale)
  if (!isPrestataireEnabled()) notFound()

  // P8b — « Commander (prix fixe) » is shown only under the DOUBLE flag (server-evaluated).
  return <PrestataireDetailClient id={params.id} forfaitEnabled={isPrestataireConnectLive()} />
}
