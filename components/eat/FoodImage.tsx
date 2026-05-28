'use client'

import { cn } from '@/lib/utils'

/**
 * FoodImage — deterministic gradient placeholder for restaurants / dishes.
 *
 * When no real photo is available, we render an intentional-looking gradient
 * tile (one of 6 warm/fresh palettes, chosen by a hash of the name) with a
 * centered food emoji or the name's initial. This keeps the UI looking
 * polished instead of broken before real photography is uploaded.
 *
 * If `src` is provided, the real image is shown and the gradient is the
 * background fallback while it loads / if it errors.
 */

const GRADIENTS = [
  'linear-gradient(135deg, #E8593C 0%, #C2341B 100%)', // warm orange → red
  'linear-gradient(135deg, #F7971E 0%, #FFD200 100%)', // sunrise amber
  'linear-gradient(135deg, #11998E 0%, #38EF7D 100%)', // fresh green → teal
  'linear-gradient(135deg, #FF6B6B 0%, #FFA36C 100%)', // coral peach
  'linear-gradient(135deg, #654EA3 0%, #EAAFC8 100%)', // plum berry
  'linear-gradient(135deg, #2C3E50 0%, #4CA1AF 100%)', // deep teal slate
] as const

// A handful of food emojis to vary the look when none is supplied.
const FALLBACK_EMOJIS = ['🍽️', '🍜', '🥗', '🍕', '🍔', '🥙', '🍰', '🌮', '🍱', '🥘'] as const

/** Simple deterministic string hash (djb2-ish). */
function hashString(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i)
  }
  return Math.abs(hash)
}

interface FoodImageProps {
  /** Name used to derive the gradient + initial (restaurant or dish name). */
  name: string
  /** Optional real image URL. Falls back to gradient if empty or it errors. */
  src?: string | null
  /** Emoji to center on the gradient. Defaults to a hashed food emoji. */
  emoji?: string
  /** Show the name's first initial instead of an emoji. */
  showInitial?: boolean
  /** Extra classes (use for sizing + radius). */
  className?: string
  /** Tailwind text size for the centered glyph. */
  glyphClassName?: string
  /** Alt text for the <img>. */
  alt?: string
}

export default function FoodImage({
  name,
  src,
  emoji,
  showInitial = false,
  className,
  glyphClassName = 'text-4xl',
  alt,
}: FoodImageProps) {
  const h = hashString(name || 'grubano')
  const gradient = GRADIENTS[h % GRADIENTS.length]
  const fallbackEmoji = emoji ?? FALLBACK_EMOJIS[h % FALLBACK_EMOJIS.length]
  const initial = (name?.trim()?.[0] ?? '?').toUpperCase()

  return (
    <div
      className={cn(
        'relative flex items-center justify-center overflow-hidden bg-gray-100',
        className,
      )}
      style={{ background: gradient }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt ?? name}
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
        />
      ) : showInitial ? (
        <span
          className={cn('font-bold text-white/95 drop-shadow-sm', glyphClassName)}
          aria-hidden
        >
          {initial}
        </span>
      ) : (
        <span className={cn('drop-shadow-sm', glyphClassName)} aria-hidden>
          {fallbackEmoji}
        </span>
      )}
    </div>
  )
}
