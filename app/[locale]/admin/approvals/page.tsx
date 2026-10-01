import { redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { resolveAdmin } from '@/lib/admin-guard'
import { buildAdminIdentity } from '@/lib/admin-identity'
import { isInfluencerEnabled } from '@/lib/influencer-verification'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import { isCourierActivationEnabled } from '@/lib/logistics-account'
import { prisma } from '@/lib/prisma'
import AdminShell from '@/components/admin/AdminShell'
import ApprovalActions from '@/components/admin/ApprovalActions'

// ── /admin/approvals — admin approval console (B2.4 / SEC2, Agent 33) ──────────
// ADM6 harmonisation: AdminShell navy console + the --op- moderation card gabarit.
// PRESENTATION ONLY — the two manual-approval gates (establishments awaiting first
// publication → POST /api/admin/restaurants/[id]/approve; pending franchise
// applications → POST /api/franchise/approve) are UNCHANGED, and ApprovalActions is
// dropped in verbatim (still wired + functional). Admin-only (resolveAdmin — equivalent
// to the prior inline triple-gate; middleware still gates /admin, each endpoint
// re-checks the admin session).
export const dynamic = 'force-dynamic'

export default async function AdminApprovalsPage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)
  const t = await getTranslations('admin.approvals')
  const locale = props.params.locale

  const admin = await resolveAdmin()
  if (!admin) redirect('/eat')

  const identity = buildAdminIdentity(admin)
  const flags = {
    influencer: isInfluencerEnabled(),
    prestataire: isPrestataireEnabled(),
    logistics: isCourierActivationEnabled(),
  }

  const [pendingRestaurants, pendingApplications] = await Promise.all([
    prisma.restaurant.findMany({
      where:   { isActive: false, approvedAt: null, archivedAt: null },
      orderBy: { createdAt: 'asc' },
      select:  {
        id: true, name: true, city: true, createdAt: true,
        // LOT D (advisory admin) — Connect status surfaced on each pending card:
        // a restaurant approved WITHOUT an active connected account cannot cash
        // in a paid order (gate D5). Advisory ONLY — approval is NOT blocked.
        stripeAccountId: true, stripeAccountStatus: true,
        // WAVE 2 (advisory géo) — un resto approuvé SANS lat/lng est invisible du
        // tri par proximité conso. Advisory seulement, n'empêche pas l'approbation.
        lat: true, lng: true,
        operator: { select: { email: true } },
      },
    }),
    prisma.franchiseApplication.findMany({
      where:   { status: 'pending' },
      orderBy: { createdAt: 'asc' },
      select:  {
        id: true, name: true, brandName: true, city: true,
        email: true, phone: true, createdAt: true,
      },
    }),
  ])

  const fmtDate = (d: Date) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d)

  return (
    <AdminShell identity={identity} flags={flags}>
      <section>
        <div className="op-dash__head">
          <h1 className="op-dash__title">{t('title')}</h1>
          <p className="op-dash__sub">{t('subtitle')}</p>
        </div>

        {/* ── Section 1 — establishments awaiting first publication ─────────────── */}
        <section aria-labelledby="admin-resto-heading" style={{ marginBottom: 26 }}>
          <div className="mod-subhead">
            <span className="ms" aria-hidden="true">storefront</span>
            <h2 id="admin-resto-heading">{t('restaurantsTitle')}</h2>
            <span className="op-pill">{String(pendingRestaurants.length)}</span>
          </div>

          {pendingRestaurants.length === 0 ? (
            <div className="op-card"><div className="op-empty">
              <span className="ic"><span className="ms" aria-hidden="true">check_circle</span></span>
              <b>{t('restaurantsEmptyTitle')}</b><span>{t('restaurantsEmptyBody')}</span>
            </div></div>
          ) : (
            <div className="mod-list">
              {pendingRestaurants.map((r) => (
                <div className="op-card mod-card" key={r.id}>
                  <div className="mod-card__top">
                    <span className="mod-ic is-admin"><span className="ms" aria-hidden="true">storefront</span></span>
                    <div className="mod-card__m">
                      <h3><span className="nm">{r.name}</span></h3>
                      <div className="mod-card__meta">
                        <span><span className="ms" aria-hidden="true">place</span>{r.city}</span>
                        <span className="brk"><span className="ms" aria-hidden="true">mail</span>{r.operator.email}</span>
                        <span><span className="ms" aria-hidden="true">schedule</span>{fmtDate(r.createdAt)}</span>
                        {/* LOT D — indicateur ADVISORY Connect (gate D5) : n'empêche pas l'approbation. */}
                        {r.stripeAccountId && r.stripeAccountStatus === 'active' ? (
                          <span><span className="ms" aria-hidden="true">check_circle</span>{t('connectReady')}</span>
                        ) : (
                          <span className="brk" style={{ color: '#b45309' }}>
                            <span className="ms" aria-hidden="true">warning</span>{t('connectMissing')}
                          </span>
                        )}
                        {/* WAVE 2 — advisory géocodage : sans coords, l'établissement est
                            invisible du tri par proximité conso. N'empêche pas d'approuver. */}
                        {(r.lat == null || r.lng == null) && (
                          <span className="brk" style={{ color: '#b45309' }}>
                            <span className="ms" aria-hidden="true">location_off</span>{t('geoMissing')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="mod-actions">
                    <ApprovalActions
                      endpoint={`/api/admin/restaurants/${r.id}/approve`}
                      label={t('approvePublish')}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Section 2 — franchise applications awaiting approval ──────────────── */}
        <section aria-labelledby="admin-franchise-heading">
          <div className="mod-subhead">
            <span className="ms" aria-hidden="true">apartment</span>
            <h2 id="admin-franchise-heading">{t('franchiseTitle')}</h2>
            <span className="op-pill">{String(pendingApplications.length)}</span>
          </div>

          {pendingApplications.length === 0 ? (
            <div className="op-card"><div className="op-empty">
              <span className="ic"><span className="ms" aria-hidden="true">check_circle</span></span>
              <b>{t('franchiseEmptyTitle')}</b><span>{t('franchiseEmptyBody')}</span>
            </div></div>
          ) : (
            <div className="mod-list">
              {pendingApplications.map((a) => (
                <div className="op-card mod-card" key={a.id}>
                  <div className="mod-card__top">
                    <span className="mod-ic is-admin"><span className="ms" aria-hidden="true">apartment</span></span>
                    <div className="mod-card__m">
                      <h3><span className="nm">{a.name}</span></h3>
                      <div className="mod-card__meta">
                        <span><span className="ms" aria-hidden="true">business</span>{a.brandName}</span>
                        <span><span className="ms" aria-hidden="true">place</span>{a.city}</span>
                        <span className="brk"><span className="ms" aria-hidden="true">mail</span>{a.email}</span>
                        <span><span className="ms" aria-hidden="true">call</span>{a.phone}</span>
                        <span><span className="ms" aria-hidden="true">schedule</span>{fmtDate(a.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="mod-actions">
                    <ApprovalActions
                      endpoint="/api/franchise/approve"
                      body={{ applicationId: a.id }}
                      label={t('approveFranchise')}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </section>
    </AdminShell>
  )
}
