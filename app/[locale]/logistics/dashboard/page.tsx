import { getServerSession } from 'next-auth'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import {
  Bike, ShieldCheck, Hourglass, Info, Ban, MapPin, Truck, User, Phone,
  Building2, Hash, Package, Sparkles, Pencil,
} from 'lucide-react'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { isCourierActivationEnabled } from '@/lib/logistics-account'
import { isMissionsEnabled } from '@/lib/missions'
import { Link } from '@/navigation'
import { Card, Badge, Button, EmptyState, type BadgeTone } from '@/components/design-system'
import RoleSwitcher from '@/components/RoleSwitcher'
import CourierMissions from '@/components/logistics/CourierMissions'
import CourierJustificatifs from '@/components/logistics/CourierJustificatifs'

// ── /logistics/dashboard — courier / logistics space shell (P1, Agent 17) ─────
// Gated by middleware (logistics/admin), calqued 1:1 on /supplier/dashboard. A
// minimal landing: a status banner + the courier's business-profile summary (READ
// ONLY — editing is a later phase) + a "missions coming soon" placeholder. NO
// payment / Stripe (logistics has no payout layer in this slice). Renders bare
// (AppChrome BARE_PREFIXES) with its own sober header + the multi-role RoleSwitcher
// (shown only for a user who also holds another space).
export const dynamic = 'force-dynamic'

const STATUS_TONE: Record<string, BadgeTone> = {
  active:    'success',
  pending:   'warning',
  suspended: 'danger',
  rejected:  'danger',
}
const STATUS_LABEL: Record<string, string> = {
  active:    'statusActive',
  pending:   'statusPending',
  suspended: 'statusSuspended',
  rejected:  'statusRejected',
}

// Enum → i18n key suffix (reuse the register namespace's option labels).
const MISSION_LABEL: Record<string, string> = {
  repas:                 'missionRepas',
  produits_fournisseurs: 'missionProduits',
  b2b:                   'missionB2b',
  froid:                 'missionFroid',
}
const VEHICLE_LABEL: Record<string, string> = {
  velo:         'vehicleVelo',
  scooter:      'vehicleScooter',
  voiture:      'vehicleVoiture',
  camionnette:  'vehicleCamionnette',
  frigorifique: 'vehicleFrigorifique',
}

function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

export default async function LogisticsDashboardPage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)
  // Single translator at `business.logistics`: dashboard.* for this page + the
  // existing register option labels (missionRepas, vehicleVelo, partnerType*).
  const t = await getTranslations('business.logistics')
  const d = (k: string) => t(`dashboard.${k}` as 'dashboard.welcome')

  const session = await getServerSession(authOptions)
  const email = session?.user?.email

  // Defence in depth — middleware already blocks unauthenticated / non-logistics.
  if (!email) {
    return (
      <div className="mx-auto max-w-xl px-5 pt-12">
        <EmptyState emoji="🔒" title={d('noProfileTitle')} description={d('noProfileBody')} />
      </div>
    )
  }

  const profile = await prisma.logisticsProfile.findUnique({ where: { email } }).catch(() => null)

  // LA (Agent 72) — courier activation is gated OFF: a 'pending' profile is a WAITLIST
  // candidate (network pre-seed), NOT a review-pending one. Under the waitlist regime we
  // show the waitlist state instead of the generic pending banner + the "missions coming
  // soon" card (which would imply imminent active missions). No work is offered.
  const onWaitlist = profile?.status === 'pending' && !isCourierActivationEnabled()
  // Brick 3 (Agent 124): the LIVE missions surface replaces the "coming soon" placeholder
  // ONLY when LOGISTICS_MISSIONS_ENABLED is ON. OFF → the existing placeholder is byte-identical.
  const missionsEnabled = isMissionsEnabled()

  const missions = profile ? asStringArray(profile.missionTypes) : []
  const vehicles = profile ? asStringArray(profile.vehicleTypes) : []
  const zones    = profile ? asStringArray(profile.zones) : []
  const missionLabel = (m: string) => (m in MISSION_LABEL ? t(MISSION_LABEL[m] as 'missionRepas') : m)
  const vehicleLabel = (v: string) => (v in VEHICLE_LABEL ? t(VEHICLE_LABEL[v] as 'vehicleVelo') : v)

  const displayName = profile?.officialName || profile?.contactName || ''

  return (
    <div className="min-h-screen bg-grubano-bg">
      {/* Sober logistics header (no operator sidebar — this space is BARE chrome). */}
      <header className="bg-grubano-ink text-white">
        <div className="mx-auto max-w-3xl px-5 py-5 flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-grubano-lg bg-grubano-primary/20">
            <Bike size={18} className="text-grubano-primary" />
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
            emoji="🛵"
            title={d('noProfileTitle')}
            description={d('noProfileBody')}
            action={
              <Link href="/business/logistics/register">
                <Button variant="primary" size="md">{d('registerCta')}</Button>
              </Link>
            }
          />
        ) : (
          <>
            {/* LA — WAITLIST state (courier activation gated OFF). Replaces the generic
                pending banner + the missions placeholder; the read-only profile stays. */}
            {onWaitlist && (
              <Card elevation="sm" padding="md" className="border-grubano-primary/30 bg-grubano-tint/40">
                <div className="flex items-start gap-2.5">
                  <Sparkles size={18} className="mt-0.5 shrink-0 text-grubano-primary" />
                  <div className="min-w-0">
                    <p className="font-semibold text-grubano-ink">{d('waitlistTitle')}</p>
                    <p className="text-sm text-grubano-ink-muted">{d('waitlistBody')}</p>
                  </div>
                </div>
              </Card>
            )}

            {/* Status banner */}
            {profile.status === 'active' && (
              <Card elevation="sm" padding="md" className="border-grubano-success/40 bg-grubano-success-tint">
                <div className="flex items-start gap-2.5">
                  <ShieldCheck size={18} className="mt-0.5 shrink-0 text-grubano-success" />
                  <div className="min-w-0">
                    <p className="font-semibold text-grubano-ink">{d('activeTitle')}</p>
                    <p className="text-sm text-grubano-ink-muted">{d('activeBody')}</p>
                    {profile.verificationStatus === 'verified' && profile.officialName && (
                      <span className="mt-2 inline-flex items-center gap-1.5 rounded-grubano-pill bg-grubano-tint px-3 py-1 text-sm font-semibold text-grubano-primary">
                        <ShieldCheck size={14} /> {profile.officialName}
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            )}
            {!onWaitlist && profile.status === 'pending' && (
              <Card elevation="sm" padding="md" className="border-grubano-warning/40 bg-grubano-warning-tint">
                <div className="flex items-start gap-2.5">
                  <Hourglass size={18} className="mt-0.5 shrink-0 text-grubano-warning" />
                  <div>
                    <p className="font-semibold text-grubano-ink">{d('pendingTitle')}</p>
                    <p className="text-sm text-grubano-ink-muted">{d('pendingBody')}</p>
                  </div>
                </div>
              </Card>
            )}
            {profile.status === 'rejected' && (
              <Card elevation="sm" padding="md" className="border-grubano-border bg-grubano-surface-muted">
                <div className="flex items-start gap-2.5">
                  <Info size={18} className="mt-0.5 shrink-0 text-grubano-ink-muted" />
                  <div>
                    <p className="font-semibold text-grubano-ink">{d('rejectedTitle')}</p>
                    <p className="text-sm text-grubano-ink-muted">{d('rejectedBody')}</p>
                  </div>
                </div>
              </Card>
            )}
            {profile.status === 'suspended' && (
              <Card elevation="sm" padding="md" className="border-grubano-danger/40 bg-grubano-danger-tint">
                <div className="flex items-start gap-2.5">
                  <Ban size={18} className="mt-0.5 shrink-0 text-grubano-danger" />
                  <div>
                    <p className="font-semibold text-grubano-ink">{d('suspendedTitle')}</p>
                    <p className="text-sm text-grubano-ink-muted">{d('suspendedBody')}</p>
                  </div>
                </div>
              </Card>
            )}

            {/* Compliance justificatifs (Agent 125) — the courier declares insurance + RC Pro so
                an admin can verify + activate (but ONLY when the activation flag is ON). Self-
                fetches its own state (column-tolerant before the additive migration is pushed). */}
            <CourierJustificatifs />

            {/* Missions. ON (LOGISTICS_MISSIONS_ENABLED) → the live offered-missions surface
                (free accept/refuse, brick 3). OFF → the original "coming soon" placeholder
                (byte-identical). Hidden under the WAITLIST regime either way: it would imply
                imminent active missions. */}
            {!onWaitlist && (missionsEnabled ? (
              <CourierMissions />
            ) : (
            <Card elevation="sm" padding="md">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-grubano-lg bg-grubano-primary/15 text-grubano-primary">
                  <Package size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 font-semibold text-grubano-ink">
                    {d('missionsTitle')}
                    <span className="inline-flex items-center gap-1 rounded-grubano-pill bg-grubano-surface-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-grubano-ink-faint">
                      <Sparkles size={11} /> {d('missionsSoonBadge')}
                    </span>
                  </p>
                  <p className="text-sm text-grubano-ink-muted">{d('missionsSoonBody')}</p>
                </div>
              </div>
            </Card>
            ))}

            {/* Read-only profile summary. */}
            <Card elevation="sm" padding="lg">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-grubano-ink-faint">{d('profileTitle')}</p>
                  <h2 className="font-display text-xl font-bold text-grubano-ink truncate">{displayName}</h2>
                  <p className="text-sm text-grubano-ink-muted truncate">{profile.contactName}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <Badge tone={STATUS_TONE[profile.status] ?? 'neutral'} size="md">
                    {d(STATUS_LABEL[profile.status] ?? 'statusPending')}
                  </Badge>
                  {profile.verificationStatus === 'verified' && (
                    <Badge tone="success" size="sm">{d('verifiedBadge')}</Badge>
                  )}
                </div>
              </div>

              <dl className="grid gap-4 sm:grid-cols-2">
                <Field icon={<Building2 size={15} />} label={d('labelPartnerType')}>
                  <span className="text-grubano-ink">
                    {t(profile.partnerType === 'company' ? 'partnerTypeCompany' : 'partnerTypeIndependent')}
                  </span>
                </Field>

                <Field icon={<Hash size={15} />} label={d('labelSiren')}>
                  {profile.siren
                    ? <span className="text-grubano-ink">{profile.siren}</span>
                    : <span className="text-grubano-ink-faint">{d('emptyValue')}</span>}
                </Field>

                <Field icon={<Truck size={15} />} label={d('labelMissionTypes')}>
                  {missions.length
                    ? <div className="flex flex-wrap gap-1.5">{missions.map((m) => (
                        <Badge key={m} tone="neutral" size="sm">{missionLabel(m)}</Badge>
                      ))}</div>
                    : <span className="text-grubano-ink-faint">{d('emptyValue')}</span>}
                </Field>

                <Field icon={<Bike size={15} />} label={d('labelVehicleTypes')}>
                  {vehicles.length
                    ? <div className="flex flex-wrap gap-1.5">{vehicles.map((v) => (
                        <Badge key={v} tone="neutral" size="sm">{vehicleLabel(v)}</Badge>
                      ))}</div>
                    : <span className="text-grubano-ink-faint">{d('emptyValue')}</span>}
                </Field>

                <Field icon={<MapPin size={15} />} label={d('labelZones')}>
                  {zones.length
                    ? <span className="text-grubano-ink">{zones.join(', ')}</span>
                    : <span className="text-grubano-ink-faint">{d('emptyValue')}</span>}
                </Field>

                <Field icon={<User size={15} />} label={d('labelContact')}>
                  <span className="text-grubano-ink">{profile.contactName}</span>
                </Field>

                {profile.contactPhone ? (
                  <Field icon={<Phone size={15} />} label={d('labelPhone')}>
                    <span className="text-grubano-ink">{profile.contactPhone}</span>
                  </Field>
                ) : null}
              </dl>

              <div className="mt-4 border-t border-grubano-border pt-3">
                <Link
                  href="/logistics/dashboard/profil"
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
