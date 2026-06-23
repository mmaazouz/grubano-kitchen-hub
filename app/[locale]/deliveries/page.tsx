import { getServerSession } from 'next-auth'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { notFound } from 'next/navigation'
import { Package } from 'lucide-react'
import { authOptions } from '@/lib/auth'
import { isMissionsEnabled } from '@/lib/missions'
import RequestDelivery from '@/components/logistics/RequestDelivery'
import RoleSwitcher from '@/components/RoleSwitcher'

// ── /deliveries — request a courier delivery (brick 3, Agent 124) ──────────────
// A business operator (resto / supplier / franchise) creates an OFFERED mission and tracks it.
// GATED: 404 when LOGISTICS_MISSIONS_ENABLED is OFF (the feature does not exist yet). The page
// is reachable by any authenticated operator (middleware lets it through — no role gate on this
// distinct prefix), and is AUTHORISED here at the page level + at the API: only business roles
// may request, and an operator only ever sees their OWN missions. Renders BARE (AppChrome
// BARE_PREFIXES) with its own sober header, like the logistics dashboard. NO money.
export const dynamic = 'force-dynamic'

const REQUESTER_ROLES = ['restaurant', 'supplier', 'franchise', 'admin']

export default async function DeliveriesPage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)

  // The whole surface does not exist while the flag is OFF.
  if (!isMissionsEnabled()) notFound()

  const session = await getServerSession(authOptions)
  const roles = ((session?.user as { roles?: unknown } | undefined)?.roles)
  const roleList = Array.isArray(roles) ? (roles as string[]) : []
  const single = (session?.user as { role?: string } | undefined)?.role
  const effective = roleList.length ? roleList : (single ? [single] : [])
  // Authorisation: business operators only (defence in depth — the API re-checks).
  if (!effective.some((r) => REQUESTER_ROLES.includes(r))) notFound()

  const t = await getTranslations('business.logistics.request')

  return (
    <div className="min-h-screen bg-grubano-bg">
      <header className="bg-grubano-ink text-white">
        <div className="mx-auto max-w-3xl px-5 py-5 flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-grubano-lg bg-grubano-primary/20">
            <Package size={18} className="text-grubano-primary" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-widest text-white/40">Grubano</p>
            <h1 className="font-display text-lg font-bold leading-tight truncate">{t('pageTitle')}</h1>
            <p className="text-xs text-white/50 truncate">{t('pageSubtitle')}</p>
          </div>
        </div>
      </header>

      <RoleSwitcher tone="light" />

      <main className="mx-auto max-w-3xl px-5 py-6">
        <RequestDelivery />
      </main>
    </div>
  )
}
