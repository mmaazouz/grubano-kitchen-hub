import { Link } from '@/navigation'
import { StellarCard, StellarPriceTag } from '@/components/stellar'
import { WF_CART } from '../mock'

// SCREEN 7/7 — SUIVI (Agent 127 → Agent 129 Stellar). Reached from the checkout mock. Shows the
// confirmation + a status timeline + ETA + a mock courier card. Stellar tokens, static mock, no money.
export const dynamic = 'force-dynamic'

const STEPS = ['Commande reçue', 'En préparation', 'Prête', 'En route', 'Livrée'] as const
const CURRENT = 1 // mock: "en préparation"

export default function EatNextTrack() {
  const r = WF_CART.restaurant
  const total = WF_CART.lines.reduce((s, l) => s + l.priceEur * l.qty, 0) + r.deliveryFeeEur

  return (
    <div className="space-y-5 p-4">
      <StellarCard elevation="elev" padding="lg" className="bg-stellar-primary-soft text-center">
        <p className="text-3xl" aria-hidden>✅</p>
        <p className="font-stellar-display text-lg font-extrabold text-stellar-accent-fg">Commande passée&nbsp;!</p>
        <p className="text-sm text-stellar-fg">{r.name} · <StellarPriceTag amountEur={total} size="sm" /> · arrivée estimée dans {r.etaMin} min</p>
        <p className="mt-1 text-xs text-stellar-muted-fg">Référence GRB-WF-0000 (maquette)</p>
      </StellarCard>

      <ol className="space-y-3">
        {STEPS.map((s, i) => {
          const done = i < CURRENT
          const active = i === CURRENT
          return (
            <li key={s} className="flex items-center gap-3">
              <span className={`grid h-7 w-7 place-items-center rounded-full font-stellar-mono text-xs ${done ? 'bg-stellar-primary text-stellar-primary-fg' : active ? 'border-2 border-stellar-primary text-stellar-primary' : 'border border-stellar-border text-stellar-muted-fg'}`}>
                {done ? '✓' : i + 1}
              </span>
              <span className={`font-stellar-display ${active ? 'font-semibold text-stellar-fg' : done ? 'text-stellar-fg' : 'text-stellar-muted-fg'}`}>{s}</span>
            </li>
          )
        })}
      </ol>

      {/* Mock courier reassurance card. */}
      <StellarCard elevation="soft" padding="md" className="flex items-center gap-3">
        <div className="h-12 w-12 rounded-full bg-stellar-surface-2" aria-hidden />
        <div className="flex-1">
          <p className="font-stellar-display text-sm font-semibold text-stellar-fg">Votre livreur (maquette)</p>
          <p className="text-xs text-stellar-muted-fg">En route vers le restaurant · vélo</p>
        </div>
        <span className="rounded-stellar-md border border-stellar-border px-3 py-1 text-sm text-stellar-fg">Appeler</span>
      </StellarCard>

      <div className="h-40 w-full rounded-stellar-2xl bg-stellar-surface-2" aria-hidden />

      <Link href="/eat-next" className="block rounded-stellar-lg border border-stellar-primary py-3 text-center font-stellar-display font-semibold text-stellar-primary">
        Retour à l’accueil
      </Link>
    </div>
  )
}
