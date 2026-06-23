'use client'

import { useState } from 'react'
import { useRouter } from '@/navigation'
import { StellarButton, StellarPriceTag } from '@/components/stellar'
import { wfDish } from '../../mock'

// SCREEN 4/7 — DISH detail (Agent 127 → Agent 129 Stellar). Description + mock options + qty +
// add-to-cart → navigates to the cart. Stellar tokens, mock, no money.
export default function EatNextDish({ params }: { params: { id: string } }) {
  const router = useRouter()
  const d = wfDish(params.id)
  const [qty, setQty] = useState(1)
  const [size, setSize] = useState<'normal' | 'grande'>('normal')

  if (!d) return <div className="p-4 text-stellar-muted-fg">Plat introuvable (maquette).</div>

  const extra = size === 'grande' ? 2 : 0
  const lineTotal = (d.priceEur + extra) * qty

  return (
    <div className="space-y-4 p-4">
      <div className="h-40 w-full rounded-stellar-2xl bg-stellar-surface-2" aria-hidden />
      <div>
        <h1 className="font-stellar-display text-2xl font-extrabold text-stellar-fg">{d.name}</h1>
        <p className="text-sm text-stellar-muted-fg">{d.description}</p>
        <p className="mt-1"><StellarPriceTag amountEur={d.priceEur} size="lg" /></p>
      </div>

      <div>
        <p className="mb-1 font-stellar-display text-sm font-semibold text-stellar-fg">Taille (exemple)</p>
        <div className="flex gap-2">
          {(['normal', 'grande'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSize(s)}
              className={`rounded-stellar-md border px-3 py-2 font-stellar-display text-sm ${size === s ? 'border-stellar-primary bg-stellar-primary text-stellar-primary-fg' : 'border-stellar-border bg-stellar-card text-stellar-fg'}`}
            >
              {s === 'normal' ? 'Normale' : 'Grande (+2,00 €)'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="font-stellar-display text-sm font-semibold text-stellar-fg">Quantité</span>
        <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="h-8 w-8 rounded-full border border-stellar-border text-lg text-stellar-fg">−</button>
        <span className="w-6 text-center text-stellar-fg">{qty}</span>
        <button onClick={() => setQty((q) => q + 1)} className="h-8 w-8 rounded-full border border-stellar-border text-lg text-stellar-fg">+</button>
      </div>

      <StellarButton variant="primary" fullWidth onClick={() => router.push('/eat-next/cart')}>
        Ajouter au panier · {lineTotal.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
      </StellarButton>
    </div>
  )
}
