import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { buildFranchiseIdentity } from '@/lib/franchise-identity'
import FranchiseShell from '@/components/portals/FranchiseShell'

// ── Franchise dashboard layout — mounts the navy FranchiseShell (CD FR1). ─────────
// Server component: resolves the franchisor identity + the REAL pending-application
// count (nav badge) + the primary brand (« Marque » link) from the SESSION operator —
// owner-scoped, a franchisor never sees another network. The /franchise space is BARE in
// AppChrome, so this shell is the only chrome for /franchise/dashboard/**. Middleware
// already gates the role (franchise|restaurant|admin); this layout only resolves display
// data (and bounces to the public landing if the session is somehow absent).
export const dynamic = 'force-dynamic'

export default async function FranchiseDashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) redirect('/franchise')

  const operator = await prisma.operator.findUnique({
    where:  { email: session.user.email },
    select: { id: true, name: true, email: true },
  })
  if (!operator) redirect('/franchise')

  // Franchisor's OWN brands → the « Marque » link target (primary brand) + the scope for
  // counting pending candidacies. Owner-scoped by the session operator id.
  const brands = await prisma.brand.findMany({
    where:   { operatorId: operator.id },
    select:  { id: true },
    orderBy: { createdAt: 'asc' },
  })
  const brandIds = brands.map((b) => b.id)
  const pendingCount = brandIds.length
    ? await prisma.franchiseeApplication.count({ where: { brandId: { in: brandIds }, status: 'pending' } })
    : 0

  return (
    <FranchiseShell
      identity={buildFranchiseIdentity(operator)}
      pendingCount={pendingCount}
      brandId={brands[0]?.id ?? null}
    >
      {children}
    </FranchiseShell>
  )
}
