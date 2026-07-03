import { getServerSession } from 'next-auth'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EmptyState } from '@/components/design-system'
import SupplierShell from '@/components/supplier/SupplierShell'
import { buildSupplierIdentity } from '@/lib/supplier-identity'
import OrdersClient, { type ReceivedOrder } from './OrdersClient'

// ── /supplier/orders — CD v1 Lot 3 (Commandes reçues). MONEY ZONE, display-only. ──
// Server shell: resolve the caller's SupplierProfile (by session email → owner-scoped,
// no IDOR) + load its incoming SupplyOrders. Amounts are read in CENTS and shown via
// formatMoney; paymentStatus is read-only (from Stripe). The status workflow runs
// through the EXISTING PATCH /api/supplier/orders/[id] state machine (client side) —
// nothing here moves money or flips paymentStatus.
export const dynamic = 'force-dynamic'

export default async function SupplierOrdersPage(props: { params: { locale: string } }) {
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

  const rows = await prisma.supplyOrder.findMany({
    where:   { supplierProfileId: profile.id },
    orderBy: { createdAt: 'desc' },
    take:    200,
    select: {
      id: true, status: true, paymentStatus: true, totalCents: true, notes: true, desiredDate: true, createdAt: true,
      operator: { select: { name: true, city: true } },
      lines:    { select: { nameSnapshot: true, unitSnapshot: true, quantity: true, unitPriceCents: true, lineTotalCents: true } },
    },
  }).catch(() => [])

  const orders: ReceivedOrder[] = rows.map((r) => ({
    id: r.id,
    status: r.status,
    paymentStatus: r.paymentStatus ?? 'unpaid',
    totalCents: r.totalCents,
    notes: r.notes,
    desiredDate: r.desiredDate ? r.desiredDate.toISOString() : null,
    createdAt: r.createdAt.toISOString(),
    operator: r.operator ? { name: r.operator.name, city: r.operator.city } : null,
    lines: r.lines,
  }))

  return (
    <SupplierShell identity={buildSupplierIdentity(profile)}>
      <OrdersClient initialOrders={orders} companyName={profile.companyName} />
    </SupplierShell>
  )
}
