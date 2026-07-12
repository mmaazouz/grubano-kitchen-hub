import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import MissionsClient from './MissionsClient'

// ── /prestataire/missions — SERVER flag gate (P3, Agent 76) ──────────────────
// The prestataire's received quote/mission inbox. Gated by middleware (prestataire/admin)
// AND page-level by PRESTATAIRE_ENABLED: this server page 404s (notFound) BEFORE rendering
// the client when the flag is OFF — byte-identical to non-existent, no leak. The mission
// endpoints are independently 404-gated. NO money (the quote amount is data).
export const dynamic = 'force-dynamic'

export default function PrestataireMissionsPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale)
  if (!isPrestataireEnabled()) notFound()

  return <MissionsClient />
}
