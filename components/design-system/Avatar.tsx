'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

const SIZES: Record<AvatarSize, string> = {
  xs: 'h-6  w-6  text-[10px]',
  sm: 'h-8  w-8  text-xs',
  md: 'h-10 w-10 text-grubano-sm',
  lg: 'h-14 w-14 text-grubano-lg',
  xl: 'h-20 w-20 text-grubano-2xl',
}

// Deterministic palette pick — same name always renders the same color.
const PALETTE = [
  ['#F97316', '#EA6A0C'], // brand orange
  ['#16A085', '#0E7A6B'], // teal
  ['#2BB673', '#0E9F6E'], // green
  ['#6C5CE7', '#4834A6'], // grape
  ['#E84393', '#C2185B'], // berry
  ['#2D3561', '#1a1a2e'], // navy
  ['#F7B733', '#E8593C'], // amber→orange
] as const

function hash(s: string) {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i)
  return Math.abs(h)
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

export interface AvatarProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Name used for fallback initials + deterministic background color. */
  name: string
  /** Optional image URL. Falls back to initials tile on missing/error. */
  src?: string | null
  size?: AvatarSize
  /** Square (rounded-lg) instead of circular — useful for restaurant logos. */
  square?: boolean
  alt?: string
}

export const Avatar = React.forwardRef<HTMLDivElement, AvatarProps>(function Avatar(
  { name, src, size = 'md', square, alt, className, ...rest },
  ref,
) {
  const [from, to] = PALETTE[hash(name || 'grubano') % PALETTE.length]!
  const init = initials(name || '?')

  return (
    <div
      ref={ref}
      className={cn(
        'relative inline-flex items-center justify-center overflow-hidden font-bold text-white shrink-0',
        square ? 'rounded-grubano-md' : 'rounded-grubano-pill',
        SIZES[size],
        className,
      )}
      style={{ background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)` }}
      aria-label={alt ?? name}
      {...rest}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt ?? name}
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <span aria-hidden style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif" }}>
          {init}
        </span>
      )}
    </div>
  )
})

export default Avatar
