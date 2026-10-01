import { redirect } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { resolveAdmin } from '@/lib/admin-guard'
import { buildAdminIdentity } from '@/lib/admin-identity'
import { isInfluencerEnabled } from '@/lib/influencer-verification'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import { isCourierActivationEnabled } from '@/lib/logistics-account'
import { isLogisticsTrackingEnabled } from '@/lib/logistics-tracking'
import AdminShell from '@/components/admin/AdminShell'
import AdminTracking from '@/components/admin/AdminTracking'

// ── /admin/tracking — Géoloc ÉTAPE 4 — admin/support courier-position lookup (WHITELIST). ──────
// Admin-only (resolveAdmin → redirect otherwise). Looks up an order id → shows the courier's
// EXACT position (admin privilege; the order-owner client gets a coarsened one via the same
// endpoint). Gated by LOGISTICS_TRACKING_ENABLED — OFF → an honest "disabled" panel (no position
// surface, byte-identical to before this feature). NEVER exposes the position to a restaurant.

export const dynamic = 'force-dynamic'

export default async function AdminTrackingPage(props: { params: { locale: string } }) {
  const { locale } = props.params
  setRequestLocale(locale)

  const admin = await resolveAdmin()
  if (!admin) redirect('/eat')

  const identity = buildAdminIdentity(admin)
  const flags = {
    influencer: isInfluencerEnabled(),
    prestataire: isPrestataireEnabled(),
    logistics: isCourierActivationEnabled(),
  }

  return (
    <AdminShell identity={identity} flags={flags}>
      <section>
        <AdminTracking enabled={isLogisticsTrackingEnabled()} />
      </section>
    </AdminShell>
  )
}
