'use client'

import * as React from 'react'
import { useLocale } from 'next-intl'
import { cn } from '@/lib/utils'
import { formatMoney, formatEuros, formatAmount } from '@/lib/format-money'

export type PriceSize = 'sm' | 'md' | 'lg' | 'xl'

const SIZES: Record<PriceSize, string> = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-lg',
  xl: 'text-2xl',
}

export interface PriceTagProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Final price in cents (avoids float issues) OR euros — pass `cents` to be safe. */
  amount: number
  /** Optional original price for strikethrough (cents or euros, same unit as `amount`). */
  originalAmount?: number
  /**
   * @deprecated The app is EUR; the currency symbol and its position follow the
   * ACTIVE LOCALE via lib/format-money (single source of truth). This prop is
   * IGNORED — kept only so existing call sites keep compiling. A user's language
   * never changes the currency ($/AED was a bug); a real multi-currency would be
   * driven by the market/merchant, not the UI language.
   */
  currency?: string
  /** Treat `amount`/`originalAmount` as cents (divide by 100). Default: false (euros). */
  cents?: boolean
  /** Always show .00 decimals (default: true). */
  showDecimals?: boolean
  size?: PriceSize
  /** Hide the currency symbol (for compact displays). */
  hideCurrency?: boolean
}

export const PriceTag = React.forwardRef<HTMLSpanElement, PriceTagProps>(function PriceTag(
  {
    amount,
    originalAmount,
    currency: _currency, // deprecated — see PriceTagProps.currency; destructured out of ...rest
    cents = false,
    showDecimals = true,
    size = 'md',
    hideCurrency,
    className,
    ...rest
  },
  ref,
) {
  const locale = useLocale()
  const opts = showDecimals ? undefined : { noDecimals: true }

  // EUR everywhere, format (separator + symbol position) follows the active locale.
  // hideCurrency → number only (no symbol); else full money string ("12,50 €" / "€12.50").
  const fmt = (value: number): string => {
    if (hideCurrency) return formatAmount(cents ? value / 100 : value, locale, opts)
    return cents ? formatMoney(value, locale, opts) : formatEuros(value, locale, opts)
  }

  const hasDiscount = typeof originalAmount === 'number' && originalAmount > amount

  return (
    <span
      ref={ref}
      className={cn('inline-flex items-baseline gap-1.5 font-bold text-gb-content', SIZES[size], className)}
      {...rest}
    >
      {hasDiscount && (
        <span className="text-gb-content-muted font-medium line-through text-[0.85em]">
          {fmt(originalAmount!)}
        </span>
      )}
      <span className={cn(hasDiscount && 'text-gb-accent')}>{fmt(amount)}</span>
    </span>
  )
})

export default PriceTag
