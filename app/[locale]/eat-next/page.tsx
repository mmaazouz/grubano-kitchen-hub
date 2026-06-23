import { Link } from '@/navigation'
import { WF_RESTAURANTS, WF_CATEGORIES, eur } from './mock'

// WIREFRAME 1/7 — HOME / découverte. Bataille 2 (transparence amont): each restaurant
// card shows delivery fee + ETA + minimum UP FRONT. Bataille 3 (intention): the search
// bar is prominent and intention-framed. Neutral styling, mock data, no money.
export const dynamic = 'force-dynamic'

export default function EatNextHome() {
  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2 text-sm text-neutral-600">
        <span className="h-4 w-4 rounded-full bg-neutral-300" aria-hidden />
        Livrer à <span className="font-semibold text-neutral-900">12 rue de la République</span> ›
      </div>

      {/* Bataille 3 — intention-first search entry. */}
      <Link href="/eat-next/search" className="block rounded-xl border border-neutral-300 bg-neutral-100 px-4 py-3 text-neutral-500">
        🔎 Envie de quoi&nbsp;? <span className="text-neutral-400">— un plat, une cuisine, une envie…</span>
      </Link>

      <div className="flex flex-wrap gap-2">
        {WF_CATEGORIES.map((c) => (
          <Link key={c} href="/eat-next/search" className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-sm text-neutral-700">
            {c}
          </Link>
        ))}
      </div>

      <h2 className="pt-2 text-sm font-bold uppercase tracking-wide text-neutral-500">Restaurants près de vous</h2>
      <ul className="space-y-3">
        {WF_RESTAURANTS.map((r) => (
          <li key={r.id}>
            <Link href={`/eat-next/r/${r.id}`} className="block rounded-xl border border-neutral-300 bg-white p-3">
              <div className="mb-2 h-24 w-full rounded-lg bg-neutral-200" aria-hidden />
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-neutral-900">{r.name}</p>
                  <p className="truncate text-sm text-neutral-500">{r.cuisine}</p>
                </div>
                <span className="shrink-0 text-sm text-neutral-700">★ {r.rating} <span className="text-neutral-400">({r.reviews})</span></span>
              </div>
              {/* Bataille 2 — fee + ETA + minimum visible on the card, not hidden until checkout. */}
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-neutral-600">
                <span>🛵 {r.deliveryFeeEur === 0 ? 'Livraison offerte' : eur(r.deliveryFeeEur)}</span>
                <span>⏱ {r.etaMin} min</span>
                <span>min. {eur(r.minOrderEur)}</span>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
