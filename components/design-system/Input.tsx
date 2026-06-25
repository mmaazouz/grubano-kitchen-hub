'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  hint?: string
  error?: string
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
  containerClassName?: string
  /** Opt-in Grubano DS (gb-) skin — additive, /eat-only (Agent 152). Default
   *  ('grubano') keeps the operator rendering byte-identical. */
  skin?: 'grubano' | 'gb'
}

let idCounter = 0
function useFieldId(provided?: string) {
  const [auto] = React.useState(() => `gb-input-${++idCounter}`)
  return provided ?? auto
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    hint,
    error,
    leftIcon,
    rightIcon,
    id,
    className,
    containerClassName,
    skin = 'grubano',
    type = 'text',
    ...rest
  },
  ref,
) {
  const fieldId = useFieldId(id)
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined
  const gb = skin === 'gb'

  return (
    <div className={cn('flex flex-col gap-1.5', containerClassName)}>
      {label && (
        <label
          htmlFor={fieldId}
          className={gb ? 'text-sm font-semibold text-gb-content' : 'text-grubano-sm font-semibold text-grubano-ink'}
        >
          {label}
        </label>
      )}

      <div
        className={cn(
          gb
            ? 'relative flex items-center bg-gb-surface-elevated border rounded-gb-lg'
            : 'relative flex items-center bg-grubano-surface border rounded-grubano-lg',
          'transition-all duration-150',
          error
            ? (gb
                ? 'border-gb-error focus-within:ring-2 focus-within:ring-gb-error'
                : 'border-grubano-danger focus-within:ring-4 focus-within:ring-grubano-danger/20')
            : (gb
                ? 'border-gb-stroke-strong focus-within:border-gb-accent focus-within:ring-2 focus-within:ring-gb-accent'
                : 'border-grubano-border-strong focus-within:border-grubano-primary focus-within:ring-4 focus-within:ring-grubano-primary/20'),
        )}
      >
        {leftIcon && (
          <span className={gb ? 'pl-3 text-gb-content-muted shrink-0' : 'pl-3 text-grubano-ink-muted shrink-0'}>{leftIcon}</span>
        )}
        <input
          ref={ref}
          id={fieldId}
          type={type}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            gb
              ? 'flex-1 h-11 px-3 bg-transparent text-base text-gb-content'
              : 'flex-1 h-11 px-3 bg-transparent text-grubano-base text-grubano-ink',
            gb
              ? 'placeholder:text-gb-content-muted outline-none'
              : 'placeholder:text-grubano-ink-faint outline-none',
            'disabled:opacity-50 disabled:pointer-events-none',
            leftIcon  && 'pl-2',
            rightIcon && 'pr-2',
            className,
          )}
          {...rest}
        />
        {rightIcon && (
          <span className={gb ? 'pr-3 text-gb-content-muted shrink-0' : 'pr-3 text-grubano-ink-muted shrink-0'}>{rightIcon}</span>
        )}
      </div>

      {error ? (
        <p id={`${fieldId}-error`} className={gb ? 'text-xs font-medium text-gb-error' : 'text-grubano-xs font-medium text-grubano-danger'}>
          {error}
        </p>
      ) : hint ? (
        <p id={`${fieldId}-hint`} className={gb ? 'text-xs text-gb-content-muted' : 'text-grubano-xs text-grubano-ink-muted'}>
          {hint}
        </p>
      ) : null}
    </div>
  )
})

export default Input
