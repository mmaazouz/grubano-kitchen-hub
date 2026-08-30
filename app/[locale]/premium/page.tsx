import { redirect } from 'next/navigation'

// WP-DES-02 — the legacy /premium page was a consumer-styled mockup with an
// INVENTED "Démarrer 14 jours gratuits" trial (no backend, no enrolment).
// BETA TRUTH — /pricing (the previous target) was itself a mock (fictitious
// Premium subscription, hardcoded fees) and is now a redirect to /more too;
// pointing there directly avoids a two-hop redirect chain. This route is kept
// only as a locale-aware redirect so any lingering external link / bookmark
// lands on the real settings hub instead of 404ing.
export default function PremiumRedirect({ params }: { params: { locale: string } }) {
  redirect(`/${params.locale}/more`)
}
