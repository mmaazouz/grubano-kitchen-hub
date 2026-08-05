import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/navigation'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import './marketplace.css'

// ── /marketplace — operator MARKETPLACE hub (WP-DES-01 honest re-skin). ──────────
// Renders UNDER the navy OperatorShell (not a BARE route). PRESENTATION-ONLY.
// HONEST: the payment / marketing "integrations" have NO connector rail yet, so
// they are listed inert with a « bientôt » badge — NO invented commission /
// rating / "Connecté" state and no plan-specific upsell (the previous emoji + fake
// 25%/4.8★/Lydia=connected demo data is gone). V3-1: the delivery-platform entries
// (third-party marketplaces) are REMOVED — no nonexistent integration may be shown
// to pilot operators, even inert. The two REAL destinations keep their links:
// supplier sourcing (always) and services discovery (flag-gated, hidden when
// OFF — no leak). ZERO money on this screen.

const integrations = [
  { name: 'Lydia',     cat: 'Payment'  },
  { name: 'SumUp',     cat: 'Payment'  },
  { name: 'Mailchimp', cat: 'Marketing' },
] as const

export default async function MarketplacePage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale)
  const t  = await getTranslations('marketplace')
  const tp = await getTranslations('marketplace.prestataires')
  // Services-discovery card is server-gated: hidden (no leak) when OFF.
  const showPrestataires = isPrestataireEnabled()

  return (
    <section className="mkt">
      <div className="op-dash__head">
        <h1 className="op-dash__title">{t('hubTitle')}</h1>
        <p className="op-dash__sub">{t('hubSubtitle')}</p>
      </div>

      {/* Real destinations */}
      <div className="op-card mkt-links">
        <Link href="/marketplace/suppliers" className="set-row">
          <span className="set-row__ic"><span className="ms" aria-hidden="true">inventory_2</span></span>
          <span className="set-row__m">
            <b>{t('hubSuppliersTitle')}</b>
            <span>{t('hubSuppliersDesc')}</span>
          </span>
          <span className="ms set-row__chev" aria-hidden="true">chevron_right</span>
        </Link>

        {showPrestataires && (
          <Link href="/marketplace/prestataires" className="set-row">
            <span className="set-row__ic"><span className="ms" aria-hidden="true">handyman</span></span>
            <span className="set-row__m">
              <b>{tp('discoverCardTitle')}</b>
              <span>{tp('discoverCardDesc')}</span>
            </span>
            <span className="ms set-row__chev" aria-hidden="true">chevron_right</span>
          </Link>
        )}
      </div>

      {/* Integrations — HONEST « bientôt » (no invented figures, no fake connected state) */}
      <div className="set-block">
        <div className="set-block__head">{t('hubIntegrationsTitle')}</div>
        <div className="op-card">
          {integrations.map((i) => (
            <div key={i.name} className="set-row is-inert">
              <span className="set-row__ic"><span className="ms" aria-hidden="true">extension</span></span>
              <span className="set-row__m">
                <b>{i.name}</b>
                <span>
                  {i.cat === 'Payment' ? t('hubCatPayment') : t('hubCatMarketing')}
                </span>
              </span>
              <span className="set-badge muted"><span className="dot" />{t('hubSoon')}</span>
            </div>
          ))}
        </div>
        <p className="mkt-note">{t('hubIntegrationsNote')}</p>
      </div>
    </section>
  )
}
