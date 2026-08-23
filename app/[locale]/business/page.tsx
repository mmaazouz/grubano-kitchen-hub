'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/navigation'
import PartnerShell from '@/components/business/PartnerShell'
import './business-landing.css'

// ── /business — landing partenaire = PartnerShell HABITÉ (mode vitrine) ───────
// Présentation = la référence Design bankée scripts/design-qa-refs/partner-shell.html
// (Claude Design 2026-08-23) : chrome vitrine (nav + CTA, footer complet), hero
// (eyebrow, titre, lead, 2 CTA, note, visuel + 2 chips), trois piliers, bande de
// repères, bloc de clôture. Typographie / rythme / composants = partner-shell.css.
//
// Comportements produit PRÉSERVÉS : [Devenir partenaire] → /business/start et
// [Se connecter] → /auth/magic (hero, header, clôture), liens légaux + sélecteur
// de langue dans le footer du shell, i18n ×5 (les textes produit existants
// priment ; seuls les micro-textes propres à la référence — chips, bande — ont
// reçu de nouvelles clés business.landing.pt*). Les anciennes sections « Métiers »
// (4 cartes → /business/start) et « Comment ça marche » n'existent pas dans la
// référence : retirées de la landing ; leurs clés i18n restent en place et
// /business/start présente toujours les familles de partenaires.
// Material Symbols (ligatures .ms) comme dans la référence — pas de lucide ici.

export default function BusinessLandingPage() {
  const t = useTranslations('business.landing')
  const tAuth = useTranslations('business.auth')

  // Trois piliers — le trio de confiance du produit (clés existantes, i18n ×5).
  const pillars = [
    { icon: 'verified',     title: t('benefit1Title'), desc: t('benefit1Desc'), basil: false },
    { icon: 'lock',         title: t('benefit2Title'), desc: t('benefit2Desc'), basil: true },
    { icon: 'account_tree', title: t('benefit3Title'), desc: t('benefit3Desc'), basil: false },
  ]
  const band = [
    { value: t('ptBand1Value'), label: t('ptBand1Label') },
    { value: t('ptBand2Value'), label: t('ptBand2Label') },
    { value: t('ptBand3Value'), label: t('ptBand3Label') },
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
          <div className="hero__chip hero__chip--a">
            <span className="ic"><span className="ms">storefront</span></span>
            <div><b>{t('ptChip1Title')}</b><span>{t('ptChip1Sub')}</span></div>
          </div>
          <div className="hero__chip hero__chip--b">
            <span className="ic"><span className="ms">groups</span></span>
            <div><b>{t('ptChip2Title')}</b><span>{t('ptChip2Sub')}</span></div>
          </div>
        </div>
      </div>

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

      {/* ══ Bande de repères ══ */}
      <div className="card band">
        {band.map((b, i) => (
          <div key={i} className="band__c">
            <div className="band__v">{b.value}</div>
            <div className="band__l">{b.label}</div>
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
