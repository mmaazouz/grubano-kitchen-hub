'use client'

import { useTranslations } from 'next-intl'
import { Link } from '@/navigation'
import './EatStateScreen.css'
// gb-* design FOUNDATION (Agent 168) — tokens + Material `.ms` font. The `.gb` scope is
// normally supplied by the wrapping <EatShell/> (its root carries `.gb`), so in-shell
// callers (the /eat not-found + error boundaries) inherit every --gb-* token and the
// Material icon font. We import the tokens here too so a STANDALONE caller (an offline
// detector / delivery-zone guard mounted outside the shell) still renders correctly as
// long as it is itself wrapped in a `.gb` root.
import '@/app/gb-foundation/gb-tokens.css'
import '@/app/gb-foundation/gb-components.css'

// ── <EatStateScreen /> — CONSUMER « États d'erreur » (offline / 404 / zone) ───────────
//
// VERBATIM reproduction of the FROZEN CD ref (Notion 38efd2c9-…-98ed, eat/error-states.html).
// One presentational component renders all 3 CD variants via `variant`, so the App-Router
// boundary files (not-found.tsx → 'notfound', error.tsx → 'offline') and any future caller
// (a network-failure error boundary, a delivery-zone guard) share a single implementation.
//
// Tone (CC brief): calm, never blaming, always an exit (retry / go back). NO money flow —
// the only behaviour is navigation + the optional retry callback. Material icons, gb- tokens.
//
//   notfound → 404 route not-found  ·  Accueil / Chercher
//   offline  → soft network failure ·  Réessayer (onRetry) / Voir mes commandes
//   zone     → address outside the delivery area · Changer d'adresse / Me prévenir
//
// The « offline » FULLY-offline case is already covered by the PWA public/offline.html; this
// in-app STATE is for soft/recoverable network failures surfaced inside the running app.

export type EatStateVariant = 'notfound' | 'offline' | 'zone'

interface Props {
  variant: EatStateVariant
  /** offline: primary « Réessayer » handler (e.g. the error boundary's reset()). */
  onRetry?: () => void
  /** zone: prefilled address shown in the field (defaults to the CD placeholder address). */
  address?: string
  /** zone: « Me prévenir à l'ouverture » opt-in handler — when omitted the button is a no-op
   *  placeholder (CD intent: real opt-in if available, otherwise inert — NOT a money flow). */
  onNotify?: () => void
  /** zone: « Changer d'adresse » handler — when omitted the button is inert. */
  onChangeAddress?: () => void
}

export default function EatStateScreen({ variant, onRetry, address, onNotify, onChangeAddress }: Props) {
  const t = useTranslations('eat.errors')
  const dataErr = variant === 'notfound' ? '404' : variant

  return (
    <div className="gb-errstate" data-err={dataErr}>
      {variant === 'offline' && (
        <>
          <span className="off-pill"><i aria-hidden="true" />{t('offline.pill')}</span>
          <div className="err__art orange"><span className="ms" aria-hidden="true">wifi_off</span></div>
          <h1>{t('offline.title')}</h1>
          <p>{t('offline.body')}</p>
          <div className="err__cta">
            <button type="button" className="es-btn es-btn--primary" onClick={onRetry}>
              <span className="ms" aria-hidden="true">refresh</span>{t('offline.retry')}
            </button>
            <Link href="/eat/orders" className="es-btn es-btn--line">
              <span className="ms" aria-hidden="true">receipt_long</span>{t('offline.orders')}
            </Link>
          </div>
        </>
      )}

      {variant === 'notfound' && (
        <>
          <div className="err__code">404</div>
          <h1>{t('notfound.title')}</h1>
          <p>{t('notfound.body')}</p>
          <div className="err__cta">
            <Link href="/eat" className="es-btn es-btn--primary">
              <span className="ms" aria-hidden="true">home</span>{t('notfound.home')}
            </Link>
            <Link href="/eat/search" className="es-btn es-btn--line">
              <span className="ms" aria-hidden="true">search</span>{t('notfound.search')}
            </Link>
          </div>
        </>
      )}

      {variant === 'zone' && (
        <>
          <div className="err__art green">
            <span className="ms" aria-hidden="true">location_off</span>
            <span className="badge"><span className="ms" aria-hidden="true">two_wheeler</span></span>
          </div>
          <h1>{t('zone.title')}</h1>
          <p>{t('zone.body')}</p>
          <div className="zone-field">
            <span className="ms" aria-hidden="true">location_on</span>
            <input defaultValue={address} placeholder={t('zone.addressPlaceholder')} aria-label={t('zone.addressPlaceholder')} />
          </div>
          <div className="zone-note"><span className="ms" aria-hidden="true">notifications_active</span>{t('zone.note')}</div>
          <div className="err__cta">
            <button type="button" className="es-btn es-btn--primary" onClick={onChangeAddress}>
              <span className="ms" aria-hidden="true">edit_location</span>{t('zone.change')}
            </button>
            <button type="button" className="es-btn es-btn--line" onClick={onNotify}>
              <span className="ms" aria-hidden="true">mail</span>{t('zone.notify')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
