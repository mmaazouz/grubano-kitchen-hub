import { notFound, redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isAffiliateEnabled, getAffiliateByOperator } from '@/lib/affiliate-account'
import { buildAffiliateLink } from '@/lib/affiliate-link'
import { buildAffiliateIdentity } from '@/lib/affiliate-identity'
import AffiliateHomeClient from '@/components/affiliate/AffiliateHomeClient'
import OnboardingChat from '@/components/onboarding/OnboardingChat'
import './affiliate-home.css'

export const dynamic = 'force-dynamic'

// ── /affiliate/dashboard — the affiliate home (CD AF1). ───────────────────────────
// Mounted inside the AffiliateShell (AF0 layout). Owner-scoped: the affiliate is resolved
// from the SESSION operator id (never a client value → no IDOR). 404 when AFFILIATE_ENABLED
// is OFF (the layout also gates → surface invisible). DISPLAY-ONLY re-skin: the money view
// (earnings 🔒) is rendered by AffiliateHomeClient from /api/affiliate/stats — server cents/
// 100, never recomputed, no fabricated payout date. The withdrawal (AF4) and the influencer
// verification/studio (AF5) moved OFF this screen to their own routes. Kept: the self-gating
// OnboardingChat help island (renders null when its flag is OFF → byte-identical). RE-SKIN —
// 0 migration, flags OFF byte-identical, moteur d'argent NON touché.
export default async function AffiliateDashboardPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale)
  if (!isAffiliateEnabled()) notFound()

  const session = await getServerSession(authOptions)
  const operatorId = (session?.user as { id?: string } | undefined)?.id
  if (!operatorId) redirect('/affiliate/join')

  const [operator, affiliate] = await Promise.all([
    prisma.operator.findUnique({ where: { id: operatorId }, select: { name: true, email: true } }),
    getAffiliateByOperator(operatorId),
  ])

  const t = await getTranslations('affiliate')

  // Defensive "not yet an affiliate" path (the middleware normally routes non-affiliates to
  // the instant-join flow already). Re-skinned to the shell primitives.
  if (!affiliate) {
    return (
      <section>
        <div className="op-card op-empty">
          <span className="ms">link</span>
          <b>{t('notYetAffiliate')}</b>
          <Link href="/affiliate/join" className="op-btn-primary" style={{ marginTop: 18 }}>
            <span className="ms">bolt</span>{t('joinCta')}
          </Link>
        </div>
      </section>
    )
  }

  const identity = buildAffiliateIdentity({
    name:  operator?.name ?? null,
    email: operator?.email ?? session?.user?.email ?? '',
    slug:  affiliate.referralLinkSlug,
  })
  const link = buildAffiliateLink(affiliate.referralLinkSlug) ?? ''

  return (
    <>
      {/* Onboarding help chat (Agent 101) — role-aware, SELF-GATING: renders null when
          ONBOARDING_AI_CHAT_ENABLED is OFF → accueil byte-identical. Never quotes a rate. */}
      <OnboardingChat role="affiliate" />
      <AffiliateHomeClient
        name={identity.name}
        initials={identity.initials}
        statusActive={affiliate.status === 'active'}
        link={link}
      />
    </>
  )
}
