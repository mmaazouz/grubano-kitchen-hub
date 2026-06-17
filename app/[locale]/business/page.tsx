'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  ChefHat, ArrowRight, LogIn, BadgeCheck, ShieldCheck, Layers,
  Store, Truck, UtensilsCrossed, Bike, ShoppingBag, TrendingUp, CreditCard, ChevronRight,
} from 'lucide-react'
import { Link } from '@/navigation'
import { cn } from '@/lib/utils'
import { LanguageSwitcher } from '@/components/design-system'

// ── /business — PREMIUM-but-SIMPLE partner landing (business.grubano.com root) ─
// Marketing vitrine: hero + product mockup → trades → how-it-works → benefits →
// final CTA → footer. PURE PRESENTATION; routes to existing journeys ([Devenir
// partenaire] → /business/start, [Se connecter] → /auth/magic). The trust trio
// (instant verification / secure payments / one account) lives in ONE place — the
// Benefits section — and is not repeated elsewhere. Reduced-motion safe.

/** Scroll-reveal wrapper — animates in once; reduced-motion shows immediately. */
function Reveal({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) { setShown(true); return }
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setShown(true); io.disconnect() } },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={cn(
        'transition-all duration-500 ease-out will-change-transform',
        shown ? 'translate-y-0 opacity-100' : 'translate-y-2 opacity-0 motion-reduce:translate-y-0 motion-reduce:opacity-100',
        className,
      )}
    >
      {children}
    </div>
  )
}

const PRIMARY_CTA =
  'inline-flex items-center justify-center gap-2 rounded-grubano-lg bg-grubano-primary px-6 py-3.5 font-semibold text-white shadow-grubano-cta transition-all duration-200 hover:bg-grubano-primaryHover hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-grubano-primary/30'
const SECONDARY_CTA =
  'inline-flex items-center justify-center gap-2 rounded-grubano-lg border border-grubano-border-strong bg-white px-6 py-3.5 font-semibold text-grubano-ink transition-colors duration-200 hover:bg-grubano-surface-muted focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-grubano-primary/20'

// Shared section-heading style — clean (bold, not extra-bold), tight tracking.
const H2 = 'font-display text-grubano-2xl font-bold tracking-tight text-grubano-ink sm:text-grubano-3xl'

export default function BusinessLandingPage() {
  const t = useTranslations('business.landing')
  const year = new Date().getFullYear()

  const trades = [
    { icon: Store,           title: t('tradeRestaurateur'), desc: t('tradeRestaurateurDesc') },
    { icon: Truck,           title: t('tradeFournisseur'),  desc: t('tradeFournisseurDesc') },
    { icon: UtensilsCrossed, title: t('tradeCreator'),      desc: t('tradeCreatorDesc') },
    { icon: Bike,            title: t('tradeLogistique'),   desc: t('tradeLogistiqueDesc') },
  ]
  const steps = [
    { title: t('step1Title'), desc: t('step1Desc') },
    { title: t('step2Title'), desc: t('step2Desc') },
    { title: t('step3Title'), desc: t('step3Desc') },
  ]
  // The trust trio — its single home on the page.
  const benefits = [
    { icon: BadgeCheck,  title: t('benefit1Title'), desc: t('benefit1Desc') },
    { icon: ShieldCheck, title: t('benefit2Title'), desc: t('benefit2Desc') },
    { icon: Layers,      title: t('benefit3Title'), desc: t('benefit3Desc') },
  ]

  return (
    <div className="min-h-screen bg-white text-grubano-ink">
      {/* ── Header ── */}
      <header className="sticky top-0 z-40 border-b border-grubano-border/70 bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3.5">
          <Link href="/business" className="flex items-center gap-2.5" aria-label="Grubano">
            <span className="grid h-9 w-9 place-items-center rounded-grubano-md bg-grubano-dark text-grubano-primary shadow-grubano-sm">
              <ChefHat size={18} />
            </span>
            <span className="leading-none">
              <span className="block font-display text-base font-bold text-grubano-ink">Grubano</span>
              <span className="block text-[11px] font-semibold uppercase tracking-wide text-grubano-primary">{t('heroEyebrow')}</span>
            </span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            <Link href="/auth/magic" className="hidden rounded-grubano-md px-3 py-2 text-grubano-sm font-semibold text-grubano-ink-muted transition-colors hover:text-grubano-ink sm:inline-flex">
              {t('ctaSecondary')}
            </Link>
            <Link href="/business/start" className="inline-flex items-center gap-1.5 rounded-grubano-lg bg-grubano-primary px-4 py-2 text-grubano-sm font-semibold text-white shadow-grubano-sm transition-colors hover:bg-grubano-primaryHover focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-grubano-primary/30">
              {t('ctaPrimary')} <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        {/* subtle decorative backdrop: soft orange glow + faint dot grid */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="absolute -top-32 end-[-10%] h-[460px] w-[460px] rounded-full bg-grubano-primary/[0.08] blur-3xl" />
          <div
            className="absolute inset-0 opacity-[0.45]"
            style={{
              backgroundImage: 'radial-gradient(circle, rgba(20,20,20,0.045) 1px, transparent 1px)',
              backgroundSize: '26px 26px',
              maskImage: 'radial-gradient(ellipse 80% 55% at 50% 0%, black 35%, transparent 72%)',
              WebkitMaskImage: 'radial-gradient(ellipse 80% 55% at 50% 0%, black 35%, transparent 72%)',
            }}
          />
        </div>

        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-16 pt-14 md:pt-20 lg:grid-cols-2 lg:gap-10 lg:pb-24">
          <div className="motion-safe:animate-slide-up">
            <span className="inline-flex items-center gap-1.5 rounded-grubano-pill bg-grubano-tint px-3 py-1 text-grubano-xs font-bold uppercase tracking-wide text-grubano-primary">
              <Sparkle /> {t('heroEyebrow')}
            </span>
            <h1
              className="mt-4 font-display font-bold tracking-tight text-grubano-ink"
              style={{ fontSize: 'clamp(2.25rem, 4.8vw, 3.75rem)', lineHeight: 1.08 }}
            >
              {t('heroTitle')}
            </h1>
            <p className="mt-5 max-w-xl text-grubano-lg leading-relaxed text-grubano-ink-muted">{t('heroSubtitle')}</p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/business/start" className={cn(PRIMARY_CTA, 'w-full sm:w-auto')}>
                {t('ctaPrimary')} <ArrowRight size={18} />
              </Link>
              <Link href="/auth/magic" className={cn(SECONDARY_CTA, 'w-full sm:w-auto')}>
                <LogIn size={18} /> {t('ctaSecondary')}
              </Link>
            </div>
          </div>

          {/* Product mockup — faux "espace partenaire" */}
          <div className="mx-auto motion-safe:animate-fade-in lg:mx-0 lg:justify-self-end" style={{ animationDelay: '120ms' }}>
            <HeroMockup />
          </div>
        </div>
      </section>

      {/* ── Métiers (tinted band) ── */}
      <section className="border-y border-grubano-border bg-grubano-surface-muted/40">
        <div className="mx-auto max-w-6xl px-5 py-20 md:py-24">
          <Reveal className="mx-auto max-w-2xl text-center">
            <h2 className={H2}>{t('tradesTitle')}</h2>
            <p className="mt-3 text-grubano-base text-grubano-ink-muted">{t('tradesSubtitle')}</p>
          </Reveal>
          <div className="mt-10 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            {trades.map((tr, i) => (
              <Reveal key={i} delay={i * 70}>
                <Link
                  href="/business/start"
                  className="group flex h-full flex-col gap-2.5 rounded-grubano-xl border border-grubano-border bg-white p-5 shadow-grubano-sm transition-all duration-200 hover:-translate-y-1 hover:border-grubano-primary/30 hover:shadow-grubano-lg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-grubano-primary/20"
                >
                  <span className="grid h-11 w-11 place-items-center rounded-grubano-md bg-grubano-tint text-grubano-primary">
                    <tr.icon size={20} />
                  </span>
                  <span className="flex items-center gap-1 font-display text-grubano-lg font-bold text-grubano-ink">
                    {tr.title}
                    <ChevronRight size={16} className="text-grubano-ink-faint transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-grubano-primary" />
                  </span>
                  <span className="text-grubano-sm leading-snug text-grubano-ink-muted">{tr.desc}</span>
                </Link>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works (white) ── */}
      <section className="mx-auto max-w-5xl px-5 py-20 md:py-24">
        <Reveal className="mx-auto max-w-2xl text-center">
          <h2 className={H2}>{t('howTitle')}</h2>
          <p className="mt-3 text-grubano-base text-grubano-ink-muted">{t('howSubtitle')}</p>
        </Reveal>
        <div className="mt-12 grid grid-cols-1 gap-8 sm:grid-cols-3">
          {steps.map((s, i) => (
            <Reveal key={i} delay={i * 90} className="relative text-center">
              <div className="mx-auto grid h-12 w-12 place-items-center rounded-grubano-pill bg-grubano-dark font-display text-grubano-lg font-bold text-grubano-primary shadow-grubano-sm">
                {i + 1}
              </div>
              <h3 className="mt-4 font-display text-grubano-lg font-bold text-grubano-ink">{s.title}</h3>
              <p className="mx-auto mt-1.5 max-w-xs text-grubano-sm leading-snug text-grubano-ink-muted">{s.desc}</p>
              {i < steps.length - 1 && (
                <span aria-hidden className="absolute end-[-20px] top-6 hidden h-px w-10 bg-grubano-border-strong sm:block" />
              )}
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Benefits (tinted band) — the single home of the trust trio ── */}
      <section className="border-y border-grubano-border bg-grubano-surface-muted/40">
        <div className="mx-auto max-w-6xl px-5 py-20 md:py-24">
          <Reveal className="mx-auto max-w-2xl text-center">
            <h2 className={H2}>{t('benefitsTitle')}</h2>
          </Reveal>
          <div className="mt-10 grid grid-cols-1 gap-3.5 md:grid-cols-3">
            {benefits.map((b, i) => (
              <Reveal key={i} delay={i * 80}>
                <div className="flex h-full flex-col gap-2.5 rounded-grubano-xl border border-grubano-border bg-white p-5 shadow-grubano-sm transition-all duration-200 hover:border-grubano-border-strong hover:shadow-grubano-md">
                  <span className="grid h-11 w-11 place-items-center rounded-grubano-md bg-grubano-tint text-grubano-primary">
                    <b.icon size={20} />
                  </span>
                  <h3 className="font-display text-grubano-lg font-bold text-grubano-ink">{b.title}</h3>
                  <p className="text-grubano-sm leading-relaxed text-grubano-ink-muted">{b.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── Final CTA (white) ── */}
      <section className="px-5 py-20 md:py-24">
        <Reveal className="mx-auto max-w-4xl">
          <div className="relative overflow-hidden rounded-grubano-2xl border border-grubano-primary/20 bg-gradient-to-br from-grubano-tint via-white to-grubano-tint/50 px-6 py-12 text-center shadow-grubano-md sm:px-12 sm:py-16">
            <h2 className={H2}>{t('finalTitle')}</h2>
            <p className="mx-auto mt-3 max-w-md text-grubano-base text-grubano-ink-muted">{t('finalSubtitle')}</p>
            <div className="mt-7 flex justify-center">
              <Link href="/business/start" className={PRIMARY_CTA}>
                {t('ctaPrimary')} <ArrowRight size={18} />
              </Link>
            </div>
          </div>
        </Reveal>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-grubano-border bg-grubano-surface-muted/40">
        <div className="mx-auto max-w-6xl px-5 py-10">
          <div className="flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
            <div className="max-w-xs">
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-grubano-md bg-grubano-dark text-grubano-primary">
                  <ChefHat size={16} />
                </span>
                <span className="font-display text-grubano-base font-bold text-grubano-ink">Grubano</span>
              </div>
              <p className="mt-2 text-grubano-sm text-grubano-ink-muted">{t('footerTagline')}</p>
            </div>
            <nav className="flex flex-wrap items-center gap-x-6 gap-y-2 text-grubano-sm font-semibold text-grubano-ink-muted">
              <Link href="/business/start" className="transition-colors hover:text-grubano-primary">{t('ctaPrimary')}</Link>
              <Link href="/auth/magic" className="transition-colors hover:text-grubano-primary">{t('ctaSecondary')}</Link>
              <Link href="/legal/mentions-legales" className="transition-colors hover:text-grubano-primary">{t('footerLegal')}</Link>
              <LanguageSwitcher variant="compact" />
            </nav>
          </div>
          <p className="mt-8 border-t border-grubano-border pt-5 text-grubano-xs text-grubano-ink-faint">{t('footerRights', { year })}</p>
        </div>
      </footer>
    </div>
  )
}

/** Small inline sparkle dot for the eyebrow (avoids an extra icon import weight). */
function Sparkle() {
  return <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full bg-grubano-primary" />
}

// ── Faux "espace partenaire" preview — built in HTML/CSS, no stock photo ──────
function HeroMockup() {
  const t = useTranslations('business.landing')
  const rows = [
    { icon: <ShoppingBag size={13} />, label: t('mockRow1') },
    { icon: <Layers size={13} />,      label: t('mockRow2') },
    { icon: <CreditCard size={13} />,  label: t('mockRow3') },
  ]
  return (
    <div className="w-full max-w-md overflow-hidden rounded-grubano-xl border border-grubano-border bg-white shadow-grubano-premium">
      {/* browser chrome */}
      <div className="flex items-center gap-2 border-b border-grubano-border bg-grubano-surface-muted/70 px-3 py-2.5">
        <span className="flex gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-grubano-border-strong" />
          <span className="h-2.5 w-2.5 rounded-full bg-grubano-border-strong" />
          <span className="h-2.5 w-2.5 rounded-full bg-grubano-border-strong" />
        </span>
        <span className="mx-auto flex items-center gap-1.5 rounded-grubano-pill bg-white px-3 py-1 text-[11px] font-medium text-grubano-ink-faint shadow-grubano-sm">
          <ShieldCheck size={11} className="text-grubano-ink-faint" /> {t('mockUrl')}
        </span>
      </div>

      {/* dashboard body */}
      <div className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-3">
          <MetricCard icon={<ShoppingBag size={14} />} label={t('mockOrders')} value="1 248" trend="+12%" />
          <MetricCard icon={<TrendingUp size={14} />} label={t('mockRevenue')} value="8 640 €" trend="+8%" />
        </div>
        <div className="rounded-grubano-md border border-grubano-border bg-white p-3">
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-grubano-ink-faint">{t('mockActivity')}</p>
          <ul className="space-y-2">
            {rows.map((r, i) => (
              <li key={i} className="flex items-center gap-2.5">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-grubano-sm bg-grubano-tint text-grubano-primary">{r.icon}</span>
                <span className="flex-1 text-grubano-xs font-medium text-grubano-ink">{r.label}</span>
                <span className="h-1.5 w-10 rounded-grubano-pill bg-grubano-surface-muted" />
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function MetricCard({ icon, label, value, trend }: { icon: React.ReactNode; label: string; value: string; trend: string }) {
  return (
    <div className="rounded-grubano-md border border-grubano-border bg-white p-3">
      <div className="flex items-center gap-1.5 text-grubano-ink-faint">
        <span className="text-grubano-primary">{icon}</span>
        <span className="text-[11px] font-semibold uppercase tracking-wide">{label}</span>
      </div>
      <p className="mt-1.5 font-display text-grubano-xl font-bold text-grubano-ink">{value}</p>
      <p className="mt-0.5 inline-flex items-center gap-0.5 text-[11px] font-bold text-grubano-success">
        <TrendingUp size={11} /> {trend}
      </p>
    </div>
  )
}
