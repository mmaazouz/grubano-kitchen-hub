'use client'

import { useState } from 'react'
import { useTranslations, useLocale } from 'next-intl'
import { useRouter } from '@/navigation'
import { StellarButton, StellarPriceTag } from '@/components/stellar'
import { formatEuros } from '@/lib/format-money'
import { addItem, readCart } from '../../cart-store'

// Client child of the dish screen (Agent 130 → Agent 133 real cart). Pure UI state (qty) over a
// REAL dish passed as props. "Ajouter au panier" now adds the REAL dish to the shared /eat-next
// cart store (mono-restaurant: a dish from another restaurant replaces the cart, after a simple
// confirmation) then navigates to the cart. NO money route, NO DB write, NO lib/pricing.
export default function DishClient({
  itemId, name, description, priceEur, category, restaurantId, restaurantName,
}: {
  itemId: string
  name: string
  description: string
  priceEur: number
  category: string
  restaurantId: string
  restaurantName: string
}) {
  const t = useTranslations('eatNext.dish')
  const locale = useLocale()
  const router = useRouter()
  const [qty, setQty] = useState(1)
  const lineTotal = priceEur * qty

  function onAdd() {
    // MONO-RESTAURANT: if the cart already holds another restaurant, confirm before replacing.
    const current = readCart()
    if (current && current.items.length && current.restaurantId !== restaurantId) {
      const ok = window.confirm(
        t('replaceConfirm', { current: current.restaurantName || t('otherRestaurant'), next: restaurantName }),
      )
      if (!ok) return
    }
    addItem({ restaurantId, restaurantName }, { itemId, name, priceEur, qty })
    router.push('/eat-next/cart')
  }

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
        <span className="font-stellar-display text-sm font-semibold text-stellar-fg">{t('quantity')}</span>
        <button onClick={() => setQty((q) => Math.max(1, q - 1))} className="h-8 w-8 rounded-full border border-stellar-border text-lg text-stellar-fg">−</button>
        <span className="w-6 text-center text-stellar-fg">{qty}</span>
        <button onClick={() => setQty((q) => q + 1)} className="h-8 w-8 rounded-full border border-stellar-border text-lg text-stellar-fg">+</button>
      </div>

      <StellarButton variant="primary" fullWidth onClick={onAdd}>
        {t('addToCart')} · {formatEuros(lineTotal, locale)}
      </StellarButton>
    </div>
  )
}
