import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { ShieldCheck, Store, Building2, MapPin, Mail, Phone, Clock3 } from 'lucide-react'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { readOperatorRoles } from '@/lib/operator-roles'
import { Card, Badge, EmptyState } from '@/components/design-system'
import ApprovalActions from '@/components/admin/ApprovalActions'

// ── /admin/approvals — admin approval console (B2.4 / SEC2, Agent 33) ──────────
// ADMIN-only console wiring the two manual-approval gates of the platform:
//   1. Establishments awaiting their FIRST publication (isActive=false AND
//      approvedAt=null AND archivedAt=null) — the only way a never-approved resto
//      comes online (the SEC1 invariant: an owner can never self-publish one).
//      "Approuver & publier" → POST /api/admin/restaurants/[id]/approve.
//   2. Franchise applications still pending → "Approuver" calls the EXISTING
//      POST /api/franchise/approve { applicationId } (B1.3-A backend, untouched).
//
// Renders inside the operator chrome (NOT in AppChrome BARE_PREFIXES → default
// sidebar) — no new chrome. Triple-gated: middleware (admin), this server check
// (role SET via readOperatorRoles), and each endpoint re-checks the session admin.
export const dynamic = 'force-dynamic'

export default async function AdminApprovalsPage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)
  const t = await getTranslations('admin.approvals')
  const locale = props.params.locale

  const session = await getServerSession(authOptions)
  if (!session?.user?.email) redirect('/auth/magic')

  // Defence in depth — middleware already gates /admin to admin. Re-resolve the
  // role SET server-side (tolerant reader) and bounce a non-admin to the public
  // consumer app (always renders → no redirect loop).
  const operator = await prisma.operator.findUnique({
    where:  { email: session.user.email },
    select: { id: true, role: true },
  })
  if (!operator) redirect('/eat')
  const roles = await readOperatorRoles(operator.id, operator.role)
  if (!roles.includes('admin')) redirect('/eat')

  const [pendingRestaurants, pendingApplications] = await Promise.all([
    prisma.restaurant.findMany({
      where:   { isActive: false, approvedAt: null, archivedAt: null },
      orderBy: { createdAt: 'asc' },
      select:  {
        id: true, name: true, city: true, createdAt: true,
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
    <div className="mx-auto max-w-3xl px-5 py-6 space-y-8">
      <header className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-grubano-lg bg-grubano-primary/15 text-grubano-primary">
          <ShieldCheck size={20} />
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold text-grubano-ink">{t('title')}</h1>
          <p className="text-sm text-grubano-ink-muted">{t('subtitle')}</p>
        </div>
      </header>

      {/* ── Section 1 — establishments awaiting first publication ─────────────── */}
      <section aria-labelledby="admin-resto-heading" className="space-y-3">
        <div className="flex items-center gap-2">
          <Store size={16} className="text-grubano-ink-muted" />
          <h2 id="admin-resto-heading" className="font-display text-lg font-bold text-grubano-ink">
            {t('restaurantsTitle')}
          </h2>
          <Badge tone="neutral" size="sm">{String(pendingRestaurants.length)}</Badge>
        </div>

        {pendingRestaurants.length === 0 ? (
          <EmptyState emoji="✅" title={t('restaurantsEmptyTitle')} description={t('restaurantsEmptyBody')} />
        ) : (
          <ul className="space-y-3">
            {pendingRestaurants.map((r) => (
              <li key={r.id}>
                <Card elevation="sm" padding="md">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-semibold text-grubano-ink truncate">{r.name}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-grubano-ink-muted">
                        <span className="inline-flex items-center gap-1"><MapPin size={13} className="shrink-0" />{r.city}</span>
                        <span className="inline-flex items-center gap-1 break-all"><Mail size={13} className="shrink-0" />{r.operator.email}</span>
                        <span className="inline-flex items-center gap-1"><Clock3 size={13} className="shrink-0" />{fmtDate(r.createdAt)}</span>
                      </p>
                    </div>
                    <ApprovalActions
                      endpoint={`/api/admin/restaurants/${r.id}/approve`}
                      label={t('approvePublish')}
                    />
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Section 2 — franchise applications awaiting approval ──────────────── */}
      <section aria-labelledby="admin-franchise-heading" className="space-y-3">
        <div className="flex items-center gap-2">
          <Building2 size={16} className="text-grubano-ink-muted" />
          <h2 id="admin-franchise-heading" className="font-display text-lg font-bold text-grubano-ink">
            {t('franchiseTitle')}
          </h2>
          <Badge tone="neutral" size="sm">{String(pendingApplications.length)}</Badge>
        </div>

        {pendingApplications.length === 0 ? (
          <EmptyState emoji="✅" title={t('franchiseEmptyTitle')} description={t('franchiseEmptyBody')} />
        ) : (
          <ul className="space-y-3">
            {pendingApplications.map((a) => (
              <li key={a.id}>
                <Card elevation="sm" padding="md">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="font-semibold text-grubano-ink truncate">{a.name}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-grubano-ink-muted">
                        <span className="inline-flex items-center gap-1"><Building2 size={13} className="shrink-0" />{a.brandName}</span>
                        <span className="inline-flex items-center gap-1"><MapPin size={13} className="shrink-0" />{a.city}</span>
                        <span className="inline-flex items-center gap-1 break-all"><Mail size={13} className="shrink-0" />{a.email}</span>
                        <span className="inline-flex items-center gap-1"><Phone size={13} className="shrink-0" />{a.phone}</span>
                        <span className="inline-flex items-center gap-1"><Clock3 size={13} className="shrink-0" />{fmtDate(a.createdAt)}</span>
                      </p>
                    </div>
                    <ApprovalActions
                      endpoint="/api/franchise/approve"
                      body={{ applicationId: a.id }}
                      label={t('approveFranchise')}
                    />
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
