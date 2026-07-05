import { notFound, redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/navigation'
import { authOptions } from '@/lib/auth'
import { isAffiliateEnabled, getAffiliateByOperator } from '@/lib/affiliate-account'
import { buildAffiliateLink } from '@/lib/affiliate-link'
import { Card, Button } from '@/components/design-system'
import AffiliateLinkCard from '@/components/affiliate/AffiliateLinkCard'
import AffiliateDashboardClient from '@/components/affiliate/AffiliateDashboardClient'
import AffiliateWithdrawCard from '@/components/affiliate/AffiliateWithdrawCard'
import AffiliateVerifyCard from '@/components/affiliate/AffiliateVerifyCard'
import AffiliateStudioCard from '@/components/affiliate/AffiliateStudioCard'
import OnboardingGuide from '@/components/onboarding/OnboardingGuide'
import OnboardingInfluencerUpgrade from '@/components/affiliate/OnboardingInfluencerUpgrade'
import OnboardingChat from '@/components/onboarding/OnboardingChat'

export const dynamic = 'force-dynamic'

// ── /affiliate/dashboard — the affiliate home SHELL (Brique A, Agent 58) ──────────
// Role-gated (middleware: affiliate/admin). 404 when AFFILIATE_ENABLED is OFF. Brique A
// ships the minimal shell: the affiliate sees THEIR referral link/code. The rich
// dashboard (gains, gamification, clicks) = Brique C; the live commission = Brique B;
// the withdrawal = Brique D. Owner-scoped: the affiliate is resolved from the SESSION
// operator id (never a client value). A defensive "not yet an affiliate" path links to
// the instant-join flow (the middleware normally redirects non-affiliates there already).

export default async function AffiliateDashboardPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale)
  if (!isAffiliateEnabled()) notFound()

  const session = await getServerSession(authOptions)
  const operatorId = (session?.user as { id?: string } | undefined)?.id
  if (!operatorId) redirect('/auth/magic')

  const t = await getTranslations('affiliate')
  const affiliate = await getAffiliateByOperator(operatorId)

  return (
    <div className="mx-auto w-full max-w-lg space-y-4">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-grubano-ink">{t('dashTitle')}</h1>
          <p className="mt-1 text-sm text-grubano-ink-muted">{t('dashSubtitle')}</p>
        </div>

        {affiliate ? (
          <>
            {/* Onboarding copilot — role-aware guide (Agent 98). SELF-GATING: renders null when
                ONBOARDING_GUIDE_ENABLED is OFF → dashboard byte-identical. role="affiliate" →
                reads the owner-scoped affiliate checklist; shows progress + a "resume" CTA toward
                the next step (e.g. "préparez vos retraits"). Reads state only — moves no money. */}
            <OnboardingGuide role="affiliate" />
            {/* INF onboarding (Agent 99) — OPTIONAL "become an influencer" upgrade, OUTSIDE the
                affiliate checklist (so a normal affiliate is never marked incomplete). Reuses the
                EXISTING verification state + request action (AffiliateVerifyCard below, anchored at
                #influencer-verify). Self-gating: hides when INFLUENCER_ENABLED is OFF → byte-identical. */}
            <OnboardingInfluencerUpgrade />
            {/* Onboarding help chat (Agent 101) — role-aware anchoring on the affiliate journey.
                SELF-GATING: renders null when ONBOARDING_AI_CHAT_ENABLED is OFF → byte-identical.
                Constrained server-side (refuses legal/fiscal/financial, never quotes a rate). */}
            <OnboardingChat role="affiliate" />
            <AffiliateLinkCard
              link={buildAffiliateLink(affiliate.referralLinkSlug) ?? ''}
              code={affiliate.referralCode}
            />
            {/* Brique C — real earnings + gamification + click funnel (fetches /api/affiliate/stats). */}
            <AffiliateDashboardClient />
            {/* Brique D2 — self-service withdrawal (KYC + fiscal + payout). Hides itself
                when AFFILIATE_CONNECT_ENABLED is OFF → dashboard byte-identical. */}
            <AffiliateWithdrawCard />
            {/* INF-1 — audience verification (become an influencer). Hides itself when
                INFLUENCER_ENABLED is OFF → dashboard byte-identical. No money effect. The
                #influencer-verify anchor is the target of the Agent 99 onboarding upgrade CTA. */}
            <div id="influencer-verify" className="scroll-mt-4">
              <AffiliateVerifyCard />
            </div>
            {/* INF-2 — content studio (verified-influencer advantage). Hides itself when
                the flag is OFF; shows a "reserved to verified" hint otherwise. No money. */}
            <AffiliateStudioCard />
          </>
        ) : (
          <Card elevation="sm" padding="lg" className="text-center">
            <p className="text-sm text-grubano-ink-muted">{t('notYetAffiliate')}</p>
            <Link href="/affiliate/join" className="mt-4 inline-block">
              <Button variant="primary" size="sm">{t('joinCta')}</Button>
            </Link>
          </Card>
        )}
    </div>
  )
}
