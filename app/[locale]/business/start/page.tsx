import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/navigation'
import PartnerShell from '@/components/business/PartnerShell'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import { isCreatorEnabled } from '@/lib/creator-account'
import { isSupplierEnabled } from '@/lib/supplier-account'
import { isFranchiseEnabled } from '@/lib/franchise-account'
import { isLogisticsEnabled } from '@/lib/logistics-account'
import { isAffiliateEnabled } from '@/lib/affiliate-account'
import './start.css'

/**
 * Account-type choice — « Quel type de partenaire êtes-vous ? » (maquette v1.5).
 *
 * One FEATURED Restaurateur card (the heart of Grubano) + the partner cards
 * (Supplier / Chef-creator / Logistics, + Prestataire when PRESTATAIRE_ENABLED is ON,
 * + Affiliate when AFFILIATE_ENABLED is ON) + a discreet Group & Franchise line. Routes
 * to the EXISTING journeys — nothing re-implemented:
 *   - Restaurateur  → /business/register
 *   - Fournisseur   → /supplier/register
 *   - Chef/Créateur → /creators/apply
 *   - Logistique    → /business/logistics/register
 *   - Prestataire   → /business/prestataire/register   (P1, gated PRESTATAIRE_ENABLED)
 *   - Recommander   → /affiliate/apply                 (Agent 118 pre-login affiliate
 *                     signup; gated AFFILIATE_ENABLED — the page 404s when OFF, so the
 *                     card is hidden then to avoid a dead link)
 *   - Franchise     → /franchise/apply                 (the real public franchise wizard)
 * No dead links. PUBLIC (middleware /business allow-list). SERVER component so the
 * prestataire + affiliate cards can be gated by the server-side flags (no client
 * interactivity here — only Links + translations).
 *
 * PRÉSENTATION (PartnerShell, mode parcours — référence partner-shell.html) : frise
 * d'étapes « Compte » (en cours) → Établissement → Vérification → Mise en ligne,
 * « Quitter » → /business, colonne formulaire 560 px, cartes / typographie de la
 * grammaire partenaire, Material Symbols. Routage et gating INCHANGÉS.
 */

type Partner = {
  key: string; href: string; icon: string; titleKey: string; descKey: string; soon: boolean
}

const BASE_PARTNERS: Partner[] = [
  { key: 'fournisseur', href: '/supplier/register',           icon: 'local_shipping', titleKey: 'fournisseurTitle', descKey: 'fournisseurDesc', soon: false },
  { key: 'creator',     href: '/creators/apply',              icon: 'skillet',        titleKey: 'creatorTitle',     descKey: 'creatorDesc',     soon: false },
  { key: 'logistique',  href: '/business/logistics/register', icon: 'two_wheeler',    titleKey: 'logistiqueTitle',  descKey: 'logistiqueDesc',  soon: false },
]

// P1 — the prestataire (services) card is offered ONLY when PRESTATAIRE_ENABLED is ON.
const PRESTATAIRE_PARTNER: Partner = {
  key: 'prestataire', href: '/business/prestataire/register', icon: 'handyman', titleKey: 'prestataireTitle', descKey: 'prestataireDesc', soon: false,
}

// Agent 119 (unification « recommander » incr. 2/3) — the affiliate (« recommander ») card
// points to the PRE-LOGIN affiliate signup /affiliate/apply (Agent 118). Offered ONLY when
// AFFILIATE_ENABLED is ON (the page 404s when OFF → a hidden card avoids a dead link, same
// pattern as the prestataire card). The « influenceur » 40 % tier is mentioned in the card
// copy, NOT a separate card. Replaces the old teaser that wrongly pointed to the creator wizard.
const AFFILIATE_PARTNER: Partner = {
  key: 'affiliate', href: '/affiliate/apply', icon: 'campaign', titleKey: 'affiliateTitle', descKey: 'affiliateDesc', soon: false,
}

export default async function BusinessStartPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale)
  const t = await getTranslations('business.start')
  const tShell = await getTranslations('business.shell')

  // Conditional cards avoid dead links: each gated surface 404s when its flag is OFF, so the
  // card is shown ONLY when its flag is ON. P0-38 — les 3 parcours historiques
  // (fournisseur, créateur, logistique) deviennent conditionnels comme prestataire/
  // affilié : un lien de navigation vers une capacité masquée est une promesse
  // fantôme (échec constaté par le fondateur). Rôles gelés → cartes ABSENTES.
  const ROLE_FLAG_OF: Record<string, () => boolean> = {
    fournisseur: isSupplierEnabled, creator: isCreatorEnabled, logistique: isLogisticsEnabled,
  }
  const partners: Partner[] = BASE_PARTNERS.filter((p) => ROLE_FLAG_OF[p.key]?.() ?? true)
  if (isPrestataireEnabled()) partners.push(PRESTATAIRE_PARTNER)
  if (isAffiliateEnabled()) partners.push(AFFILIATE_PARTNER)

  return (
    <PartnerShell
      mode="parcours"
      exitHref="/business"
      steps={[
        { label: tShell('stepAccount'),       state: 'now' },
        { label: tShell('stepEstablishment'), state: 'todo' },
        { label: tShell('stepVerification'),  state: 'todo' },
        { label: tShell('stepGoLive'),        state: 'todo' },
      ]}
    >
      <div className="st-head">
        <h1 className="t-h1">{t('title')}</h1>
        <p className="t-small">{t('subtitle')}</p>
      </div>

      {/* ── LE CŒUR DE GRUBANO — featured Restaurateur ── */}
      <p className="st-label">{t('coreLabel')}</p>
      <Link href="/business/register" className="card card--raised card__pad st-feat">
        <span className="st-feat__ic"><span className="ms" aria-hidden="true">storefront</span></span>
        <span>
          <span className="st-feat__t">
            <span className="t-h3">{t('restaurateurTitle')}</span>
            <span className="ms flip-rtl" aria-hidden="true">arrow_forward</span>
          </span>
          <span className="t-small" style={{ display: 'block', marginTop: 2 }}>{t('restaurateurDesc')}</span>
        </span>
      </Link>

      {/* ── LES PARTENAIRES — cards (label + grid only when at least one flag exposes a card) ── */}
      {partners.length > 0 && (<>
      <p className="st-label">{t('partnersLabel')}</p>
      <div className="st-grid">
        {partners.map(({ key, href, icon, titleKey, descKey, soon }) => (
          <Link key={key} href={href} className="card card__pad st-card">
            <span className="st-card__ic"><span className="ms" aria-hidden="true">{icon}</span></span>
            <span className="t-h3">
              {t(titleKey)}
              {soon && <> <span className="pill pill--todo">{t('logistiqueSoon')}</span></>}
            </span>
            <span className="t-small">{t(descKey)}</span>
          </Link>
        ))}
      </div>
      </>)}

      {/* ── Group & Franchise — discreet line (P0-38 : cachée rôle gelé) ── */}
      {isFranchiseEnabled() && (
        <p className="st-line t-small">
          {t('franchiseLine')}{' '}
          <Link href="/franchise/apply">{t('franchiseCta')}</Link>
        </p>
      )}

      {/* ── Already a partner ── */}
      <p className="st-line t-small">
        {t('alreadyAccount')}{' '}
        <Link href="/auth/magic">{t('signIn')}</Link>
      </p>

      {/* ── Other activity / contact (P4) ── */}
      <p className="st-line t-small" style={{ marginTop: 'var(--pt-2)' }}>
        {t('otherActivityPrompt')}{' '}
        <a href="mailto:contact@grubano.com?subject=Grubano%20partenaire">{t('otherActivityCta')}</a>
      </p>
    </PartnerShell>
  )
}
