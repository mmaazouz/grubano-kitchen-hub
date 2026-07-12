import { notFound, redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { resolveAdmin } from '@/lib/admin-guard'
import { buildAdminIdentity } from '@/lib/admin-identity'
import { isInfluencerEnabled } from '@/lib/influencer-verification'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import { isCourierActivationEnabled } from '@/lib/logistics-account'
import { prisma } from '@/lib/prisma'
import AdminShell from '@/components/admin/AdminShell'
import PrestataireStatusActions from '@/components/admin/PrestataireStatusActions'
import PrestataireCoherenceAction from '@/components/admin/PrestataireCoherenceAction'

// ── /admin/prestataires — ADMIN prestataire moderation console (Agent 112) ──────────
// ADM6 harmonisation: AdminShell navy console + the --op- moderation card gabarit.
// PRESENTATION ONLY — calque of /admin/suppliers. The page-level PRESTATAIRE_ENABLED gate
// (404 when OFF → the role does not exist) is UNCHANGED and stays the FIRST check; the
// query, the stored vetting/verification VERDICT (displayed, NEVER recomputed) and both
// wired action components (PrestataireStatusActions → POST /api/prestataire/admin/status;
// PrestataireCoherenceAction → POST /api/admin/prestataires/coherence) are UNCHANGED.
// NON-MONEY: status/visibility only — no payout is even wired.
export const dynamic = 'force-dynamic'

export default async function AdminPrestatairesPage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)
  // Page-level flag gate (defence in depth — the whole role is OFF by default).
  if (!isPrestataireEnabled()) notFound()

  const t = await getTranslations('admin.prestataires')
  const locale = props.params.locale

  const admin = await resolveAdmin()
  if (!admin) redirect('/eat')

  const identity = buildAdminIdentity(admin)
  const flags = {
    influencer: isInfluencerEnabled(),
    prestataire: isPrestataireEnabled(),
    logistics: isCourierActivationEnabled(),
  }

  const prestataires = await prisma.prestataireProfile.findMany({
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true, email: true, companyName: true, contactName: true, city: true,
      status: true, marketplaceCoherencePending: true, vettingVerdict: true, vettingReason: true,
      verificationStatus: true, siren: true, officialName: true, createdAt: true,
    },
  })

  const fmtDate = (d: Date) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d)
  const pill = (tone: string) => (tone === 'neutral' ? 'op-pill' : `op-pill is-${tone}`)
  const statusTone = (s: string) =>
    s === 'active' ? 'success' : s === 'pending' ? 'warning' : s === 'suspended' ? 'danger' : 'neutral'
  const verdictTone = (v: string | null) =>
    v === 'legit' ? 'success' : v === 'doubt' ? 'warning' : v === 'bad' ? 'danger' : 'neutral'
  const verifTone = (v: string | null) =>
    v === 'verified' ? 'success' : v === 'review' ? 'warning' : v === 'rejected' ? 'danger' : 'neutral'
  const statusLabel = (s: string) => t(`status_${s}` as 'status_pending')
  const verdictLabel = (v: string | null) => t(`verdict_${v ?? 'unknown'}` as 'verdict_unknown')
  const verifLabel = (v: string | null) => t(`verif_${v ?? 'unknown'}` as 'verif_unknown')

  return (
    <AdminShell identity={identity} flags={flags}>
      <section>
        <div className="op-dash__head">
          <h1 className="op-dash__title">{t('title')}</h1>
          <p className="op-dash__sub">{t('subtitle')}</p>
        </div>

        {prestataires.length === 0 ? (
          <div className="op-card"><div className="op-empty">
            <span className="ic"><span className="ms" aria-hidden="true">handyman</span></span>
            <b>{t('emptyTitle')}</b><span>{t('emptyBody')}</span>
          </div></div>
        ) : (
          <div className="mod-list">
            {prestataires.map((p) => (
              <div className="op-card mod-card" key={p.id}>
                <div className="mod-card__top">
                  <span className="mod-ic is-info"><span className="ms" aria-hidden="true">handyman</span></span>
                  <div className="mod-card__m">
                    <h3>
                      <span className="nm">{p.companyName}</span>
                      <span className={pill(statusTone(p.status))}>{statusLabel(p.status)}</span>
                      {/* Coherence review queue (Agent 112): an ACTIVE prestataire still hidden from
                          the directory until the publication coherence check clears it. */}
                      {p.status === 'active' && p.marketplaceCoherencePending && (
                        <span className="op-pill is-warning"><span className="ms" aria-hidden="true">schedule</span>{t('coherencePending')}</span>
                      )}
                    </h3>
                    <div className="mod-card__meta">
                      <span><span className="ms" aria-hidden="true">person</span>{p.contactName}{p.city ? ` · ${p.city}` : ''}</span>
                      <span className="brk">{p.email}</span>
                      <span>{t('siren')}: {p.siren ? <span className="strong">{p.siren}</span> : t('sirenNone')}</span>
                      <span><span className="ms" aria-hidden="true">schedule</span>{fmtDate(p.createdAt)}</span>
                      {p.officialName && <span><span className="ms" aria-hidden="true">badge</span>{p.officialName}</span>}
                    </div>
                    <div className="mod-pillrow">
                      <span className={pill(verdictTone(p.vettingVerdict))}><span className="ms" aria-hidden="true">verified</span>{verdictLabel(p.vettingVerdict)}</span>
                      <span className={pill(verifTone(p.verificationStatus))}><span className="ms" aria-hidden="true">shield</span>{verifLabel(p.verificationStatus)}</span>
                    </div>
                    {p.vettingReason && <p className="mod-note">{p.vettingReason}</p>}
                  </div>
                </div>
                <div className="mod-actions">
                  <PrestataireStatusActions
                    email={p.email}
                    status={p.status}
                    activateLabel={t('activate')}
                    suspendLabel={t('suspend')}
                    errorLabel={t('actionError')}
                  />
                  {/* Approve coherence → make visible (Agent 112). Only when active-but-pending. */}
                  {p.status === 'active' && p.marketplaceCoherencePending && (
                    <PrestataireCoherenceAction
                      email={p.email}
                      label={t('coherenceApprove')}
                      errorLabel={t('actionError')}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </AdminShell>
  )
}
