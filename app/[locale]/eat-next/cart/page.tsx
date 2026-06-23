'use client'

import { useState } from 'react'
import { Link } from '@/navigation'
import { WF_CART, eur } from '../mock'

// WIREFRAME 5/7 — PANIER. Bataille 2 (transparence): a clear price recap (subtotal +
// delivery + total) — nothing hidden until checkout. Bataille 1 (no account wall): the
// CTA goes STRAIGHT to checkout — NO login is asked here. Local qty state (resets on
// reload — wireframe). Mock, no money.
export default function EatNextCart() {
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
        <p className="text-neutral-600">Votre panier est vide.</p>
        <Link href="/eat-next" className="inline-block rounded-xl bg-neutral-800 px-4 py-2 font-semibold text-white">Découvrir des restaurants</Link>
      </div>
    )
  }

  return (
    <div className="space-y-4 p-4">
      <div>
        <h1 className="text-lg font-bold text-neutral-900">Votre panier</h1>
        <p className="text-sm text-neutral-500">{r.name} · ⏱ {r.etaMin} min</p>
      </div>

      <ul className="space-y-2">
        {lines.map((l) => (
          <li key={l.dishId} className="flex items-center gap-3 rounded-xl border border-neutral-300 bg-white p-3">
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-neutral-900">{l.name}</p>
              <p className="text-sm text-neutral-600">{eur(l.priceEur)}</p>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setQty(l.dishId, -1)} className="h-7 w-7 rounded-full border border-neutral-300">−</button>
              <span className="w-5 text-center text-sm">{l.qty}</span>
              <button onClick={() => setQty(l.dishId, 1)} className="h-7 w-7 rounded-full border border-neutral-300">+</button>
            </div>
          </li>
        ))}
      </ul>

      {/* Bataille 2 — fully transparent recap, BEFORE checkout. */}
      <div className="space-y-1 rounded-xl border border-neutral-300 bg-neutral-50 p-4 text-sm">
        <div className="flex justify-between text-neutral-700"><span>Sous-total</span><span>{eur(subtotal)}</span></div>
        <div className="flex justify-between text-neutral-700"><span>Frais de livraison</span><span>{delivery === 0 ? 'Offerts' : eur(delivery)}</span></div>
        <div className="flex justify-between text-neutral-500"><span>Promo / fidélité</span><span>visible au paiement</span></div>
        <div className="mt-1 flex justify-between border-t border-neutral-300 pt-2 text-base font-bold text-neutral-900"><span>Total</span><span>{eur(total)}</span></div>
      </div>

      {/* Bataille 1 — NO account wall: straight to checkout, no login requested here. */}
      <Link href="/eat-next/checkout" className="block rounded-xl bg-neutral-800 py-3 text-center font-semibold text-white">
        Aller au paiement · {eur(total)}
      </Link>
      <p className="text-center text-xs text-neutral-400">Aucun compte requis pour continuer.</p>
    </div>
  )
}
