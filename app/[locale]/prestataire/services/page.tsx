import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import ServicesClient from './ServicesClient'

// ── /prestataire/services — SERVER flag gate (P2, Agent 75) ──────────────────
// The prestataire's « Mes services » management screen. Gated by middleware
// (prestataire/admin) AND page-level by PRESTATAIRE_ENABLED: this server page 404s
// (notFound) BEFORE rendering the client form when the flag is OFF — byte-identical to the
// route not existing, no leak of the role. The CRUD endpoint /api/prestataire/services is
// independently 404-gated too. NO money here (services are « sur devis »).
export const dynamic = 'force-dynamic'

export default function PrestataireServicesPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale)
  if (!isPrestataireEnabled()) notFound()

  return <ServicesClient />
}
