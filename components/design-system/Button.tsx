'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

// `gb-*` variants are the OPT-IN Grubano Design System skin (Agent 151) used by the
// /eat consumer app. They are ADDITIVE: the four legacy variants below + their
// BASE/SIZES are UNTOUCHED, so every operator call-site renders byte-identically.
export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gb-primary' | 'gb-secondary' | 'gb-ghost'
export type ButtonSize    = 'sm' | 'md' | 'lg' | 'pill'

const BASE =
  'inline-flex items-center justify-center gap-2 font-semibold ' +
  'transition-all duration-150 active:scale-[0.98] ' +
  'disabled:opacity-50 disabled:pointer-events-none ' +
  'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-grubano-primary/30'

const VARIANTS: Record<'primary' | 'secondary' | 'ghost' | 'danger', string> = {
  primary:
    'bg-grubano-primary text-white shadow-grubano-cta ' +
    'hover:bg-grubano-primaryHover',
  secondary:
    'bg-grubano-surface text-grubano-ink border border-grubano-border-strong ' +
    'hover:bg-grubano-surface-muted',
  ghost:
    'bg-transparent text-grubano-ink hover:bg-grubano-surface-muted',
  danger:
    'bg-grubano-danger text-white hover:brightness-95',
}

const SIZES: Record<ButtonSize, string> = {
  sm:   'h-9  px-3 text-grubano-sm  rounded-grubano-md',
  md:   'h-11 px-4 text-grubano-base rounded-grubano-lg',
  lg:   'h-14 px-6 text-grubano-lg  rounded-grubano-xl',
  pill: 'h-12 px-6 text-grubano-base rounded-grubano-pill',
}

// ── Grubano DS (gb-) opt-in path — additive, /eat-only ────────────────────────
const GB_BASE =
  'inline-flex items-center justify-center gap-2 font-gb-sans font-semibold ' +
  'transition-all duration-150 active:scale-[0.98] ' +
  'disabled:opacity-50 disabled:pointer-events-none ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gb-accent'

const GB_VARIANTS: Record<'gb-primary' | 'gb-secondary' | 'gb-ghost', string> = {
  // CD-exact: filled buttons use the VIVID accent #FF6A1F (bg-gb-accent) to match the
  // Claude-Design mockups. Founder decision overrides the DS a11y note: white-on-#FF6A1F
  // ≈ 2.9:1 in LIGHT is an ACCEPTED, documented tradeoff (revisit at go-live). text-on-accent
  // keeps DARK accessible (dark text on the lightened accent ≈ 7:1). hover = accent-hover #F2570E.
  'gb-primary':   'bg-gb-accent text-gb-content-on-accent shadow-gb-md hover:bg-gb-accent-hover',
  'gb-secondary': 'bg-gb-surface-elevated text-gb-content border border-gb-stroke-strong hover:bg-gb-oat-100',
  'gb-ghost':     'bg-transparent text-gb-content hover:bg-gb-oat-100',
}

const GB_SIZES: Record<ButtonSize, string> = {
  sm:   'h-9  px-3 text-sm   rounded-gb-md',
  md:   'h-11 px-4 text-base rounded-gb-lg',
  lg:   'h-14 px-6 text-lg   rounded-gb-xl',
  pill: 'h-12 px-6 text-base rounded-gb-full',
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  loading?: boolean
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    fullWidth,
    loading,
    leftIcon,
    rightIcon,
    children,
    className,
    disabled,
    ...rest
  },
  ref,
) {
  const gb = variant.startsWith('gb-')
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        gb ? GB_BASE : BASE,
        gb ? GB_VARIANTS[variant as keyof typeof GB_VARIANTS] : VARIANTS[variant as keyof typeof VARIANTS],
        gb ? GB_SIZES[size] : SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden
          className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin"
        />
      ) : (
        leftIcon && <span className="shrink-0">{leftIcon}</span>
      )}
      {children}
      {!loading && rightIcon && <span className="shrink-0">{rightIcon}</span>}
    </button>
  )
})

export default Button
