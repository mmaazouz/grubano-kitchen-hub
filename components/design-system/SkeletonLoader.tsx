'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

const SHIMMER =
  'bg-gradient-to-r from-gb-oat-100 via-gb-oat-200 to-gb-oat-100 ' +
  '[background-size:200%_100%] animate-shimmer'

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Tailwind w-* / h-* override-friendly. Defaults: w-full h-4. */
  rounded?: 'sm' | 'md' | 'lg' | 'pill' | 'none'
}

const ROUNDED = {
  none: 'rounded-none',
  sm:   'rounded-gb-sm',
  md:   'rounded-gb-md',
  lg:   'rounded-gb-lg',
  pill: 'rounded-gb-full',
} as const

/**
 * Base shimmer block. Compose into higher-level skeletons (see <SkeletonCard/>).
 */
export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(function Skeleton(
  { rounded = 'md', className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      aria-hidden
      className={cn('w-full h-4', SHIMMER, ROUNDED[rounded], className)}
      {...rest}
    />
  )
})

/** Restaurant/dish card skeleton — match RestaurantCard footprint. */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-gb-xl overflow-hidden bg-gb-surface-elevated border border-gb-stroke', className)}>
      <Skeleton rounded="none" className="h-40" />
      <div className="p-4 flex flex-col gap-2">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <div className="flex gap-2 mt-1">
          <Skeleton className="h-5 w-16" rounded="pill" />
          <Skeleton className="h-5 w-16" rounded="pill" />
        </div>
      </div>
    </div>
  )
}

/** Horizontal dish-row skeleton — match DishCard horizontal variant. */
export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div className={cn('flex gap-3 p-3 bg-gb-surface-elevated rounded-gb-lg border border-gb-stroke', className)}>
      <Skeleton className="h-20 w-20 shrink-0" />
      <div className="flex-1 flex flex-col gap-2 py-1">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-4 w-16 mt-1" />
      </div>
    </div>
  )
}

/** List of N skeleton rows for loading states. */
export function SkeletonList({ count = 4, variant = 'row' }: { count?: number; variant?: 'row' | 'card' }) {
  return (
    <div className={variant === 'card' ? 'grid grid-cols-1 sm:grid-cols-2 gap-4' : 'flex flex-col gap-3'}>
      {Array.from({ length: count }).map((_, i) =>
        variant === 'card' ? <SkeletonCard key={i} /> : <SkeletonRow key={i} />
      )}
    </div>
  )
}

export default Skeleton
