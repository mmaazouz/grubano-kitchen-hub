import { unstable_noStore as noStore } from 'next/cache'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { prisma } from '@/lib/prisma'
import { callerOperator } from '@/lib/operator-session'
import OrdersClient, { type MyOrder } from './OrdersClient'
import './supply-orders.css'

// ── /marketplace/orders — the resto's own supplier orders (flux acheteur, Lot F) ─
// VERBATIM CD (Notion 392fd2c9-…-14507a, mini-chantier n°2, écran F — last of the
// chantier). Re-skin of the buyer's supply-order history to the navy --op- CD:
// list + detail view + order timeline. Renders UNDER the OperatorShell (screen CONTENT).
//
// REAL DATA, owner-scoped: SupplyOrders are resolved directly for the SESSION operator
// (callerOperator, never a client id). Reads only — this screen creates/charges nothing.
//
// 🔒 MONEY-ADJACENT (reviewed): « Recommander » does NOT create an order here — it loads
// the past order's lines into the browser cart (lib/supply-cart) and navigates to the
// Lot E cart, where the REAL POST /api/marketplace/orders re-validates prices/availability
// server-side. « Contacter » is a plain mailto/tel to the supplier's real profile. The
// online-pay entry point is intentionally NOT shown (deferred like the Lot E locked
// « Payer en ligne » — the gated /pay flow is untouched). « Annuler » reuses the existing
// PATCH (placed→cancelled) state machine.
//
// HONEST OMISSIONS (SIGNAL): the timeline shows a REAL timestamp only for « Commande
// envoyée » (SupplyOrder.createdAt) — no per-step timestamp is stored (confirmedAt/…),
// so later steps show only their real status, never a fabricated time. No sequential
// invoice number (ref derived from the real id). « Livraison prévue » = real desiredDate
// or hidden.

export const dynamic = 'force-dynamic'

export default async function MarketplaceOrdersPage(props: { params: { locale: string } }) {
  const { locale } = props.params
  setRequestLocale(locale)
  noStore() // never prerender the session-scoped order list statically
  const t = await getTranslations('marketplaceOrders')

  const operator = await callerOperator()
  const isOperator = !!operator && (operator.role === 'restaurant' || operator.role === 'admin')

  const rows = isOperator
    ? await prisma.supplyOrder
        .findMany({
          where:   { operatorId: operator!.id },
          orderBy: { createdAt: 'desc' },
          select: {
            id: true, status: true, totalCents: true, desiredDate: true, createdAt: true,
            supplierProfileId: true,
            supplierProfile: { select: { companyName: true, city: true, email: true, phone: true } },
            lines: {
              select: { catalogItemId: true, nameSnapshot: true, unitSnapshot: true, quantity: true, unitPriceCents: true, lineTotalCents: true },
            },
          },
        })
        .catch(() => [])
    : []

  // Serialize dates → ISO strings for the client boundary.
  const orders: MyOrder[] = rows.map((o) => ({
    id: o.id,
    status: o.status,
    totalCents: o.totalCents,
    createdAt: o.createdAt.toISOString(),
    desiredDate: o.desiredDate ? o.desiredDate.toISOString() : null,
    supplierProfileId: o.supplierProfileId,
    supplier: o.supplierProfile
      ? { companyName: o.supplierProfile.companyName, city: o.supplierProfile.city, email: o.supplierProfile.email, phone: o.supplierProfile.phone }
      : null,
    lines: o.lines.map((l) => ({
      catalogItemId: l.catalogItemId,
      nameSnapshot: l.nameSnapshot,
      unitSnapshot: l.unitSnapshot,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      lineTotalCents: l.lineTotalCents,
    })),
  }))

  if (!isOperator) {
    return (
      <section className="mkt-orders">
        <div className="op-dash__head"><h1 className="op-dash__title">{t('title')}</h1></div>
        <div className="op-card">
          <div className="op-emptyline">
            <span className="ms" aria-hidden="true">lock</span>
            <b>{t('noAccessTitle')}</b>
          </div>
        </div>
      </section>
    )
  }

  return <OrdersClient orders={orders} />
}
