import { redirect } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { resolveAdmin } from '@/lib/admin-guard'
import { buildAdminIdentity } from '@/lib/admin-identity'
import { listGhostOrders, listCancelledPaidOrders } from '@/lib/admin-reconciliation'
import { isInfluencerEnabled } from '@/lib/influencer-verification'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import { isCourierActivationEnabled } from '@/lib/logistics-account'
import AdminShell from '@/components/admin/AdminShell'
import ReconciliationClient from './ReconciliationClient'
import './reconciliation.css'

// ── /admin/reconciliation — ghost-order queue (CD ADM3, decision D5). ────────────
// AdminShell + the read-only reconciliation queue (orders captured after expiry).
// Admin-only (resolveAdmin). READ-ONLY: no money action — « Résoudre » is a disabled
// « bientôt » (POST-resolve deferred). Queries directly via lib/admin-reconciliation
// (no e-mail digest side-effect); the cron GET /api/admin/reconcile-ghost-orders is
// untouched.

export const dynamic = 'force-dynamic'

export default async function AdminReconciliationPage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)

  const admin = await resolveAdmin()
  if (!admin) redirect('/eat')

  const identity = buildAdminIdentity(admin)
  const flags = {
    influencer: isInfluencerEnabled(),
    prestataire: isPrestataireEnabled(),
    logistics: isCourierActivationEnabled(),
  }
  // LOT C — the cancelled-but-paid queue renders on the same page, below the ghost
  // queue (read-only calque): a restaurant cancelling a PAID order flag-OFF keeps
  // the money with no admin surface — this section IS that surface.
  const [data, cancelledPaid] = await Promise.all([listGhostOrders(), listCancelledPaidOrders()])

  return (
    <AdminShell identity={identity} flags={flags}>
      <ReconciliationClient data={data} cancelledPaid={cancelledPaid} />
    </AdminShell>
  )
}
