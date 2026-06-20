import { getTranslations, setRequestLocale } from 'next-intl/server'
import { Link } from '@/navigation'
import { Store, Truck, UtensilsCrossed, Bike, Wrench, Megaphone, ChevronRight, ArrowRight } from 'lucide-react'
import { Card } from '@/components/design-system'
import PartnerChrome from '@/components/business/PartnerChrome'
import { isPrestataireEnabled } from '@/lib/prestataire-account'

/**
 * Account-type choice — « Quel type de partenaire êtes-vous ? » (maquette v1.5).
 *
 * One FEATURED Restaurateur card (the heart of Grubano) + the partner cards
 * (Supplier / Chef-creator / Logistics, + Prestataire when PRESTATAIRE_ENABLED is ON) +
 * a light influencer teaser + a discreet Group & Franchise line. Routes to the EXISTING
 * journeys — nothing re-implemented:
 *   - Restaurateur  → /business/register
 *   - Fournisseur   → /supplier/register
 *   - Chef/Créateur → /creators/apply
 *   - Logistique    → /business/logistics/register
 *   - Prestataire   → /business/prestataire/register   (P1, gated PRESTATAIRE_ENABLED)
 *   - Influenceur   → /creators/apply?type=influencer
 *   - Franchise     → /business/franchise-soon
 * No dead links. PUBLIC (middleware /business allow-list). SERVER component so the
 * prestataire card can be gated by the server-side PRESTATAIRE_ENABLED flag (no client
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

export default async function BusinessStartPage({ params }: { params: { locale: string } }) {
  setRequestLocale(params.locale)
  const t = await getTranslations('business.start')

  const partners = isPrestataireEnabled() ? [...BASE_PARTNERS, PRESTATAIRE_PARTNER] : BASE_PARTNERS

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

        {/* ── Influencer teaser (light) ── */}
        <Link
          href="/creators/apply?type=influencer"
          className="group mt-4 flex items-center gap-2.5 rounded-grubano-lg border border-grubano-border bg-white px-4 py-3 transition-colors hover:border-grubano-role-influencer/40 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-grubano-role-influencer/20"
        >
          <Megaphone size={18} className="shrink-0 text-grubano-role-influencer" />
          <span className="flex-1 text-grubano-sm text-grubano-ink-muted">{t('influencerTeaser')}</span>
          <ArrowRight size={16} className="shrink-0 text-grubano-ink-faint transition-transform duration-150 group-hover:translate-x-0.5" />
        </Link>

        {/* ── Group & Franchise — discreet line ── */}
        <p className="mt-5 text-center text-grubano-sm text-grubano-ink-muted">
          {t('franchiseLine')}{' '}
          <Link href="/business/franchise-soon" className="font-semibold text-grubano-primary hover:underline">
            {t('franchiseCta')}
          </Link>
        </p>

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
