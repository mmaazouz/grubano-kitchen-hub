'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

// ── Stellar Button (consumer redesign, Agent 128) ─────────────────────────────
// NEW namespace — does NOT touch components/design-system/Button. Styled with the
// `stellar-*` Tailwind tokens (var(--st-*)), which only resolve inside a `.grubano-v2`
// subtree. Plus Jakarta Sans display font, Stellar green primary, token radii/shadows.
export type StellarButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type StellarButtonSize = 'sm' | 'md' | 'lg'

const BASE =
  'inline-flex items-center justify-center gap-2 font-stellar-display font-semibold ' +
  'transition-all duration-200 ease-out active:scale-[0.98] ' +
  'disabled:opacity-50 disabled:pointer-events-none ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stellar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-stellar-bg'

const VARIANTS: Record<StellarButtonVariant, string> = {
  primary:   'bg-stellar-primary text-stellar-primary-fg shadow-stellar-soft hover:shadow-stellar-glow',
  secondary: 'bg-stellar-surface-2 text-stellar-fg border border-stellar-border hover:bg-stellar-muted',
  ghost:     'bg-transparent text-stellar-fg hover:bg-stellar-surface-2',
  danger:    'bg-stellar-destructive text-stellar-destructive-fg hover:brightness-95',
}

const SIZES: Record<StellarButtonSize, string> = {
  sm: 'h-9  px-3.5 text-sm rounded-stellar-md',
  md: 'h-11 px-5   text-base rounded-stellar-lg',
  lg: 'h-14 px-7   text-lg rounded-stellar-xl',
}

export interface StellarButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: StellarButtonVariant
  size?: StellarButtonSize
  fullWidth?: boolean
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}

export const StellarButton = React.forwardRef<HTMLButtonElement, StellarButtonProps>(function StellarButton(
  { variant = 'primary', size = 'md', fullWidth, leftIcon, rightIcon, children, className, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(BASE, VARIANTS[variant], SIZES[size], fullWidth && 'w-full', className)}
      {...rest}
    >
      {leftIcon && <span className="shrink-0">{leftIcon}</span>}
      {children}
      {rightIcon && <span className="shrink-0">{rightIcon}</span>}
    </button>
  )
})

export default StellarButton
