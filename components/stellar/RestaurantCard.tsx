'use client'

import { cn } from '@/lib/utils'
import { StellarBadge } from './Badge'
import { StellarPriceTag } from './PriceTag'

// ── Stellar RestaurantCard (Agent 128) ────────────────────────────────────────
// Composite tile in Stellar tokens, embodying the redesign's transparency battle:
// delivery fee + ETA shown on the card. Pure display (props only — no money/data
// import). Resolves only inside `.grubano-v2`.
export interface StellarRestaurantCardProps {
  name: string
  cuisine: string
  /** V4-2 : GET /api/restaurants sert null tant qu'aucun avis réel — la ★ est
   *  masquée dans ce cas (jamais de .toFixed sur une note absente). */
  rating: number | null
  deliveryFeeEur: number
  etaMin: number
  tag?: string
  className?: string
}

export function StellarRestaurantCard({
  name, cuisine, rating, deliveryFeeEur, etaMin, tag, className,
}: StellarRestaurantCardProps) {
  return (
    <div className={cn('overflow-hidden rounded-stellar-2xl border border-stellar-border bg-stellar-card shadow-stellar-soft', className)}>
      <div className="relative h-28 w-full bg-stellar-surface-2">
        {tag && <span className="absolute left-2 top-2"><StellarBadge tone="primary">{tag}</StellarBadge></span>}
      </div>
      <div className="p-3.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-stellar-display font-bold text-stellar-fg">{name}</p>
            <p className="truncate text-sm text-stellar-muted-fg">{cuisine}</p>
          </div>
          {rating != null && (
            <span className="shrink-0 text-sm font-semibold text-stellar-fg">★ {rating.toFixed(1)}</span>
          )}
        </div>
        {/* Transparency: fee + ETA on the card (bataille 2). */}
        <div className="mt-2 flex items-center gap-3 text-xs text-stellar-muted-fg">
          <span className="inline-flex items-center gap-1">
            🛵 {deliveryFeeEur === 0 ? 'Offerte' : <StellarPriceTag amountEur={deliveryFeeEur} size="sm" muted />}
          </span>
          <span>⏱ {etaMin} min</span>
        </div>
      </div>
    </div>
  )
}

export default StellarRestaurantCard
