'use client'

import { useState } from 'react'
import { Link } from '@/navigation'
import { StellarInput, StellarRestaurantCard } from '@/components/stellar'
import { WF_RESTAURANTS, WF_INTENTIONS, WF_CATEGORIES } from '../mock'

// SCREEN 2/7 — RECHERCHE par INTENTION (Agent 127 → Agent 129 Stellar). Bataille 3: search by
// craving / dish / cuisine, not just name. Stellar tokens, mock results, no money.
export default function EatNextSearch() {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'note' | 'delai' | 'prix'>('note')

  const chip = 'rounded-full border border-stellar-border bg-stellar-surface-1 px-3 py-1 font-stellar-display text-sm text-stellar-fg'

  return (
    <div className="space-y-4 p-4">
      <StellarInput value={q} onChange={(e) => setQ(e.target.value)} placeholder="Envie de quoi ? (plat, cuisine, envie…)" />

      {/* Bataille 3 — intention chips. */}
      <div>
        <p className="mb-1 font-stellar-display text-xs font-semibold uppercase tracking-wide text-stellar-muted-fg">Par envie</p>
        <div className="flex flex-wrap gap-2">
          {WF_INTENTIONS.map((i) => (
            <button key={i} onClick={() => setQ(i)} className={chip}>{i}</button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1 font-stellar-display text-xs font-semibold uppercase tracking-wide text-stellar-muted-fg">Cuisine</p>
        <div className="flex flex-wrap gap-2">
          {WF_CATEGORIES.map((c) => (
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
      <ul className="space-y-3">
        {WF_RESTAURANTS.map((r) => (
          <li key={r.id}>
            <Link href={`/eat-next/r/${r.id}`} className="block">
              <StellarRestaurantCard name={r.name} cuisine={r.cuisine} rating={r.rating} deliveryFeeEur={r.deliveryFeeEur} etaMin={r.etaMin} tag={r.tags[0]} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
