'use client'

import { Fragment } from 'react'
import { useTranslations } from 'next-intl'
import { Link } from '@/navigation'
import { LanguageSwitcher } from '@/components/design-system'
import './partner-shell.css'

// ── PartnerShell — chrome MAÎTRE du contexte PUBLIC / PARTENAIRE ─────────────
// Implémente la référence Design bankée scripts/design-qa-refs/partner-shell.html
// (Claude Design, 2026-08-23). Composant FRÈRE de PartnerChrome (décision
// fondateur) : les consommateurs historiques de PartnerChrome ne changent pas
// d'apparence ; la migration se fait route par route (/business, /business/start,
// /business/register, /business/verified, /business/onboarding).
//
// Un seul header, deux configurations pilotées par la prop `mode` :
//   • "vitrine"  → nav (≤ 3 entrées) + CTA, contenu 1080 px, footer complet ;
//   • "parcours" → nav masquée, lien « Quitter », frise d'étapes, colonne 560 px.
// La largeur dérive EXPLICITEMENT du mode (data-width posé par le composant — la
// référence le posait par son script de démonstration) et peut être forcée par
// `width`. Aucune magie DOM : nav / exit / frise sont rendus ou non selon le mode.
//
// Zéro fuite : tout le CSS vit sous `.pt-shell` (partner-shell.css) ; AppChrome,
// globals.css, OperatorShell, brand-fonts.css ne sont pas touchés. /business/* est
// déjà BARE dans AppChrome, le shell n'est donc jamais imbriqué dans OperatorShell.

export type PartnerShellMode = 'vitrine' | 'parcours'
export type PartnerStepState = 'done' | 'now' | 'todo'
export interface PartnerStep { label: string; state: PartnerStepState }
export interface PartnerNavLink { label: string; href: string }

export interface PartnerShellProps {
  mode: PartnerShellMode
  /** Vitrine only — header navigation (3 entries max per the reference). */
  nav?: PartnerNavLink[]
  /** Vitrine only — header call-to-action (pill). */
  cta?: PartnerNavLink
  /** Parcours only — where « Quitter » leads. Omit to hide the exit link. */
  exitHref?: string
  /** Parcours only — the step strip. Omit to hide the strip (no step invented). */
  steps?: PartnerStep[]
  /** Content column: 'content' = 1080 px, 'form' = 560 px. Defaults from mode. */
  width?: 'content' | 'form'
  /** Footer (brand + legal links + language switcher). Default true. */
  footer?: boolean
  children: React.ReactNode
}

const BRAND_SYMBOL = '/brand/grubano-symbol-color.svg' // same asset as OperatorShell

export default function PartnerShell({ mode, nav, cta, exitHref, steps, width, footer = true, children }: PartnerShellProps) {
  const t = useTranslations('business.shell')
  const tAuth = useTranslations('business.auth')
  const tLanding = useTranslations('business.landing')
  const tLegal = useTranslations('legal')
  const year = new Date().getFullYear()
  const bodyWidth = width ?? (mode === 'parcours' ? 'form' : 'content')
  const showSteps = mode === 'parcours' && !!steps && steps.length > 0

  return (
    <div className="pt-wrap">
      <div className="pt-shell" data-mode={mode} data-screen-label="PartnerShell">
        {/* ══ CHROME : header ══ */}
        <header className="pt-head">
          <div className="pt-head__in">
            <Link href="/business" className="pt-brand" aria-label="Grubano">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={BRAND_SYMBOL} alt="" />
              <b>Grubano</b>
              <span className="ctx">{tAuth('brandPartners')}</span>
            </Link>

            {mode === 'vitrine' && (nav?.length || cta) && (
              <nav className="pt-nav" aria-label={tAuth('brandPartners')}>
                {nav?.slice(0, 3).map((l) => (
                  <Link key={l.href + l.label} href={l.href}>{l.label}</Link>
                ))}
                {cta && (
                  <Link className="pt-nav__cta" href={cta.href}>
                    {cta.label}<span className="ms flip-rtl" aria-hidden="true">arrow_forward</span>
                  </Link>
                )}
              </nav>
            )}

            {mode === 'parcours' && exitHref && (
              <Link className="pt-head__exit" href={exitHref}>
                <span className="ms" aria-hidden="true">close</span>{t('exit')}
              </Link>
            )}
          </div>
        </header>

        {/* ══ CHROME : frise d'étapes (mode parcours uniquement) ══ */}
        {showSteps && (
          <div className="pt-steps" role="list" aria-label={t('stepsAria')}>
            <div className="pt-steps__in">
              {steps!.map((s, i) => (
                <Fragment key={s.label + i}>
                  {i > 0 && <span className="pt-step__bar" aria-hidden="true" />}
                  <div
                    className={`pt-step${s.state === 'done' ? ' is-done' : s.state === 'now' ? ' is-now' : ''}`}
                    role="listitem"
                    aria-current={s.state === 'now' ? 'step' : undefined}
                  >
                    <span className="pt-step__d">
                      {s.state === 'done' ? <span className="ms" style={{ fontSize: 14 }} aria-hidden="true">check</span> : i + 1}
                    </span>
                    <span className="pt-step__l">{s.label}</span>
                  </div>
                </Fragment>
              ))}
            </div>
          </div>
        )}

        {/* ══ Corps ══ */}
        <main className="pt-body" data-width={bodyWidth}>
          <section>{children}</section>
        </main>

        {/* ══ CHROME : footer ══ */}
        {footer && (
          <footer className="pt-foot">
            <div className="pt-foot__in">
              <div className="pt-foot__b">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={BRAND_SYMBOL} alt="" />
                <b>Grubano</b>
              </div>
              <div className="pt-foot__links">
                <Link href="/legal/mentions-legales">{tLanding('footerLegal')}</Link>
                <Link href="/legal/confidentialite">{tLegal('nav.confidentialite')}</Link>
                <Link href="/legal/cookies">{tLegal('nav.cookies')}</Link>
                <a href="mailto:contact@grubano.com?subject=Grubano%20partenaire">{t('contact')}</a>
                {/* Product behaviour preserved: the language switcher is not in the
                    reference but exists on the live landing — kept in the footer row. */}
                <LanguageSwitcher variant="compact" />
              </div>
              <div className="pt-foot__c">{tLanding('footerRights', { year })}</div>
            </div>
          </footer>
        )}
      </div>
    </div>
  )
}
