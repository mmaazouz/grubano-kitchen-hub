'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export type CategoryPillSize = 'sm' | 'md' | 'lg'

const SIZES: Record<CategoryPillSize, string> = {
  sm: 'h-8  px-3 text-grubano-xs gap-1',
  md: 'h-10 px-4 text-grubano-sm gap-1.5',
  lg: 'h-12 px-5 text-grubano-base gap-2',
}

export interface CategoryPillProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Emoji or small icon shown before the label. */
  emoji?: React.ReactNode
  /** Selected (filled orange) vs idle (outlined surface). */
  active?: boolean
  size?: CategoryPillSize
}

export const CategoryPill = React.forwardRef<HTMLButtonElement, CategoryPillProps>(function CategoryPill(
  { emoji, active, size = 'md', children, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={active}
      className={cn(
        'inline-flex items-center font-semibold rounded-grubano-pill whitespace-nowrap',
        'transition-all duration-150 active:scale-95',
        'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-grubano-primary/30',
        SIZES[size],
        active
          ? 'bg-grubano-primary text-white shadow-grubano-cta'
          : 'bg-grubano-surface text-grubano-ink border border-grubano-border-strong hover:bg-grubano-surface-muted',
        className,
      )}
      {...rest}
    >
      {emoji && <span className="leading-none">{emoji}</span>}
      <span>{children}</span>
    </button>
  )
})

export default CategoryPill
