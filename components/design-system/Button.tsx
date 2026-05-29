'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize    = 'sm' | 'md' | 'lg' | 'pill'

const BASE =
  'inline-flex items-center justify-center gap-2 font-semibold ' +
  'transition-all duration-150 active:scale-[0.98] ' +
  'disabled:opacity-50 disabled:pointer-events-none ' +
  'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-grubano-primary/30'

const VARIANTS: Record<ButtonVariant, string> = {
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
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        BASE,
        VARIANTS[variant],
        SIZES[size],
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
