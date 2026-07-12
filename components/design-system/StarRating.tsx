'use client'

import * as React from 'react'
import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'

export type StarSize = 'sm' | 'md' | 'lg'

const ICON_SIZES: Record<StarSize, number> = { sm: 12, md: 16, lg: 20 }
const TEXT_SIZES: Record<StarSize, string> = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
}

export interface StarRatingProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  /** Value 0-5 (floats OK, e.g. 4.6 — only used for display variant). */
  value: number
  /** When provided, switches to interactive mode (integer 1-5). */
  onChange?: (next: number) => void
  size?: StarSize
  /** Show the numeric value beside the star (display mode). */
  showValue?: boolean
  /** Show the number of reviews in muted tone, e.g. (1.2k). */
  reviewCount?: number | string
  /** Number of stars (default 5). */
  max?: number
}

function formatCount(n: number | string): string {
  if (typeof n === 'string') return n
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return n.toString()
}

export const StarRating = React.forwardRef<HTMLDivElement, StarRatingProps>(function StarRating(
  { value, onChange, size = 'md', showValue = true, reviewCount, max = 5, className, ...rest },
  ref,
) {
  const interactive = typeof onChange === 'function'
  const iconSize = ICON_SIZES[size]

  // ── Interactive mode: full stars only, 1..max
  if (interactive) {
    return (
      <div
        ref={ref}
        role="radiogroup"
        aria-label="Note"
        className={cn('inline-flex items-center gap-0.5', className)}
        {...rest}
      >
        {Array.from({ length: max }).map((_, i) => {
          const star = i + 1
          const active = star <= Math.round(value)
          return (
            <button
              key={star}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`${star} étoile${star > 1 ? 's' : ''}`}
              onClick={() => onChange!(star)}
              className="p-1 -m-1 transition-transform active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gb-accent rounded-gb-sm"
            >
              <Star
                size={iconSize}
                className={cn(
                  active ? 'fill-gb-warning stroke-gb-warning' : 'fill-transparent stroke-gb-stroke-strong',
                )}
              />
            </button>
          )
        })}
      </div>
    )
  }

  // ── Display mode: single filled star + numeric value (Wolt/UberEats style)
  return (
    <div
      ref={ref}
      className={cn('inline-flex items-center gap-1 font-semibold text-gb-content', TEXT_SIZES[size], className)}
      {...rest}
    >
      <Star size={iconSize} className="fill-gb-warning stroke-gb-warning" />
      {showValue && <span>{value.toFixed(1)}</span>}
      {reviewCount !== undefined && (
        <span className="font-medium text-gb-content-muted">({formatCount(reviewCount)})</span>
      )}
    </div>
  )
})

export default StarRating
