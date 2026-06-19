import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Scale } from 'lucide-react'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { readOperatorRoles } from '@/lib/operator-roles'
import { isClaimsEnabled } from '@/lib/claims'
import AdminClaimsArbitration from '@/components/claims/AdminClaimsArbitration'

// ── /admin/claims — neutral admin arbitration console (P4.5-C2, Agent 53) ──────────
// ADMIN-only. Triple-gated: middleware (admin) + this server role check + each endpoint
// re-checks the admin session. Gated by CLAIMS_ENABLED (OFF → bounce to /admin/approvals
// → no claims UI exposed = byte-identical). The arbiter is NEVER a party (resto/client).
export const dynamic = 'force-dynamic'

export default async function AdminClaimsPage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)
  const t = await getTranslations('claims')

  const session = await getServerSession(authOptions)
  if (!session?.user?.email) redirect('/auth/magic')

  const operator = await prisma.operator.findUnique({
    where:  { email: session.user.email },
    select: { id: true, role: true },
  })
  if (!operator) redirect('/eat')
  const roles = await readOperatorRoles(operator.id, operator.role)
  if (!roles.includes('admin')) redirect('/eat')

  // Flag OFF → no claims console (byte-identical: the feature is inert everywhere).
  if (!isClaimsEnabled()) redirect('/admin/approvals')

  return (
    <div className="mx-auto max-w-3xl px-5 py-6 space-y-6">
      <header className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-grubano-lg bg-grubano-primary/15 text-grubano-primary">
          <Scale size={20} />
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold text-grubano-ink">{t('admin.title')}</h1>
          <p className="text-sm text-grubano-ink-muted">{t('admin.subtitle')}</p>
        </div>
      </header>

      <AdminClaimsArbitration />
    </div>
  )
}
