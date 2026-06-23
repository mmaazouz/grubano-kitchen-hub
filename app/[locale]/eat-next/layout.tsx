import { notFound } from 'next/navigation'
import { setRequestLocale } from 'next-intl/server'
import { isConsumerRedesignEnabled } from '@/lib/consumer-redesign'
import WireframeNav from '@/components/eat-next/WireframeNav'
import { StellarLogo } from '@/components/stellar'
import '../../stellar-theme.css'

// ── /eat-next — consumer redesign shell (Phase 1, Agent 127 wireframes → Agent 129 Stellar) ──
// GATED by CONSUMER_REDESIGN_ENABLED (default OFF) → the whole subtree notFound()s when OFF, so
// the CURRENT /eat app stays byte-identical. Now DRESSED with the Stellar Unity design system:
// the whole subtree is wrapped in `.grubano-v2` (scoped theme — tokens resolve only here) and the
// stellar-theme.css is loaded. Still mock data, still NO money wired (the checkout is a mock).
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
    <div className="grubano-v2 flex min-h-screen justify-center bg-stellar-surface-2 font-stellar-display">
      <div className="relative flex min-h-screen w-full max-w-[480px] flex-col bg-stellar-bg">
        {/* Header — Stellar orbital logo. */}
        <header className="sticky top-0 z-50 flex items-center justify-between border-b border-stellar-border bg-stellar-bg/95 px-4 py-2.5 backdrop-blur">
          <StellarLogo variant="full" size={26} />
          <span className="rounded-full bg-stellar-primary-soft px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-stellar-accent-fg">
            Prototype
          </span>
        </header>
        {/* Disclaimer — this is a prototype on sample data, payment not wired. */}
        <p className="bg-stellar-surface-1 px-4 py-1 text-center text-[11px] text-stellar-muted-fg">
          Prototype · données d’exemple · paiement non branché
        </p>
        <main className="flex-1 pb-16 text-stellar-fg">{children}</main>
        <WireframeNav />
      </div>
    </div>
  )
}
