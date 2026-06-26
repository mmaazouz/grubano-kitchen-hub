'use client'

import * as React from 'react'
import { useLocale } from 'next-intl'
import { Clock, Bike } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatEuros } from '@/lib/format-money'
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
  /**
   * @deprecated The app is EUR; amounts format via lib/format-money using the
   * ACTIVE LOCALE. This prop is IGNORED (a user's language never changes the
   * currency — $/AED was a bug). Kept only for call-site compatibility.
   */
  currency?: string
  /** Top-left ribbon, e.g. "Nouveau", "Promo -20%". */
  ribbon?: { label: string; tone?: 'primary' | 'success' | 'danger' | 'dark' }
  /** Optional click handler — turns the whole card into a button. */
  onClick?: () => void
  layout?: RestaurantCardLayout
  /** Show a closed/unavailable overlay. */
  unavailable?: boolean
  /** Label for free delivery (i18n). Defaults to French "Gratuit". */
  freeLabel?: string
  /** Label for the closed overlay (i18n). Defaults to French "Fermé". */
  closedLabel?: string
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
  timeBadge,
  closedLabel = 'Fermé',
}: {
  cover?: string | null
  name: string
  className?: string
  unavailable?: boolean
  ribbon?: RestaurantCardProps['ribbon']
  /** Optional overlay pill showing the delivery time (min) on the cover (grid only). */
  timeBadge?: number
  closedLabel?: string
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
          className="absolute inset-0 grid place-items-center text-white/90 font-gb-display font-bold text-2xl drop-shadow"
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

      {typeof timeBadge === 'number' && (
        <span className="absolute bottom-2 left-2 z-10 inline-flex items-center gap-1 rounded-gb-full bg-white/95 px-2 py-1 text-[11px] font-bold text-gb-content shadow-gb-sm">
          <Clock size={11} /> {timeBadge} min
        </span>
      )}

      {unavailable && (
        <div className="absolute inset-0 z-10 bg-black/55 grid place-items-center">
          <span className="px-3 py-1 rounded-gb-full bg-white/95 text-gb-content text-xs font-bold">
            {closedLabel}
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
  freeLabel = 'Gratuit',
  hideTime,
}: Pick<RestaurantCardProps, 'rating' | 'reviewCount' | 'deliveryTime' | 'deliveryFee' | 'currency' | 'freeLabel'> & {
  /** Hide the inline delivery-time chip (when it is shown as a cover overlay instead). */
  hideTime?: boolean
}) {
  const locale = useLocale()
  return (
    <div className="flex items-center gap-3 text-xs text-gb-content-muted">
      {typeof rating === 'number' && rating > 0 && (
        <StarRating value={rating} size="sm" reviewCount={reviewCount} />
      )}
      {!hideTime && typeof deliveryTime === 'number' && (
        <span className="inline-flex items-center gap-1 font-medium">
          <Clock size={12} />
          {deliveryTime} min
        </span>
      )}
      {typeof deliveryFee === 'number' && (
        <span className="inline-flex items-center gap-1 font-medium">
          <Bike size={12} />
          {deliveryFee === 0 ? freeLabel : formatEuros(deliveryFee, locale)}
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
    freeLabel,
    closedLabel,
    className,
    ...rest
  },
  ref,
) {
  const locale = useLocale()
  const interactive = typeof onClick === 'function'

  const wrapperBase =
    'bg-gb-surface-elevated border border-gb-stroke overflow-hidden ' +
    'transition-all duration-150'

  const interactiveClasses = interactive
    ? 'cursor-pointer hover:-translate-y-0.5 hover:shadow-gb-md active:scale-[0.99] ' +
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gb-accent'
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
          'flex gap-3 p-3 rounded-gb-lg shadow-gb-sm',
          interactiveClasses,
          className,
        )}
        {...rest}
      >
        <CoverArea cover={cover} name={name} ribbon={ribbon} unavailable={unavailable} closedLabel={closedLabel} className="h-24 w-24 rounded-gb-md shrink-0" />
        <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
          <div>
            <h3 className="font-gb-display font-bold text-base text-gb-content truncate">{name}</h3>
            {cuisine && <p className="text-xs text-gb-content-muted truncate">{cuisine}</p>}
          </div>
          <MetaRow rating={rating} reviewCount={reviewCount} deliveryTime={deliveryTime} deliveryFee={deliveryFee} currency={currency} freeLabel={freeLabel} />
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
          'rounded-gb-xl shadow-gb-md',
          interactiveClasses,
          className,
        )}
        {...rest}
      >
        <CoverArea cover={cover} name={name} ribbon={ribbon} unavailable={unavailable} closedLabel={closedLabel} className="h-56" />
        <div className="p-5 flex flex-col gap-2">
          <h2 className="font-gb-display font-bold text-2xl text-gb-content">{name}</h2>
          {cuisine && <p className="text-sm text-gb-content-muted">{cuisine}</p>}
          <div className="mt-1">
            <MetaRow rating={rating} reviewCount={reviewCount} deliveryTime={deliveryTime} deliveryFee={deliveryFee} currency={currency} freeLabel={freeLabel} />
          </div>
          {typeof minOrder === 'number' && minOrder > 0 && (
            <p className="text-xs text-gb-content-muted mt-1">
              Min. {formatEuros(minOrder, locale)}
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
        'rounded-gb-xl shadow-gb-md',
        interactiveClasses,
        className,
      )}
      {...rest}
    >
      <CoverArea cover={cover} name={name} ribbon={ribbon} timeBadge={deliveryTime} unavailable={unavailable} closedLabel={closedLabel} className="h-40" />
      <div className="p-4 flex flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-gb-display font-bold text-lg text-gb-content leading-tight line-clamp-1">{name}</h3>
        </div>
        {cuisine && <p className="text-xs text-gb-content-muted line-clamp-1">{cuisine}</p>}
        <MetaRow rating={rating} reviewCount={reviewCount} deliveryTime={deliveryTime} deliveryFee={deliveryFee} currency={currency} freeLabel={freeLabel} hideTime />
      </div>
    </div>
  )
})

export default RestaurantCard
