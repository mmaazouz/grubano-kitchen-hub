'use client'

import { cn } from '@/lib/utils'

/**
 * FoodImage — premium gradient placeholder for restaurants / dishes.
 *
 * Grubano's staging data has no photography, so this component is the visual
 * backbone of the app. Instead of a flat colour, each placeholder is a
 * branded "tile": a food-inspired gradient + a soft radial highlight for depth
 * + a faint dot-grid texture, with an elegant centered glyph (emoji or
 * initial). The palette is chosen deterministically from the name so the same
 * restaurant/dish always looks the same.
 *
 * If `src` is provided, the real image is shown on top; the gradient remains
 * as the loading / error background.
 */

const GRADIENTS = [
  ['#E8593C', '#B11E2F'], // signature orange → crimson
  ['#FF8A3D', '#E8593C'], // mango → brand orange
  ['#F7B733', '#E8593C'], // amber → orange
  ['#16A085', '#0E7A6B'], // basil → deep teal
  ['#2BB673', '#0E9F6E'], // fresh green
  ['#6C5CE7', '#4834A6'], // grape
  ['#E84393', '#C2185B'], // berry
  ['#2D3561', '#1a1a2e'], // midnight (navy brand)
] as const

const FALLBACK_EMOJIS = ['🍽️', '🍜', '🥗', '🍕', '🍔', '🥙', '🍰', '🌮', '🍱', '🥘', '🍝', '🥟'] as const

/** Deterministic djb2-ish string hash. */
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
  /** Optional real image URL. Falls back to the gradient tile if empty. */
  src?: string | null
  /** Emoji to center. Defaults to a hashed food emoji. */
  emoji?: string
  /** Show the name's first initial instead of an emoji. */
  showInitial?: boolean
  /** Extra classes (use for sizing + radius). */
  className?: string
  /** Tailwind text size for the centered glyph. */
  glyphClassName?: string
  /** Alt text for the <img>. */
  alt?: string
  /** Hide the centered glyph entirely (pure texture tile). */
  hideGlyph?: boolean
}

// A faint dot-grid texture, encoded once as a data URI.
const DOT_TEXTURE =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20'%3E%3Ccircle cx='2' cy='2' r='1' fill='%23ffffff' fill-opacity='0.12'/%3E%3C/svg%3E\")"

export default function FoodImage({
  name,
  src,
  emoji,
  showInitial = false,
  className,
  glyphClassName = 'text-4xl',
  alt,
  hideGlyph = false,
}: FoodImageProps) {
  const h = hashString(name || 'grubano')
  const [from, to] = GRADIENTS[h % GRADIENTS.length]
  const fallbackEmoji = emoji ?? FALLBACK_EMOJIS[h % FALLBACK_EMOJIS.length]
  const initial = (name?.trim()?.[0] ?? '?').toUpperCase()
  // Slight angle variation so tiles don't look uniform.
  const angle = 120 + (h % 5) * 15

  return (
    <div
      className={cn(
        'relative isolate flex items-center justify-center overflow-hidden',
        className,
      )}
      style={{ background: `linear-gradient(${angle}deg, ${from} 0%, ${to} 100%)` }}
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
        <>
          {/* Soft radial highlight (top-left) for depth */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'radial-gradient(120% 90% at 18% 12%, rgba(255,255,255,0.28), rgba(255,255,255,0) 55%)',
            }}
          />
          {/* Dot-grid texture */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{ backgroundImage: DOT_TEXTURE }}
          />
          {/* Bottom vignette for legibility of overlaid logos/badges */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2"
            style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.18), transparent)' }}
          />
          {!hideGlyph &&
            (showInitial ? (
              <span
                className={cn(
                  'relative z-10 font-bold tracking-tight text-white/95 drop-shadow-[0_2px_8px_rgba(0,0,0,0.25)]',
                  glyphClassName,
                )}
                style={{ fontFamily: "'Space Grotesk', system-ui, sans-serif" }}
                aria-hidden
              >
                {initial}
              </span>
            ) : (
              <span
                className={cn('relative z-10 drop-shadow-[0_2px_8px_rgba(0,0,0,0.2)]', glyphClassName)}
                aria-hidden
              >
                {fallbackEmoji}
              </span>
            ))}
        </>
      )}
    </div>
  )
}
