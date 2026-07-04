import { redirect } from 'next/navigation'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { resolveAdmin } from '@/lib/admin-guard'
import { buildAdminIdentity } from '@/lib/admin-identity'
import { isInfluencerEnabled } from '@/lib/influencer-verification'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import { isCourierActivationEnabled } from '@/lib/logistics-account'
import { isClaimsEnabled } from '@/lib/claims'
import AdminShell from '@/components/admin/AdminShell'
import AdminClaimsArbitration from '@/components/claims/AdminClaimsArbitration'

// ── /admin/claims — neutral admin arbitration console (P4.5-C2, Agent 53) ──────────
// ADM6 harmonisation: now mounts the AdminShell navy console + an --op- page header;
// the arbitration WIDGET (AdminClaimsArbitration) is unchanged — every wired action,
// route and money rule is byte-identical. Admin-only (resolveAdmin, equivalent to the
// prior inline triple-gate). Gated by CLAIMS_ENABLED (OFF → bounce to /admin/approvals
// → no claims UI exposed = byte-identical). The arbiter is NEVER a party (resto/client).
export const dynamic = 'force-dynamic'

export default async function AdminClaimsPage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)
  const t = await getTranslations('claims')

  const admin = await resolveAdmin()
  if (!admin) redirect('/eat')

  // Flag OFF → no claims console (byte-identical: the feature is inert everywhere).
  if (!isClaimsEnabled()) redirect('/admin/approvals')

  const identity = buildAdminIdentity(admin)
  const flags = {
    influencer: isInfluencerEnabled(),
    prestataire: isPrestataireEnabled(),
    logistics: isCourierActivationEnabled(),
  }

  return (
    <AdminShell identity={identity} flags={flags}>
      <section>
        <div className="op-dash__head">
          <h1 className="op-dash__title">{t('admin.title')}</h1>
          <p className="op-dash__sub">{t('admin.subtitle')}</p>
        </div>
        <AdminClaimsArbitration />
      </section>
    </AdminShell>
  )
}
