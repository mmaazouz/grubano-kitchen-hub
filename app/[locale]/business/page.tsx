'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Store, Truck, UtensilsCrossed, Bike, ChevronRight } from 'lucide-react'
import { Link } from '@/navigation'
import { cn } from '@/lib/utils'
import PartnerShell from '@/components/business/PartnerShell'
import './business-landing.css'

// ── /business — landing partenaire = PartnerShell HABITÉ (mode vitrine) ───────
// Présentation = la référence Design bankée scripts/design-qa-refs/partner-shell.html
// (Claude Design 2026-08-23) : chrome vitrine (nav + CTA, footer complet), hero
// (eyebrow, titre, lead, 2 CTA, note, visuel), trois piliers, bloc de clôture.
// Typographie / rythme / composants = partner-shell.css.
//
// ARBITRAGES FONDATEUR (correction finale) :
//  · les sections historiques « Métiers » et « Comment ça marche » sont RESTAURÉES
//    VERBATIM depuis develop@94a416c (balisage, textes i18n, liens, Reveal, icônes
//    lucide, classes Tailwind) et simplement montées sous le PartnerShell — aucune
//    recomposition ; leur refonte visuelle est une lacune Design séparée ;
//  · la bande de repères (« 3 modes » / « 15 min » / « 0 € ») et les chips du visuel
//    de la référence sont RETIRÉES : aucun texte produit existant ne leur correspond
//    et aucun engagement commercial non validé n'est publié ; aucun texte de
//    substitution n'est inventé.
// Comportements produit PRÉSERVÉS : [Devenir partenaire] → /business/start et
// [Se connecter] → /auth/magic (hero, header, clôture), liens légaux + sélecteur de
// langue dans le footer du shell, i18n ×5 (aucune nouvelle clé de contenu).

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

// Shared section-heading style — clean (bold, not extra-bold), tight tracking.
const H2 = 'font-display text-grubano-2xl font-bold tracking-tight text-grubano-ink sm:text-grubano-3xl'

export default function BusinessLandingPage() {
  const t = useTranslations('business.landing')
  const tAuth = useTranslations('business.auth')

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
  // Trois piliers — le trio de confiance du produit (clés existantes, i18n ×5).
  const pillars = [
    { icon: 'verified',     title: t('benefit1Title'), desc: t('benefit1Desc'), basil: false },
    { icon: 'lock',         title: t('benefit2Title'), desc: t('benefit2Desc'), basil: true },
    { icon: 'account_tree', title: t('benefit3Title'), desc: t('benefit3Desc'), basil: false },
  ]

  return (
    <PartnerShell
      mode="vitrine"
      nav={[{ label: t('ctaSecondary'), href: '/auth/magic' }]}
      cta={{ label: t('ctaPrimary'), href: '/business/start' }}
    >
      {/* ══ Hero ══ */}
      <div className="hero">
        <div>
          <span className="t-eyebrow">{t('heroEyebrow')}</span>
          <h1 className="t-hero" style={{ marginTop: 'var(--pt-4)' }}>{t('heroTitle')}</h1>
          <p className="t-lead" style={{ marginTop: 'var(--pt-4)', maxWidth: 480 }}>{t('heroSubtitle')}</p>
          <div className="hero__cta">
            <Link className="btn btn--lg btn--primary" href="/business/start">
              <span className="ms" aria-hidden="true">rocket_launch</span>{t('ctaPrimary')}
            </Link>
            <Link className="btn btn--lg btn--secondary" href="/auth/magic">
              <span className="ms" aria-hidden="true">login</span>{t('ctaSecondary')}
            </Link>
          </div>
          <div className="hero__note"><span className="ms" aria-hidden="true">check_circle</span>{tAuth('heroBullet1')}</div>
        </div>
        <div className="hero__art" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/grubano-symbol-color.svg" alt="" />
        </div>
      </div>

      {/* ══ Sections historiques — restaurées VERBATIM depuis develop@94a416c ══ */}
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

      {/* ══ Trois piliers ══ */}
      <div className="tri">
        {pillars.map((p) => (
          <div key={p.icon} className={`card tri__it${p.basil ? ' basil' : ''}`}>
            <div className="tri__ic"><span className="ms" aria-hidden="true">{p.icon}</span></div>
            <h3 className="t-h3">{p.title}</h3>
            <p className="t-small">{p.desc}</p>
          </div>
        ))}
      </div>

      {/* ══ Clôture ══ */}
      <div className="close">
        <div className="close__in">
          <h2 className="t-h1">{t('finalTitle')}</h2>
          <p>{t('finalSubtitle')}</p>
          <Link className="btn btn--lg btn--primary" href="/business/start">
            <span className="ms" aria-hidden="true">rocket_launch</span>{t('ctaPrimary')}
          </Link>
        </div>
      </div>
    </PartnerShell>
  )
}
