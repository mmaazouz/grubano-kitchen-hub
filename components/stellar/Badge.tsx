'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

// ── Stellar Badge (Agent 128) ─────────────────────────────────────────────────
// Status pill in Stellar tokens. NEW namespace. Resolves only inside `.grubano-v2`.
export type StellarBadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'info' | 'ai' | 'danger'

const TONES: Record<StellarBadgeTone, string> = {
  neutral: 'bg-stellar-surface-2 text-stellar-muted-fg',
  primary: 'bg-stellar-primary-soft text-stellar-accent-fg',
  success: 'bg-stellar-primary-soft text-stellar-accent-fg',
  warning: 'bg-stellar-warning-soft text-stellar-warning',
  info:    'bg-stellar-info-soft text-stellar-info',
  ai:      'bg-stellar-ai-soft text-stellar-ai',
  danger:  'bg-stellar-destructive-soft text-stellar-destructive',
}

export interface StellarBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: StellarBadgeTone
  icon?: React.ReactNode
}

export function StellarBadge({ tone = 'neutral', icon, className, children, ...rest }: StellarBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-stellar-display font-semibold',
        TONES[tone],
        className,
      )}
      {...rest}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </span>
  )
}

export default StellarBadge
