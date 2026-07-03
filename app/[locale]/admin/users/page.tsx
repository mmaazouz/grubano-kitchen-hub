import { redirect } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { resolveAdmin } from '@/lib/admin-guard'
import { buildAdminIdentity } from '@/lib/admin-identity'
import { listAdminUsers } from '@/lib/admin-users'
import { isInfluencerEnabled } from '@/lib/influencer-verification'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import { isCourierActivationEnabled } from '@/lib/logistics-account'
import AdminShell from '@/components/admin/AdminShell'
import UsersClient from './UsersClient'
import './users.css'

// ── /admin/users — users (Operator) list (CD ADM4). ──────────────────────────────
// AdminShell + a read-only, cross-operator, PII-sensitive users list. Admin-only
// (resolveAdmin). READ-ONLY: nothing written — « Suspendre » is a disabled « bientôt »
// (suspension = STOP-design deferred: column + endpoint + audit-log first, with ADM7).

export const dynamic = 'force-dynamic'

export default async function AdminUsersPage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)

  const admin = await resolveAdmin()
  if (!admin) redirect('/eat')

  const identity = buildAdminIdentity(admin)
  const flags = {
    influencer: isInfluencerEnabled(),
    prestataire: isPrestataireEnabled(),
    logistics: isCourierActivationEnabled(),
  }
  const data = await listAdminUsers()

  return (
    <AdminShell identity={identity} flags={flags}>
      <UsersClient data={data} />
    </AdminShell>
  )
}
