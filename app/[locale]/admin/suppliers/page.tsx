import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Truck, Building2, BadgeCheck, ShieldCheck, Clock3 } from 'lucide-react'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { readOperatorRoles } from '@/lib/operator-roles'
import { Card, Badge, EmptyState } from '@/components/design-system'
import type { BadgeTone } from '@/components/design-system'
import SupplierStatusActions from '@/components/admin/SupplierStatusActions'

// ── /admin/suppliers — ADMIN supplier moderation console (Agent 85) ──────────────
// ADMIN-only (triple-gated: middleware /admin, this server role re-check, and the
// status endpoint re-checks admin too). READ-ONLY listing of suppliers + their stored
// vetting / registry-verification VERDICT (displayed, NEVER recomputed) + activate/
// suspend buttons that call the EXISTING POST /api/supplier/admin/status. NON-MONEY:
// changing a business status only gates visibility/catalogue — payouts stay hard-gated
// by Stripe Connect KYB. NO payment/Connect surface here.
export const dynamic = 'force-dynamic'

export default async function AdminSuppliersPage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)
  const t = await getTranslations('admin.suppliers')
  const locale = props.params.locale

  const session = await getServerSession(authOptions)
  if (!session?.user?.email) redirect('/auth/magic')
  const operator = await prisma.operator.findUnique({ where: { email: session.user.email }, select: { id: true, role: true } })
  if (!operator) redirect('/eat')
  const roles = await readOperatorRoles(operator.id, operator.role)
  if (!roles.includes('admin')) redirect('/eat')

  const suppliers = await prisma.supplierProfile.findMany({
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true, email: true, companyName: true, contactName: true, city: true,
      status: true, vettingVerdict: true, vettingReason: true,
      verificationStatus: true, siren: true, officialName: true, createdAt: true,
    },
  })

  const fmtDate = (d: Date) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(d)
  const statusTone = (s: string): BadgeTone =>
    s === 'active' ? 'success' : s === 'pending' ? 'warning' : s === 'suspended' ? 'danger' : 'neutral'
  const verdictTone = (v: string | null): BadgeTone =>
    v === 'legit' ? 'success' : v === 'doubt' ? 'warning' : v === 'bad' ? 'danger' : 'neutral'
  const verifTone = (v: string | null): BadgeTone =>
    v === 'verified' ? 'success' : v === 'review' ? 'warning' : v === 'rejected' ? 'danger' : 'neutral'
  const statusLabel = (s: string) => t(`status_${s}` as 'status_pending')
  const verdictLabel = (v: string | null) => t(`verdict_${v ?? 'unknown'}` as 'verdict_unknown')
  const verifLabel = (v: string | null) => t(`verif_${v ?? 'unknown'}` as 'verif_unknown')

  return (
    <div className="mx-auto max-w-3xl px-5 py-6 space-y-6">
      <header className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-grubano-lg bg-grubano-primary/15 text-grubano-primary">
          <Truck size={20} />
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold text-grubano-ink">{t('title')}</h1>
          <p className="text-sm text-grubano-ink-muted">{t('subtitle')}</p>
        </div>
      </header>

      {suppliers.length === 0 ? (
        <EmptyState emoji="📦" title={t('emptyTitle')} description={t('emptyBody')} />
      ) : (
        <ul className="space-y-3">
          {suppliers.map((s) => (
            <li key={s.id}>
              <Card elevation="sm" padding="md">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-grubano-ink">
                      <span className="truncate">{s.companyName}</span>
                      <Badge tone={statusTone(s.status)} size="sm">{statusLabel(s.status)}</Badge>
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-grubano-ink-muted">
                      <span className="inline-flex items-center gap-1"><Building2 size={13} className="shrink-0" />{s.contactName}{s.city ? ` · ${s.city}` : ''}</span>
                      <span className="break-all">{s.email}</span>
                      <span className="inline-flex items-center gap-1">
                        {t('siren')}: {s.siren ? <span className="font-medium text-grubano-ink">{s.siren}</span> : t('sirenNone')}
                      </span>
                      <span className="inline-flex items-center gap-1"><Clock3 size={13} className="shrink-0" />{fmtDate(s.createdAt)}</span>
                    </p>
                    {s.officialName && (
                      <p className="mt-0.5 text-xs text-grubano-ink-muted truncate">{s.officialName}</p>
                    )}
                    <p className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge tone={verdictTone(s.vettingVerdict)} size="sm" icon={<BadgeCheck size={12} />}>{verdictLabel(s.vettingVerdict)}</Badge>
                      <Badge tone={verifTone(s.verificationStatus)} size="sm" icon={<ShieldCheck size={12} />}>{verifLabel(s.verificationStatus)}</Badge>
                    </p>
                    {s.vettingReason && (
                      <p className="mt-1 text-xs text-grubano-ink-muted italic">{s.vettingReason}</p>
                    )}
                  </div>
                  <SupplierStatusActions
                    email={s.email}
                    status={s.status}
                    activateLabel={t('activate')}
                    suspendLabel={t('suspend')}
                    errorLabel={t('actionError')}
                  />
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
