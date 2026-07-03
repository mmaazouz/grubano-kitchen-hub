import { redirect } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { resolveAdmin } from '@/lib/admin-guard'
import { buildAdminIdentity } from '@/lib/admin-identity'
import { listAdminRestaurants } from '@/lib/admin-establishments'
import { isInfluencerEnabled } from '@/lib/influencer-verification'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import { isCourierActivationEnabled } from '@/lib/logistics-account'
import AdminShell from '@/components/admin/AdminShell'
import EstablishmentsClient from './EstablishmentsClient'
import './establishments.css'

// ── /admin/establishments — restaurants list (CD ADM2). ──────────────────────────
// AdminShell + a read-only, cross-operator list of every establishment. Admin-only
// (resolveAdmin, defence in depth). READ-ONLY: no money, nothing written. HONEST
// OMISSIONS (SIGNAL): no suspension pill/chip (no column), no plan/subscription column
// (« Formule »/« Premium » dropped), phone absent (owner email shown on the fiche).

export const dynamic = 'force-dynamic'

export default async function AdminEstablishmentsPage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)

  const admin = await resolveAdmin()
  if (!admin) redirect('/eat')

  const identity = buildAdminIdentity(admin)
  const flags = {
    influencer: isInfluencerEnabled(),
    prestataire: isPrestataireEnabled(),
    logistics: isCourierActivationEnabled(),
  }
  const data = await listAdminRestaurants()

  return (
    <AdminShell identity={identity} flags={flags}>
      <EstablishmentsClient data={data} />
    </AdminShell>
  )
}
