import { notFound, redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { resolveAdmin } from '@/lib/admin-guard'
import { buildAdminIdentity } from '@/lib/admin-identity'
import { isInfluencerEnabled, listVerificationRequests } from '@/lib/influencer-verification'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import { isCourierActivationEnabled } from '@/lib/logistics-account'
import AdminShell from '@/components/admin/AdminShell'
import InfluencerVerifyActions from '@/components/admin/InfluencerVerifyActions'

// ── /admin/influencer-verifications — admin audience-verification console (INF-1) ─────
// ADM6 harmonisation: AdminShell navy console + the --op- moderation card gabarit.
// PRESENTATION ONLY — the INFLUENCER_ENABLED gate (notFound when OFF → byte-identical)
// stays the FIRST check; listVerificationRequests() and the wired InfluencerVerifyActions
// (approve flips the affiliate's audienceVerified via /api/admin/influencer-verifications,
// which re-checks admin) are UNCHANGED. Admin-only (resolveAdmin — equivalent to the prior
// inline gate). NO money surface.
export const dynamic = 'force-dynamic'

export default async function AdminInfluencerVerificationsPage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)
  if (!isInfluencerEnabled()) notFound()
  const t = await getTranslations('admin.influencerVerif')
  const locale = props.params.locale

  const admin = await resolveAdmin()
  if (!admin) redirect('/eat')

  const identity = buildAdminIdentity(admin)
  const flags = {
    influencer: isInfluencerEnabled(),
    prestataire: isPrestataireEnabled(),
    logistics: isCourierActivationEnabled(),
  }

  const requests = await listVerificationRequests()
  const fmtDate = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso))
  const pill = (tone: string) => (tone === 'neutral' ? 'op-pill' : `op-pill is-${tone}`)
  const tone = (s: string) => (s === 'approved' ? 'success' : s === 'rejected' ? 'danger' : 'warning')
  const statusLabel = (s: string) => t(`status_${s}` as 'status_pending')

  return (
    <AdminShell identity={identity} flags={flags}>
      <section>
        <div className="op-dash__head">
          <h1 className="op-dash__title">{t('title')}</h1>
          <p className="op-dash__sub">{t('subtitle')}</p>
        </div>

        {requests.length === 0 ? (
          <div className="op-card"><div className="op-empty">
            <span className="ic"><span className="ms" aria-hidden="true">verified</span></span>
            <b>{t('emptyTitle')}</b><span>{t('emptyBody')}</span>
          </div></div>
        ) : (
          <div className="mod-list">
            {requests.map((r) => (
              <div className="op-card mod-card" key={r.id}>
                <div className="mod-card__top">
                  <span className="mod-ic is-admin"><span className="ms" aria-hidden="true">verified</span></span>
                  <div className="mod-card__m">
                    <h3>
                      <span className="nm">{r.operatorName ?? r.operatorEmail ?? r.operatorId}</span>
                      <span className={pill(tone(r.status))}>{statusLabel(r.status)}</span>
                    </h3>
                    <div className="mod-card__meta">
                      <span><span className="ms" aria-hidden="true">group</span>{r.platform} · {r.handle} · {r.declaredFollowers.toLocaleString(locale)}</span>
                      {r.proofUrl && (
                        <a href={r.proofUrl} target="_blank" rel="noopener noreferrer" className="brk">
                          <span className="ms" aria-hidden="true">link</span>{t('proof')}
                        </a>
                      )}
                      <span><span className="ms" aria-hidden="true">schedule</span>{fmtDate(r.createdAt)}</span>
                    </div>
                  </div>
                </div>
                {r.status === 'pending' && (
                  <div className="mod-actions">
                    <InfluencerVerifyActions id={r.id} approveLabel={t('approve')} rejectLabel={t('reject')} />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </AdminShell>
  )
}
