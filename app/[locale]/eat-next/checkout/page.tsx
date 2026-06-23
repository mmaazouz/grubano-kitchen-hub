'use client'

import { useState } from 'react'
import { useRouter } from '@/navigation'
import { WF_CART, eur } from '../mock'

// WIREFRAME 6/7 — CHECKOUT (the crux). Bataille 1 (kill the account wall): account-AT-
// payment — a guest enters only an EMAIL (passwordless, NO password field anywhere) and
// pays with a 1-TAP WALLET (Apple/Google Pay placeholders) as the PRIMARY method, card as
// fallback. Bataille 2: transparent final recap. Minimal — a single screen. ⚠️ STRUCTURAL
// MOCK ONLY: "Confirmer" just navigates to the tracking wireframe. It does NOT call
// /api/orders, /pay, or any money route — nothing is charged. Mock data, no money.
export default function EatNextCheckout() {
  const router = useRouter()
  const r = WF_CART.restaurant
  const subtotal = WF_CART.lines.reduce((s, l) => s + l.priceEur * l.qty, 0)
  const total = subtotal + r.deliveryFeeEur
  const [email, setEmail] = useState('')
  const [method, setMethod] = useState<'apple' | 'google' | 'card'>('apple')

  // Pure navigation — NO money route is ever called (wireframe).
  const confirm = () => router.push('/eat-next/track')

  return (
    <div className="space-y-5 p-4">
      <h1 className="text-lg font-bold text-neutral-900">Paiement</h1>

      {/* Bataille 1 — account AT payment: email only, passwordless. No password field. */}
      <section className="space-y-2">
        <p className="text-sm font-semibold text-neutral-700">Votre email</p>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="vous@email.com"
          className="w-full rounded-xl border border-neutral-300 bg-white px-4 py-3 text-sm outline-none focus:border-neutral-500"
        />
        <p className="text-xs text-neutral-500">
          Pas de mot de passe&nbsp;: on vous envoie un lien / code de connexion. Votre compte se crée tout seul à la commande.
        </p>
      </section>

      {/* Adresse + ETA (réassurance amont). */}
      <section className="rounded-xl border border-neutral-300 bg-neutral-50 p-3 text-sm text-neutral-700">
        <div className="flex justify-between"><span>📍 Livraison</span><span className="font-medium">12 rue de la République</span></div>
        <div className="mt-1 flex justify-between"><span>⏱ Estimation</span><span className="font-medium">{r.etaMin} min</span></div>
      </section>

      {/* Bataille 1 — 1-tap WALLET primary, card fallback. (Placeholders — no real SDK.) */}
      <section className="space-y-2">
        <p className="text-sm font-semibold text-neutral-700">Payer en 1 geste</p>
        <button
          onClick={() => setMethod('apple')}
          className={`flex w-full items-center justify-center gap-2 rounded-xl border py-3 text-sm font-semibold ${method === 'apple' ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300 bg-white text-neutral-800'}`}
        >  Apple Pay <span className="text-xs font-normal opacity-70">(maquette)</span></button>
        <button
          onClick={() => setMethod('google')}
          className={`flex w-full items-center justify-center gap-2 rounded-xl border py-3 text-sm font-semibold ${method === 'google' ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300 bg-white text-neutral-800'}`}
        >  G Pay <span className="text-xs font-normal opacity-70">(maquette)</span></button>
        <button
          onClick={() => setMethod('card')}
          className={`w-full rounded-xl border py-2.5 text-sm ${method === 'card' ? 'border-neutral-900 bg-neutral-100 text-neutral-900' : 'border-neutral-300 bg-white text-neutral-600'}`}
        >  Payer par carte (repli)</button>
      </section>

      {/* Bataille 2 — transparent FINAL recap. */}
      <section className="space-y-1 rounded-xl border border-neutral-300 bg-neutral-50 p-4 text-sm">
        <div className="flex justify-between text-neutral-700"><span>Sous-total</span><span>{eur(subtotal)}</span></div>
        <div className="flex justify-between text-neutral-700"><span>Frais de livraison</span><span>{r.deliveryFeeEur === 0 ? 'Offerts' : eur(r.deliveryFeeEur)}</span></div>
        <div className="mt-1 flex justify-between border-t border-neutral-300 pt-2 text-base font-bold text-neutral-900"><span>Total à payer</span><span>{eur(total)}</span></div>
      </section>

      <button onClick={confirm} className="w-full rounded-xl bg-neutral-800 py-3 font-semibold text-white">
        Confirmer la commande · {eur(total)}
      </button>
      <p className="text-center text-xs text-neutral-400">Maquette — aucun paiement réel n’est effectué.</p>
    </div>
  )
}
