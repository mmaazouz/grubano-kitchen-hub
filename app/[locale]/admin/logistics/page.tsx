import { redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { resolveAdmin } from '@/lib/admin-guard'
import { buildAdminIdentity } from '@/lib/admin-identity'
import { isInfluencerEnabled } from '@/lib/influencer-verification'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import { isCourierActivationEnabled } from '@/lib/logistics-account'
import { prisma } from '@/lib/prisma'
import AdminShell from '@/components/admin/AdminShell'
import LogisticsActivationAction from '@/components/admin/LogisticsActivationAction'

// ── /admin/logistics — ADMIN courier activation console (Agent 125) ──────────────
// ADM6 harmonisation: AdminShell navy console + the --op- moderation card gabarit.
// PRESENTATION ONLY — the query, the read-only justificatifs, the LOGISTICS_COURIER_
// ACTIVATION_ENABLED master guardrail (banner when OFF; everyone stays on the waitlist)
// and the wired LogisticsActivationAction (STRICT NO-OP unless the flag is ON) are
// UNCHANGED. Admin-only (resolveAdmin — equivalent to the prior inline gate). NO payment
// surface here.
export const dynamic = 'force-dynamic'

export default async function AdminLogisticsPage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)
  const t = await getTranslations('admin.logistics')
  const locale = props.params.locale

  const admin = await resolveAdmin()
  if (!admin) redirect('/eat')

  const identity = buildAdminIdentity(admin)
  const flags = {
    influencer: isInfluencerEnabled(),
    prestataire: isPrestataireEnabled(),
    logistics: isCourierActivationEnabled(),
  }

  const activationEnabled = isCourierActivationEnabled()

  const couriers = await prisma.logisticsProfile.findMany({
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true, email: true, contactName: true, officialName: true, siren: true,
      status: true, createdAt: true,
      justificatifsStatus: true, insuranceInsurer: true, insurancePolicyNumber: true,
      insuranceExpiry: true, rcProInsurer: true, rcProPolicyNumber: true,
    },
  })

  const fmtDate = (d: Date) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d)
  const pill = (tone: string) => (tone === 'neutral' ? 'op-pill' : `op-pill is-${tone}`)
  const statusTone = (s: string) =>
    s === 'active' ? 'success' : s === 'pending' ? 'warning' : s === 'suspended' ? 'danger' : 'neutral'
  const justTone = (s: string) =>
    s === 'verified' ? 'success' : s === 'submitted' ? 'warning' : 'neutral'
  const statusLabel = (s: string) => t(`status_${s}` as 'status_pending')
  const justLabel = (s: string) => t(`just_${s}` as 'just_none')

  return (
    <AdminShell identity={identity} flags={flags}>
      <section>
        <div className="op-dash__head">
          <h1 className="op-dash__title">{t('title')}</h1>
          <p className="op-dash__sub">{t('subtitle')}</p>
        </div>

        {/* ⭐ Master guardrail state — when OFF, activation is impossible; everyone stays on the waitlist. */}
        {!activationEnabled && (
          <div className="op-notice is-warning">
            <span className="ms" aria-hidden="true">lock</span>
            <div>
              <b>{t('disabledTitle')}</b>
              <p>{t('disabledBody')}</p>
            </div>
          </div>
        )}

        {couriers.length === 0 ? (
          <div className="op-card"><div className="op-empty">
            <span className="ic"><span className="ms" aria-hidden="true">two_wheeler</span></span>
            <b>{t('emptyTitle')}</b><span>{t('emptyBody')}</span>
          </div></div>
        ) : (
          <div className="mod-list">
            {couriers.map((c) => (
              <div className="op-card mod-card" key={c.id}>
                <div className="mod-card__top">
                  <span className="mod-ic is-info"><span className="ms" aria-hidden="true">two_wheeler</span></span>
                  <div className="mod-card__m">
                    <h3>
                      <span className="nm">{c.officialName || c.contactName}</span>
                      <span className={pill(statusTone(c.status))}>{statusLabel(c.status)}</span>
                      <span className={pill(justTone(c.justificatifsStatus))}><span className="ms" aria-hidden="true">fact_check</span>{justLabel(c.justificatifsStatus)}</span>
                    </h3>
                    <div className="mod-card__meta">
                      <span><span className="ms" aria-hidden="true">person</span>{c.contactName}</span>
                      <span className="brk">{c.email}</span>
                      <span><span className="ms" aria-hidden="true">tag</span>{c.siren ?? t('sirenNone')}</span>
                      <span><span className="ms" aria-hidden="true">schedule</span>{fmtDate(c.createdAt)}</span>
                    </div>
                    {/* Declared justificatifs (read-only) */}
                    {c.justificatifsStatus !== 'none' && (
                      <div className="mod-card__meta" style={{ marginTop: 6 }}>
                        <span><span className="ms" aria-hidden="true">shield</span>{t('insurance')}: {c.insuranceInsurer ?? '—'} {c.insurancePolicyNumber ? `· ${c.insurancePolicyNumber}` : ''} {c.insuranceExpiry ? `· ${c.insuranceExpiry}` : ''}</span>
                        <span>{t('rcPro')}: {c.rcProInsurer ?? '—'} {c.rcProPolicyNumber ? `· ${c.rcProPolicyNumber}` : ''}</span>
                      </div>
                    )}
                  </div>
                </div>
                {/* Activate only when there is a declaration to verify and the account is not yet active. */}
                {c.status !== 'active' && (c.justificatifsStatus === 'submitted' || c.justificatifsStatus === 'verified') && (
                  <div className="mod-actions">
                    <LogisticsActivationAction
                      email={c.email}
                      label={t('activate')}
                      errorLabel={t('actionError')}
                      disabledLabel={t('activateDisabled')}
                    />
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
