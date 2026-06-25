'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export type BadgeTone =
  | 'neutral'
  | 'primary'
  | 'success'
  | 'danger'
  | 'warning'
  | 'info'
  | 'dark'

export type BadgeSize = 'sm' | 'md'

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-grubano-surface-muted text-grubano-ink-muted',
  primary: 'bg-grubano-tint            text-grubano-primary',
  success: 'bg-grubano-success-tint    text-grubano-success',
  danger:  'bg-grubano-danger-tint     text-grubano-danger',
  warning: 'bg-grubano-warning-tint    text-grubano-warning',
  info:    'bg-grubano-info-tint       text-grubano-info',
  dark:    'bg-grubano-dark            text-white',
}

const SIZES: Record<BadgeSize, string> = {
  sm: 'h-5 px-2 text-[11px]',
  md: 'h-6 px-2.5 text-grubano-xs',
}

// ── Grubano DS (gb-) opt-in skin — additive, /eat-only (Agent 152). The maps
// above + the non-gb render path are UNCHANGED → operator badges byte-identical.
const GB_TONES: Record<BadgeTone, string> = {
  neutral: 'bg-gb-oat-100 text-gb-content-muted',
  primary: 'bg-gb-zest-50 text-gb-accent-strong',
  success: 'bg-gb-success-soft text-gb-success',
  danger:  'bg-gb-error-soft text-gb-error',
  warning: 'bg-gb-warning-soft text-gb-warning',
  info:    'bg-gb-info-soft text-gb-info',
  dark:    'bg-gb-ink-800 text-white',
}
const GB_SIZES: Record<BadgeSize, string> = {
  sm: 'h-5 px-2 text-[11px]',
  md: 'h-6 px-2.5 text-xs',
}

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
  size?: BadgeSize
  icon?: React.ReactNode
  dot?: boolean
  /** Opt-in Grubano DS skin — additive, /eat-only. Default keeps the operator
   *  rendering byte-identical. */
  skin?: 'grubano' | 'gb'
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { tone = 'neutral', size = 'md', icon, dot, skin = 'grubano', children, className, ...rest },
  ref,
) {
  const gb = skin === 'gb'
  return (
    <span
      ref={ref}
      className={gb
        ? cn(
            'inline-flex items-center gap-1 font-semibold rounded-gb-full whitespace-nowrap',
            GB_TONES[tone],
            GB_SIZES[size],
            className,
          )
        : cn(
            'inline-flex items-center gap-1 font-semibold rounded-grubano-pill whitespace-nowrap',
            TONES[tone],
            SIZES[size],
            className,
          )
      }
      {...rest}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {icon && <span className="shrink-0 leading-none">{icon}</span>}
      {children}
    </span>
  )
})

export default Badge
