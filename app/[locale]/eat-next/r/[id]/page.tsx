import { notFound } from 'next/navigation'
import { Link } from '@/navigation'
import { wfRestaurant, wfDishesFor, eur } from '../../mock'

// WIREFRAME 3/7 — RESTAURANT. Bataille 2 (transparence amont): a transparency banner at
// the TOP spells out delivery fee + ETA + minimum before anything else. Menu grouped by
// category; each dish links to its detail. Server, mock data, no money.
export const dynamic = 'force-dynamic'

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
      <div className="h-32 w-full bg-neutral-200" aria-hidden />
      <div className="space-y-4 p-4">
        <div>
          <h1 className="text-xl font-bold text-neutral-900">{r.name}</h1>
          <p className="text-sm text-neutral-500">{r.cuisine} · ★ {r.rating} ({r.reviews} avis)</p>
        </div>

        {/* Bataille 2 — transparency banner, up front. */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-xl border border-neutral-300 bg-neutral-100 px-4 py-3 text-sm text-neutral-700">
          <span>🛵 Livraison&nbsp;: <b>{r.deliveryFeeEur === 0 ? 'offerte' : eur(r.deliveryFeeEur)}</b></span>
          <span>⏱ Délai&nbsp;: <b>{r.etaMin} min</b></span>
          <span>🧺 Minimum&nbsp;: <b>{eur(r.minOrderEur)}</b></span>
        </div>

        {Object.entries(byCategory).map(([cat, items]) => (
          <section key={cat}>
            <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-neutral-500">{cat}</h2>
            <ul className="space-y-2">
              {items.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 rounded-xl border border-neutral-300 bg-white p-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-neutral-900">{d.name}</p>
                    <p className="truncate text-sm text-neutral-500">{d.description}</p>
                    <p className="mt-0.5 text-sm text-neutral-800">{eur(d.priceEur)}</p>
                  </div>
                  <Link href={`/eat-next/dish/${d.id}`} className="shrink-0 rounded-lg border border-neutral-800 px-3 py-1.5 text-sm font-semibold text-neutral-800">
                    Ajouter
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}

        <Link href="/eat-next/cart" className="block rounded-xl bg-neutral-800 py-3 text-center font-semibold text-white">
          Voir le panier
        </Link>
      </div>
    </div>
  )
}
