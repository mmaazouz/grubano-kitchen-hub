'use client'

import { useState } from 'react'
import { useRouter } from '@/navigation'
import { StellarButton, StellarPriceTag } from '@/components/stellar'

// Client child of the dish screen (Agent 130). Pure UI state (qty) over a REAL dish passed as
// props. "Ajouter au panier" only NAVIGATES to the cart (the cart stays a mock for now — wiring
// real cart state is a later brick). No money route, no write.
export default function DishClient({
  name, description, priceEur, category,
}: {
  name: string
  description: string
  priceEur: number
  category: string
}) {
  const router = useRouter()
  const [qty, setQty] = useState(1)
  const lineTotal = priceEur * qty

  return (
    <div className="space-y-4 p-4">
      <div className="h-40 w-full rounded-stellar-2xl bg-stellar-surface-2" aria-hidden />
      <div>
        {category && <p className="font-stellar-display text-xs font-semibold uppercase tracking-wide text-stellar-muted-fg">{category}</p>}
        <h1 className="font-stellar-display text-2xl font-extrabold text-stellar-fg">{name}</h1>
        {description && <p className="text-sm text-stellar-muted-fg">{description}</p>}
        <p className="mt-1"><StellarPriceTag amountEur={priceEur} size="lg" /></p>
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
