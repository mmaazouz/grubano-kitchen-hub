import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { readOperatorRoles } from '@/lib/operator-roles'
import { buildAdminIdentity } from '@/lib/admin-identity'
import { computeAdminOverview } from '@/lib/admin-overview'
import { formatMoney } from '@/lib/format-money'
import { isInfluencerEnabled } from '@/lib/influencer-verification'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import { isCourierActivationEnabled } from '@/lib/logistics-account'
import AdminShell from '@/components/admin/AdminShell'
import { Link } from '@/navigation'
import './admin-overview.css'

// ── /admin — the admin console INDEX = the platform overview (CD ADM1). ──────────
// Renders the AdminShell (navy --op- console chrome) + the read-only KPI overview.
// /admin is BARE in AppChrome, so this page mounts AdminShell itself (like /supplier).
// ADMIN-only, triple-gated: middleware, this server re-check (readOperatorRoles), and
// GET /api/admin/overview re-checks too. READ-ONLY: no money moves, nothing is written.
//
// HONEST OMISSIONS (SIGNAL): KPI deltas (no 2nd real window → no fabricated trend) and
// the "recent activity" feed (no event/audit-log model → lands with the AdminAuditLog in
// ADM7) are omitted. The « paiements à réconcilier » queue count is real but not yet
// clickable (the reconciliation screen is ADM6).

export const dynamic = 'force-dynamic'

const CH_ICON: Record<string, string> = {
  delivery: 'local_shipping', pickup: 'shopping_bag', dinein: 'restaurant', reservation: 'event_seat',
}

export default async function AdminOverviewPage(props: { params: { locale: string } }) {
  const { locale } = props.params
  setRequestLocale(locale)
  const t = await getTranslations('adminOverview')

  const session = await getServerSession(authOptions)
  if (!session?.user?.email) redirect('/auth/magic')

  const operator = await prisma.operator.findUnique({
    where:  { email: session.user.email },
    select: { id: true, role: true, name: true, email: true },
  })
  if (!operator) redirect('/eat')
  const roles = await readOperatorRoles(operator.id, operator.role)
  if (!roles.includes('admin')) redirect('/eat')

  const identity = buildAdminIdentity(operator)
  const flags = {
    influencer: isInfluencerEnabled(),
    prestataire: isPrestataireEnabled(),
    logistics: isCourierActivationEnabled(),
  }
  const ov = await computeAdminOverview()
  const chTotal = ov.channels.reduce((s, c) => s + c.count, 0)
  const chLabel = (key: string) => {
    const label = t(`channel.${key}` as 'channel.delivery')
    return label === `channel.${key}` ? key : label
  }

  return (
    <AdminShell identity={identity} flags={flags}>
      <section>
        <div className="op-dash__head ov-head">
          <div>
            <h1 className="op-dash__title">{t('title')}</h1>
            <p className="op-dash__sub">{t('subtitle')}</p>
          </div>
          <span className="ro-badge"><span className="ms" aria-hidden="true">visibility</span>{t('readOnly')}</span>
        </div>

        {!ov.hasData ? (
          <div className="op-card"><div className="op-emptyline">
            <span className="ms" aria-hidden="true">query_stats</span>
            <b>{t('emptyTitle')}</b>
            <span>{t('emptyBody')}</span>
          </div></div>
        ) : (
          <>
            {/* KPIs — no delta (no 2nd real window → no fabricated trend) */}
            <div className="kpi-grid">
              <Kpi icon="storefront"  label={t('kpiRestaurants')} value={String(ov.restaurantsActive)} />
              <Kpi icon="receipt_long" label={t('kpiOrders')}     value={String(ov.orders24h)} />
              <Kpi icon="payments"    label={t('kpiGmv')}         value={formatMoney(ov.grossCents, locale)} mono />
              <Kpi icon="person_add"  label={t('kpiUsers')}       value={String(ov.newUsers7d)} />
            </div>

            <div className="ov-cols">
              {/* GMV decomposition — the golden equation from real stored sums */}
              <div className="op-card ov-card">
                <h3>{t('gmvTitle')}</h3>
                <div className="hint">{t('gmvHint')}</div>
                {ov.grossCents === 0 ? (
                  <p className="ov-none">{t('gmvNone')}</p>
                ) : (
                  <>
                    <div className="gmv-bar">
                      <i style={{ width: `${ov.commissionPct ?? 0}%`, background: '#4C63D2' }} />
                      <i style={{ width: `${100 - (ov.commissionPct ?? 0)}%`, background: '#41BD78' }} />
                    </div>
                    <div className="gmv-legend">
                      <div className="row"><span className="sw" style={{ background: '#101828' }} /><span className="nm"><b>{t('gmvGross')}</b></span><span className="vv mono">{formatMoney(ov.grossCents, locale)}</span></div>
                      <div className="row"><span className="sw" style={{ background: '#4C63D2' }} /><span className="nm">{ov.commissionPct != null ? t('gmvCommissionPct', { pct: ov.commissionPct }) : t('gmvCommission')}</span><span className="vv mono">{formatMoney(ov.commissionCents, locale)}</span></div>
                      <div className="row"><span className="sw" style={{ background: '#41BD78' }} /><span className="nm">{t('gmvNet')}</span><span className="vv mono">{formatMoney(ov.netCents, locale)}</span></div>
                    </div>
                    <div className="gmv-eq">
                      <span className="mono">{formatMoney(ov.grossCents, locale)}</span><span className="op">=</span>
                      <span className="mono">{formatMoney(ov.commissionCents, locale)}</span><span className="op">+</span>
                      <span className="mono">{formatMoney(ov.netCents, locale)}</span>
                    </div>
                  </>
                )}
              </div>

              {/* Volume by channel — real LedgerEntry.channel distribution */}
              <div className="op-card ov-card">
                <h3>{t('channelsTitle')}</h3>
                <div className="hint">{t('channelsHint')}</div>
                {ov.channels.length === 0 ? (
                  <p className="ov-none">{t('channelsNone')}</p>
                ) : (
                  ov.channels.map((c) => {
                    const pct = chTotal > 0 ? Math.round((c.count / chTotal) * 100) : 0
                    return (
                      <div className="ch-row" key={c.key}>
                        <span className="ch-ic"><span className="ms" aria-hidden="true">{CH_ICON[c.key] ?? 'receipt_long'}</span></span>
                        <div className="ch-m">
                          <div className="top"><b>{chLabel(c.key)}</b><span className="n mono">{c.count} · {pct} %</span></div>
                          <div className="ch-track"><i style={{ width: `${pct}%` }} /></div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            {/* À superviser — real open-queue counts */}
            <div className="op-card ov-card">
              <h3>{t('superviseTitle')}</h3>
              <div className="hint">{t('superviseHint')}</div>
              <div className="sup-list">
                <SupItem tone="warn" icon="verified_user" title={t('supApprovals')} sub={t('supApprovalsSub')} n={ov.pendingApprovals} href="/admin/approvals" />
                <SupItem tone="dang" icon="flag" title={t('supClaims')} sub={t('supClaimsSub')} n={ov.openClaims} href="/admin/claims" />
                <SupItem tone="info" icon="account_balance" title={t('supReconcile')} sub={t('supReconcileSub')} n={ov.toReconcile} href="/admin/reconciliation" />
              </div>
            </div>
          </>
        )}
      </section>
    </AdminShell>
  )
}

function Kpi({ icon, label, value, mono }: { icon: string; label: string; value: string; mono?: boolean }) {
  return (
    <div className="op-card kpi">
      <div className="kpi__top"><span className="kpi__ic"><span className="ms" aria-hidden="true">{icon}</span></span><span className="kpi__label">{label}</span></div>
      <div className={`kpi__val${mono ? ' mono' : ''}`}>{value}</div>
    </div>
  )
}

function SupItem({
  tone, icon, title, sub, n, href,
}: {
  tone: 'warn' | 'dang' | 'info'; icon: string; title: string; sub: string; n: number; href?: string
}) {
  const inner = (
    <>
      <span className={`sup-item__ic ${tone}`}><span className="ms" aria-hidden="true">{icon}</span></span>
      <div className="sup-item__m"><b>{title}</b><span>{sub}</span></div>
      <span className="sup-item__n mono">{n}</span>
      {href && <span className="ms go flip-rtl" aria-hidden="true">chevron_right</span>}
    </>
  )
  return href
    ? <Link href={href} className="sup-item">{inner}</Link>
    : <div className="sup-item is-static">{inner}</div>
}
