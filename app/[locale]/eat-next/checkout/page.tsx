'use client'

import { useState } from 'react'
import { useRouter } from '@/navigation'
import { StellarCard, StellarButton, StellarInput, StellarPriceTag } from '@/components/stellar'
import { WF_CART } from '../mock'

// SCREEN 6/7 — CHECKOUT (the crux), Agent 127 → Agent 129 Stellar. Bataille 1 (kill the account
// wall): account-AT-payment — email only (passwordless, NO password field) + 1-tap WALLET (Apple/
// Google Pay placeholders) primary + card fallback. Bataille 2: transparent final recap. ⚠️ STILL
// A STRUCTURAL MOCK: "Confirmer" only navigates to the tracking screen — it calls NO /api/orders,
// /pay or any money route; nothing is charged. Stellar tokens, mock, no money.
export default function EatNextCheckout() {
  const router = useRouter()
  const r = WF_CART.restaurant
  const subtotal = WF_CART.lines.reduce((s, l) => s + l.priceEur * l.qty, 0)
  const total = subtotal + r.deliveryFeeEur
  const [email, setEmail] = useState('')
  const [method, setMethod] = useState<'apple' | 'google' | 'card'>('apple')

  // Pure navigation — NO money route is ever called (mock).
  const confirm = () => router.push('/eat-next/track')

  const wallet = (active: boolean) =>
    `flex w-full items-center justify-center gap-2 rounded-stellar-lg border py-3 font-stellar-display text-sm font-semibold ${active ? 'border-stellar-primary bg-stellar-primary text-stellar-primary-fg' : 'border-stellar-border bg-stellar-card text-stellar-fg'}`

  return (
    <div className="space-y-5 p-4">
      <h1 className="font-stellar-display text-xl font-extrabold text-stellar-fg">Paiement</h1>

      {/* Bataille 1 — account AT payment: email only, passwordless. No password field. */}
      <StellarInput
        type="email"
        label="Votre email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="vous@email.com"
        hint="Pas de mot de passe : on vous envoie un lien / code. Votre compte se crée tout seul à la commande."
      />

      {/* Adresse + ETA (réassurance amont). */}
      <StellarCard elevation="soft" padding="md" className="space-y-1 text-sm text-stellar-fg">
        <div className="flex justify-between"><span>📍 Livraison</span><span className="font-medium">12 rue de la République</span></div>
        <div className="flex justify-between"><span>⏱ Estimation</span><span className="font-medium">{r.etaMin} min</span></div>
      </StellarCard>

      {/* Bataille 1 — 1-tap WALLET primary, card fallback. (Placeholders — no real SDK.) */}
      <section className="space-y-2">
        <p className="font-stellar-display text-sm font-semibold text-stellar-fg">Payer en 1 geste</p>
        <button onClick={() => setMethod('apple')} className={wallet(method === 'apple')}>  Apple Pay <span className="text-xs font-normal opacity-70">(maquette)</span></button>
        <button onClick={() => setMethod('google')} className={wallet(method === 'google')}>  G Pay <span className="text-xs font-normal opacity-70">(maquette)</span></button>
        <button onClick={() => setMethod('card')} className={`w-full rounded-stellar-lg border py-2.5 font-stellar-display text-sm ${method === 'card' ? 'border-stellar-primary bg-stellar-primary-soft text-stellar-accent-fg' : 'border-stellar-border bg-stellar-card text-stellar-muted-fg'}`}>  Payer par carte (repli)</button>
      </section>

      {/* Bataille 2 — transparent FINAL recap. */}
      <StellarCard elevation="soft" padding="md" className="space-y-1 text-sm">
        <div className="flex justify-between text-stellar-muted-fg"><span>Sous-total</span><StellarPriceTag amountEur={subtotal} size="sm" /></div>
        <div className="flex justify-between text-stellar-muted-fg"><span>Frais de livraison</span><span>{r.deliveryFeeEur === 0 ? 'Offerts' : <StellarPriceTag amountEur={r.deliveryFeeEur} size="sm" />}</span></div>
        <div className="mt-1 flex items-center justify-between border-t border-stellar-border pt-2 font-stellar-display text-base font-bold text-stellar-fg"><span>Total à payer</span><StellarPriceTag amountEur={total} size="lg" /></div>
      </StellarCard>

      <StellarButton variant="primary" fullWidth onClick={confirm}>
        Confirmer la commande · {total.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
      </StellarButton>
      <p className="text-center text-xs text-stellar-muted-fg">Maquette — aucun paiement réel n’est effectué.</p>
    </div>
  )
}
