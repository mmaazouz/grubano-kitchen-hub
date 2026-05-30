'use client'

import * as React from 'react'
import { Plus, Flame } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from './Badge'
import { PriceTag } from './PriceTag'

export type DishLayout = 'vertical' | 'horizontal'

export interface DishCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onClick'> {
  name: string
  description?: string
  /** Final price in euros (or cents — see PriceTag). */
  price: number
  /** Optional original price for strikethrough. */
  originalPrice?: number
  cents?: boolean
  currency?: string
  /** Photo URL. Falls back to a gradient tile from name. */
  photo?: string | null
  /** Calories, allergens, etc. — tiny line below description. */
  meta?: React.ReactNode
  /** Labels: Nouveau / Populaire / Veggie. */
  labels?: Array<{ label: string; tone?: 'primary' | 'success' | 'warning' | 'neutral' }>
  popular?: boolean
  unavailable?: boolean
  /** Badge text for popular dishes (i18n). Defaults to French "Populaire". */
  popularLabel?: string
  /** Compact popular badge in the horizontal layout. Defaults to "Top". */
  topLabel?: string
  /** Sold-out overlay text (i18n). Defaults to French "Épuisé". */
  soldOutLabel?: string
  /** When set, the card becomes interactive (whole card tap). */
  onClick?: () => void
  /** When set, shows a + button (independent of card click). */
  onAdd?: () => void
  /** Quantity in cart — shows pill instead of + button. */
  quantityInCart?: number
  layout?: DishLayout
}

const GRADIENTS = [
  ['#F97316', '#EA6A0C'],
  ['#16A085', '#0E7A6B'],
  ['#2BB673', '#0E9F6E'],
  ['#6C5CE7', '#4834A6'],
  ['#E84393', '#C2185B'],
  ['#F7B733', '#E8593C'],
] as const

const FALLBACK_EMOJIS = ['🍽️', '🍕', '🥗', '🍔', '🥙', '🍰', '🌮', '🍱', '🍝', '🥟']

function hash(s: string) {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i)
  return Math.abs(h)
}

function DishPhoto({
  photo,
  name,
  className,
  unavailable,
  soldOutLabel = 'Épuisé',
}: {
  photo?: string | null
  name: string
  className?: string
  unavailable?: boolean
  soldOutLabel?: string
}) {
  const h = hash(name)
  const [from, to] = GRADIENTS[h % GRADIENTS.length]!
  const emoji = FALLBACK_EMOJIS[h % FALLBACK_EMOJIS.length]

  return (
    <div
      className={cn('relative overflow-hidden', className)}
      style={{ background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)` }}
    >
      {photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photo} alt={name} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />
      ) : (
        <span aria-hidden className="absolute inset-0 grid place-items-center text-3xl drop-shadow">
          {emoji}
        </span>
      )}
      {unavailable && (
        <div className="absolute inset-0 bg-white/70 grid place-items-center">
          <span className="text-grubano-xs font-bold text-grubano-ink">{soldOutLabel}</span>
        </div>
      )}
    </div>
  )
}

function AddButton({
  onAdd,
  qty,
}: {
  onAdd?: () => void
  qty?: number
}) {
  if (!onAdd && !qty) return null
  if (qty && qty > 0) {
    return (
      <span
        aria-label={`${qty} dans le panier`}
        className="absolute -bottom-2 -right-2 h-9 min-w-9 px-2 inline-flex items-center justify-center rounded-grubano-pill bg-grubano-primary text-white font-bold text-grubano-sm shadow-grubano-cta"
      >
        {qty}
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onAdd?.()
      }}
      aria-label="Ajouter au panier"
      className="absolute -bottom-2 -right-2 h-9 w-9 inline-flex items-center justify-center rounded-grubano-pill bg-grubano-primary text-white shadow-grubano-cta active:scale-90 transition-transform focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-grubano-primary/30"
    >
      <Plus size={18} strokeWidth={2.5} />
    </button>
  )
}

export const DishCard = React.forwardRef<HTMLDivElement, DishCardProps>(function DishCard(
  {
    name,
    description,
    price,
    originalPrice,
    cents,
    currency,
    photo,
    meta,
    labels,
    popular,
    unavailable,
    popularLabel = 'Populaire',
    topLabel = 'Top',
    soldOutLabel,
    onClick,
    onAdd,
    quantityInCart,
    layout = 'horizontal',
    className,
    ...rest
  },
  ref,
) {
  const interactive = typeof onClick === 'function'
  const interactiveClasses = interactive
    ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-grubano-md active:scale-[0.99] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-grubano-primary/30'
    : ''

  if (layout === 'vertical') {
    return (
      <div
        ref={ref}
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
        onClick={onClick}
        className={cn(
          'group relative bg-grubano-surface border border-grubano-border rounded-grubano-xl overflow-hidden shadow-grubano-sm transition-all duration-150',
          interactiveClasses,
          unavailable && 'opacity-70',
          className,
        )}
        {...rest}
      >
        <div className="relative">
          <DishPhoto photo={photo} name={name} className="h-36 w-full" unavailable={unavailable} soldOutLabel={soldOutLabel} />
          {popular && (
            <span className="absolute top-2 left-2">
              <Badge tone="warning" size="sm" icon={<Flame size={10} />}>
                {popularLabel}
              </Badge>
            </span>
          )}
          <AddButton onAdd={onAdd} qty={quantityInCart} />
        </div>
        <div className="p-3 flex flex-col gap-1">
          <h4 className="font-semibold text-grubano-sm text-grubano-ink line-clamp-2">{name}</h4>
          {description && <p className="text-grubano-xs text-grubano-ink-muted line-clamp-2">{description}</p>}
          <div className="mt-1 flex items-center justify-between gap-2">
            <PriceTag amount={price} originalAmount={originalPrice} cents={cents} currency={currency} size="sm" />
            {labels && labels.length > 0 && (
              <div className="flex gap-1">
                {labels.slice(0, 1).map((l) => (
                  <Badge key={l.label} tone={l.tone ?? 'neutral'} size="sm">
                    {l.label}
                  </Badge>
                ))}
              </div>
            )}
          </div>
          {meta && <div className="text-grubano-xs text-grubano-ink-faint mt-0.5">{meta}</div>}
        </div>
      </div>
    )
  }

  // ── Horizontal layout (default — menu list row)
  return (
    <div
      ref={ref}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      className={cn(
        'group relative bg-grubano-surface border border-grubano-border rounded-grubano-lg p-3 flex gap-3 transition-all duration-150',
        interactiveClasses,
        unavailable && 'opacity-70',
        className,
      )}
      {...rest}
    >
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-start gap-2 mb-1">
          <h4 className="flex-1 font-semibold text-grubano-base text-grubano-ink line-clamp-1">{name}</h4>
          {popular && (
            <Badge tone="warning" size="sm" icon={<Flame size={10} />}>
              {topLabel}
            </Badge>
          )}
        </div>
        {description && <p className="text-grubano-xs text-grubano-ink-muted line-clamp-2">{description}</p>}
        {labels && labels.length > 0 && (
          <div className="flex gap-1 mt-1.5 flex-wrap">
            {labels.map((l) => (
              <Badge key={l.label} tone={l.tone ?? 'neutral'} size="sm">
                {l.label}
              </Badge>
            ))}
          </div>
        )}
        <div className="mt-auto pt-2 flex items-center justify-between gap-2">
          <PriceTag amount={price} originalAmount={originalPrice} cents={cents} currency={currency} />
          {meta && <span className="text-grubano-xs text-grubano-ink-faint">{meta}</span>}
        </div>
      </div>
      <div className="relative shrink-0">
        <DishPhoto photo={photo} name={name} className="h-24 w-24 rounded-grubano-md" unavailable={unavailable} soldOutLabel={soldOutLabel} />
        <AddButton onAdd={onAdd} qty={quantityInCart} />
      </div>
    </div>
  )
})

export default DishCard
