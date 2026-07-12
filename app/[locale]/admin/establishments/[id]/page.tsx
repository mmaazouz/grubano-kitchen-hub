import { redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { resolveAdmin } from '@/lib/admin-guard'
import { buildAdminIdentity } from '@/lib/admin-identity'
import { getAdminRestaurantDetail } from '@/lib/admin-establishments'
import { formatMoney } from '@/lib/format-money'
import { isInfluencerEnabled } from '@/lib/influencer-verification'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import { isCourierActivationEnabled } from '@/lib/logistics-account'
import AdminShell from '@/components/admin/AdminShell'
import { Link } from '@/navigation'
import '../establishments.css'

// ── /admin/establishments/[id] — establishment fiche (CD ADM2). ──────────────────
// READ-ONLY, admin-only. Real Restaurant fields + owner + real 30-day GMV/orders +
// real per-channel commission (resolveCommissionRate) + real rating/claims. HONEST
// OMISSIONS: phone (not on Restaurant), plan/« Formule »/price (no column). « Suspendre »
// is a disabled « bientôt » control (suspension deferred). « Voir la fiche publique »
// links to the real /eat/r/[id].

export const dynamic = 'force-dynamic'

export default async function AdminEstablishmentDetailPage(props: { params: { locale: string; id: string } }) {
  const { locale, id } = props.params
  setRequestLocale(locale)
  const t = await getTranslations('adminEstablishments')

  const admin = await resolveAdmin()
  if (!admin) redirect('/eat')

  const identity = buildAdminIdentity(admin)
  const flags = {
    influencer: isInfluencerEnabled(),
    prestataire: isPrestataireEnabled(),
    logistics: isCourierActivationEnabled(),
  }
  const d = await getAdminRestaurantDetail(id)

  const initials =
    (d?.name ?? '?').trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '?'
  const fmtDate = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'Europe/Paris' }).format(new Date(iso))
  const pct = (r: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(r * 100)
  const statusLabel = (s: string) => (s === 'active' ? t('stActive') : s === 'pending' ? t('stPending') : t('stPaused'))
  const pillClass = (s: string) => (s === 'active' ? 'open' : s === 'pending' ? 'pending' : 'closed')

  return (
    <AdminShell identity={identity} flags={flags}>
      <section>
        <Link href="/admin/establishments" className="op-back">
          <span className="ms flip-rtl" aria-hidden="true">arrow_back</span>{t('back')}
        </Link>

        {!d ? (
          <div className="op-card op-center" style={{ minHeight: 420 }}>
            <div className="op-error__card">
              <span className="ms" aria-hidden="true">storefront</span>
              <h2>{t('notFoundTitle')}</h2>
              <p>{t('notFoundBody')}</p>
              <Link href="/admin/establishments" className="op-btn-ghost">
                <span className="ms flip-rtl" aria-hidden="true">arrow_back</span>{t('back')}
              </Link>
            </div>
          </div>
        ) : (
          <>
            <div className="op-card es-dt-top">
              <span className="es-dt-logo" style={{ background: 'linear-gradient(135deg,#5B6EE1,#33409E)' }}>{initials}</span>
              <div className="es-dt-m">
                <h2>{d.name}</h2>
                <div className="sub">
                  <span><span className="ms" aria-hidden="true">place</span>{d.address}</span>
                  {d.brandName && <span><span className="ms" aria-hidden="true">sell</span>{d.brandName}</span>}
                  <span className={`pill ${pillClass(d.status)}`}><i className="dot" />{statusLabel(d.status)}</span>
                </div>
              </div>
              <div className="es-dt-actions">
                <Link href={`/eat/r/${d.id}`} className="op-btn-ghost"><span className="ms" aria-hidden="true">open_in_new</span>{t('viewPublic')}</Link>
                <div className="act-soon"><span className="ms" aria-hidden="true">block</span>{t('suspend')} <span className="soon">{t('soon')}</span></div>
              </div>
            </div>

            <div className="es-cols">
              <div>
                <div className="op-card es-sec">
                  <h3><span className="ms" aria-hidden="true">info</span>{t('infoTitle')}</h3>
                  <div className="info-row"><span className="k">{t('infoName')}</span><span className="v">{d.name}</span></div>
                  {d.owner?.name && <div className="info-row"><span className="k">{t('infoOwner')}</span><span className="v">{d.owner.name}</span></div>}
                  {d.owner?.email && <div className="info-row"><span className="k">{t('infoEmail')}</span><span className="v mono">{d.owner.email}</span></div>}
                  {d.cuisine.length > 0 && <div className="info-row"><span className="k">{t('infoCuisine')}</span><span className="v">{d.cuisine.join(' · ')}</span></div>}
                  <div className="info-row"><span className="k">{t('infoRegistered')}</span><span className="v mono">{fmtDate(d.createdAt)}</span></div>
                </div>

                <div className="op-card es-sec">
                  <h3><span className="ms" aria-hidden="true">tune</span>{t('channelsTitle')}</h3>
                  <div className="info-row"><span className="k">{t('chDelivery')}</span><span className="v">{d.channels.delivery ? t('enabled') : t('disabled')}</span></div>
                  <div className="info-row"><span className="k">{t('chPickup')}</span><span className="v">{d.channels.pickup ? t('enabled') : t('disabled')}</span></div>
                  <div className="info-row"><span className="k">{t('chReservation')}</span><span className="v">{d.channels.reservation ? t('enabled') : t('disabled')}</span></div>
                  <div className="info-row"><span className="k">{t('commissionLabel')}</span><span className="v mono">{t('commissionValue', { delivery: pct(d.commission.delivery), pickup: pct(d.commission.pickup), dinein: pct(d.commission.dinein) })}</span></div>
                </div>
              </div>

              <div>
                <div className="es-kpis">
                  <div className="op-card es-kpi"><div className="l">{t('kpiGmv')}</div><div className="v">{formatMoney(d.gmv30Cents, locale)}</div></div>
                  <div className="op-card es-kpi"><div className="l">{t('kpiOrders')}</div><div className="v">{d.orders30}</div></div>
                  <div className="op-card es-kpi"><div className="l">{t('kpiRating')}</div><div className="v">{d.rating != null ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(d.rating)} ★` : t('ratingNone')}</div></div>
                  <div className="op-card es-kpi"><div className="l">{t('kpiClaims')}</div><div className="v">{d.openClaims}</div></div>
                </div>
              </div>
            </div>
          </>
        )}
      </section>
    </AdminShell>
  )
}
