'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/navigation'
import {
  ChefHat,
  ShieldCheck,
  Store,
  UtensilsCrossed,
  Megaphone,
  Building2,
  ChevronRight,
} from 'lucide-react'
import { Card } from '@/components/design-system'

/**
 * Account-type selection screen (Brique 2 — Approche A).
 *
 * The entry point of business.grubano.com. It routes the visitor to the right
 * EXISTING journey — nothing is re-implemented here:
 *   - Restaurateur          → /business/auth        (current partner sign-in/up)
 *   - Créateur de recettes  → /creators/apply       (Agent 4, with YouTube check)
 *   - Affilié / Influenceur → /creators/apply?type=influencer (same journey;
 *                             the param is forward-compat — the page ignores it)
 *   - Franchiseur           → /business/franchise-soon (light placeholder; the
 *                             full franchisor journey is Brique 7)
 *
 * PUBLIC: /business/* is already in the middleware public allow-list. Links use
 * the locale-aware <Link> from @/navigation (locale-LESS hrefs → prefixed once).
 */

const CHOICES = [
  {
    key: 'restaurateur',
    href: '/business/auth',
    icon: Store,
    titleKey: 'restaurateurTitle',
    descKey: 'restaurateurDesc',
    accent: 'text-grubano-primary',
    bg: 'bg-grubano-tint',
  },
  {
    key: 'creator',
    href: '/creators/apply',
    icon: UtensilsCrossed,
    titleKey: 'creatorTitle',
    descKey: 'creatorDesc',
    accent: 'text-[#16A34A]',
    bg: 'bg-[#16A34A]/12',
  },
  {
    key: 'influencer',
    href: '/creators/apply?type=influencer',
    icon: Megaphone,
    titleKey: 'influencerTitle',
    descKey: 'influencerDesc',
    accent: 'text-[#8B5CF6]',
    bg: 'bg-[#8B5CF6]/12',
  },
  {
    key: 'franchisor',
    href: '/business/franchise-soon',
    icon: Building2,
    titleKey: 'franchisorTitle',
    descKey: 'franchisorDesc',
    accent: 'text-[#2563EB]',
    bg: 'bg-[#2563EB]/12',
  },
] as const

export default function BusinessStartPage() {
  const t = useTranslations('business.start')

  return (
    <Layout>
      <div className="w-full max-w-2xl">
        <div className="mb-6 text-center">
          <h1 className="font-display text-[28px] font-extrabold leading-tight text-grubano-ink">{t('title')}</h1>
          <p className="mt-2 text-grubano-sm text-grubano-ink-muted">{t('subtitle')}</p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {CHOICES.map(({ key, href, icon: Icon, titleKey, descKey, accent, bg }) => (
            <Link key={key} href={href} className="group block">
              <Card
                elevation="md"
                padding="md"
                interactive
                className="flex h-full items-start gap-3.5"
              >
                <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-grubano-md ${bg} ${accent}`}>
                  <Icon size={22} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="font-display text-base font-extrabold text-grubano-ink">{t(titleKey)}</span>
                    <ChevronRight
                      size={16}
                      className="text-grubano-ink-faint transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-grubano-primary"
                    />
                  </span>
                  <span className="mt-0.5 block text-grubano-sm leading-snug text-grubano-ink-muted">{t(descKey)}</span>
                </span>
              </Card>
            </Link>
          ))}
        </div>

        <p className="mt-6 text-center text-grubano-sm text-grubano-ink-muted">
          {t('alreadyAccount')}{' '}
          <Link href="/business/auth" className="font-bold text-grubano-primary hover:underline">
            {t('signIn')}
          </Link>
        </p>
      </div>
    </Layout>
  )
}

// ── Brand chrome (matches /business/auth + /business/verified) ──────────────

function Layout({ children }: { children: React.ReactNode }) {
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

      <main className="mx-auto flex max-w-6xl items-center justify-center px-5 pb-10 pt-10 md:pt-16">
        {children}
      </main>
    </div>
  )
}
