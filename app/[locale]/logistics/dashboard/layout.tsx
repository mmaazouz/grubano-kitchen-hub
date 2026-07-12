import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isCourierActivationEnabled } from '@/lib/logistics-account'
import { buildLogisticsIdentity } from '@/lib/logistics-identity'
import LogisticsShell from '@/components/portals/LogisticsShell'

// ── Logistics dashboard layout — mounts the AMBER LogisticsShell (CD LO0). ────────
// Server component: resolves the REAL courier identity + status from the SESSION email →
// LogisticsProfile (email-keyed, 1:1 Operator) — owner-scoped, a courier never sees
// another's space. The /logistics space is BARE in AppChrome, so this shell is the only
// chrome for /logistics/dashboard/** (it REPLACES the old bare navy header). NO flag gate
// on the whole space: the console stays OPEN (the WAITLIST state is honest) — middleware
// already gates the role (logistics|admin) + role-spaces already points here. The pill
// status is derived REALLY: onWaitlist = pending && !isCourierActivationEnabled().
// RE-SKIN — 0 migration, flags OFF, moteur d'argent non touché, middleware/role-spaces
// UNCHANGED.
export const dynamic = 'force-dynamic'

type CourierStatus = 'waitlist' | 'active' | 'pending' | 'rejected' | 'suspended'

const KNOWN: readonly CourierStatus[] = ['active', 'pending', 'rejected', 'suspended']

export default async function LogisticsDashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  // Defence in depth — middleware already blocks unauthenticated / non-logistics.
  if (!email) redirect('/login')

  const [operator, profile] = await Promise.all([
    prisma.operator.findUnique({ where: { email }, select: { name: true } }).catch(() => null),
    prisma.logisticsProfile
      .findUnique({ where: { email }, select: { status: true, contactName: true, officialName: true } })
      .catch(() => null),
  ])

  const identity = buildLogisticsIdentity({
    name: profile?.contactName || profile?.officialName || operator?.name || null,
    email,
  })

  // Real status pill. A 'pending' profile under the OFF activation flag is a WAITLIST
  // candidate (not a review-pending one) — same rule as the dashboard page. No profile
  // (e.g. an admin viewing) → no pill (null).
  let status: CourierStatus | null = null
  if (profile) {
    const s = profile.status
    if (s === 'pending' && !isCourierActivationEnabled()) status = 'waitlist'
    else if ((KNOWN as readonly string[]).includes(s)) status = s as CourierStatus
    else status = 'pending'
  }

  return (
    <LogisticsShell identity={identity} status={status}>
      {children}
    </LogisticsShell>
  )
}
