'use client'

import { useRouter } from '@/navigation'
import { StellarCard, StellarButton, StellarPriceTag } from '@/components/stellar'
import { useEatNextCart } from '../cart-store'

// SCREEN 5/7 — PANIER (Agent 127 → Agent 129 Stellar → Agent 133 real cart). Reads the shared
// /eat-next cart store (isolated sessionStorage, calque lib/eat-cart). Real lines with ±/remove.
// Bataille 2: transparent recap. ⚠️ The total is a NAÏVE display sum (Σ price×qty) — NO lib/pricing,
// NO money route; the real total + fees are computed server-side at order creation (brick 2e).
export default function EatNextCart() {
  const router = useRouter()
  const { cart, hydrated, subtotalEur, setItemQty, removeItem } = useEatNextCart()

  if (!hydrated) {
    return <div className="p-6 text-center text-sm text-stellar-muted-fg">Chargement…</div>
  }

  if (!cart || cart.items.length === 0) {
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
        <p className="text-sm text-stellar-muted-fg">{cart.restaurantName || 'Restaurant'}</p>
      </div>

      <ul className="space-y-2">
        {cart.items.map((l) => (
          <li key={l.itemId}>
            <StellarCard elevation="soft" padding="md" className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-stellar-display font-semibold text-stellar-fg">{l.name}</p>
                <StellarPriceTag amountEur={l.priceEur} size="sm" muted />
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setItemQty(l.itemId, l.qty - 1, l.options)} className="h-7 w-7 rounded-full border border-stellar-border text-stellar-fg" aria-label="Réduire">−</button>
                <span className="w-5 text-center text-sm text-stellar-fg">{l.qty}</span>
                <button onClick={() => setItemQty(l.itemId, l.qty + 1, l.options)} className="h-7 w-7 rounded-full border border-stellar-border text-stellar-fg" aria-label="Augmenter">+</button>
                <button onClick={() => removeItem(l.itemId, l.options)} className="ml-1 text-xs text-stellar-muted-fg underline" aria-label="Retirer">Retirer</button>
              </div>
            </StellarCard>
          </li>
        ))}
      </ul>

      {/* Bataille 2 — transparent recap. Total is an ESTIMATE; final total + fees = at payment. */}
      <StellarCard elevation="soft" padding="md" className="space-y-1 text-sm">
        <div className="flex justify-between text-stellar-muted-fg"><span>Sous-total</span><StellarPriceTag amountEur={subtotalEur} size="sm" /></div>
        <div className="flex justify-between text-stellar-muted-fg"><span>Frais de livraison</span><span className="text-xs">calculés au paiement</span></div>
        <div className="mt-1 flex items-center justify-between border-t border-stellar-border pt-2 font-stellar-display text-base font-bold text-stellar-fg"><span>Total estimé</span><StellarPriceTag amountEur={subtotalEur} size="lg" /></div>
      </StellarCard>

      {/* Bataille 1 — NO account wall: straight to checkout. */}
      <StellarButton variant="primary" fullWidth onClick={() => router.push('/eat-next/checkout')}>
        Aller au paiement · {subtotalEur.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
      </StellarButton>
      <p className="text-center text-xs text-stellar-muted-fg">Aucun compte requis pour continuer · total final calculé au paiement.</p>
    </div>
  )
}
