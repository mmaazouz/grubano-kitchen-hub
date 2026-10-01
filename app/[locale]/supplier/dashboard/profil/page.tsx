import { getServerSession } from 'next-auth'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EmptyState } from '@/components/design-system'
import SupplierShell from '@/components/supplier/SupplierShell'
import { buildSupplierIdentity } from '@/lib/supplier-identity'
import { isSupplierConnectEnabled } from '@/lib/supplier-connect'
import ReglagesClient from './ReglagesClient'

// ── /supplier/dashboard/profil — CD v1 Lot 6 (Réglages). RE-SKIN of the real profile.
// Server shell: resolve the caller's SupplierProfile (session email → owner-scoped) +
// pass the Connect flag + real payoutStatus. The client edits ONLY the operational
// fields via the EXISTING GET/PATCH /api/supplier/profile — no new field, no new route.
// SupplierConnectCard (gated) lives in the Versements section. No money is moved here.
export const dynamic = 'force-dynamic'

export default async function SupplierReglagesPage(props: { params: { locale: string } }) {
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

  return (
    <SupplierShell identity={buildSupplierIdentity(profile)}>
      <ReglagesClient connectEnabled={isSupplierConnectEnabled()} payoutStatus={profile.payoutStatus ?? 'none'} />
    </SupplierShell>
  )
}
