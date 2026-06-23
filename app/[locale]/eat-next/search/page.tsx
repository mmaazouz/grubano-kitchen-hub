'use client'

import { useState } from 'react'
import { Link } from '@/navigation'
import { WF_RESTAURANTS, WF_INTENTIONS, WF_CATEGORIES, eur } from '../mock'

// WIREFRAME 2/7 — RECHERCHE par INTENTION (bataille 3): search by craving / dish / cuisine,
// not just by name. Intention chips + free text + filters (cuisine, prix, délai). Mock
// results (the query does NOT actually filter the mock — wireframe shows the STRUCTURE).
// Client for the interactive controls. Neutral styling, no money.
export default function EatNextSearch() {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'note' | 'delai' | 'prix'>('note')

  return (
    <div className="space-y-4 p-4">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Envie de quoi ? (plat, cuisine, envie…)"
        className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-500"
      />

      {/* Bataille 3 — intention chips. */}
      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Par envie</p>
        <div className="flex flex-wrap gap-2">
          {WF_INTENTIONS.map((i) => (
            <button key={i} onClick={() => setQ(i)} className="rounded-full border border-neutral-300 bg-neutral-100 px-3 py-1 text-sm text-neutral-700">
              {i}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">Cuisine</p>
        <div className="flex flex-wrap gap-2">
          {WF_CATEGORIES.map((c) => (
            <button key={c} onClick={() => setQ(c)} className="rounded-full border border-neutral-300 bg-white px-3 py-1 text-sm text-neutral-700">
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2 text-sm">
        {(['note', 'delai', 'prix'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSort(s)}
            className={`rounded-lg border px-3 py-1 ${sort === s ? 'border-neutral-800 bg-neutral-800 text-white' : 'border-neutral-300 bg-white text-neutral-700'}`}
          >
            {s === 'note' ? 'Mieux notés' : s === 'delai' ? 'Plus rapides' : 'Moins chers'}
          </button>
        ))}
      </div>

      <h2 className="pt-1 text-sm font-bold uppercase tracking-wide text-neutral-500">
        Résultats {q ? `· « ${q} »` : ''}
      </h2>
      <ul className="space-y-3">
        {WF_RESTAURANTS.map((r) => (
          <li key={r.id}>
            <Link href={`/eat-next/r/${r.id}`} className="flex items-center gap-3 rounded-xl border border-neutral-300 bg-white p-3">
              <div className="h-14 w-14 shrink-0 rounded-lg bg-neutral-200" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-neutral-900">{r.name}</p>
                <p className="truncate text-sm text-neutral-500">{r.cuisine} · ★ {r.rating}</p>
                {/* Bataille 2 — fee + ETA visible in results too. */}
                <p className="text-xs text-neutral-600">🛵 {r.deliveryFeeEur === 0 ? 'offerte' : eur(r.deliveryFeeEur)} · ⏱ {r.etaMin} min</p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
