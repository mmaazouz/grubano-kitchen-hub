'use client'

import { cn } from '@/lib/utils'

// ── Stellar PriceTag (Agent 128) ──────────────────────────────────────────────
// Pure DISPLAY of an amount (euros). NO money computation, NO money import — the
// caller passes a number. Mono font for figures. Resolves only inside `.grubano-v2`.
export interface StellarPriceTagProps {
  amountEur: number
  size?: 'sm' | 'md' | 'lg'
  muted?: boolean
  className?: string
}

const SIZE = { sm: 'text-sm', md: 'text-base', lg: 'text-xl font-bold' } as const

export function StellarPriceTag({ amountEur, size = 'md', muted, className }: StellarPriceTagProps) {
  return (
    <span
      className={cn(
        'font-stellar-mono tabular-nums',
        SIZE[size],
        muted ? 'text-stellar-muted-fg' : 'text-stellar-fg',
        className,
      )}
    >
      {amountEur.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })}
    </span>
  )
}

export default StellarPriceTag
