import { notFound, redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/navigation'
import { authOptions } from '@/lib/auth'
import { isAffiliateEnabled, getAffiliateByOperator } from '@/lib/affiliate-account'
import { buildAffiliateLink } from '@/lib/affiliate-link'
import { Card, Button } from '@/components/design-system'
import PartnerChrome from '@/components/business/PartnerChrome'
import AffiliateLinkCard from '@/components/affiliate/AffiliateLinkCard'
import AffiliateDashboardClient from '@/components/affiliate/AffiliateDashboardClient'
import AffiliateWithdrawCard from '@/components/affiliate/AffiliateWithdrawCard'

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
    <PartnerChrome>
      <div className="w-full max-w-lg space-y-4">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-grubano-ink">{t('dashTitle')}</h1>
          <p className="mt-1 text-sm text-grubano-ink-muted">{t('dashSubtitle')}</p>
        </div>

        {affiliate ? (
          <>
            <AffiliateLinkCard
              link={buildAffiliateLink(affiliate.referralLinkSlug) ?? ''}
              code={affiliate.referralCode}
            />
            {/* Brique C — real earnings + gamification + click funnel (fetches /api/affiliate/stats). */}
            <AffiliateDashboardClient />
            {/* Brique D2 — self-service withdrawal (KYC + fiscal + payout). Hides itself
                when AFFILIATE_CONNECT_ENABLED is OFF → dashboard byte-identical. */}
            <AffiliateWithdrawCard />
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
    </PartnerChrome>
  )
}
