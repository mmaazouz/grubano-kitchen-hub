import { redirect } from 'next/navigation'

// ── /business/logistics-soon — orphan redirect (P1, Agent 17) ─────────────────
// The "coming soon" courier placeholder is now dead: logistics onboarding is LIVE
// at /business/logistics/register, and the /business/start Logistique card already
// points there. This route had no remaining inbound link (only a stale comment),
// so it now REDIRECTS to the live self-serve register — no dead link, no orphan.
export default function LogisticsSoonRedirect({ params: { locale } }: { params: { locale: string } }) {
  redirect(`/${locale}/business/logistics/register`)
}
