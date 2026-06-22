import { getServerSession } from 'next-auth'
import { notFound } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Wrench, MapPin, Tags, Hourglass, ChevronRight, Sparkles, Pencil, MonitorSmartphone, Inbox, CalendarDays } from 'lucide-react'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Link } from '@/navigation'
import { Card, Badge, EmptyState, type BadgeTone } from '@/components/design-system'
import RoleSwitcher from '@/components/RoleSwitcher'
import OnboardingGuide from '@/components/onboarding/OnboardingGuide'
import OnboardingChat from '@/components/onboarding/OnboardingChat'
import PrestataireConnectCard from '@/components/prestataire/PrestataireConnectCard'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import { isPrestataireConnectLive } from '@/lib/prestataire-connect'

// ── /prestataire/dashboard — SERVICES marketplace space shell (P1, Agent 74) ──
// A CLONE of /supplier/dashboard, adapted to services. Gated by middleware
// (prestataire/admin) AND page-level by PRESTATAIRE_ENABLED (404 when OFF → the role
// does not exist). Minimal landing: a status banner + the prestataire's read-only
// business profile + a « coming soon » card listing the LATER bricks (services list,
// quotes/devis, missions, calendar, reviews, invoicing). NO payment / Connect here.
// Renders bare (AppChrome BARE_PREFIXES) with its own sober header + the RoleSwitcher.
export const dynamic = 'force-dynamic'

const STATUS_TONE: Record<string, BadgeTone> = {
  pending:   'warning',
  active:    'success',
  suspended: 'danger',
  rejected:  'danger',
}

const SVC_LABEL: Record<string, string> = {
  electricity:        'svcElectricity',
  plumbing:           'svcPlumbing',
  haccp:              'svcHaccp',
  cleaning:           'svcCleaning',
  pest_control:       'svcPestControl',
  fridge_repair:      'svcFridgeRepair',
  kitchen_maintenance:'svcKitchenMaintenance',
  accounting:         'svcAccounting',
  training:           'svcTraining',
  other:              'svcOther',
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

export default async function PrestataireDashboardPage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)
  // Page-level flag gate (defence in depth — the whole role is OFF by default).
  if (!isPrestataireEnabled()) notFound()

  const t = await getTranslations('prestataire')
  const d = (k: string) => t(`dashboard.${k}` as 'dashboard.welcome')

  const session = await getServerSession(authOptions)
  const email = session?.user?.email

  // Defence in depth — middleware already blocks unauthenticated / non-prestataire.
  if (!email) {
    return (
      <div className="mx-auto max-w-xl px-5 pt-12">
        <EmptyState emoji="🔒" title={d('noProfileTitle')} description={d('noProfileBody')} />
      </div>
    )
  }

  const profile = await prisma.prestataireProfile.findUnique({ where: { email } }).catch(() => null)

  const services = profile ? asStringArray(profile.serviceCategories) : []
  const zones    = profile ? asStringArray(profile.coverageZones) : []
  const svcLabel = (s: string) => (s in SVC_LABEL ? t(SVC_LABEL[s] as 'svcOther') : s)
  const modalityLabel = (m: string) =>
    t((m === 'remote' ? 'modalityRemote' : m === 'both' ? 'modalityBoth' : 'modalityOnSite') as 'modalityOnSite')

  // The LATER bricks (P2+) — shown as a single « à venir » card so the shell is honest
  // about what is not built yet. NO link / no work is offered here.
  // P2 (Agent 75) — « Services » is now BUILT (managed below), so it leaves the soon list.
  // P3 (Agent 76) — « Devis » + « Missions » are now BUILT (managed below), so they leave the soon list.
  // P4 (Agent 77) — « Calendrier » is now BUILT (managed below), so it leaves the soon list.
  const SOON = ['soonReviews', 'soonInvoicing'] as const

  return (
    <div className="min-h-screen bg-grubano-bg">
      {/* Sober prestataire header (no operator sidebar — this space is BARE chrome). */}
      <header className="bg-grubano-ink text-white">
        <div className="mx-auto max-w-3xl px-5 py-5 flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-grubano-lg bg-grubano-primary/20">
            <Wrench size={18} className="text-grubano-primary" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-widest text-white/40">Grubano</p>
            <h1 className="font-display text-lg font-bold leading-tight truncate">{d('welcome')}</h1>
            <p className="text-xs text-white/50 truncate">{d('subtitle')}</p>
          </div>
        </div>
      </header>

      <RoleSwitcher tone="light" />

      <main className="mx-auto max-w-3xl px-5 py-6 space-y-5">
        {!profile ? (
          <EmptyState
            emoji="🛠️"
            title={d('noProfileTitle')}
            description={d('noProfileBody')}
            action={
              <Link href="/business/prestataire/register">
                <span className="inline-flex items-center gap-1.5 rounded-grubano-lg bg-grubano-primary px-5 py-3 font-semibold text-white shadow-grubano-sm">
                  {d('registerCta')}
                </span>
              </Link>
            }
          />
        ) : (
          <>
            {/* Onboarding copilote (Agent 104) — role-aware activation guide for the prestataire.
                Self-gating: renders null unless ONBOARDING_GUIDE_ENABLED is on (probe in the
                component) → the dashboard is byte-identical when the flag is OFF. READ-ONLY,
                moves no money; fetches /api/business/activation?role=prestataire. */}
            <OnboardingGuide role="prestataire" />

            {/* Onboarding help chat (Agent 106) — constrained how-to copilot anchored on the
                prestataire checklist. Self-gating (ONBOARDING_AI_CHAT_ENABLED) → null when OFF,
                byte-identical. Governance unchanged: refuses legal/fiscal/financial + never quotes
                a rate. Reads state only. */}
            <OnboardingChat role="prestataire" />

            {profile.status === 'pending' && (
              <Card elevation="sm" padding="md" className="border-grubano-warning/40 bg-grubano-warning-tint">
                <div className="flex items-start gap-2.5">
                  <Hourglass size={18} className="mt-0.5 shrink-0 text-grubano-warning" />
                  <div>
                    <p className="font-semibold text-grubano-ink">{d('statusPendingTitle')}</p>
                    <p className="text-sm text-grubano-ink-muted">{d('statusPendingBody')}</p>
                  </div>
                </div>
              </Card>
            )}

            {/* P2 (Agent 75) — « Mes services » management (services are now BUILT). Only an
                ACTIVE prestataire can add/edit; a pending one sees the banner above. */}
            {profile.status === 'active' && (
              <Card elevation="sm" padding="md" interactive>
                <Link href="/prestataire/services" className="flex items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-grubano-lg bg-grubano-primary/15 text-grubano-primary">
                    <Wrench size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-grubano-ink">{d('manageServicesTitle')}</p>
                    <p className="text-sm text-grubano-ink-muted">{d('manageServicesBody')}</p>
                  </div>
                  <ChevronRight size={18} className="shrink-0 text-grubano-ink-faint" />
                </Link>
              </Card>
            )}

            {/* P3 (Agent 76) — « Demandes & missions » (the devis/mission inbox). Active only. */}
            {profile.status === 'active' && (
              <Card elevation="sm" padding="md" interactive>
                <Link href="/prestataire/missions" className="flex items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-grubano-lg bg-grubano-primary/15 text-grubano-primary">
                    <Inbox size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-grubano-ink">{d('missionsTitle')}</p>
                    <p className="text-sm text-grubano-ink-muted">{d('missionsBody')}</p>
                  </div>
                  <ChevronRight size={18} className="shrink-0 text-grubano-ink-faint" />
                </Link>
              </Card>
            )}

            {/* P4 (Agent 77) — « Mon calendrier » (declared availability + planned missions). Active only. */}
            {profile.status === 'active' && (
              <Card elevation="sm" padding="md" interactive>
                <Link href="/prestataire/calendar" className="flex items-center gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-grubano-lg bg-grubano-primary/15 text-grubano-primary">
                    <CalendarDays size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-grubano-ink">{d('calendarTitle')}</p>
                    <p className="text-sm text-grubano-ink-muted">{d('calendarBody')}</p>
                  </div>
                  <ChevronRight size={18} className="shrink-0 text-grubano-ink-faint" />
                </Link>
              </Card>
            )}

            {/* P7 (Agent 80) — Stripe Connect payout onboarding (TEST, DOUBLE-FLAG gated:
                PRESTATAIRE_ENABLED + PRESTATAIRE_CONNECT_ENABLED). ⚠️ Account onboarding only —
                NO money moves (the real payment is P8). Mounted only when the double flag is
                live → OFF = nothing renders. Active prestataires only. */}
            {profile.status === 'active' && isPrestataireConnectLive() && (
              <PrestataireConnectCard initialStatus={profile.payoutStatus ?? 'none'} />
            )}

            {/* Future bricks (P5+) — avis / facturation. */}
            <Card elevation="sm" padding="md">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-grubano-lg bg-grubano-primary/15 text-grubano-primary">
                  <Sparkles size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-grubano-ink">{d('comingSoonTitle')}</p>
                  <p className="text-sm text-grubano-ink-muted">{d('comingSoonBody')}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {SOON.map((k) => (
                  <span key={k} className="inline-flex items-center gap-1 rounded-grubano-pill bg-grubano-surface-muted px-2.5 py-1 text-[11px] font-semibold text-grubano-ink-faint">
                    {d(k)}
                    <ChevronRight size={11} />
                  </span>
                ))}
              </div>
            </Card>

            {/* Read-only profile summary. */}
            <Card elevation="sm" padding="lg">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="font-display text-xl font-bold text-grubano-ink truncate">{profile.companyName}</h2>
                  <p className="text-sm text-grubano-ink-muted truncate">
                    {profile.contactName}{profile.city ? ` · ${profile.city}` : ''}
                  </p>
                </div>
                <Badge tone={STATUS_TONE[profile.status] ?? 'neutral'} size="md">
                  {d(`status${profile.status.charAt(0).toUpperCase()}${profile.status.slice(1)}` as 'statusPending')}
                </Badge>
              </div>

              <dl className="grid gap-4 sm:grid-cols-2">
                <Field icon={<Tags size={15} />} label={d('labelServices')}>
                  {services.length
                    ? <div className="flex flex-wrap gap-1.5">{services.map((s) => (
                        <Badge key={s} tone="neutral" size="sm">{svcLabel(s)}</Badge>
                      ))}</div>
                    : <span className="text-grubano-ink-faint">{d('emptyValue')}</span>}
                </Field>

                <Field icon={<MapPin size={15} />} label={d('labelCoverageZones')}>
                  {zones.length
                    ? <span className="text-grubano-ink">{zones.join(', ')}</span>
                    : <span className="text-grubano-ink-faint">{d('emptyValue')}</span>}
                </Field>

                <Field icon={<MonitorSmartphone size={15} />} label={d('labelModality')}>
                  <span className="text-grubano-ink">{modalityLabel(profile.modality)}</span>
                </Field>

                {profile.indicativeRate ? (
                  <Field icon={<Tags size={15} />} label={d('labelRate')}>
                    <span className="text-grubano-ink whitespace-pre-line">{profile.indicativeRate}</span>
                  </Field>
                ) : null}
              </dl>

              <div className="mt-4 border-t border-grubano-border pt-3">
                <Link
                  href="/prestataire/dashboard/profil"
                  className="inline-flex items-center gap-1.5 text-grubano-sm font-semibold text-grubano-primary hover:underline"
                >
                  <Pencil size={14} /> {d('editProfileCta')}
                </Link>
              </div>
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
