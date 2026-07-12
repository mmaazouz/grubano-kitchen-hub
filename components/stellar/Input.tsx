'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

// ── Stellar Input (Agent 128) ─────────────────────────────────────────────────
// Form field in Stellar tokens. NEW namespace. Resolves only inside `.grubano-v2`.
export interface StellarInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: string
  error?: string
}

export const StellarInput = React.forwardRef<HTMLInputElement, StellarInputProps>(function StellarInput(
  { label, hint, error, className, id, ...rest },
  ref,
) {
  const autoId = React.useId()
  const inputId = id ?? autoId
  return (
    <div>
      {label && (
        <label htmlFor={inputId} className="mb-1 block text-sm font-stellar-display font-semibold text-stellar-fg">
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        className={cn(
          'h-11 w-full rounded-stellar-lg border bg-stellar-card px-3.5 text-base text-stellar-fg',
          'placeholder:text-stellar-muted-fg outline-none transition-colors duration-200',
          'focus:border-stellar-ring focus:ring-2 focus:ring-stellar-ring focus:ring-offset-0',
          error ? 'border-stellar-destructive' : 'border-stellar-border',
          className,
        )}
        {...rest}
      />
      {error ? (
        <p className="mt-1 text-xs text-stellar-destructive">{error}</p>
      ) : hint ? (
        <p className="mt-1 text-xs text-stellar-muted-fg">{hint}</p>
      ) : null}
    </div>
  )
})

export default StellarInput
