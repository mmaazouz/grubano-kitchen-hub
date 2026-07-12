import { getServerSession } from 'next-auth'
import { redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/navigation'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { readOperatorRoles } from '@/lib/operator-roles'
import { getOperatorCompanyIdentity } from '@/lib/operator-identity'
import { isAffiliateEnabled } from '@/lib/affiliate-account'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import { addableActivities, activityHref, activityMode, type AddableActivity } from '@/lib/add-activity'
import PartnerChrome from '@/components/business/PartnerChrome'
import './add-activity.css'

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
//
// 🔒 RE-SKIN (LOT 7, CD 391fd2c9-…-c820ba) — PRESENTATION ONLY. The content is
// restyled to the operator CD design language (--op-* aa-type cards, self-declared
// in add-activity.css since PartnerChrome does not carry those tokens). Material
// Symbols replace lucide. The ROUTING LOGIC is byte-identical: activityHref (email
// prefill+lock + editable siren/company on company-backed journeys), addableActivities
// (filters out roles already held), activityMode (apply vs register). No fetch /
// mutation / create happens here — the hub only ROUTES to the existing journeys.

// Per-activity presentation: the Material Symbol icon + the i18n title/description
// keys. The role token (accent tint) is applied in CSS via data-role.
const ACTIVITY_META: Record<AddableActivity, {
  icon:     string
  titleKey: 'supplierTitle' | 'creatorTitle' | 'logisticsTitle' | 'franchiseTitle' | 'affiliateTitle' | 'prestataireTitle'
  descKey:  'supplierDesc'  | 'creatorDesc'  | 'logisticsDesc'  | 'franchiseDesc'  | 'affiliateDesc'  | 'prestataireDesc'
}> = {
  supplier:    { icon: 'local_shipping',     titleKey: 'supplierTitle',    descKey: 'supplierDesc' },
  creator:     { icon: 'skillet',            titleKey: 'creatorTitle',     descKey: 'creatorDesc' },
  logistics:   { icon: 'delivery_dining',    titleKey: 'logisticsTitle',   descKey: 'logisticsDesc' },
  franchise:   { icon: 'branding_watermark', titleKey: 'franchiseTitle',   descKey: 'franchiseDesc' },
  affiliate:   { icon: 'campaign',           titleKey: 'affiliateTitle',   descKey: 'affiliateDesc' },
  prestataire: { icon: 'handyman',           titleKey: 'prestataireTitle', descKey: 'prestataireDesc' },
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
  // Phase 6 — the affiliate + prestataire activities are offered ONLY when their flag is ON.
  const addable = addableActivities(roles, {
    includeAffiliate:   isAffiliateEnabled(),
    includePrestataire: isPrestataireEnabled(),
  })
  // Best-effort: the B1.1 columns may not be migrated yet → no prefill, page still works.
  const anchor = await getOperatorCompanyIdentity(operator.id).catch(() => null)

  const t = await getTranslations('addActivity')

  return (
    <PartnerChrome>
      <section className="gb-op-aa">
        <Link href="/dashboard" className="back-link">
          <span className="ms flip-rtl">arrow_back</span>
          {t('back')}
        </Link>

        <h1 className="aa-title">{t('title')}</h1>
        <p className="aa-sub">{t('subtitle')}</p>

        {addable.length === 0 ? (
          <div className="aa-empty">
            <span className="ms">task_alt</span>
            <b>{t('empty')}</b>
            <span>{t('emailLocked')}</span>
          </div>
        ) : (
          <>
            <p className="aa-section-label">{t('sectionLabel')}</p>
            <ul className="aa-types">
              {addable.map((activity) => {
                const meta = ACTIVITY_META[activity]
                const apply = activityMode(activity) === 'apply'
                return (
                  <li key={activity}>
                    <Link
                      href={activityHref(activity, email, anchor)}
                      data-role={activity}
                      className="aa-type"
                    >
                      <span className="aa-type__ic"><span className="ms">{meta.icon}</span></span>
                      <span className="aa-type__head">
                        <b>{t(meta.titleKey)}</b>
                        {apply && <span className="aa-type__badge">{t('candidatureBadge')}</span>}
                      </span>
                      <span className="aa-type__desc">{t(meta.descKey)}</span>
                      <span className="aa-type__cta">
                        {apply ? t('apply') : t('start')}
                        <span className="ms flip-rtl">arrow_forward</span>
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>

            <div className="aa-note">
              <span className="ms">info</span>
              <p>{t('emailLocked')}</p>
            </div>
          </>
        )}
      </section>
    </PartnerChrome>
  )
}
