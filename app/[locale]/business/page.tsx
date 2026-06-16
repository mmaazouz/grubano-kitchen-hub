'use client'

import { useTranslations } from 'next-intl'
import { ArrowRight, LogIn, BadgeCheck, ShieldCheck, Layers } from 'lucide-react'
import { Link } from '@/navigation'
import PartnerChrome from '@/components/business/PartnerChrome'

// ── /business — premium partner LANDING (business.grubano.com root, Agent 14) ─
// The host root (middleware) now lands here. Hero + two CTAs ([Devenir partenaire]
// → the account-type choice; [Se connecter] → the unified passwordless login) +
// a reassurance band. PUBLIC (middleware /business allow-list). Pure presentation.
export default function BusinessLandingPage() {
  const t = useTranslations('business.landing')

  const reassure = [
    { icon: <BadgeCheck size={16} />, text: t('reassure1') },
    { icon: <ShieldCheck size={16} />, text: t('reassure2') },
    { icon: <Layers size={16} />,     text: t('reassure3') },
  ]

  return (
    <PartnerChrome>
      <div className="w-full max-w-2xl pt-6 text-center">
        <h1 className="font-display text-[32px] font-extrabold leading-[1.1] text-grubano-ink sm:text-[42px]">
          {t('heroTitle')}
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-grubano-base text-grubano-ink-muted">
          {t('heroSubtitle')}
        </p>

        <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/business/start"
            className="inline-flex w-full items-center justify-center gap-2 rounded-grubano-lg bg-grubano-primary px-6 py-3.5 font-semibold text-white shadow-grubano-sm transition-transform active:scale-[0.99] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-grubano-primary/30 sm:w-auto"
          >
            {t('ctaPrimary')} <ArrowRight size={18} />
          </Link>
          <Link
            href="/auth/magic"
            className="inline-flex w-full items-center justify-center gap-2 rounded-grubano-lg border border-grubano-border bg-white px-6 py-3.5 font-semibold text-grubano-ink transition-colors hover:bg-grubano-surface-muted focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-grubano-primary/20 sm:w-auto"
          >
            <LogIn size={18} /> {t('ctaSecondary')}
          </Link>
        </div>

        <ul className="mt-8 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-grubano-sm font-medium text-grubano-ink-muted">
          {reassure.map((r, i) => (
            <li key={i} className="inline-flex items-center gap-1.5">
              <span className="text-grubano-primary">{r.icon}</span>
              {r.text}
            </li>
          ))}
        </ul>
      </div>
    </PartnerChrome>
  )
}
