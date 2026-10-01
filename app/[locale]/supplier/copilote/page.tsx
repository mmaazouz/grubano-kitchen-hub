import { getServerSession } from 'next-auth'
import { getTranslations, setRequestLocale } from 'next-intl/server'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { EmptyState } from '@/components/design-system'
import SupplierShell from '@/components/supplier/SupplierShell'
import { buildSupplierIdentity } from '@/lib/supplier-identity'
import './supplier-copilote.css'

// ── /supplier/copilote — CD v1 Lot 6, HONEST INERT PREVIEW (violet). ──────────────
// The AI does not exist yet: a permanent "Aperçu — bientôt" banner, example exchanges
// and insights badged « Exemple », a DISABLED input + disabled send. Rendered fully
// server-side (no interactivity, no LLM call, no fabricated real analysis). The real
// onboarding help chat (OnboardingChat) stays gated on the dashboard; this is the
// honest preview of the future Copilote (decision 5).
export const dynamic = 'force-dynamic'

export default async function SupplierCopilotePage(props: { params: { locale: string } }) {
  setRequestLocale(props.params.locale)
  const t  = await getTranslations('supplierCopilot')
  const ts = await getTranslations('supplier')

  const session = await getServerSession(authOptions)
  const email = session?.user?.email
  if (!email) {
    return <div className="mx-auto max-w-xl px-5 pt-12"><EmptyState emoji="🔒" title={ts('noProfileTitle')} description={ts('noProfileBody')} /></div>
  }
  const profile = await prisma.supplierProfile.findUnique({ where: { email } }).catch(() => null)
  if (!profile) {
    return <div className="mx-auto max-w-xl px-5 pt-12"><EmptyState emoji="📦" title={ts('noProfileTitle')} description={ts('noProfileBody')} /></div>
  }
  const identity = buildSupplierIdentity(profile)
  const Ex = () => <span className="msg__ex"><span className="ms">science</span>{t('example')}</span>

  return (
    <SupplierShell identity={identity}>
      <section className="sup-cop">
        <div className="cop-banner">
          <span className="ms">auto_awesome</span>
          <div className="m"><b>{t('bannerTitle')}</b><span>{t('bannerBody')}</span></div>
          <span className="cop-soon-chip">{t('soon')}</span>
        </div>

        <div className="cop-grid">
          <div className="op-card" style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="cop-head">
              <span className="cop-head__ic"><span className="ms">auto_awesome</span></span>
              <div className="m"><b>{t('headTitle')}</b><span>{t('headSub')}</span></div>
            </div>

            <div className="cop-thread">
              <div className="msg user"><span className="msg__av">{identity.profileInitials}</span><div className="msg__bubble">{t('q1')}</div></div>
              <div className="msg ai"><span className="msg__av"><span className="ms">auto_awesome</span></span><div className="msg__bubble"><Ex />{t('a1')}</div></div>
              <div className="msg user"><span className="msg__av">{identity.profileInitials}</span><div className="msg__bubble">{t('q2')}</div></div>
              <div className="msg ai"><span className="msg__av"><span className="ms">auto_awesome</span></span><div className="msg__bubble"><Ex />{t('a2')}</div></div>
            </div>

            <div className="cop-suggestions">
              <span className="sugg-chip"><span className="ms">trending_down</span>{t('sugg1')}</span>
              <span className="sugg-chip"><span className="ms">campaign</span>{t('sugg2')}</span>
              <span className="sugg-chip"><span className="ms">route</span>{t('sugg3')}</span>
            </div>

            <div className="cop-inputbar">
              <div className="cop-input">{t('inputPlaceholder')}</div>
              <button className="cop-send" disabled aria-label={t('sendSoon')}><span className="ms">arrow_upward</span></button>
            </div>
          </div>

          <div className="insight-col">
            <div className="insight-title">{t('insightsTitle')}</div>
            <div className="insight-card">
              <div className="insight-card__top"><span className="insight-card__ic"><span className="ms">trending_down</span></span><span className="ex">{t('example')}</span></div>
              <b>{t('insight1Title')}</b>
              <p>{t('insight1Body')}</p>
            </div>
            <div className="insight-card">
              <div className="insight-card__top"><span className="insight-card__ic"><span className="ms">schedule</span></span><span className="ex">{t('example')}</span></div>
              <b>{t('insight2Title')}</b>
              <p>{t('insight2Body')}</p>
            </div>
          </div>
        </div>
      </section>
    </SupplierShell>
  )
}
