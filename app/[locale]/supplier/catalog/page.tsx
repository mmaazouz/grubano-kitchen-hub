import { getServerSession } from 'next-auth'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EmptyState } from '@/components/design-system'
import SupplierShell from '@/components/supplier/SupplierShell'
import { buildSupplierIdentity } from '@/lib/supplier-identity'
import CatalogClient, { type CatalogItem } from './CatalogClient'

// ── /supplier/catalog — CD v1 Lot 2 (SupplierShell + catalogue CRUD). ─────────────
// Server shell: resolve the caller's SupplierProfile (by session email → owner-scoped,
// no IDOR) + load its catalogue items, then render the CD list/detail client. All
// CRUD is the EXISTING real API (/api/supplier/catalog, session-scoped). Prices are
// CENTS server-side; no money is moved here.
export const dynamic = 'force-dynamic'

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

export default async function SupplierCatalogPage(props: { params: { locale: string } }) {
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

  const rows = await prisma.supplierCatalogItem.findMany({
    where:   { supplierProfileId: profile.id },
    orderBy: { name: 'asc' },
    select:  { id: true, name: true, description: true, category: true, priceCents: true, unit: true, packSize: true, available: true, allergens: true },
  }).catch(() => [])

  const items: CatalogItem[] = rows.map((r) => ({
    id: r.id, name: r.name, description: r.description, category: r.category,
    priceCents: r.priceCents, unit: r.unit, packSize: r.packSize, available: r.available,
    allergens: asStringArray(r.allergens),
  }))

  return (
    <SupplierShell identity={buildSupplierIdentity(profile)}>
      <CatalogClient initialItems={items} />
    </SupplierShell>
  )
}
