// ── Stellar Unity design-system barrel (consumer redesign, Agent 128) ──────────
// NEW namespace, separate from components/design-system (untouched). Every primitive
// is styled with the scoped `stellar-*` Tailwind tokens and renders only inside a
// `.grubano-v2` subtree. NO money, NO data.
export { StellarButton, type StellarButtonProps, type StellarButtonVariant, type StellarButtonSize } from './Button'
export { StellarCard, type StellarCardProps } from './Card'
export { StellarBadge, type StellarBadgeProps, type StellarBadgeTone } from './Badge'
export { StellarInput, type StellarInputProps } from './Input'
export { StellarPriceTag, type StellarPriceTagProps } from './PriceTag'
export { StellarRestaurantCard, type StellarRestaurantCardProps } from './RestaurantCard'
export { StellarLogo, type StellarLogoProps, type StellarLogoVariant } from './StellarLogo'
