import { redirect } from 'next/navigation'
import { getServerSession } from 'next-auth'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Bike, Building2, ShieldCheck, Clock3, Hash, Lock, FileCheck2 } from 'lucide-react'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { readOperatorRoles } from '@/lib/operator-roles'
import { isCourierActivationEnabled } from '@/lib/logistics-account'
import { Card, Badge, EmptyState } from '@/components/design-system'
import type { BadgeTone } from '@/components/design-system'
import LogisticsActivationAction from '@/components/admin/LogisticsActivationAction'

// ── /admin/logistics — ADMIN courier activation console (Agent 125) ──────────────
// ADMIN-only (middleware /admin + this server role re-check + the activation endpoint re-checks
// admin too). READ-ONLY listing of couriers + their declared justificatifs, with a "Verify &
// Activate" button. ⚠️ The button is a STRICT NO-OP unless LOGISTICS_COURIER_ACTIVATION_ENABLED
// is ON — when OFF we show a banner explaining everyone stays on the waitlist (Agent 72). Human
// supervision of activation = doc §8 / EU dir. 2024. NO payment surface here.
export const dynamic = 'force-dynamic'

export default async function AdminLogisticsPage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)
  const t = await getTranslations('admin.logistics')
  const locale = props.params.locale

  const session = await getServerSession(authOptions)
  if (!session?.user?.email) redirect('/auth/magic')
  const operator = await prisma.operator.findUnique({ where: { email: session.user.email }, select: { id: true, role: true } })
  if (!operator) redirect('/eat')
  const roles = await readOperatorRoles(operator.id, operator.role)
  if (!roles.includes('admin')) redirect('/eat')

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
  const statusTone = (s: string): BadgeTone =>
    s === 'active' ? 'success' : s === 'pending' ? 'warning' : s === 'suspended' ? 'danger' : 'neutral'
  const justTone = (s: string): BadgeTone =>
    s === 'verified' ? 'success' : s === 'submitted' ? 'warning' : 'neutral'
  const statusLabel = (s: string) => t(`status_${s}` as 'status_pending')
  const justLabel = (s: string) => t(`just_${s}` as 'just_none')

  return (
    <div className="mx-auto max-w-3xl px-5 py-6 space-y-6">
      <header className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-grubano-lg bg-grubano-primary/15 text-grubano-primary">
          <Bike size={20} />
        </span>
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold text-grubano-ink">{t('title')}</h1>
          <p className="text-sm text-grubano-ink-muted">{t('subtitle')}</p>
        </div>
      </header>

      {/* ⭐ Master guardrail state — when OFF, activation is impossible; everyone stays on the waitlist. */}
      {!activationEnabled && (
        <Card elevation="sm" padding="md" className="border-grubano-warning/40 bg-grubano-warning-tint">
          <div className="flex items-start gap-2.5">
            <Lock size={18} className="mt-0.5 shrink-0 text-grubano-warning" />
            <div>
              <p className="font-semibold text-grubano-ink">{t('disabledTitle')}</p>
              <p className="text-sm text-grubano-ink-muted">{t('disabledBody')}</p>
            </div>
          </div>
        </Card>
      )}

      {couriers.length === 0 ? (
        <EmptyState emoji="🛵" title={t('emptyTitle')} description={t('emptyBody')} />
      ) : (
        <ul className="space-y-3">
          {couriers.map((c) => (
            <li key={c.id}>
              <Card elevation="sm" padding="md">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-grubano-ink">
                      <span className="truncate">{c.officialName || c.contactName}</span>
                      <Badge tone={statusTone(c.status)} size="sm">{statusLabel(c.status)}</Badge>
                      <Badge tone={justTone(c.justificatifsStatus)} size="sm" icon={<FileCheck2 size={12} />}>{justLabel(c.justificatifsStatus)}</Badge>
                    </p>
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-grubano-ink-muted">
                      <span className="inline-flex items-center gap-1"><Building2 size={13} className="shrink-0" />{c.contactName}</span>
                      <span className="break-all">{c.email}</span>
                      <span className="inline-flex items-center gap-1"><Hash size={13} className="shrink-0" />{c.siren ?? t('sirenNone')}</span>
                      <span className="inline-flex items-center gap-1"><Clock3 size={13} className="shrink-0" />{fmtDate(c.createdAt)}</span>
                    </p>
                    {/* Declared justificatifs (read-only) */}
                    {c.justificatifsStatus !== 'none' && (
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-grubano-ink-muted">
                        <span className="inline-flex items-center gap-1"><ShieldCheck size={12} className="shrink-0" />{t('insurance')}: {c.insuranceInsurer ?? '—'} {c.insurancePolicyNumber ? `· ${c.insurancePolicyNumber}` : ''} {c.insuranceExpiry ? `· ${c.insuranceExpiry}` : ''}</span>
                        <span className="inline-flex items-center gap-1">{t('rcPro')}: {c.rcProInsurer ?? '—'} {c.rcProPolicyNumber ? `· ${c.rcProPolicyNumber}` : ''}</span>
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {/* Activate only when there is a declaration to verify and the account is not yet active. */}
                    {c.status !== 'active' && (c.justificatifsStatus === 'submitted' || c.justificatifsStatus === 'verified') && (
                      <LogisticsActivationAction
                        email={c.email}
                        label={t('activate')}
                        errorLabel={t('actionError')}
                        disabledLabel={t('activateDisabled')}
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
