'use client'

import { useState } from 'react'
import { useRouter } from '@/navigation'
import { wfDish, eur } from '../../mock'

// WIREFRAME 4/7 — DISH detail. Description + mock options + quantity + add-to-cart →
// navigates to the cart wireframe. Client (quantity + options). Mock, no money.
export default function EatNextDish({ params }: { params: { id: string } }) {
  const router = useRouter()
  const d = wfDish(params.id)
  const [qty, setQty] = useState(1)
  const [size, setSize] = useState<'normal' | 'grande'>('normal')

  if (!d) {
    return <div className="p-4 text-neutral-600">Plat introuvable (maquette).</div>
  }

  const extra = size === 'grande' ? 2 : 0
  const lineTotal = (d.priceEur + extra) * qty

  return (
    <div className="space-y-4 p-4">
      <div className="h-40 w-full rounded-xl bg-neutral-200" aria-hidden />
      <div>
        <h1 className="text-xl font-bold text-neutral-900">{d.name}</h1>
        <p className="text-sm text-neutral-500">{d.description}</p>
        <p className="mt-1 text-lg font-semibold text-neutral-900">{eur(d.priceEur)}</p>
      </div>

      <div>
        <p className="mb-1 text-sm font-semibold text-neutral-700">Taille (exemple)</p>
        <div className="flex gap-2">
          {(['normal', 'grande'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setSize(s)}
              className={`rounded-lg border px-3 py-2 text-sm ${size === s ? 'border-neutral-800 bg-neutral-800 text-white' : 'border-neutral-300 bg-white text-neutral-700'}`}
            >
              {s === 'normal' ? 'Normale' : 'Grande (+2,00 €)'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold text-neutral-700">Quantité</span>
        <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="h-8 w-8 rounded-full border border-neutral-300 text-lg">−</button>
        <span className="w-6 text-center">{qty}</span>
        <button onClick={() => setQty((q) => q + 1)} className="h-8 w-8 rounded-full border border-neutral-300 text-lg">+</button>
      </div>

      <button
        onClick={() => router.push('/eat-next/cart')}
        className="w-full rounded-xl bg-neutral-800 py-3 font-semibold text-white"
      >
        Ajouter au panier · {eur(lineTotal)}
      </button>
    </div>
  )
}
