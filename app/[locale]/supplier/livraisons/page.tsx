import { getServerSession } from 'next-auth'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EmptyState } from '@/components/design-system'
import SupplierShell from '@/components/supplier/SupplierShell'
import { buildSupplierIdentity } from '@/lib/supplier-identity'
import './supplier-livraisons.css'

// ── /supplier/livraisons — CD v1 Lot 4b, HONEST INERT PREVIEW. ────────────────────
// No delivery model exists (only SupplyOrder.status + desiredDate), so this screen is
// READ-ONLY: a clear "Aperçu — bientôt" banner + PLANNED deliveries derived from the
// real confirmed/preparing/delivered orders (owner-scoped by session email). NO
// fabricated tracking / courier / timeslot / street address, NO functional workflow
// (that lives on /supplier/orders). Rendered fully server-side (no interactivity).
// A real delivery module = STOP-design migration, not built here.
export const dynamic = 'force-dynamic'

const AV_GRADS = [
  'linear-gradient(135deg,#D5372A,#A8281D)', 'linear-gradient(135deg,#FF8A3D,#F2570E)',
  'linear-gradient(135deg,#3E5A7D,#1B3A5E)', 'linear-gradient(135deg,#E8A63D,#B9740A)',
  'linear-gradient(135deg,#41BD78,#1E9E57)', 'linear-gradient(135deg,#6E56CF,#8B74E0)',
]
function initials(name: string | null | undefined): string {
  const p = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!p.length) return '—'
  return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[1][0]).toUpperCase()
}
function gradFor(seed: string): string {
  let h = 0; for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AV_GRADS[h % AV_GRADS.length]
}
// real order status → delivery-style label/class (no invented "shipped" state)
const DELIV: Record<string, { cls: string; key: 'statusToPrep' | 'statusInProgress' | 'statusDelivered' }> = {
  confirmed: { cls: 'prep',      key: 'statusToPrep' },
  preparing: { cls: 'shipped',   key: 'statusInProgress' },
  delivered: { cls: 'delivered', key: 'statusDelivered' },
}

export default async function SupplierLivraisonsPage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)
  const locale = props.params.locale
  const t  = await getTranslations('supplier')
  const td = await getTranslations('supplierDeliv')

  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) {
    return <div className="mx-auto max-w-xl px-5 pt-12"><EmptyState emoji="🔒" title={t('noProfileTitle')} description={t('noProfileBody')} /></div>
  }
  const profile = await prisma.supplierProfile.findUnique({ where: { email } }).catch(() => null)
  if (!profile) {
    return <div className="mx-auto max-w-xl px-5 pt-12"><EmptyState emoji="📦" title={t('noProfileTitle')} description={t('noProfileBody')} /></div>
  }

  // Planned deliveries = real accepted orders (confirmed/preparing/delivered), scoped.
  const rows = await prisma.supplyOrder.findMany({
    where:   { supplierProfileId: profile.id, status: { in: ['confirmed', 'preparing', 'delivered'] } },
    orderBy: { createdAt: 'desc' },
    take:    200,
    select: {
      id: true, status: true, desiredDate: true, createdAt: true,
      operator: { select: { name: true, city: true } },
      lines:    { select: { quantity: true } },
    },
  }).catch(() => [])

  const now = new Date()
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const kpiPrep = rows.filter((r) => r.status === 'confirmed').length
  const kpiProg = rows.filter((r) => r.status === 'preparing').length
  const kpiDone = rows.filter((r) => r.status === 'delivered' && r.createdAt >= startToday).length
  const fmtDate = (d: Date) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' }).format(d)

  return (
    <SupplierShell identity={buildSupplierIdentity(profile)}>
      <section className="sup-dl">
        <div className="op-dash__head"><h1 className="op-dash__title">{td('title')}</h1></div>

        <div className="preview-banner">
          <span className="ms">auto_awesome</span>
          <div><b>{td('previewTitle')}</b><span>{td('previewBody')}</span></div>
        </div>

        {rows.length === 0 ? (
          <div className="op-card"><div className="op-emptyline">
            <span className="ms">local_shipping</span>
            <b>{td('emptyTitle')}</b>
            <span>{td('emptyBody')}</span>
          </div></div>
        ) : (
          <>
            <div className="op-card stat-strip">
              <div className="stat"><span className="lbl">{td('kpiToPrep')}</span><b>{kpiPrep}</b></div>
              <div className="stat"><span className="lbl">{td('kpiInProgress')}</span><b>{kpiProg}</b></div>
              <div className="stat"><span className="lbl">{td('kpiDeliveredToday')}</span><b>{kpiDone}</b></div>
            </div>

            <div className="op-card">
              {rows.map((r) => {
                const meta = DELIV[r.status] ?? DELIV.confirmed
                const items = r.lines.reduce((s, l) => s + l.quantity, 0)
                const sub = [r.operator?.city, r.desiredDate ? td('plannedFor', { date: fmtDate(r.desiredDate) }) : null].filter(Boolean).join(' · ')
                return (
                  <div key={r.id} className="dl-row">
                    <span className="dl-row__av" style={{ background: gradFor(r.operator?.name || r.id) }}>{initials(r.operator?.name)}</span>
                    <div className="dl-row__m"><b>{r.operator?.name ?? '—'}</b><span>{sub || '—'}</span></div>
                    <span className="qty">{td('itemsCount', { count: items })}</span>
                    <span className={`dl-status ${meta.cls}`}><i className="dot" />{td(meta.key)}</span>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </section>
    </SupplierShell>
  )
}
