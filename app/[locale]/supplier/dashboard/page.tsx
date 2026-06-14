import { getServerSession } from 'next-auth'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Truck, Clock3, MapPin, Tags, CreditCard, Hourglass, Package, ChevronRight, Inbox } from 'lucide-react'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Link } from '@/navigation'
import { Card, Badge, EmptyState, type BadgeTone } from '@/components/design-system'
import RoleSwitcher from '@/components/RoleSwitcher'
import { formatMoney } from '@/lib/format-money'

// ── /supplier/dashboard — B2B supplier space shell (Slice 0, Agent 14) ────────
// Gated by middleware (supplier/admin). Minimal landing: a welcome + the supplier's
// business-profile summary. NO catalogue / orders here (Slice 1+). Renders bare
// (AppChrome BARE_PREFIXES) with its own sober header + the multi-role RoleSwitcher
// (shows only for a user who holds another space too).
export const dynamic = 'force-dynamic'

const STATUS_TONE: Record<string, BadgeTone> = {
  pending:   'warning',
  active:    'success',
  suspended: 'danger',
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

export default async function SupplierDashboardPage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)
  const t = await getTranslations('supplier')
  const locale = props.params.locale

  const session = await getServerSession(authOptions)
  const email = session?.user?.email

  // Defence in depth — middleware should already block unauthenticated visits.
  if (!email) {
    return (
      <div className="mx-auto max-w-xl px-5 pt-12">
        <EmptyState emoji="🔒" title={t('noProfileTitle')} description={t('noProfileBody')} />
      </div>
    )
  }

  const profile = await prisma.supplierProfile.findUnique({ where: { email } }).catch(() => null)

  const categories = profile ? asStringArray(profile.categories) : []
  const zones = profile ? asStringArray(profile.deliveryZones) : []
  const catLabel = (c: string) => t(`cat${c.charAt(0).toUpperCase()}${c.slice(1)}` as 'catFresh')

  return (
    <div className="min-h-screen bg-grubano-bg">
      {/* Sober supplier header (no operator sidebar — this space is BARE chrome). */}
      <header className="bg-grubano-ink text-white">
        <div className="mx-auto max-w-3xl px-5 py-5 flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-grubano-lg bg-grubano-primary/20">
            <Truck size={18} className="text-grubano-primary" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-widest text-white/40">Grubano</p>
            <h1 className="font-display text-lg font-bold leading-tight truncate">{t('dashWelcome')}</h1>
          </div>
        </div>
      </header>

      <RoleSwitcher tone="light" />

      <main className="mx-auto max-w-3xl px-5 py-6 space-y-5">
        {!profile ? (
          <EmptyState emoji="📦" title={t('noProfileTitle')} description={t('noProfileBody')} />
        ) : (
          <>
            {profile.status === 'pending' && (
              <Card elevation="sm" padding="md" className="border-grubano-warning/40 bg-grubano-warning-tint">
                <div className="flex items-start gap-2.5">
                  <Hourglass size={18} className="mt-0.5 shrink-0 text-grubano-warning" />
                  <div>
                    <p className="font-semibold text-grubano-ink">{t('statusPendingTitle')}</p>
                    <p className="text-sm text-grubano-ink-muted">{t('statusPendingBody')}</p>
                  </div>
                </div>
              </Card>
            )}

            {/* Slice 1 — entry point to the catalogue management. */}
            <Link href="/supplier/catalog" className="block">
              <Card elevation="sm" padding="md" className="transition-shadow hover:shadow-grubano-md">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-grubano-lg bg-grubano-primary/15 text-grubano-primary">
                    <Package size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-grubano-ink">{t('catalogTitle')}</p>
                    <p className="text-sm text-grubano-ink-muted">{t('catalogCardSubtitle')}</p>
                  </div>
                  <ChevronRight size={18} className="shrink-0 text-grubano-ink-faint" />
                </div>
              </Card>
            </Link>

            {/* Slice 2 — incoming B2B orders. */}
            <Link href="/supplier/orders" className="block">
              <Card elevation="sm" padding="md" className="transition-shadow hover:shadow-grubano-md">
                <div className="flex items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-grubano-lg bg-grubano-primary/15 text-grubano-primary">
                    <Inbox size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-grubano-ink">{t('ordersTitle')}</p>
                    <p className="text-sm text-grubano-ink-muted">{t('dashOrdersSubtitle')}</p>
                  </div>
                  <ChevronRight size={18} className="shrink-0 text-grubano-ink-faint" />
                </div>
              </Card>
            </Link>

            <Card elevation="sm" padding="lg">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-display text-xl font-bold text-grubano-ink truncate">{profile.companyName}</h2>
                  <p className="text-sm text-grubano-ink-muted truncate">
                    {profile.contactName}{profile.city ? ` · ${profile.city}` : ''}
                  </p>
                </div>
                <Badge tone={STATUS_TONE[profile.status] ?? 'neutral'} size="md">
                  {t(`status${profile.status.charAt(0).toUpperCase()}${profile.status.slice(1)}` as 'statusPending')}
                </Badge>
              </div>

              <dl className="grid gap-4 sm:grid-cols-2">
                <Field icon={<Tags size={15} />} label={t('labelCategories')}>
                  {categories.length
                    ? <div className="flex flex-wrap gap-1.5">{categories.map((c) => (
                        <Badge key={c} tone="neutral" size="sm">{catLabel(c)}</Badge>
                      ))}</div>
                    : <span className="text-grubano-ink-faint">{t('emptyValue')}</span>}
                </Field>

                <Field icon={<MapPin size={15} />} label={t('labelDeliveryZones')}>
                  {zones.length
                    ? <span className="text-grubano-ink">{zones.join(', ')}</span>
                    : <span className="text-grubano-ink-faint">{t('emptyValue')}</span>}
                </Field>

                <Field icon={<CreditCard size={15} />} label={t('labelMinimumOrder')}>
                  <span className="font-semibold text-grubano-ink">{formatMoney(profile.minimumOrderCents, locale)}</span>
                </Field>

                <Field icon={<Clock3 size={15} />} label={t('labelLeadTime')}>
                  <span className="text-grubano-ink">{t('leadTimeValue', { days: profile.leadTimeDays })}</span>
                </Field>

                {profile.paymentTerms ? (
                  <div className="sm:col-span-2">
                    <Field icon={<CreditCard size={15} />} label={t('labelPaymentTerms')}>
                      <span className="text-grubano-ink whitespace-pre-line">{profile.paymentTerms}</span>
                    </Field>
                  </div>
                ) : null}
              </dl>
            </Card>
          </>
        )}
      </main>
    </div>
  )
}

function Field({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-grubano-ink-faint">
        <span className="text-grubano-ink-muted">{icon}</span>{label}
      </dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}
