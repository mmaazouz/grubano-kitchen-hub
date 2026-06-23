import { Link } from '@/navigation'
import { StellarRestaurantCard, StellarPriceTag } from '@/components/stellar'
import { listRestaurants } from './data'

// SCREEN 1/7 — HOME / découverte (Agent 127 wireframe → Agent 129 Stellar → Agent 130 real data).
// Bataille 2 (transparence amont): each card shows delivery fee + ETA up front (+ a min line).
// Bataille 3 (intention): a prominent "Envie de quoi ?" search entry. Stellar tokens, REAL
// restaurants (read-only, same models + gate as /api/restaurants), NO money, NO write.
export const dynamic = 'force-dynamic'

export default async function EatNextHome() {
  const restaurants = await listRestaurants()
  // Real category pills, derived from the loaded restaurants' cuisines (read-only).
  const categories = Array.from(new Set(restaurants.map((r) => r.cuisine).filter(Boolean))).slice(0, 8)

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

      {categories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => (
            <Link key={c} href="/eat-next/search" className="rounded-full border border-stellar-border bg-stellar-card px-3 py-1 font-stellar-display text-sm font-medium text-stellar-fg">
              {c}
            </Link>
          ))}
        </div>
      )}

      <h2 className="pt-2 font-stellar-display text-sm font-bold uppercase tracking-wide text-stellar-muted-fg">Restaurants près de vous</h2>

      {restaurants.length === 0 ? (
        <p className="rounded-stellar-lg border border-stellar-border bg-stellar-surface-1 p-6 text-center text-sm text-stellar-muted-fg">
          Aucun restaurant disponible pour le moment.
        </p>
      ) : (
        <ul className="space-y-3">
          {restaurants.map((r) => (
            <li key={r.id}>
              <Link href={`/eat-next/r/${r.id}`} className="block">
                <StellarRestaurantCard
                  name={r.name}
                  cuisine={r.cuisine}
                  rating={r.rating}
                  deliveryFeeEur={r.deliveryFeeEur}
                  etaMin={r.etaMin}
                  tag={r.deliveryFeeEur === 0 ? 'Livraison offerte' : undefined}
                />
                {/* Bataille 2 — minimum order also shown up front. */}
                <p className="mt-1 px-1 text-xs text-stellar-muted-fg">
                  Minimum&nbsp;: <StellarPriceTag amountEur={r.minOrderEur} size="sm" muted /> · {r.reviewCount} avis
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
