import { getServerSession } from 'next-auth'
import { setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { authOptions } from '@/lib/auth'
import { isMissionsEnabled } from '@/lib/missions'
import RequestDelivery from '@/components/logistics/RequestDelivery'
import DeliveriesPreview from '@/components/logistics/DeliveriesPreview'
import './deliveries.css'

// ── /deliveries — operator LIVRAISONS (brick 3, Agent 124 → re-skin CD v1 LOT 5) ──────
// A business operator (resto / supplier / franchise) manages the delivery side of orders.
//
// GATED by LOGISTICS_MISSIONS_ENABLED (default OFF — the courier network is not live yet).
// Founder-approved exception (« aperçu visible sous la coquille ») for THIS screen only:
//   • the page now renders UNDER the navy OperatorShell (its /deliveries entry was removed
//     from AppChrome BARE_PREFIXES — surgical, one entry, nothing else),
//   • when the flag is OFF (the default) we render the HONEST APERÇU (<DeliveriesPreview/>):
//     « Bientôt » banner, hatched GPS placeholder (NO fake live map), courier payout marked
//     inactive, all figures/amounts labelled « exemple », all action buttons inert. We do
//     NOT fabricate any data presented as real, and NO money moves.
//   • when the flag is ON, the functional <RequestDelivery/> form renders (its POST to
//     /api/logistics/missions/request is byte-identical; priceCents stays inert as today).
// The flag itself (lib/missions) is only READ here, never modified. The business-role auth
// guard below is preserved (defence in depth — the API re-checks).
export const dynamic = 'force-dynamic'

const REQUESTER_ROLES = ['restaurant', 'supplier', 'franchise', 'admin']

export default async function DeliveriesPage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)

  const session = await getServerSession(authOptions)
  const roles = ((session?.user as { roles?: unknown } | undefined)?.roles)
  const roleList = Array.isArray(roles) ? (roles as string[]) : []
  const single = (session?.user as { role?: string } | undefined)?.role
  const effective = roleList.length ? roleList : (single ? [single] : [])
  // Authorisation: business operators only (defence in depth — the API re-checks).
  if (!effective.some((r) => REQUESTER_ROLES.includes(r))) notFound()

  // Flag READ (never modified). OFF (the default) → honest aperçu under the shell.
  // ON → the functional courier-request form (unchanged data flow).
  return (
    <section className="op-deliveries-page">
      {isMissionsEnabled() ? <RequestDelivery /> : <DeliveriesPreview />}
    </section>
  )
}
