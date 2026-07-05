import { notFound, redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isAffiliateEnabled, getAffiliateByOperator } from '@/lib/affiliate-account'
import { buildAffiliateIdentity } from '@/lib/affiliate-identity'
import AffiliateShell from '@/components/portals/AffiliateShell'

// ── Affiliate dashboard layout — mounts the navy AffiliateShell (CD AF0). ─────────
// Server component: resolves the REAL affiliate identity (operator name/@slug) from the
// SESSION operator id — owner-scoped, an affiliate never sees another's space. The
// /affiliate space is BARE in AppChrome, so this shell is the only chrome for
// /affiliate/dashboard/** (it REPLACES the old PartnerChrome). 404 when AFFILIATE_ENABLED
// is OFF → the whole surface stays invisible, byte-identical. Middleware already gates the
// role (affiliate|admin) + role-spaces already points /affiliate/dashboard here; only the
// layout + shell were missing. RE-SKIN — 0 migration, flags OFF, moteur d'argent non touché.
export const dynamic = 'force-dynamic'

export default async function AffiliateDashboardLayout({ children }: { children: React.ReactNode }) {
  if (!isAffiliateEnabled()) notFound()

  const session = await getServerSession(authOptions)
  const operatorId = (session?.user as { id?: string } | undefined)?.id
  if (!operatorId) redirect('/affiliate/join')

  const [operator, affiliate] = await Promise.all([
    prisma.operator.findUnique({ where: { id: operatorId }, select: { name: true, email: true } }),
    getAffiliateByOperator(operatorId),
  ])

  const identity = buildAffiliateIdentity({
    name:  operator?.name ?? null,
    email: operator?.email ?? session?.user?.email ?? '',
    slug:  affiliate?.referralLinkSlug ?? null,
  })

  return <AffiliateShell identity={identity}>{children}</AffiliateShell>
}
