import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/navigation'
import { prisma } from '@/lib/prisma'
import { callerOperator } from '@/lib/operator-session'
import CartClient from './CartClient'
import './panier.css'

// ── /marketplace/suppliers/[id]/panier — supplier CART + order validation (Lot E) ─
// VERBATIM CD (Notion 392fd2c9-…-1333fd, mini-chantier n°2, écran E). Continuation of
// Lot D (« Voir le panier »). Renders UNDER the OperatorShell — emits screen CONTENT.
//
// 🔒🔒 MONEY (adversarially reviewed). The server here only READS the supplier + its
// available catalogue (authoritative priceCents). The cart QUANTITIES live in the
// browser (lib/supply-cart) — the client component joins them with these server prices
// for a DISPLAY-ONLY preview. « Passer la commande » calls the EXISTING
// POST /api/marketplace/orders, which is the single source of truth for money: it
// re-fetches each item's priceCents, snapshots + SUMS server-side in CENTS
// (buildOrderLines) and re-enforces supplier.minimumOrderCents. The client NEVER sends
// an amount — only {catalogItemId, quantity} (+ notes, desiredDate). « Payer en ligne »
// stays a LOCKED, inert button — the gated /pay flow is untouched. No commission line
// is shown to the buyer (the 1 % lives on the supplier payout, not here).
//
// HONEST OMISSIONS (no backing → omitted, SIGNAL): no VAT breakdown / « TVA incluse »
// (supply orders carry no tax model — total = Σ line snapshots), no delivery-fee line,
// no order-cutoff time, no per-weekday delivery calendar (day chips = real dates from
// leadTimeDays, none disabled — we don't model supplier closures).

export const dynamic = 'force-dynamic'

export default async function SupplierCartPage(props: { params: { locale: string; id: string } }) {
  const { locale, id } = props.params
  setRequestLocale(locale)
  const t = await getTranslations('marketplaceCart')

  const operator = await callerOperator()
  const isOperator = !!operator && (operator.role === 'restaurant' || operator.role === 'admin')

  // Same marketplace visibility gate as the catalogue: only an active + coherent
  // supplier can be checked out. Fetch the available items (buyer can only order those).
  const supplier = isOperator
    ? await prisma.supplierProfile
        .findFirst({
          where: { id, status: 'active', marketplaceCoherencePending: false },
          select: {
            id: true, companyName: true, city: true,
            minimumOrderCents: true, leadTimeDays: true,
            catalogItems: {
              where: { available: true },
              select: { id: true, name: true, priceCents: true, unit: true, packSize: true },
              orderBy: [{ category: 'asc' }, { name: 'asc' }],
            },
          },
        })
        .catch(() => null)
    : null

  if (!supplier) {
    return (
      <section className="mkt-cart">
        <Link href="/marketplace/suppliers" className="op-back">
          <span className="ms flip-rtl" aria-hidden="true">arrow_back</span>{t('backToMarketplace')}
        </Link>
        <div className="op-card op-center" style={{ minHeight: 420 }}>
          <div className="op-error__card">
            <span className="ms" aria-hidden="true">cloud_off</span>
            <h2>{t('supplierGoneTitle')}</h2>
            <p>{t('supplierGoneBody')}</p>
            <Link href="/marketplace/suppliers" className="op-btn-ghost">
              <span className="ms flip-rtl" aria-hidden="true">arrow_back</span>{t('backToMarketplace')}
            </Link>
          </div>
        </div>
      </section>
    )
  }

  return (
    <CartClient
      supplierId={supplier.id}
      companyName={supplier.companyName}
      city={supplier.city}
      minimumOrderCents={supplier.minimumOrderCents}
      leadTimeDays={supplier.leadTimeDays}
      items={supplier.catalogItems}
    />
  )
}
