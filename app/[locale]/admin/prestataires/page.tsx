import { notFound, redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Wrench, Building2, BadgeCheck, ShieldCheck, Clock3 } from 'lucide-react'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { readOperatorRoles } from '@/lib/operator-roles'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import { Card, Badge, EmptyState } from '@/components/design-system'
import type { BadgeTone } from '@/components/design-system'
import PrestataireStatusActions from '@/components/admin/PrestataireStatusActions'
import PrestataireCoherenceAction from '@/components/admin/PrestataireCoherenceAction'

// ── /admin/prestataires — ADMIN prestataire moderation console (Agent 112) ──────────
// Calque of /admin/suppliers. ADMIN-only (middleware /admin, this server role re-check, and the
// status/coherence endpoints re-check admin too) + page-level PRESTATAIRE_ENABLED gate (404 when
// OFF → the role does not exist). READ-ONLY listing of prestataires + their stored vetting /
// registry-verification VERDICT (displayed, NEVER recomputed) + activate/suspend (POST
// /api/prestataire/admin/status) + a COHERENCE review queue: an active-but-pending prestataire
// shows a "coherence to validate" badge + an "approve (go live)" action (POST
// /api/admin/prestataires/coherence). NON-MONEY: status/visibility only — no payout is even wired.
export const dynamic = 'force-dynamic'

export default async function AdminPrestatairesPage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)
  // Page-level flag gate (defence in depth — the whole role is OFF by default).
  if (!isPrestataireEnabled()) notFound()

  const t = await getTranslations('admin.prestataires')
  const locale = props.params.locale

  const session = await getServerSession(authOptions)
  if (!session?.user?.email) redirect('/auth/magic')
  const operator = await prisma.operator.findUnique({ where: { email: session.user.email }, select: { id: true, role: true } })
  if (!operator) redirect('/eat')
  const roles = await readOperatorRoles(operator.id, operator.role)
  if (!roles.includes('admin')) redirect('/eat')

  const prestataires = await prisma.prestataireProfile.findMany({
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true, email: true, companyName: true, contactName: true, city: true,
      status: true, marketplaceCoherencePending: true, vettingVerdict: true, vettingReason: true,
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
          <Wrench size={20} />
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold text-grubano-ink">{t('title')}</h1>
          <p className="text-sm text-grubano-ink-muted">{t('subtitle')}</p>
        </div>
      </header>

      {prestataires.length === 0 ? (
        <EmptyState emoji="🛠️" title={t('emptyTitle')} description={t('emptyBody')} />
      ) : (
        <ul className="space-y-3">
          {prestataires.map((p) => (
            <li key={p.id}>
              <Card elevation="sm" padding="md">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-grubano-ink">
                      <span className="truncate">{p.companyName}</span>
                      <Badge tone={statusTone(p.status)} size="sm">{statusLabel(p.status)}</Badge>
                      {/* Coherence review queue (Agent 112): an ACTIVE prestataire still hidden from
                          the directory until the publication coherence check clears it. */}
                      {p.status === 'active' && p.marketplaceCoherencePending && (
                        <Badge tone="warning" size="sm" icon={<Clock3 size={12} />}>{t('coherencePending')}</Badge>
                      )}
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-grubano-ink-muted">
                      <span className="inline-flex items-center gap-1"><Building2 size={13} className="shrink-0" />{p.contactName}{p.city ? ` · ${p.city}` : ''}</span>
                      <span className="break-all">{p.email}</span>
                      <span className="inline-flex items-center gap-1">
                        {t('siren')}: {p.siren ? <span className="font-medium text-grubano-ink">{p.siren}</span> : t('sirenNone')}
                      </span>
                      <span className="inline-flex items-center gap-1"><Clock3 size={13} className="shrink-0" />{fmtDate(p.createdAt)}</span>
                    </p>
                    {p.officialName && (
                      <p className="mt-0.5 text-xs text-grubano-ink-muted truncate">{p.officialName}</p>
                    )}
                    <p className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge tone={verdictTone(p.vettingVerdict)} size="sm" icon={<BadgeCheck size={12} />}>{verdictLabel(p.vettingVerdict)}</Badge>
                      <Badge tone={verifTone(p.verificationStatus)} size="sm" icon={<ShieldCheck size={12} />}>{verifLabel(p.verificationStatus)}</Badge>
                    </p>
                    {p.vettingReason && (
                      <p className="mt-1 text-xs text-grubano-ink-muted italic">{p.vettingReason}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
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
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
