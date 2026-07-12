import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import CalendarClient from './CalendarClient'

// ── /prestataire/calendar — SERVER flag gate (P4, Agent 77) ──────────────────
// « Mon calendrier »: declare availability (simple/declarative) + a READ-ONLY agenda of the
// prestataire's planned missions (P3 scheduledDate). Gated by middleware (prestataire/admin)
// AND page-level by PRESTATAIRE_ENABLED: this server page 404s (notFound) BEFORE rendering
// the client when the flag is OFF — byte-identical to non-existent, no leak. The availability
// endpoint is independently 404-gated. NO bookable slots / NO money.
export const dynamic = 'force-dynamic'

export default function PrestataireCalendarPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale)
  if (!isPrestataireEnabled()) notFound()

  return <CalendarClient />
}
