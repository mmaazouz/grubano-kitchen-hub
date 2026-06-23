import { notFound } from 'next/navigation'
import { Link } from '@/navigation'
import { StellarCard, StellarPriceTag } from '@/components/stellar'
import { wfRestaurant, wfDishesFor } from '../../mock'

// SCREEN 3/7 — RESTAURANT (Agent 127 → Agent 129 Stellar). Bataille 2: a transparency banner at
// the TOP (fee + ETA + min). Menu grouped by category; each dish links to its detail. Stellar
// tokens, mock data, no money.
export const dynamic = 'force-dynamic'

const addBtn = 'shrink-0 rounded-stellar-md border border-stellar-primary px-3 py-1.5 font-stellar-display text-sm font-semibold text-stellar-primary'

export default function EatNextRestaurant({ params }: { params: { id: string } }) {
  const r = wfRestaurant(params.id)
  if (!r) notFound()
  const dishes = wfDishesFor(r.id)
  const byCategory = dishes.reduce<Record<string, typeof dishes>>((acc, d) => {
    (acc[d.category] ??= []).push(d)
    return acc
  }, {})

  return (
    <div className="pb-4">
      <div className="h-32 w-full bg-stellar-surface-2" aria-hidden />
      <div className="space-y-4 p-4">
        <div>
          <h1 className="font-stellar-display text-2xl font-extrabold text-stellar-fg">{r.name}</h1>
          <p className="text-sm text-stellar-muted-fg">{r.cuisine} · ★ {r.rating} ({r.reviews} avis)</p>
        </div>

        {/* Bataille 2 — transparency banner, up front. */}
        <StellarCard elevation="soft" padding="md" className="flex flex-wrap gap-x-4 gap-y-1 bg-stellar-primary-soft text-sm text-stellar-accent-fg">
          <span>🛵 Livraison&nbsp;: <b>{r.deliveryFeeEur === 0 ? 'offerte' : <StellarPriceTag amountEur={r.deliveryFeeEur} size="sm" />}</b></span>
          <span>⏱ Délai&nbsp;: <b>{r.etaMin} min</b></span>
          <span>🧺 Minimum&nbsp;: <b><StellarPriceTag amountEur={r.minOrderEur} size="sm" /></b></span>
        </StellarCard>

        {Object.entries(byCategory).map(([cat, items]) => (
          <section key={cat}>
            <h2 className="mb-2 font-stellar-display text-sm font-bold uppercase tracking-wide text-stellar-muted-fg">{cat}</h2>
            <ul className="space-y-2">
              {items.map((d) => (
                <li key={d.id}>
                  <StellarCard elevation="soft" padding="md" className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-stellar-display font-semibold text-stellar-fg">{d.name}</p>
                      <p className="truncate text-sm text-stellar-muted-fg">{d.description}</p>
                      <p className="mt-0.5"><StellarPriceTag amountEur={d.priceEur} size="sm" /></p>
                    </div>
                    <Link href={`/eat-next/dish/${d.id}`} className={addBtn}>Ajouter</Link>
                  </StellarCard>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <Link href="/eat-next/cart" className="block rounded-stellar-lg bg-stellar-primary py-3 text-center font-stellar-display font-semibold text-stellar-primary-fg shadow-stellar-soft">
          Voir le panier
        </Link>
      </div>
    </div>
  )
}
