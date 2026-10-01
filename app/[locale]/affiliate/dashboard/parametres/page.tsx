import { notFound, redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { setRequestLocale } from 'next-intl/server'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isAffiliateEnabled } from '@/lib/affiliate-account'
import { buildAffiliateIdentity } from '@/lib/affiliate-identity'
import { buildAffiliateLink } from '@/lib/affiliate-link'
import AffiliateSettingsClient from '@/components/affiliate/AffiliateSettingsClient'
import './affiliate-settings.css'

export const dynamic = 'force-dynamic'

// ── /affiliate/dashboard/parametres — AF6 « Paramètres ». ──────────────────────────
// Server-resolves the REAL affiliate identity (owner-scoped: name/email/createdAt from the
// Operator, slug/status/audienceVerified from the Affiliate) and hands it to the client. Per
// the founder's decision, ALL profile fields are READ-ONLY (there is NO affiliate profile
// PATCH endpoint, unlike CR7) — channel editing is inert « bientôt », language + sign-out are
// real. 404 when AFFILIATE_ENABLED is OFF. RE-SKIN — 0 backend, 0 migration, money non touché.
export default async function AffiliateSettingsPage({ params: { locale } }: { params: { locale: string } }) {
  setRequestLocale(locale)
  if (!isAffiliateEnabled()) notFound()

  const session = await getServerSession(authOptions)
  const operatorId = (session?.user as { id?: string } | undefined)?.id
  if (!operatorId) redirect('/affiliate/join')

  const [operator, affiliate] = await Promise.all([
    prisma.operator.findUnique({ where: { id: operatorId }, select: { name: true, email: true, createdAt: true } }),
    prisma.affiliate.findUnique({ where: { operatorId }, select: { referralLinkSlug: true, status: true, audienceVerified: true } }),
  ])

  const email    = operator?.email ?? session?.user?.email ?? ''
  const identity = buildAffiliateIdentity({ name: operator?.name ?? null, email, slug: affiliate?.referralLinkSlug ?? null })
  const link     = buildAffiliateLink(affiliate?.referralLinkSlug ?? null) ?? ''

  return (
    <AffiliateSettingsClient
      name={identity.name}
      initials={identity.initials}
      email={email}
      link={link}
      statusActive={affiliate?.status === 'active'}
      verified={!!affiliate?.audienceVerified}
      createdAtISO={operator?.createdAt ? operator.createdAt.toISOString() : null}
    />
  )
}
