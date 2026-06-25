'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export type CategoryPillSize = 'sm' | 'md' | 'lg'

const SIZES: Record<CategoryPillSize, string> = {
  sm: 'h-8  px-3 text-xs gap-1',
  md: 'h-10 px-4 text-sm gap-1.5',
  lg: 'h-12 px-5 text-base gap-2',
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
        'inline-flex items-center font-semibold rounded-gb-full whitespace-nowrap',
        'transition-all duration-150 active:scale-95',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gb-accent',
        SIZES[size],
        active
          ? 'bg-gb-accent-strong text-white shadow-gb-md'
          : 'bg-gb-surface-elevated text-gb-content border border-gb-stroke-strong hover:bg-gb-oat-100',
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
