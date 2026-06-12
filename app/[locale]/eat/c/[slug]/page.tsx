import { redirect } from 'next/navigation'

/**
 * /eat/c/[slug] → /chef/[slug] — PERMANENT bridge (Mission 1 Creator Studio).
 *
 * The legacy public creator page lived here and its "Commander" CTAs routed
 * through /ref/{code} — the AFFILIATION rail (90 d first-touch cookie →
 * ReferralOrder 30 %). The June 12 pivot reserves that rail for the
 * INFLUENCER role: a chef's page click carries a CONTRIBUTION stat only
 * (/api/chef-visit → Order.chefSlug). THIS redirect is the débranchement that
 * kills the double-remuneration path — the affiliation rail is no longer
 * reachable from any public creator page, while every old shared link keeps
 * working (no 404). Same thin-bridge pattern as app/[locale]/ref/[code].
 */
export default function LegacyCreatorPageBridge({
  params,
}: {
  params: { locale: string; slug: string }
}) {
  redirect(`/${params.locale}/chef/${encodeURIComponent(params.slug)}`)
}
