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

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
  size?: BadgeSize
  icon?: React.ReactNode
  dot?: boolean
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { tone = 'neutral', size = 'md', icon, dot, children, className, ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cn(
        'inline-flex items-center gap-1 font-semibold rounded-grubano-pill whitespace-nowrap',
        TONES[tone],
        SIZES[size],
        className,
      )}
      {...rest}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}
      {icon && <span className="shrink-0 leading-none">{icon}</span>}
      {children}
    </span>
  )
})

export default Badge
