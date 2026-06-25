'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface EmptyStateProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Big visual: emoji string or a custom illustration node. */
  emoji?: React.ReactNode
  /** Headline — keep it human. */
  title: string
  /** Optional supporting copy. */
  description?: React.ReactNode
  /** Optional CTA — pass a Button or any node. */
  action?: React.ReactNode
  /** Compact variant — for small empty lists inside cards. */
  compact?: boolean
  /** Opt-in Grubano DS (gb-) skin (Agent 151) — additive, /eat-only. The default
   *  ('grubano') keeps the original operator rendering byte-identical. */
  skin?: 'grubano' | 'gb'
}

export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(
  { emoji = '🍽️', title, description, action, compact, skin = 'grubano', className, ...rest },
  ref,
) {
  const gb = skin === 'gb'
  return (
    <div
      ref={ref}
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'py-8 gap-2' : 'py-16 gap-3',
        className,
      )}
      {...rest}
    >
      <div
        aria-hidden
        className={cn(
          'flex items-center justify-center',
          gb ? 'rounded-gb-full bg-gb-zest-50' : 'rounded-grubano-pill bg-grubano-tint',
          compact ? 'h-12 w-12 text-2xl' : 'h-20 w-20 text-4xl',
        )}
      >
        {emoji}
      </div>
      <h3
        className={cn(
          gb ? 'font-gb-display' : 'font-display',
          'font-bold',
          gb ? 'text-gb-content' : 'text-grubano-ink',
          compact ? (gb ? 'text-base' : 'text-grubano-base') : (gb ? 'text-xl' : 'text-grubano-xl'),
        )}
      >
        {title}
      </h3>
      {description && (
        <p className={cn(
          gb ? 'text-gb-content-muted' : 'text-grubano-ink-muted',
          'max-w-sm',
          compact ? (gb ? 'text-xs' : 'text-grubano-xs') : (gb ? 'text-sm' : 'text-grubano-sm'),
        )}>
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
})

export default EmptyState
