import { redirect } from 'next/navigation'

// BETA TRUTH — the « Tarification & Premium » screen was a presentation-only mock:
// Section A showed HARDCODED fees (2,90 € delivery / 15,00 € min / 0,50 € packaging /
// +5 % delivery) contradicting the REAL fulfillment settings (/api/restaurants/[id]/
// fulfillment + FulfillmentForm), with an inert « Enregistrer » button; Section B sold
// a fictitious « Premium 29 €/mois » subscription with an inert modal — no subscription
// model, no billing endpoint, no plan exists anywhere in the backend. No operator
// subscription is offered today, so the screen is hidden for the beta. The route is
// kept only as a locale-aware redirect (same pattern as /premium) so lingering links /
// bookmarks land on the real settings hub instead of 404ing, and the middleware sweep
// (tests/middleware.test.ts) still resolves the path. The redirect is UNCONDITIONAL —
// no env gate, no dynamic API (SSG-safe).
export default function PricingRedirect({ params }: { params: { locale: string } }) {
  redirect(`/${params.locale}/more`)
}
