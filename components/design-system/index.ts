/**
 * Grubano Design System — public API.
 *
 * Other agents (2 / 3 / 4) should import from this barrel:
 *
 *   import { Button, RestaurantCard, useToast } from '@/components/design-system'
 *
 * Owner: Agent 6. API contract: components/design-system/README.md
 */

export { Avatar }        from './Avatar'
export { Badge }         from './Badge'
export { Button }        from './Button'
export { Card }          from './Card'
export { CategoryPill }  from './CategoryPill'
export { DishCard }      from './DishCard'
export { EmptyState }    from './EmptyState'
export { Input }         from './Input'
export { Modal }         from './Modal'
export { OrderCard }     from './OrderCard'
export { PriceTag }      from './PriceTag'
export { RestaurantCard } from './RestaurantCard'
export {
  Skeleton,
  SkeletonCard,
  SkeletonRow,
  SkeletonList,
} from './SkeletonLoader'
export { StarRating }    from './StarRating'
export { ToastProvider, useToast } from './Toast'
export { LanguageSwitcher } from './LanguageSwitcher'

// ── Re-export prop types for external consumers ─────────────────────────────
export type { AvatarProps, AvatarSize }         from './Avatar'
export type { BadgeProps, BadgeTone, BadgeSize } from './Badge'
export type { ButtonProps, ButtonVariant, ButtonSize } from './Button'
export type { CardProps, CardElevation, CardPadding } from './Card'
export type { CategoryPillProps, CategoryPillSize } from './CategoryPill'
export type { DishCardProps, DishLayout }       from './DishCard'
export type { EmptyStateProps }                 from './EmptyState'
export type { InputProps }                      from './Input'
export type { ModalProps, ModalSize }           from './Modal'
export type { OrderCardProps, OrderCardItem, OrderStatus } from './OrderCard'
export type { PriceTagProps, PriceSize }        from './PriceTag'
export type { RestaurantCardProps, RestaurantCardLayout } from './RestaurantCard'
export type { SkeletonProps }                   from './SkeletonLoader'
export type { StarRatingProps, StarSize }       from './StarRating'
export type { ToastVariant, ToastOptions }      from './Toast'
export type { LanguageSwitcherProps }           from './LanguageSwitcher'
