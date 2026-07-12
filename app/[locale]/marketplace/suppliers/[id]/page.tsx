import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/navigation'
import { prisma } from '@/lib/prisma'
import { callerOperator } from '@/lib/operator-session'
import { formatMoney } from '@/lib/format-money'
import SupplierCatalogClient from './SupplierCatalogClient'
import './supplier-catalog.css'

// ── /marketplace/suppliers/[id] — supplier catalogue, BUYER side (flux acheteur, Lot D)
// VERBATIM CD (Notion 392fd2c9-…-2865f5, mini-chantier n°2, écran D). Re-skin of the
// operator-side supplier detail to the navy --op- catalog design. Renders UNDER the
// OperatorShell (AppChrome) — this file emits only the screen CONTENT (<section>).
//
// REAL DATA, owner-scoped: the connected restaurateur is resolved from the SESSION
// (callerOperator, never a client id). The supplier is fetched with the SAME
// visibility gate as GET /api/marketplace/suppliers (status='active' +
// marketplaceCoherencePending=false) so a buyer can only open a marketplace-visible
// supplier. Catalogue items are shown in full (available=false → greyed, non-addable).
//
// 🔒 MONEY: this screen moves NO money and creates NO order. The sticky cart bar is a
// DISPLAY-ONLY client preview (Σ priceCents·qty vs the supplier's REAL minimumOrderCents);
// « Voir le panier » only persists the chosen quantities (lib/supply-cart) and navigates
// to the cart (Lot E), where the SupplyOrder is created server-side (POST re-snapshots
// prices in CENTS and re-enforces the minimum). Amounts are CENTS via formatMoney.
//
// HONEST OMISSIONS (no backing column → omitted, SIGNAL): supplier ★ rating/reviews
// (no supplier-review rail exists), order cutoff time, catalogue item photo/SKU. The
// « Livre dans votre zone » badge shows ONLY on a real textual match between the buyer's
// restaurant city and the supplier's deliveryZones — never fabricated.

export const dynamic = 'force-dynamic'

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

// Normalise a place string for a lenient (accent/space/case-insensitive) match.
// NFD decomposes accents (é → e + combining mark); stripping every non-alphanumeric
// then drops the combining marks too, so "Paris 11e" and "paris11e" both collapse.
function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '')
}

export default async function SupplierCatalogPage(props: { params: { locale: string; id: string } }) {
  const { locale, id } = props.params
  setRequestLocale(locale)
  const t  = await getTranslations('marketplaceCatalog')
  const ts = await getTranslations('supplier')

  const catLabel = (cat: string) => {
    const k = `cat${cat.charAt(0).toUpperCase()}${cat.slice(1)}`
    const label = ts(k as 'catFresh')
    return label === k ? cat : label
  }
  const logoInitials = (name: string) =>
    name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || 'F'

  const operator = await callerOperator()
  const isOperator = !!operator && (operator.role === 'restaurant' || operator.role === 'admin')

  // Owner-scoped fetch: same marketplace visibility gate as the discovery endpoint.
  const supplier = isOperator
    ? await prisma.supplierProfile
        .findFirst({
          where: { id, status: 'active', marketplaceCoherencePending: false },
          select: {
            id: true, companyName: true, city: true, categories: true,
            deliveryZones: true, minimumOrderCents: true, leadTimeDays: true,
            catalogItems: {
              select: {
                id: true, name: true, category: true, priceCents: true,
                unit: true, packSize: true, available: true,
              },
              orderBy: [{ category: 'asc' }, { name: 'asc' }],
            },
          },
        })
        .catch(() => null)
    : null

  // Not found / not visible / not an operator → honest not-found state.
  if (!supplier) {
    return (
      <section className="mkt-sd">
        <Link href="/marketplace/suppliers" className="op-back">
          <span className="ms flip-rtl" aria-hidden="true">arrow_back</span>{t('back')}
        </Link>
        <div className="op-card op-center" style={{ minHeight: 420 }}>
          <div className="op-error__card">
            <span className="ms" aria-hidden="true">cloud_off</span>
            <h2>{t('notFoundTitle')}</h2>
            <p>{t('notFoundBody')}</p>
            <Link href="/marketplace/suppliers" className="op-btn-ghost">
              <span className="ms flip-rtl" aria-hidden="true">arrow_back</span>{t('backToMarketplace')}
            </Link>
          </div>
        </div>
      </section>
    )
  }

  const categories = asStringArray(supplier.categories)
  const deliveryZones = asStringArray(supplier.deliveryZones)

  // Real zone match: any of the buyer's restaurant cities textually matches any of the
  // supplier's declared delivery zones. No match / no data → badge hidden (honest).
  const buyerCities = isOperator
    ? await prisma.restaurant
        .findMany({ where: { operatorId: operator!.id }, select: { city: true } })
        .then((rs) => rs.map((r) => r.city).filter(Boolean))
        .catch(() => [] as string[])
    : []
  const zoneMatch = deliveryZones.some((z) => {
    const nz = norm(z)
    return nz.length > 0 && buyerCities.some((c) => {
      const nc = norm(c)
      return nc.length > 0 && (nz.includes(nc) || nc.includes(nz))
    })
  })

  const items = supplier.catalogItems
  const catalogueEmpty = items.length === 0

  return (
    <section className="mkt-sd">
      <Link href="/marketplace/suppliers" className="op-back">
        <span className="ms flip-rtl" aria-hidden="true">arrow_back</span>{t('back')}
      </Link>

      {/* Supplier header — real SupplierProfile. ★ rating omitted (no review rail). */}
      <div className="op-card sd-head">
        <span className="sd-logo">{logoInitials(supplier.companyName)}</span>
        <div className="sd-head__m">
          <h1>{supplier.companyName}</h1>
          <div className="sd-head__loc">
            <span className="ms" aria-hidden="true">place</span>
            {supplier.city || t('cityUnknown')}
            {deliveryZones.length > 0 && <> · {t('deliversIn', { zones: deliveryZones.join(', ') })}</>}
          </div>
          {categories.length > 0 && (
            <div className="sd-cats">
              {categories.map((c) => <span key={c} className="sd-cat">{catLabel(c)}</span>)}
            </div>
          )}
        </div>
        <div className="sd-facts">
          {supplier.minimumOrderCents > 0 && (
            <div className="sd-fact">
              <span className="ms" aria-hidden="true">shopping_cart</span>
              {t('minOrder')} <b className="mono">{formatMoney(supplier.minimumOrderCents, locale)}</b>
            </div>
          )}
          <div className="sd-fact">
            <span className="ms" aria-hidden="true">local_shipping</span>
            {t('leadTime')} <b>{ts('leadTimeValue', { days: supplier.leadTimeDays })}</b>
          </div>
          {zoneMatch && (
            <span className="sd-zone"><span className="ms" aria-hidden="true">check</span>{t('deliverZone')}</span>
          )}
        </div>
      </div>

      {catalogueEmpty ? (
        <div className="op-card">
          <div className="op-emptyline">
            <span className="ms" aria-hidden="true">inventory</span>
            <b>{t('catalogEmptyTitle')}</b>
            <span>{t('catalogEmptyBody', { supplier: supplier.companyName })}</span>
            <Link href="/marketplace/suppliers" className="op-btn-ghost">
              <span className="ms flip-rtl" aria-hidden="true">arrow_back</span>{t('backToMarketplace')}
            </Link>
          </div>
        </div>
      ) : (
        <SupplierCatalogClient
          supplierId={supplier.id}
          minimumOrderCents={supplier.minimumOrderCents}
          items={items}
        />
      )}
    </section>
  )
}
