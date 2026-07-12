import { redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { resolveAdmin } from '@/lib/admin-guard'
import { buildAdminIdentity } from '@/lib/admin-identity'
import { isInfluencerEnabled } from '@/lib/influencer-verification'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import { isCourierActivationEnabled } from '@/lib/logistics-account'
import { prisma } from '@/lib/prisma'
import AdminShell from '@/components/admin/AdminShell'
import SupplierStatusActions from '@/components/admin/SupplierStatusActions'
import SupplierCoherenceAction from '@/components/admin/SupplierCoherenceAction'

// ── /admin/suppliers — ADMIN supplier moderation console (Agent 85) ──────────────
// ADM6 harmonisation: AdminShell navy console + the --op- moderation card gabarit.
// PRESENTATION ONLY — the query, the stored vetting/verification VERDICT (displayed,
// NEVER recomputed) and both wired action components (SupplierStatusActions →
// POST /api/supplier/admin/status; SupplierCoherenceAction) are UNCHANGED. NON-MONEY:
// changing a business status only gates visibility/catalogue — payouts stay hard-gated
// by Stripe Connect KYB. Admin-only (resolveAdmin — equivalent to the prior inline gate).
export const dynamic = 'force-dynamic'

export default async function AdminSuppliersPage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)
  const t = await getTranslations('admin.suppliers')
  const locale = props.params.locale

  const admin = await resolveAdmin()
  if (!admin) redirect('/eat')

  const identity = buildAdminIdentity(admin)
  const flags = {
    influencer: isInfluencerEnabled(),
    prestataire: isPrestataireEnabled(),
    logistics: isCourierActivationEnabled(),
  }

  const suppliers = await prisma.supplierProfile.findMany({
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

        {suppliers.length === 0 ? (
          <div className="op-card"><div className="op-empty">
            <span className="ic"><span className="ms" aria-hidden="true">local_shipping</span></span>
            <b>{t('emptyTitle')}</b><span>{t('emptyBody')}</span>
          </div></div>
        ) : (
          <div className="mod-list">
            {suppliers.map((s) => (
              <div className="op-card mod-card" key={s.id}>
                <div className="mod-card__top">
                  <span className="mod-ic is-info"><span className="ms" aria-hidden="true">local_shipping</span></span>
                  <div className="mod-card__m">
                    <h3>
                      <span className="nm">{s.companyName}</span>
                      <span className={pill(statusTone(s.status))}>{statusLabel(s.status)}</span>
                      {/* Coherence review queue (Agent 111): an ACTIVE supplier still hidden from
                          the marketplace until the publication coherence check clears it. */}
                      {s.status === 'active' && s.marketplaceCoherencePending && (
                        <span className="op-pill is-warning"><span className="ms" aria-hidden="true">schedule</span>{t('coherencePending')}</span>
                      )}
                    </h3>
                    <div className="mod-card__meta">
                      <span><span className="ms" aria-hidden="true">person</span>{s.contactName}{s.city ? ` · ${s.city}` : ''}</span>
                      <span className="brk">{s.email}</span>
                      <span>{t('siren')}: {s.siren ? <span className="strong">{s.siren}</span> : t('sirenNone')}</span>
                      <span><span className="ms" aria-hidden="true">schedule</span>{fmtDate(s.createdAt)}</span>
                      {s.officialName && <span><span className="ms" aria-hidden="true">badge</span>{s.officialName}</span>}
                    </div>
                    <div className="mod-pillrow">
                      <span className={pill(verdictTone(s.vettingVerdict))}><span className="ms" aria-hidden="true">verified</span>{verdictLabel(s.vettingVerdict)}</span>
                      <span className={pill(verifTone(s.verificationStatus))}><span className="ms" aria-hidden="true">shield</span>{verifLabel(s.verificationStatus)}</span>
                    </div>
                    {s.vettingReason && <p className="mod-note">{s.vettingReason}</p>}
                  </div>
                </div>
                <div className="mod-actions">
                  <SupplierStatusActions
                    email={s.email}
                    status={s.status}
                    activateLabel={t('activate')}
                    suspendLabel={t('suspend')}
                    errorLabel={t('actionError')}
                  />
                  {/* Approve coherence → make visible (Agent 111). Only when active-but-pending. */}
                  {s.status === 'active' && s.marketplaceCoherencePending && (
                    <SupplierCoherenceAction
                      email={s.email}
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
