import { Link } from '@/navigation'
import { StellarRestaurantCard, StellarPriceTag } from '@/components/stellar'
import { WF_RESTAURANTS, WF_CATEGORIES } from './mock'

// SCREEN 1/7 — HOME / découverte (Agent 127 wireframe → Agent 129 Stellar). Bataille 2
// (transparence amont): each card shows delivery fee + ETA up front (+ a min line). Bataille 3
// (intention): a prominent "Envie de quoi ?" search entry. Stellar tokens, mock data, no money.
export const dynamic = 'force-dynamic'

export default function EatNextHome() {
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2 text-sm text-stellar-muted-fg">
        <span className="h-4 w-4 rounded-full bg-stellar-primary-soft" aria-hidden />
        Livrer à <span className="font-semibold text-stellar-fg">12 rue de la République</span> ›
      </div>

      {/* Bataille 3 — intention-first search entry. */}
      <Link href="/eat-next/search" className="block rounded-stellar-xl border border-stellar-border bg-stellar-surface-1 px-4 py-3 text-stellar-muted-fg shadow-stellar-soft">
        🔎 <span className="font-stellar-display font-semibold text-stellar-fg">Envie de quoi&nbsp;?</span> <span className="text-stellar-muted-fg">— un plat, une cuisine, une envie…</span>
      </Link>

      <div className="flex flex-wrap gap-2">
        {WF_CATEGORIES.map((c) => (
          <Link key={c} href="/eat-next/search" className="rounded-full border border-stellar-border bg-stellar-card px-3 py-1 font-stellar-display text-sm font-medium text-stellar-fg">
            {c}
          </Link>
        ))}
      </div>

      <h2 className="pt-2 font-stellar-display text-sm font-bold uppercase tracking-wide text-stellar-muted-fg">Restaurants près de vous</h2>
      <ul className="space-y-3">
        {WF_RESTAURANTS.map((r) => (
          <li key={r.id}>
            <Link href={`/eat-next/r/${r.id}`} className="block">
              <StellarRestaurantCard
                name={r.name}
                cuisine={r.cuisine}
                rating={r.rating}
                deliveryFeeEur={r.deliveryFeeEur}
                etaMin={r.etaMin}
                tag={r.tags[0]}
              />
              {/* Bataille 2 — minimum order also shown up front. */}
              <p className="mt-1 px-1 text-xs text-stellar-muted-fg">
                Minimum&nbsp;: <StellarPriceTag amountEur={r.minOrderEur} size="sm" muted /> · {r.reviews} avis
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
