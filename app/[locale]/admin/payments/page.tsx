import { redirect } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { resolveAdmin } from '@/lib/admin-guard'
import { buildAdminIdentity } from '@/lib/admin-identity'
import { listAdminLedger } from '@/lib/admin-ledger'
import { isInfluencerEnabled } from '@/lib/influencer-verification'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import { isCourierActivationEnabled } from '@/lib/logistics-account'
import AdminShell from '@/components/admin/AdminShell'
import LedgerClient from './LedgerClient'
import './payments.css'

// ── /admin/payments — accounting ledger (CD ADM5 🔒). ────────────────────────────
// AdminShell + a 100% READ-ONLY ledger journal. Admin-only (resolveAdmin). No money
// action is possible from this screen — it lists stored LedgerEntry rows (CENTS) and
// shows the golden-equation decomposition. Money review GO required before ship.

export const dynamic = 'force-dynamic'

export default async function AdminPaymentsPage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)

  const admin = await resolveAdmin()
  if (!admin) redirect('/eat')

  const identity = buildAdminIdentity(admin)
  const flags = {
    influencer: isInfluencerEnabled(),
    prestataire: isPrestataireEnabled(),
    logistics: isCourierActivationEnabled(),
  }
  const initial = await listAdminLedger('30')

  return (
    <AdminShell identity={identity} flags={flags}>
      <LedgerClient initial={initial} />
    </AdminShell>
  )
}
