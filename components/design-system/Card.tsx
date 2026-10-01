'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export type CardElevation = 'flat' | 'sm' | 'md' | 'lg' | 'premium'
export type CardPadding   = 'none' | 'sm' | 'md' | 'lg'

const ELEV: Record<CardElevation, string> = {
  flat:    'shadow-none',
  sm:      'shadow-grubano-sm',
  md:      'shadow-grubano-md',
  lg:      'shadow-grubano-lg',
  premium: 'shadow-grubano-premium',
}

const PAD: Record<CardPadding, string> = {
  none: 'p-0',
  sm:   'p-3',
  md:   'p-4',
  lg:   'p-6',
}

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  elevation?: CardElevation
  padding?: CardPadding
  interactive?: boolean
  as?: 'div' | 'article' | 'section' | 'button'
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  {
    elevation = 'md',
    padding = 'md',
    interactive,
    as = 'div',
    className,
    children,
    ...rest
  },
  ref,
) {
  const Tag = as as React.ElementType
  return (
    <Tag
      ref={ref}
      className={cn(
        'bg-grubano-surface border border-grubano-border rounded-grubano-xl',
        ELEV[elevation],
        PAD[padding],
        interactive && 'cursor-pointer transition-all duration-150 hover:-translate-y-0.5 hover:shadow-grubano-lg active:scale-[0.99]',
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  )
})

export default Card
