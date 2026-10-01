import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { readCreatorRoles, DEFAULT_ROLES } from '@/lib/creator-roles'
import { buildCreatorIdentity } from '@/lib/creator-identity'
import CreatorShell from '@/components/portals/CreatorShell'

// ── Creator dashboard layout — mounts the navy CreatorShell (CD CR0). ─────────────
// Server component: resolves the creator identity (name/@slug), the REAL role flags
// (gate the recipes / affiliation nav), from the SESSION email — owner-scoped, a creator
// never sees another studio. The /creators space is BARE in AppChrome, so this shell is
// the only chrome for /creators/dashboard/**. Middleware already gates the role
// (creator|admin); this layout only resolves display data. An admin/creator without a
// Creator row still gets the shell (both roles) — the page shows its own « not a creator »
// state. RE-SKIN = 0 migration, flags OFF byte-identical, moteur d'argent non touché.
export const dynamic = 'force-dynamic'

export default async function CreatorDashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.email) redirect('/creators')

  const creator = await prisma.creator.findUnique({
    where:  { email: session.user.email },
    select: { id: true, name: true, referralLinkSlug: true, referralCode: true },
  })

  const roles = creator ? await readCreatorRoles(creator.id) : { ...DEFAULT_ROLES }
  const identity = buildCreatorIdentity({
    name:  creator?.name ?? null,
    email: session.user.email,
    slug:  creator?.referralLinkSlug ?? creator?.referralCode?.toLowerCase() ?? null,
  })

  return (
    <CreatorShell identity={identity} roles={{ isChef: roles.isChef, isInfluencer: roles.isInfluencer }}>
      {children}
    </CreatorShell>
  )
}
