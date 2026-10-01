import { getServerSession } from 'next-auth'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EmptyState } from '@/components/design-system'
import SupplierShell from '@/components/supplier/SupplierShell'
import { buildSupplierIdentity } from '@/lib/supplier-identity'
import { aggregateSupplierClients } from '@/lib/supplier-clients'
import ClientsClient from './ClientsClient'

// ── /supplier/clients — CD v1 Lot 4a (Clients directory). READ-ONLY. ──────────────
// Server shell: resolve the caller's SupplierProfile (session email → owner-scoped,
// no IDOR) + aggregate its clients from real SupplyOrders. Same aggregation the
// GET /api/supplier/clients route serves; called directly here for SSR. No money is
// moved. Gated pipeline → 0 orders → 0 clients → honest empty state.
export const dynamic = 'force-dynamic'

export default async function SupplierClientsPage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)
  const t = await getTranslations('supplier')

  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) {
    return <div className="mx-auto max-w-xl px-5 pt-12"><EmptyState emoji="🔒" title={t('noProfileTitle')} description={t('noProfileBody')} /></div>
  }

  const profile = await prisma.supplierProfile.findUnique({ where: { email } }).catch(() => null)
  if (!profile) {
    return <div className="mx-auto max-w-xl px-5 pt-12"><EmptyState emoji="📦" title={t('noProfileTitle')} description={t('noProfileBody')} /></div>
  }

  const clients = await aggregateSupplierClients(profile.id)

  return (
    <SupplierShell identity={buildSupplierIdentity(profile)}>
      <ClientsClient initialClients={clients} />
    </SupplierShell>
  )
}
