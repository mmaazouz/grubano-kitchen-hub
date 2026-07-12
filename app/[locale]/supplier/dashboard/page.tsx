import { getServerSession } from 'next-auth'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Link } from '@/navigation'
import { EmptyState } from '@/components/design-system'
import RoleSwitcher from '@/components/RoleSwitcher'
import SupplierConnectCard from '@/components/supplier/SupplierConnectCard'
import OnboardingGuide from '@/components/onboarding/OnboardingGuide'
import OnboardingChat from '@/components/onboarding/OnboardingChat'
import SupplierShell, { type SupplierIdentity } from '@/components/supplier/SupplierShell'
import { formatMoney } from '@/lib/format-money'
import { isSupplierConnectEnabled } from '@/lib/supplier-connect'
import './supplier-dashboard.css'

// ── /supplier/dashboard — CD v1 Lot 1 (SupplierShell + dashboard). ────────────────
// Renders inside the new navy SupplierShell. Data is REAL + owner-scoped
// (supplierProfileId = the caller's profile): KPIs, "Commandes à traiter", Top
// produits / Top clients are computed from real SupplyOrder / SupplyOrderLine rows.
// The supplier B2B pipeline is gated (SUPPLIER_CONNECT_ENABLED OFF) so in practice
// there are 0 orders in prod → the honest empty state shows. NO money is moved or
// simulated here; every amount is read server-side in CENTS and formatted via
// formatMoney. The Copilote card is an honest "bientôt" (violet) link.
export const dynamic = 'force-dynamic'

const AV_GRADS = [
  'linear-gradient(135deg,#FF8A3D,#F2570E)',
  'linear-gradient(135deg,#D5372A,#A8281D)',
  'linear-gradient(135deg,#E8A63D,#B9740A)',
  'linear-gradient(135deg,#41BD78,#1E9E57)',
  'linear-gradient(135deg,#3E5A7D,#1B3A5E)',
  'linear-gradient(135deg,#6E56CF,#8B74E0)',
] as const

const ORDER_STATUS: Record<string, { cls: string; key: 'osPlaced' | 'osConfirmed' | 'osPreparing' | 'osDelivered' }> = {
  placed:    { cls: 'confirm', key: 'osPlaced' },
  confirmed: { cls: 'prep',    key: 'osConfirmed' },
  preparing: { cls: 'prep',    key: 'osPreparing' },
  delivered: { cls: 'shipped', key: 'osDelivered' },
}
const ACTIONABLE = new Set(['placed', 'confirmed', 'preparing'])

function initials(name: string | null | undefined): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '—'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

export default async function SupplierDashboardPage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)
  const locale = props.params.locale
  const t = await getTranslations('supplier')
  const td = await getTranslations('supplierDash')

  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) {
    return (
      <div className="mx-auto max-w-xl px-5 pt-12">
        <EmptyState emoji="🔒" title={t('noProfileTitle')} description={t('noProfileBody')} />
      </div>
    )
  }

  const profile = await prisma.supplierProfile.findUnique({ where: { email } }).catch(() => null)
  if (!profile) {
    return (
      <div className="mx-auto max-w-xl px-5 pt-12">
        <EmptyState emoji="📦" title={t('noProfileTitle')} description={t('noProfileBody')} />
      </div>
    )
  }

  // Owner-scoped: only THIS supplier's incoming orders. Recent window is plenty for a
  // dashboard; the whole pipeline is gated so this is typically empty in prod.
  const orders = await prisma.supplyOrder.findMany({
    where:  { supplierProfileId: profile.id },
    orderBy: { createdAt: 'desc' },
    take:   200,
    select: {
      id: true, status: true, totalCents: true, desiredDate: true, createdAt: true,
      operatorId: true,
      operator: { select: { name: true, city: true } },
      lines: { select: { nameSnapshot: true, quantity: true, lineTotalCents: true } },
    },
  }).catch(() => [])

  // ── KPIs (real, CENTS server-side) ──────────────────────────────────────────
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const isToday = (d: Date) => d >= startOfToday
  const receivedToday = orders.filter((o) => isToday(o.createdAt)).length
  const toProcess     = orders.filter((o) => o.status === 'confirmed' || o.status === 'preparing').length
  const revenueTodayC = orders.filter((o) => isToday(o.createdAt)).reduce((s, o) => s + (o.totalCents ?? 0), 0)
  const deliveries    = orders.filter((o) => (o.status === 'confirmed' || o.status === 'preparing') && o.desiredDate).length

  // ── "Commandes à traiter" (actionable, most recent first) ────────────────────
  const toTreat = orders.filter((o) => ACTIONABLE.has(o.status)).slice(0, 6)

  // ── Top produits / Top clients (aggregated in JS from the fetched window) ─────
  const prodMap = new Map<string, { qty: number; cents: number }>()
  for (const o of orders) for (const l of o.lines) {
    const cur = prodMap.get(l.nameSnapshot) ?? { qty: 0, cents: 0 }
    cur.qty += l.quantity; cur.cents += l.lineTotalCents
    prodMap.set(l.nameSnapshot, cur)
  }
  const topProducts = Array.from(prodMap.entries())
    .map(([name, v]) => ({ name, qty: v.qty, cents: v.cents }))
    .sort((a, b) => b.cents - a.cents).slice(0, 4)

  const clientMap = new Map<string, { name: string; cents: number; since: Date }>()
  for (const o of orders) {
    const cur = clientMap.get(o.operatorId)
    if (cur) { cur.cents += o.totalCents ?? 0; if (o.createdAt < cur.since) cur.since = o.createdAt }
    else clientMap.set(o.operatorId, { name: o.operator?.name ?? '—', cents: o.totalCents ?? 0, since: o.createdAt })
  }
  const topClients = Array.from(clientMap.values()).sort((a, b) => b.cents - a.cents).slice(0, 3)

  const identity: SupplierIdentity = {
    companyName:     profile.companyName,
    companyInitials: initials(profile.companyName),
    profileName:     (profile.contactName ?? '').split(/\s+/)[0] || profile.companyName,
    profileInitials: initials(profile.contactName ?? profile.companyName),
    acceptingOrders: profile.status === 'active',
  }

  const dateLabel = new Intl.DateTimeFormat(locale, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  }).format(now)
  const monthYear = (d: Date) => new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric' }).format(d)

  return (
    <SupplierShell identity={identity}>
      <section>
        <div className="op-dash__head">
          <h1 className="op-dash__title">{td('title')}</h1>
          <p className="op-dash__sub">{dateLabel} — {profile.companyName}</p>
        </div>

        {/* Honest status banners (real states, no money) */}
        {profile.status === 'pending' && (
          <div className="sup-banner"><span className="ms">hourglass_top</span>
            <div><b>{t('statusPendingTitle')}</b><span>{t('statusPendingBody')}</span></div>
          </div>
        )}
        {profile.status === 'active' && profile.marketplaceCoherencePending && (
          <div className="sup-banner"><span className="ms">hourglass_top</span>
            <div><b>{t('coherencePendingTitle')}</b><span>{t('coherencePendingBody')}</span></div>
          </div>
        )}

        {/* Multi-role space switch (self-hides for single-role users) + onboarding
            copilots (self-gating → null when their flags are OFF). Real, inert today. */}
        <RoleSwitcher />
        <OnboardingGuide role="supplier" />
        <OnboardingChat role="supplier" />

        {/* KPIs — real, mono */}
        <div className="op-card stat-strip">
          <div className="stat"><span className="lbl">{td('kpiReceivedToday')}</span><b>{receivedToday}</b></div>
          <div className="stat"><span className="lbl">{td('kpiToProcess')}</span><b>{toProcess}</b></div>
          <div className="stat"><span className="lbl">{td('kpiRevenue')}</span><b>{formatMoney(revenueTodayC, locale)}</b></div>
          <div className="stat"><span className="lbl">{td('kpiDeliveries')}</span><b>{deliveries}</b></div>
        </div>

        {/* Copilote — honest "bientôt" (violet) */}
        <Link href="/supplier/copilote" className="ai-card">
          <span className="ai-card__ic"><span className="ms">auto_awesome</span></span>
          <div className="ai-card__m"><b>{td('aiTitle')}</b><span>{td('aiPrompt')}</span></div>
          <span className="ai-card-ask"><span className="ms">arrow_forward</span>{td('aiAsk')}</span>
        </Link>

        <div className="dash-grid">
          <div className="op-card">
            <div className="op-card__head"><h2><span className="ms">receipt_long</span>{td('ordersToProcess')}</h2></div>
            {toTreat.length === 0 ? (
              <div className="op-emptyline">
                <span className="ms">receipt_long</span>
                <b>{td('emptyOrdersTitle')}</b>
                <span>{td('emptyOrdersBody')}</span>
              </div>
            ) : toTreat.map((o, i) => {
              const meta = ORDER_STATUS[o.status] ?? ORDER_STATUS.placed
              const items = o.lines.reduce((s, l) => s + l.quantity, 0)
              return (
                <div key={o.id} className="ord-row">
                  <span className="ord-row__av" style={{ background: AV_GRADS[i % AV_GRADS.length] }}>{initials(o.operator?.name)}</span>
                  <div className="ord-row__m"><b>{o.operator?.name ?? '—'}</b><span>{td('itemsCount', { count: items })}</span></div>
                  <span className="amt">{formatMoney(o.totalCents ?? 0, locale)}</span>
                  <span className={`ord-status ${meta.cls}`}><i className="dot" />{td(meta.key)}</span>
                  <Link href="/supplier/orders" className="ord-action"><span className="ms">visibility</span>{o.status === 'delivered' ? td('view') : td('process')}</Link>
                </div>
              )
            })}
          </div>

          <div className="side-col">
            <div className="op-card">
              <div className="op-card__head"><h2><span className="ms">trending_up</span>{td('topProducts')}</h2></div>
              {topProducts.length === 0 ? (
                <div className="op-emptyline"><span className="ms">trending_up</span><b>{td('emptyTopTitle')}</b></div>
              ) : topProducts.map((p, i) => (
                <div key={p.name} className="top-row">
                  <span className="rank">{i + 1}</span>
                  <div className="m"><b>{p.name}</b><span>{td('unitsSold', { count: p.qty })}</span></div>
                  <span className="val">{formatMoney(p.cents, locale)}</span>
                </div>
              ))}
            </div>

            <div className="op-card">
              <div className="op-card__head"><h2><span className="ms">group</span>{td('topClients')}</h2></div>
              {topClients.length === 0 ? (
                <div className="op-emptyline"><span className="ms">group</span><b>{td('emptyTopTitle')}</b></div>
              ) : topClients.map((c, i) => (
                <div key={c.name + i} className="top-row">
                  <span className="rank">{i + 1}</span>
                  <div className="m"><b>{c.name}</b><span>{td('since', { date: monthYear(c.since) })}</span></div>
                  <span className="val">{formatMoney(c.cents, locale)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Transitional: payout onboarding entry (Stripe Connect, gated) stays reachable
            here until the Réglages « Versements » section lands (B6). Real + gated. */}
        <div className="sup-connect-slot">
          <SupplierConnectCard enabled={isSupplierConnectEnabled()} initialStatus={profile.payoutStatus ?? 'none'} />
        </div>
      </section>
    </SupplierShell>
  )
}
