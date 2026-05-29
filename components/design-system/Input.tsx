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
    type = 'text',
    ...rest
  },
  ref,
) {
  const fieldId = useFieldId(id)
  const describedBy = error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined

  return (
    <div className={cn('flex flex-col gap-1.5', containerClassName)}>
      {label && (
        <label
          htmlFor={fieldId}
          className="text-grubano-sm font-semibold text-grubano-ink"
        >
          {label}
        </label>
      )}

      <div
        className={cn(
          'relative flex items-center bg-grubano-surface border rounded-grubano-lg',
          'transition-all duration-150',
          error
            ? 'border-grubano-danger focus-within:ring-4 focus-within:ring-grubano-danger/20'
            : 'border-grubano-border-strong focus-within:border-grubano-primary focus-within:ring-4 focus-within:ring-grubano-primary/20',
        )}
      >
        {leftIcon && (
          <span className="pl-3 text-grubano-ink-muted shrink-0">{leftIcon}</span>
        )}
        <input
          ref={ref}
          id={fieldId}
          type={type}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            'flex-1 h-11 px-3 bg-transparent text-grubano-base text-grubano-ink',
            'placeholder:text-grubano-ink-faint outline-none',
            'disabled:opacity-50 disabled:pointer-events-none',
            leftIcon  && 'pl-2',
            rightIcon && 'pr-2',
            className,
          )}
          {...rest}
        />
        {rightIcon && (
          <span className="pr-3 text-grubano-ink-muted shrink-0">{rightIcon}</span>
        )}
      </div>

      {error ? (
        <p id={`${fieldId}-error`} className="text-grubano-xs font-medium text-grubano-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${fieldId}-hint`} className="text-grubano-xs text-grubano-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
})

export default Input
