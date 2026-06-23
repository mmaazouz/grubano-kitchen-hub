'use client'

import { useState } from 'react'
import { useRouter } from '@/navigation'
import { StellarCard, StellarButton, StellarPriceTag } from '@/components/stellar'
import { WF_CART } from '../mock'

// SCREEN 5/7 — PANIER (Agent 127 → Agent 129 Stellar). Bataille 2: transparent recap (subtotal +
// delivery + total via PriceTag). Bataille 1 (no account wall): the CTA goes STRAIGHT to checkout.
// Local qty state (resets on reload). Stellar tokens, mock, no money.
export default function EatNextCart() {
  const router = useRouter()
  const r = WF_CART.restaurant
  const [lines, setLines] = useState(WF_CART.lines.map((l) => ({ ...l })))

  const setQty = (dishId: string, delta: number) =>
    setLines((prev) => prev
      .map((l) => (l.dishId === dishId ? { ...l, qty: Math.max(0, l.qty + delta) } : l))
      .filter((l) => l.qty > 0))

  const subtotal = lines.reduce((s, l) => s + l.priceEur * l.qty, 0)
  const delivery = r.deliveryFeeEur
  const total = subtotal + delivery

  if (lines.length === 0) {
    return (
      <div className="space-y-4 p-6 text-center">
        <p className="text-stellar-muted-fg">Votre panier est vide.</p>
        <StellarButton variant="primary" onClick={() => router.push('/eat-next')}>Découvrir des restaurants</StellarButton>
      </div>
    )
  }

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="font-stellar-display text-xl font-extrabold text-stellar-fg">Votre panier</h1>
        <p className="text-sm text-stellar-muted-fg">{r.name} · ⏱ {r.etaMin} min</p>
      </div>

      <ul className="space-y-2">
        {lines.map((l) => (
          <li key={l.dishId}>
            <StellarCard elevation="soft" padding="md" className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-stellar-display font-semibold text-stellar-fg">{l.name}</p>
                <StellarPriceTag amountEur={l.priceEur} size="sm" muted />
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setQty(l.dishId, -1)} className="h-7 w-7 rounded-full border border-stellar-border text-stellar-fg">−</button>
                <span className="w-5 text-center text-sm text-stellar-fg">{l.qty}</span>
                <button onClick={() => setQty(l.dishId, 1)} className="h-7 w-7 rounded-full border border-stellar-border text-stellar-fg">+</button>
              </div>
            </StellarCard>
          </li>
        ))}
      </ul>

      {/* Bataille 2 — fully transparent recap, BEFORE checkout. */}
      <StellarCard elevation="soft" padding="md" className="space-y-1 text-sm">
        <div className="flex justify-between text-stellar-muted-fg"><span>Sous-total</span><StellarPriceTag amountEur={subtotal} size="sm" /></div>
        <div className="flex justify-between text-stellar-muted-fg"><span>Frais de livraison</span><span>{delivery === 0 ? 'Offerts' : <StellarPriceTag amountEur={delivery} size="sm" />}</span></div>
        <div className="flex justify-between text-stellar-muted-fg"><span>Promo / fidélité</span><span className="text-xs">visible au paiement</span></div>
        <div className="mt-1 flex items-center justify-between border-t border-stellar-border pt-2 font-stellar-display text-base font-bold text-stellar-fg"><span>Total</span><StellarPriceTag amountEur={total} size="lg" /></div>
      </StellarCard>

      {/* Bataille 1 — NO account wall: straight to checkout, no login requested here. */}
      <StellarButton variant="primary" fullWidth onClick={() => router.push('/eat-next/checkout')}>
        Aller au paiement · {total.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
      </StellarButton>
      <p className="text-center text-xs text-stellar-muted-fg">Aucun compte requis pour continuer.</p>
    </div>
  )
}
