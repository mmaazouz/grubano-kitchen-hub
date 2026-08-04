import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/navigation'
import { Store, Truck, UtensilsCrossed, Bike, Wrench, Megaphone, ChevronRight } from 'lucide-react'
import { Card } from '@/components/design-system'
import PartnerChrome from '@/components/business/PartnerChrome'
import { isPrestataireEnabled } from '@/lib/prestataire-account'
import { isCreatorEnabled } from '@/lib/creator-account'
import { isSupplierEnabled } from '@/lib/supplier-account'
import { isFranchiseEnabled } from '@/lib/franchise-account'
import { isLogisticsEnabled } from '@/lib/logistics-account'
import { isAffiliateEnabled } from '@/lib/affiliate-account'

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
 */

type Partner = {
  key: string; href: string; icon: typeof Truck; titleKey: string; descKey: string
  accent: string; bg: string; soon: boolean
}

const BASE_PARTNERS: Partner[] = [
  { key: 'fournisseur', href: '/supplier/register',           icon: Truck,           titleKey: 'fournisseurTitle', descKey: 'fournisseurDesc', accent: 'text-grubano-primary',        bg: 'bg-grubano-tint',              soon: false },
  { key: 'creator',     href: '/creators/apply',              icon: UtensilsCrossed, titleKey: 'creatorTitle',     descKey: 'creatorDesc',     accent: 'text-grubano-role-creator',   bg: 'bg-grubano-role-creator/12',   soon: false },
  { key: 'logistique',  href: '/business/logistics/register', icon: Bike,            titleKey: 'logistiqueTitle',  descKey: 'logistiqueDesc',  accent: 'text-grubano-role-logistics', bg: 'bg-grubano-role-logistics/12', soon: false },
]

// P1 — the prestataire (services) card is offered ONLY when PRESTATAIRE_ENABLED is ON.
const PRESTATAIRE_PARTNER: Partner = {
  key: 'prestataire', href: '/business/prestataire/register', icon: Wrench, titleKey: 'prestataireTitle', descKey: 'prestataireDesc',
  accent: 'text-grubano-primary', bg: 'bg-grubano-tint', soon: false,
}

// Agent 119 (unification « recommander » incr. 2/3) — the affiliate (« recommander ») card
// points to the PRE-LOGIN affiliate signup /affiliate/apply (Agent 118). Offered ONLY when
// AFFILIATE_ENABLED is ON (the page 404s when OFF → a hidden card avoids a dead link, same
// pattern as the prestataire card). The « influenceur » 40 % tier is mentioned in the card
// copy, NOT a separate card. Replaces the old teaser that wrongly pointed to the creator wizard.
const AFFILIATE_PARTNER: Partner = {
  key: 'affiliate', href: '/affiliate/apply', icon: Megaphone, titleKey: 'affiliateTitle', descKey: 'affiliateDesc',
  accent: 'text-grubano-role-influencer', bg: 'bg-grubano-role-influencer/12', soon: false,
}

export default async function BusinessStartPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale)
  const t = await getTranslations('business.start')

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
    <PartnerChrome>
      <div className="w-full max-w-3xl">
        <div className="mb-7 text-center">
          <h1 className="font-display text-[28px] font-extrabold leading-tight text-grubano-ink">{t('title')}</h1>
          <p className="mt-2 text-grubano-sm text-grubano-ink-muted">{t('subtitle')}</p>
        </div>

        {/* ── LE CŒUR DE GRUBANO — featured Restaurateur ── */}
        <p className="mb-2 text-[11px] font-bold uppercase tracking-widest text-grubano-ink-faint">{t('coreLabel')}</p>
        <Link href="/business/register" className="group block">
          <Card elevation="md" padding="lg" interactive className="border-grubano-primary/30 bg-gradient-to-br from-grubano-tint/60 to-white">
            <div className="flex items-center gap-4">
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-grubano-lg bg-grubano-primary text-white shadow-grubano-sm">
                <Store size={26} />
              </span>
              <div className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5">
                  <span className="font-display text-lg font-extrabold text-grubano-ink">{t('restaurateurTitle')}</span>
                  <ChevronRight size={18} className="text-grubano-primary transition-transform duration-150 group-hover:translate-x-0.5" />
                </span>
                <span className="mt-0.5 block text-grubano-sm text-grubano-ink-muted">{t('restaurateurDesc')}</span>
              </div>
            </div>
          </Card>
        </Link>

        {/* ── LES PARTENAIRES — cards ── */}
        <p className="mb-2 mt-6 text-[11px] font-bold uppercase tracking-widest text-grubano-ink-faint">{t('partnersLabel')}</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {partners.map(({ key, href, icon: Icon, titleKey, descKey, accent, bg, soon }) => (
            <Link key={key} href={href} className="group block">
              <Card elevation="sm" padding="md" interactive className="flex h-full flex-col gap-2.5">
                <span className={`grid h-11 w-11 place-items-center rounded-grubano-md ${bg} ${accent}`}>
                  <Icon size={20} />
                </span>
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="font-display text-base font-extrabold text-grubano-ink">{t(titleKey)}</span>
                  {soon && (
                    <span className="rounded-grubano-pill bg-grubano-surface-muted px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-grubano-ink-faint">
                      {t('logistiqueSoon')}
                    </span>
                  )}
                </span>
                <span className="text-grubano-sm leading-snug text-grubano-ink-muted">{t(descKey)}</span>
              </Card>
            </Link>
          ))}
        </div>

        {/* ── Group & Franchise — discreet line (P0-38 : cachée rôle gelé) ── */}
        {isFranchiseEnabled() && (
          <p className="mt-5 text-center text-grubano-sm text-grubano-ink-muted">
            {t('franchiseLine')}{' '}
            <Link href="/franchise/apply" className="font-semibold text-grubano-primary hover:underline">
              {t('franchiseCta')}
            </Link>
          </p>
        )}

        {/* ── Already a partner ── */}
        <p className="mt-6 text-center text-grubano-sm text-grubano-ink-muted">
          {t('alreadyAccount')}{' '}
          <Link href="/auth/magic" className="font-bold text-grubano-primary hover:underline">
            {t('signIn')}
          </Link>
        </p>

        {/* ── Other activity / contact (P4) ── */}
        <p className="mt-2 text-center text-grubano-sm text-grubano-ink-muted">
          {t('otherActivityPrompt')}{' '}
          <a href="mailto:contact@grubano.com?subject=Grubano%20partenaire" className="font-semibold text-grubano-primary hover:underline">
            {t('otherActivityCta')}
          </a>
        </p>
      </div>
    </PartnerChrome>
  )
}
