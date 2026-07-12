'use client'

import { useTranslations } from 'next-intl'
import { ChefHat, ShieldCheck } from 'lucide-react'

// ── Shared partner-portal chrome (business.grubano.com, Agent 14) ─────────────
// The sober premium header used across the NEW partner entry surfaces (landing,
// account-type choice, logistics-soon). Mirrors the chrome the existing
// /business/auth + /business/onboarding pages render inline — extracted so the new
// premium pages stay visually consistent without touching the live auth flow.
export default function PartnerChrome({ children }: { children: React.ReactNode }) {
  const t = useTranslations('business.auth')
  return (
    <div className="min-h-screen bg-gradient-to-b from-white via-grubano-surface-muted/40 to-white">
      <header className="border-b border-grubano-border bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-grubano-md bg-grubano-dark text-grubano-primary shadow-grubano-sm">
              <ChefHat size={18} />
            </div>
            <div>
              <p className="font-display text-base font-extrabold leading-none text-grubano-ink">Grubano</p>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-grubano-primary">
                {t('brandPartners')}
              </p>
            </div>
          </div>
          <span className="hidden items-center gap-1.5 rounded-grubano-pill bg-grubano-tint px-3 py-1 text-xs font-semibold text-grubano-primary sm:inline-flex">
            <ShieldCheck size={13} />
            {t('verifiedSpace')}
          </span>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col items-center px-5 pb-12 pt-10 md:pt-14">
        {children}
      </main>
    </div>
  )
}
