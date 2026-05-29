'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export type PriceSize = 'sm' | 'md' | 'lg' | 'xl'

const SIZES: Record<PriceSize, string> = {
  sm: 'text-grubano-sm',
  md: 'text-grubano-base',
  lg: 'text-grubano-lg',
  xl: 'text-grubano-2xl',
}

export interface PriceTagProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Final price in cents (avoids float issues) OR euros (auto-detected by < 1000 heuristic — pass cents to be safe). */
  amount: number
  /** Optional original price for strikethrough (cents or euros, same unit as `amount`). */
  originalAmount?: number
  /** Currency symbol — default €. */
  currency?: string
  /** Treat `amount`/`originalAmount` as cents (divide by 100). Default: false (euros). */
  cents?: boolean
  /** Always show .00 decimals (default: true). */
  showDecimals?: boolean
  size?: PriceSize
  /** Hide the currency symbol (for compact displays). */
  hideCurrency?: boolean
}

function format(value: number, cents: boolean, showDecimals: boolean): string {
  const v = cents ? value / 100 : value
  return showDecimals ? v.toFixed(2).replace('.', ',') : Math.round(v).toString()
}

export const PriceTag = React.forwardRef<HTMLSpanElement, PriceTagProps>(function PriceTag(
  {
    amount,
    originalAmount,
    currency = '€',
    cents = false,
    showDecimals = true,
    size = 'md',
    hideCurrency,
    className,
    ...rest
  },
  ref,
) {
  const hasDiscount =
    typeof originalAmount === 'number' && originalAmount > amount

  return (
    <span
      ref={ref}
      className={cn('inline-flex items-baseline gap-1.5 font-bold text-grubano-ink', SIZES[size], className)}
      {...rest}
    >
      {hasDiscount && (
        <span className="text-grubano-ink-faint font-medium line-through text-[0.85em]">
          {format(originalAmount!, cents, showDecimals)}
          {!hideCurrency && <span className="ml-0.5">{currency}</span>}
        </span>
      )}
      <span className={cn(hasDiscount && 'text-grubano-primary')}>
        {format(amount, cents, showDecimals)}
        {!hideCurrency && <span className="ml-0.5">{currency}</span>}
      </span>
    </span>
  )
})

export default PriceTag
