import { redirect } from 'next/navigation'

// WP-DES-02 — the legacy /premium page was a consumer-styled mockup with an
// INVENTED "Démarrer 14 jours gratuits" trial (no backend, no enrolment). The
// operator premium upsell now lives on /pricing (CD v1, operator foundation,
// with the honest "Passer à Premium" modal — real establishment context, billing
// still gate-2). This route is kept only as a locale-aware redirect so any
// lingering external link / bookmark lands on the real page instead of 404ing.
export default function PremiumRedirect({ params }: { params: { locale: string } }) {
  redirect(`/${params.locale}/pricing`)
}
