'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

// ── Stellar Card (Agent 128) ──────────────────────────────────────────────────
// Surface primitive in Stellar tokens. NEW namespace; existing design-system Card
// untouched. Resolves only inside `.grubano-v2`.
export type StellarCardElevation = 'flat' | 'soft' | 'elev'
export type StellarCardPadding = 'none' | 'sm' | 'md' | 'lg'

const ELEVATION: Record<StellarCardElevation, string> = {
  flat: 'shadow-none',
  soft: 'shadow-stellar-soft',
  elev: 'shadow-stellar-elev',
}
const PADDING: Record<StellarCardPadding, string> = {
  none: '', sm: 'p-3', md: 'p-4', lg: 'p-6',
}

export interface StellarCardProps extends React.HTMLAttributes<HTMLDivElement> {
  elevation?: StellarCardElevation
  padding?: StellarCardPadding
  interactive?: boolean
}

export const StellarCard = React.forwardRef<HTMLDivElement, StellarCardProps>(function StellarCard(
  { elevation = 'soft', padding = 'md', interactive, className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'rounded-stellar-2xl border border-stellar-border bg-stellar-card text-stellar-card-fg',
        ELEVATION[elevation],
        PADDING[padding],
        interactive && 'transition-all duration-200 ease-out hover:-translate-y-0.5 hover:shadow-stellar-elev active:scale-[0.99]',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
})

export default StellarCard
