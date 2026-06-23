import '../../../stellar-theme.css'
import {
  StellarButton, StellarCard, StellarBadge, StellarInput,
  StellarPriceTag, StellarRestaurantCard, StellarLogo,
} from '@/components/stellar'

// ── /eat-next/design-system — Stellar Unity showcase (Phase 1, Agent 128) ──────
// GATED by the eat-next layout (notFound() when CONSUMER_REDESIGN_ENABLED is OFF). Renders
// the scoped design system for visual validation: logo, color tokens (light + dark), type
// scale, spacing/radii/shadows, and the primitive components. Everything lives inside a
// `.grubano-v2` wrapper so the Stellar tokens apply ONLY here. Pure design — no money, no data.
export const dynamic = 'force-dynamic'

const SWATCHES = [
  ['primary', 'bg-stellar-primary'], ['primary-soft', 'bg-stellar-primary-soft'],
  ['accent', 'bg-stellar-accent'], ['surface-1', 'bg-stellar-surface-1'],
  ['surface-2', 'bg-stellar-surface-2'], ['card', 'bg-stellar-card'],
  ['success', 'bg-stellar-success'], ['warning', 'bg-stellar-warning'],
  ['info', 'bg-stellar-info'], ['ai', 'bg-stellar-ai'],
  ['destructive', 'bg-stellar-destructive'], ['border', 'bg-stellar-border'],
] as const

const TYPE = [
  ['text-5xl', '5xl'], ['text-3xl', '3xl'], ['text-2xl', '2xl'],
  ['text-xl', 'xl'], ['text-base', 'base'], ['text-sm', 'sm'], ['text-xs', 'xs'],
] as const

function Swatches() {
  return (
    <div className="grid grid-cols-3 gap-2">
      {SWATCHES.map(([name, cls]) => (
        <div key={name} className="overflow-hidden rounded-stellar-md border border-stellar-border">
          <div className={`h-10 ${cls}`} />
          <p className="bg-stellar-card px-1.5 py-1 text-[10px] text-stellar-muted-fg">{name}</p>
        </div>
      ))}
    </div>
  )
}

function Panel() {
  return (
    <div className="space-y-6 bg-stellar-bg p-4 text-stellar-fg">
      <Swatches />

      <section>
        <p className="mb-2 font-stellar-display text-sm font-bold uppercase tracking-wide text-stellar-muted-fg">Typographie · Plus Jakarta Sans</p>
        <div className="space-y-1">
          {TYPE.map(([cls, label]) => (
            <p key={label} className={`font-stellar-display font-bold ${cls}`}>Aa <span className="font-stellar-mono text-xs font-normal text-stellar-muted-fg">{label}</span></p>
          ))}
        </div>
      </section>

      <section>
        <p className="mb-2 font-stellar-display text-sm font-bold uppercase tracking-wide text-stellar-muted-fg">Rayons & ombres</p>
        <div className="flex flex-wrap gap-3">
          <div className="h-14 w-14 rounded-stellar-lg bg-stellar-card shadow-stellar-soft" />
          <div className="h-14 w-14 rounded-stellar-xl bg-stellar-card shadow-stellar-elev" />
          <div className="h-14 w-14 rounded-stellar-2xl bg-stellar-card shadow-stellar-glow" />
          <div className="h-14 w-14 rounded-stellar-3xl bg-stellar-card shadow-stellar-ai" />
        </div>
      </section>

      <section className="space-y-2">
        <p className="font-stellar-display text-sm font-bold uppercase tracking-wide text-stellar-muted-fg">Boutons</p>
        <div className="flex flex-wrap gap-2">
          <StellarButton variant="primary">Commander</StellarButton>
          <StellarButton variant="secondary">Voir le menu</StellarButton>
          <StellarButton variant="ghost">Plus tard</StellarButton>
          <StellarButton variant="danger">Annuler</StellarButton>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StellarButton size="sm">sm</StellarButton>
          <StellarButton size="md">md</StellarButton>
          <StellarButton size="lg">lg</StellarButton>
        </div>
      </section>

      <section className="space-y-2">
        <p className="font-stellar-display text-sm font-bold uppercase tracking-wide text-stellar-muted-fg">Badges</p>
        <div className="flex flex-wrap gap-2">
          <StellarBadge tone="primary">Populaire</StellarBadge>
          <StellarBadge tone="success">Ouvert</StellarBadge>
          <StellarBadge tone="warning">Bientôt fermé</StellarBadge>
          <StellarBadge tone="info">Nouveau</StellarBadge>
          <StellarBadge tone="ai">IA</StellarBadge>
          <StellarBadge tone="danger">Indispo</StellarBadge>
          <StellarBadge tone="neutral">Neutre</StellarBadge>
        </div>
      </section>

      <section className="space-y-2">
        <p className="font-stellar-display text-sm font-bold uppercase tracking-wide text-stellar-muted-fg">Champ & carte</p>
        <StellarInput label="Email" hint="On vous envoie un lien — sans mot de passe." placeholder="vous@email.com" />
        <StellarCard padding="md" interactive>
          <div className="flex items-center justify-between">
            <span className="font-stellar-display font-semibold">Gnocchi 4 fromages</span>
            <StellarPriceTag amountEur={12.9} size="md" />
          </div>
        </StellarCard>
        <StellarRestaurantCard name="Gnocchi Bar" cuisine="Pâtes italiennes" rating={4.8} deliveryFeeEur={1.99} etaMin={25} tag="Populaire" />
      </section>
    </div>
  )
}

export default function StellarShowcase() {
  return (
    <div className="grubano-v2">
      <header className="flex items-center justify-between bg-stellar-bg p-4">
        <StellarLogo variant="full" />
        <div className="flex items-center gap-2">
          <StellarLogo variant="mark" size={28} />
          <StellarLogo variant="favicon" size={20} />
        </div>
      </header>

      <Panel />

      {/* Dark theme preview — nested wrapper carries `.dark` so --st-* dark overrides apply. */}
      <div className="grubano-v2 dark">
        <div className="bg-stellar-bg p-3">
          <p className="mb-2 font-stellar-display text-sm font-bold uppercase tracking-wide text-stellar-muted-fg">Thème sombre</p>
          <StellarLogo variant="full" />
        </div>
        <Panel />
      </div>
    </div>
  )
}
