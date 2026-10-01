import { getServerSession } from 'next-auth'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EmptyState } from '@/components/design-system'
import SupplierShell from '@/components/supplier/SupplierShell'
import { buildSupplierIdentity } from '@/lib/supplier-identity'
import FacturationClient, { type Invoice } from './FacturationClient'

// ── /supplier/facturation — CD v1 Lot 5 (Facturation). MONEY ZONE, DISPLAY-ONLY. ──
// Server shell: resolve the caller's SupplierProfile (session email → owner-scoped,
// no IDOR) + read its invoiced SupplyOrders (a payment was attempted). Every amount is
// read in CENTS and passed straight through — NOTHING is written, computed into a
// charge, or simulated (no supply-pricing, no Payout, no checkout, no paymentStatus
// flip). The reversement (commission/net) is only meaningful when payoutStatus=active;
// otherwise the client shows "—". The B2B pipeline is gated OFF → 0 invoiced orders →
// honest empty state + the "Versements en cours d'activation" chip.
export const dynamic = 'force-dynamic'

export default async function SupplierFacturationPage(props: { params: { locale: string } }) {
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

  const payoutActive = profile.payoutStatus === 'active'

  // Invoiced orders = a payment was attempted (never 'unpaid'). CENTS read-only.
  const rows = await prisma.supplyOrder.findMany({
    where:   { supplierProfileId: profile.id, paymentStatus: { in: ['paid', 'pending', 'failed'] } },
    orderBy: { createdAt: 'desc' },
    take:    200,
    select: {
      id: true, paymentStatus: true, chargedCents: true, supplierPayoutCents: true, grubanoMarginCents: true,
      paidAt: true, createdAt: true,
      operator: { select: { name: true } },
      lines:    { select: { nameSnapshot: true, unitSnapshot: true, quantity: true, unitPriceCents: true, lineTotalCents: true } },
    },
  }).catch(() => [])

  const invoices: Invoice[] = rows.map((r) => ({
    id:  r.id,
    ref: `#${r.id.slice(-6).toUpperCase()}`, // derived from the real order id — NOT a fabricated sequential invoice number
    clientName: r.operator?.name ?? '—',
    dateISO: (r.paidAt ?? r.createdAt).toISOString(),
    paid: r.paymentStatus === 'paid',
    chargedCents: r.chargedCents ?? 0,
    supplierPayoutCents: r.supplierPayoutCents ?? 0,
    grubanoMarginCents: r.grubanoMarginCents ?? 0,
    lines: r.lines,
  }))

  const now = new Date()
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const caMonthCents = rows
    .filter((r) => r.paymentStatus === 'paid' && (r.paidAt ?? r.createdAt) >= startMonth)
    .reduce((s, r) => s + (r.chargedCents ?? 0), 0)
  // Available balance is only meaningful once the payout rail is active; else "—".
  const soldeCents = payoutActive
    ? rows.filter((r) => r.paymentStatus === 'paid').reduce((s, r) => s + (r.supplierPayoutCents ?? 0), 0)
    : null

  return (
    <SupplierShell identity={buildSupplierIdentity(profile)}>
      <FacturationClient
        invoices={invoices}
        payoutActive={payoutActive}
        caMonthCents={caMonthCents}
        soldeCents={soldeCents}
        companyName={profile.companyName}
      />
    </SupplierShell>
  )
}
