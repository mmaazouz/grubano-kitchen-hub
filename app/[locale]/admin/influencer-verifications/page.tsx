import { notFound, redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { BadgeCheck, Users2, Link2, Clock3 } from 'lucide-react'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { readOperatorRoles } from '@/lib/operator-roles'
import { Card, Badge, EmptyState } from '@/components/design-system'
import { isInfluencerEnabled, listVerificationRequests } from '@/lib/influencer-verification'
import InfluencerVerifyActions from '@/components/admin/InfluencerVerifyActions'

// ── /admin/influencer-verifications — admin audience-verification console (INF-1) ─────
// ADMIN-only. Lists affiliate audience-verification requests; approve flips the affiliate's
// audienceVerified (the /api/admin/influencer-verifications route re-checks admin + applies
// the grant). notFound() when INFLUENCER_ENABLED is OFF → byte-identical. Triple-gated:
// middleware (/admin), this server role re-check, and the endpoint. NO money surface.
export const dynamic = 'force-dynamic'

export default async function AdminInfluencerVerificationsPage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)
  if (!isInfluencerEnabled()) notFound()
  const t = await getTranslations('admin.influencerVerif')
  const locale = props.params.locale

  const session = await getServerSession(authOptions)
  if (!session?.user?.email) redirect('/auth/magic')
  const operator = await prisma.operator.findUnique({ where: { email: session.user.email }, select: { id: true, role: true } })
  if (!operator) redirect('/eat')
  const roles = await readOperatorRoles(operator.id, operator.role)
  if (!roles.includes('admin')) redirect('/eat')

  const requests = await listVerificationRequests()
  const fmtDate = (iso: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(iso))
  const tone = (s: string): 'success' | 'danger' | 'warning' =>
    s === 'approved' ? 'success' : s === 'rejected' ? 'danger' : 'warning'
  const statusLabel = (s: string) => t(`status_${s}` as 'status_pending')

  return (
    <div className="mx-auto max-w-3xl px-5 py-6 space-y-6">
      <header className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-grubano-lg bg-grubano-primary/15 text-grubano-primary">
          <BadgeCheck size={20} />
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold text-grubano-ink">{t('title')}</h1>
          <p className="text-sm text-grubano-ink-muted">{t('subtitle')}</p>
        </div>
      </header>

      {requests.length === 0 ? (
        <EmptyState emoji="✅" title={t('emptyTitle')} description={t('emptyBody')} />
      ) : (
        <ul className="space-y-3">
          {requests.map((r) => (
            <li key={r.id}>
              <Card elevation="sm" padding="md">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-semibold text-grubano-ink">
                      <span className="truncate">{r.operatorName ?? r.operatorEmail ?? r.operatorId}</span>
                      <Badge tone={tone(r.status)} size="sm">{statusLabel(r.status)}</Badge>
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-grubano-ink-muted">
                      <span className="inline-flex items-center gap-1"><Users2 size={13} className="shrink-0" />{r.platform} · {r.handle} · {r.declaredFollowers.toLocaleString(locale)}</span>
                      {r.proofUrl && (
                        <a href={r.proofUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-grubano-primary hover:underline break-all">
                          <Link2 size={13} className="shrink-0" />{t('proof')}
                        </a>
                      )}
                      <span className="inline-flex items-center gap-1"><Clock3 size={13} className="shrink-0" />{fmtDate(r.createdAt)}</span>
                    </p>
                  </div>
                  {r.status === 'pending' && (
                    <InfluencerVerifyActions id={r.id} approveLabel={t('approve')} rejectLabel={t('reject')} />
                  )}
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
