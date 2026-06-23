'use client'

import { useEffect, useState } from 'react'
import { Link } from '@/navigation'
import { StellarInput, StellarRestaurantCard } from '@/components/stellar'

// SCREEN 2/7 — RECHERCHE par INTENTION (Agent 127 → Agent 129 Stellar → Agent 130 real data).
// Bataille 3: search by craving / dish / cuisine. Reuses the EXISTING /eat search logic by
// fetching the SAME public, read-only endpoint /eat/search calls: GET /api/restaurants?q&sort.
// No fork of the search logic, no write, no money.

// Shape of GET /api/restaurants results (subset we display; prices already in EUROS).
interface ApiRestaurant {
  id: string
  name: string
  cuisine: string[]
  rating: number
  reviewCount: number
  deliveryTime: number
  minOrder: number
  deliveryFee: number
}

const INTENTIONS = [
  'Envie de réconfort', 'Léger ce midi', 'Repas à partager', 'Sans gluten', 'Le moins cher', 'Livré en 20 min',
]
const CUISINES = ['Burgers', 'Pizza', 'Sushi', 'Healthy', 'Pâtes', 'Desserts']

export default function EatNextSearch() {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'note' | 'delai' | 'prix'>('note')
  const [results, setResults] = useState<ApiRestaurant[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const ctrl = new AbortController()
    setLoading(true)
    const sp = new URLSearchParams({ take: '50' })
    if (q.trim()) sp.set('q', q.trim())
    if (sort === 'note') sp.set('sort', 'rating')
    else if (sort === 'delai') sp.set('sort', 'delivery')
    // 'prix' (le moins cher) has no API sort — sorted client-side below by delivery fee.

    const t = setTimeout(() => {
      fetch(`/api/restaurants?${sp.toString()}`, { signal: ctrl.signal })
        .then((res) => (res.ok ? res.json() : { restaurants: [] }))
        .then((d) => {
          const list: ApiRestaurant[] = Array.isArray(d.restaurants) ? d.restaurants : []
          setResults(sort === 'prix' ? [...list].sort((a, b) => a.deliveryFee - b.deliveryFee) : list)
        })
        .catch(() => { /* aborted or offline — leave previous results */ })
        .finally(() => setLoading(false))
    }, 250)

    return () => { ctrl.abort(); clearTimeout(t) }
  }, [q, sort])

  const chip = 'rounded-full border border-stellar-border bg-stellar-surface-1 px-3 py-1 font-stellar-display text-sm text-stellar-fg'

  return (
    <div className="space-y-4 p-4">
      <StellarInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Envie de quoi ? (plat, cuisine, envie…)" />

      {/* Bataille 3 — intention chips (populate the real search query). */}
      <div>
        <p className="mb-1 font-stellar-display text-xs font-semibold uppercase tracking-wide text-stellar-muted-fg">Par envie</p>
        <div className="flex flex-wrap gap-2">
          {INTENTIONS.map((i) => (
            <button key={i} onClick={() => setQ(i)} className={chip}>{i}</button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1 font-stellar-display text-xs font-semibold uppercase tracking-wide text-stellar-muted-fg">Cuisine</p>
        <div className="flex flex-wrap gap-2">
          {CUISINES.map((c) => (
            <button key={c} onClick={() => setQ(c)} className={chip}>{c}</button>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        {(['note', 'delai', 'prix'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSort(s)}
            className={`rounded-stellar-md border px-3 py-1 font-stellar-display text-sm ${sort === s ? 'border-stellar-primary bg-stellar-primary text-stellar-primary-fg' : 'border-stellar-border bg-stellar-card text-stellar-fg'}`}
          >
            {s === 'note' ? 'Mieux notés' : s === 'delai' ? 'Plus rapides' : 'Moins chers'}
          </button>
        ))}
      </div>

      <h2 className="pt-1 font-stellar-display text-sm font-bold uppercase tracking-wide text-stellar-muted-fg">
        Résultats {q ? `· « ${q} »` : ''}
      </h2>

      {loading ? (
        <p className="text-sm text-stellar-muted-fg">Recherche…</p>
      ) : results.length === 0 ? (
        <p className="rounded-stellar-lg border border-stellar-border bg-stellar-surface-1 p-6 text-center text-sm text-stellar-muted-fg">
          Aucun résultat.
        </p>
      ) : (
        <ul className="space-y-3">
          {results.map((r) => (
            <li key={r.id}>
              <Link href={`/eat-next/r/${r.id}`} className="block">
                <StellarRestaurantCard
                  name={r.name}
                  cuisine={Array.isArray(r.cuisine) && typeof r.cuisine[0] === 'string' ? r.cuisine[0] : ''}
                  rating={r.rating}
                  deliveryFeeEur={r.deliveryFee}
                  etaMin={r.deliveryTime}
                  tag={r.deliveryFee === 0 ? 'Livraison offerte' : undefined}
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
