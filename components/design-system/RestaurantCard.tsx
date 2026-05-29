'use client'

import * as React from 'react'
import { Clock, Bike } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from './Badge'
import { StarRating } from './StarRating'

export type RestaurantCardLayout = 'grid' | 'list' | 'hero'

export interface RestaurantCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onClick'> {
  name: string
  /** Cover photo URL. Falls back to gradient tile derived from name. */
  cover?: string | null
  /** Cuisine label, e.g. "Italien • Pizza". */
  cuisine?: string
  rating?: number
  reviewCount?: number | string
  /** Delivery time in minutes. */
  deliveryTime?: number
  deliveryFee?: number
  minOrder?: number
  /** Currency symbol — default €. */
  currency?: string
  /** Top-left ribbon, e.g. "Nouveau", "Promo -20%". */
  ribbon?: { label: string; tone?: 'primary' | 'success' | 'danger' | 'dark' }
  /** Optional click handler — turns the whole card into a button. */
  onClick?: () => void
  layout?: RestaurantCardLayout
  /** Show a closed/unavailable overlay. */
  unavailable?: boolean
}

const GRADIENTS = [
  ['#F97316', '#EA6A0C'],
  ['#16A085', '#0E7A6B'],
  ['#2BB673', '#0E9F6E'],
  ['#6C5CE7', '#4834A6'],
  ['#E84393', '#C2185B'],
  ['#2D3561', '#1a1a2e'],
  ['#F7B733', '#E8593C'],
] as const

function hash(s: string) {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i)
  return Math.abs(h)
}

function CoverArea({
  cover,
  name,
  className,
  unavailable,
  ribbon,
}: {
  cover?: string | null
  name: string
  className?: string
  unavailable?: boolean
  ribbon?: RestaurantCardProps['ribbon']
}) {
  const [from, to] = GRADIENTS[hash(name) % GRADIENTS.length]!

  return (
    <div
      className={cn('relative overflow-hidden', className)}
      style={{ background: `linear-gradient(135deg, ${from} 0%, ${to} 100%)` }}
    >
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={cover}
          alt={name}
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <span
          aria-hidden
          className="absolute inset-0 grid place-items-center text-white/90 font-display font-bold text-2xl drop-shadow"
        >
          {name.trim()[0]?.toUpperCase() ?? '?'}
        </span>
      )}

      {ribbon && (
        <span className="absolute top-3 left-3 z-10">
          <Badge tone={ribbon.tone ?? 'primary'} size="md">
            {ribbon.label}
          </Badge>
        </span>
      )}

      {unavailable && (
        <div className="absolute inset-0 z-10 bg-black/55 grid place-items-center">
          <span className="px-3 py-1 rounded-grubano-pill bg-white/95 text-grubano-ink text-grubano-sm font-bold">
            Fermé
          </span>
        </div>
      )}
    </div>
  )
}

function MetaRow({
  rating,
  reviewCount,
  deliveryTime,
  deliveryFee,
  currency = '€',
}: Pick<RestaurantCardProps, 'rating' | 'reviewCount' | 'deliveryTime' | 'deliveryFee' | 'currency'>) {
  return (
    <div className="flex items-center gap-3 text-grubano-xs text-grubano-ink-muted">
      {typeof rating === 'number' && rating > 0 && (
        <StarRating value={rating} size="sm" reviewCount={reviewCount} />
      )}
      {typeof deliveryTime === 'number' && (
        <span className="inline-flex items-center gap-1 font-medium">
          <Clock size={12} />
          {deliveryTime} min
        </span>
      )}
      {typeof deliveryFee === 'number' && (
        <span className="inline-flex items-center gap-1 font-medium">
          <Bike size={12} />
          {deliveryFee === 0 ? 'Gratuit' : `${deliveryFee.toFixed(2).replace('.', ',')} ${currency}`}
        </span>
      )}
    </div>
  )
}

export const RestaurantCard = React.forwardRef<HTMLDivElement, RestaurantCardProps>(function RestaurantCard(
  {
    name,
    cover,
    cuisine,
    rating,
    reviewCount,
    deliveryTime,
    deliveryFee,
    minOrder,
    currency = '€',
    ribbon,
    onClick,
    layout = 'grid',
    unavailable,
    className,
    ...rest
  },
  ref,
) {
  const interactive = typeof onClick === 'function'

  const wrapperBase =
    'bg-grubano-surface border border-grubano-border overflow-hidden ' +
    'transition-all duration-150'

  const interactiveClasses = interactive
    ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-grubano-lg active:scale-[0.99] ' +
      'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-grubano-primary/30'
    : ''

  // ── List layout (horizontal row, used in /eat search results)
  if (layout === 'list') {
    return (
      <div
        ref={ref}
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
        onClick={onClick}
        onKeyDown={(e) => interactive && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick!())}
        className={cn(
          wrapperBase,
          'flex gap-3 p-3 rounded-grubano-lg shadow-grubano-sm',
          interactiveClasses,
          className,
        )}
        {...rest}
      >
        <CoverArea cover={cover} name={name} ribbon={ribbon} unavailable={unavailable} className="h-24 w-24 rounded-grubano-md shrink-0" />
        <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
          <div>
            <h3 className="font-display font-bold text-grubano-base text-grubano-ink truncate">{name}</h3>
            {cuisine && <p className="text-grubano-xs text-grubano-ink-muted truncate">{cuisine}</p>}
          </div>
          <MetaRow rating={rating} reviewCount={reviewCount} deliveryTime={deliveryTime} deliveryFee={deliveryFee} currency={currency} />
        </div>
      </div>
    )
  }

  // ── Hero layout (oversize — restaurant detail header / featured)
  if (layout === 'hero') {
    return (
      <div
        ref={ref}
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : undefined}
        onClick={onClick}
        className={cn(
          wrapperBase,
          'rounded-grubano-2xl shadow-grubano-lg',
          interactiveClasses,
          className,
        )}
        {...rest}
      >
        <CoverArea cover={cover} name={name} ribbon={ribbon} unavailable={unavailable} className="h-56" />
        <div className="p-5 flex flex-col gap-2">
          <h2 className="font-display font-bold text-grubano-2xl text-grubano-ink">{name}</h2>
          {cuisine && <p className="text-grubano-sm text-grubano-ink-muted">{cuisine}</p>}
          <div className="mt-1">
            <MetaRow rating={rating} reviewCount={reviewCount} deliveryTime={deliveryTime} deliveryFee={deliveryFee} currency={currency} />
          </div>
          {typeof minOrder === 'number' && minOrder > 0 && (
            <p className="text-grubano-xs text-grubano-ink-muted mt-1">
              Min. {minOrder.toFixed(2).replace('.', ',')} {currency}
            </p>
          )}
        </div>
      </div>
    )
  }

  // ── Grid layout (default — vertical card for homepage feeds)
  return (
    <div
      ref={ref}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onClick={onClick}
      onKeyDown={(e) => interactive && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick!())}
      className={cn(
        wrapperBase,
        'rounded-grubano-xl shadow-grubano-md',
        interactiveClasses,
        className,
      )}
      {...rest}
    >
      <CoverArea cover={cover} name={name} ribbon={ribbon} unavailable={unavailable} className="h-40" />
      <div className="p-4 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-display font-bold text-grubano-lg text-grubano-ink leading-tight line-clamp-1">{name}</h3>
        </div>
        {cuisine && <p className="text-grubano-xs text-grubano-ink-muted line-clamp-1">{cuisine}</p>}
        <MetaRow rating={rating} reviewCount={reviewCount} deliveryTime={deliveryTime} deliveryFee={deliveryFee} currency={currency} />
      </div>
    </div>
  )
})

export default RestaurantCard
