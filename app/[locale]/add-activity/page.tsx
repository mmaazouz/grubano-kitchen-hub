import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Truck, ChefHat, Bike, Building2, Megaphone, ArrowRight } from 'lucide-react'
import { Link } from '@/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { readOperatorRoles } from '@/lib/operator-roles'
import { getOperatorCompanyIdentity } from '@/lib/operator-identity'
import { isAffiliateEnabled } from '@/lib/affiliate-account'
import { addableActivities, activityHref, activityMode, type AddableActivity } from '@/lib/add-activity'
import { Card, EmptyState } from '@/components/design-system'
import PartnerChrome from '@/components/business/PartnerChrome'

export const dynamic = 'force-dynamic'

// ── /add-activity — unified "add an activity" hub (B1.3-C, Agent 32) ──────────
// Connected-only (middleware auth-gates this non-public route to ANY role; the
// page also redirects a session-less visitor to /auth/magic). It GRANTS NO ROLE:
// each card routes to the EXISTING vetted journey, carrying the SESSION email so
// the new activity attaches to the SAME account. Company-backed journeys also get
// the verified siren/company as an editable PREFILL (read from the B1.1 anchor,
// best-effort so the page works even before that migration lands). Rendered in the
// neutral PartnerChrome (this route is in AppChrome BARE_PREFIXES → no operator
// sidebar), so it is coherent for a partner of any role.

// Per-activity presentation (literal Tailwind classes so the role tokens are kept
// by the purge). Supplier uses the brand primary (as on /business/start); the rest
// use their P7 role tokens.
const CARDS: Record<AddableActivity, {
  Icon:     typeof Truck
  accent:   string
  bg:       string
  titleKey: 'supplierTitle' | 'creatorTitle' | 'logisticsTitle' | 'franchiseTitle' | 'affiliateTitle'
  descKey:  'supplierDesc'  | 'creatorDesc'  | 'logisticsDesc'  | 'franchiseDesc'  | 'affiliateDesc'
}> = {
  supplier:  { Icon: Truck,     accent: 'text-grubano-primary',        bg: 'bg-grubano-tint',              titleKey: 'supplierTitle',  descKey: 'supplierDesc' },
  creator:   { Icon: ChefHat,   accent: 'text-grubano-role-creator',   bg: 'bg-grubano-role-creator/12',   titleKey: 'creatorTitle',   descKey: 'creatorDesc' },
  logistics: { Icon: Bike,      accent: 'text-grubano-role-logistics', bg: 'bg-grubano-role-logistics/12', titleKey: 'logisticsTitle', descKey: 'logisticsDesc' },
  franchise: { Icon: Building2, accent: 'text-grubano-role-franchise', bg: 'bg-grubano-role-franchise/12', titleKey: 'franchiseTitle', descKey: 'franchiseDesc' },
  // Phase 6 Brique A — only ever reached when AFFILIATE_ENABLED is ON (gated below).
  affiliate: { Icon: Megaphone, accent: 'text-grubano-primary',        bg: 'bg-grubano-tint',              titleKey: 'affiliateTitle', descKey: 'affiliateDesc' },
}

export default async function AddActivityPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale)

  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) redirect('/auth/magic')

  const operator = await prisma.operator.findUnique({
    where:  { email },
    select: { id: true, role: true },
  })
  if (!operator) redirect('/auth/magic')

  const roles = await readOperatorRoles(operator.id, operator.role)
  // Phase 6 Brique A — the affiliate activity is offered ONLY when AFFILIATE_ENABLED is ON.
  const addable = addableActivities(roles, { includeAffiliate: isAffiliateEnabled() })
  // Best-effort: the B1.1 columns may not be migrated yet → no prefill, page still works.
  const anchor = await getOperatorCompanyIdentity(operator.id).catch(() => null)

  const t = await getTranslations('addActivity')

  return (
    <PartnerChrome>
      <div className="w-full max-w-2xl">
        <div className="mb-1 text-center sm:text-left">
          <h1 className="font-display text-[26px] font-extrabold leading-tight text-grubano-ink">{t('title')}</h1>
          <p className="mt-1.5 text-grubano-sm text-grubano-ink-muted">{t('subtitle')}</p>
        </div>

        {addable.length === 0 ? (
          <div className="mt-6">
            <EmptyState emoji="✅" title={t('empty')} />
          </div>
        ) : (
          <>
            <p className="mt-3 mb-3 text-[13px] text-grubano-ink-faint">{t('emailLocked')}</p>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {addable.map((activity) => {
                const c = CARDS[activity]
                const apply = activityMode(activity) === 'apply'
                return (
                  <li key={activity}>
                    <Link
                      href={activityHref(activity, email, anchor)}
                      className="group block h-full focus-visible:outline-none"
                    >
                      <Card elevation="sm" padding="md" interactive className="flex h-full flex-col gap-2.5">
                        <span className={`grid h-11 w-11 place-items-center rounded-grubano-md ${c.bg} ${c.accent}`}>
                          <c.Icon size={20} />
                        </span>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="font-display text-base font-extrabold text-grubano-ink">{t(c.titleKey)}</span>
                          {apply && (
                            <span className="rounded-grubano-pill bg-grubano-surface-muted px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-grubano-ink-faint">
                              {t('candidatureBadge')}
                            </span>
                          )}
                        </span>
                        <span className="text-grubano-sm leading-snug text-grubano-ink-muted">{t(c.descKey)}</span>
                        <span className="mt-auto inline-flex items-center gap-1 pt-1 text-grubano-sm font-bold text-grubano-primary">
                          {apply ? t('apply') : t('start')}
                          <ArrowRight size={15} className="shrink-0 transition-transform duration-150 group-hover:translate-x-0.5" />
                        </span>
                      </Card>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </PartnerChrome>
  )
}
