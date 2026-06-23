import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { isConsumerRedesignEnabled } from '@/lib/consumer-redesign'
import WireframeNav from '@/components/eat-next/WireframeNav'

// ── /eat-next — consumer redesign WIREFRAMES shell (Phase 1, Agent 127) ────────
// LOW-FIDELITY clickable wireframes of the new purchase path. GATED by
// CONSUMER_REDESIGN_ENABLED (default OFF) → the whole subtree notFound()s when OFF, so
// the CURRENT /eat app stays byte-identical. Neutral styling ONLY (no design system /
// brand tokens — that comes next). Mock data, NO money wired. Public (middleware treats
// /eat-next as /eat-prefixed → no login required; the wireframe demonstrates the
// account-at-payment flow without a real session).
export const dynamic = 'force-dynamic'

export default function EatNextLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: { locale: string }
}) {
  setRequestLocale(params.locale)
  if (!isConsumerRedesignEnabled()) notFound()

  return (
    <div className="flex min-h-screen justify-center bg-neutral-200/50 font-sans text-neutral-900">
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-white">
        {/* Persistent wireframe disclaimer — this is NOT the final design. */}
        <div className="sticky top-0 z-50 bg-neutral-800 px-3 py-1.5 text-center text-[11px] font-medium text-neutral-100">
          MAQUETTE BASSE FIDÉLITÉ · données fictives · aucun paiement
        </div>
        <main className="flex-1 pb-16">{children}</main>
        <WireframeNav />
      </div>
    </div>
  )
}
