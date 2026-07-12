import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import ProfilClient from './ProfilClient'

// ── /prestataire/dashboard/profil — SERVER flag gate (Agent 104) ─────────────
// Editable prestataire Profile & settings — the calque of /supplier/dashboard/profil (P5a).
// This server page 404s (notFound) BEFORE rendering the client form when PRESTATAIRE_ENABLED
// is OFF — byte-identical to the route not existing, no leak of the role (same pattern as the
// /prestataire/services and /prestataire/dashboard pages). Gated by middleware (prestataire/admin)
// too. The edit goes through the EXISTING /api/prestataire/profile (OPERATIONAL fields only;
// identity SIREN/verification shown READ-ONLY). NO money here — the prestataire payment rail is
// untouched. This page backs the dashboard "Modifier mon profil" link AND the onboarding-guide
// CTAs (steps prestataireProfile / prestataireCompany), which previously pointed to a missing route.
export const dynamic = 'force-dynamic'

export default function PrestataireProfilPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale)
  if (!isPrestataireEnabled()) notFound()

  return <ProfilClient />
}
