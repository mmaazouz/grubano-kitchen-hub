'use client'

import { BadgeCheck } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Link } from '@/navigation'

export interface CreatorBadgeData {
  id: string
  name: string
  verified: boolean
  followers: number
  /** referralLinkSlug ?? referralCode — drives the public profile URL. */
  slug: string | null
}

interface CreatorBadgeProps {
  creator: CreatorBadgeData
  /** Visual variant. "compact" = single chip (default, fits the DishCard meta
   *  slot). "row" = larger, used on the public page hero or stand-alone. */
  variant?: 'compact' | 'row'
}

/** Compact follower count: 48000 → "48k", 1234567 → "1,2M". */
function formatFollowers(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace('.', ',')}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1).replace('.', ',')}M`
}

/**
 * Clickable badge attached to an adopted creator recipe on the consumer menu.
 *
 * - Navigates to the creator's public page (`/eat/c/{slug}`) so the customer
 *   can discover their other recipes (lever 4-bis B).
 * - `stopPropagation` so a tap inside a DishCard's meta slot doesn't bubble
 *   up and open the dish customisation modal.
 * - Falls back to a non-link visual when the creator has no slug (defensive —
 *   the API always provides a slug today, but this keeps the UI safe).
 */
export default function CreatorBadge({ creator, variant = 'compact' }: CreatorBadgeProps) {
  const t = useTranslations('eat.creator')
  const followers = formatFollowers(creator.followers)

  const inner = (
    <>
      <BadgeCheck
        size={variant === 'row' ? 16 : 13}
        className={creator.verified ? 'text-grubano-primary' : 'text-grubano-ink-faint'}
        strokeWidth={2.4}
      />
      <span className="truncate">
        <span className="text-grubano-ink-muted">{t('signedBy')} </span>
        <span className="font-bold text-grubano-ink">{creator.name}</span>
        {followers && (
          <span className="ml-1.5 text-grubano-ink-faint">· {followers}</span>
        )}
      </span>
    </>
  )

  const base =
    variant === 'row'
      ? 'inline-flex items-center gap-2 rounded-grubano-pill bg-grubano-tint px-3 py-1.5 text-grubano-sm shadow-grubano-sm'
      : 'inline-flex items-center gap-1.5 rounded-grubano-pill bg-grubano-tint px-2 py-0.5 text-[11px] max-w-full'

  if (!creator.slug) {
    return <span className={base} aria-label={t('signedBy') + ' ' + creator.name}>{inner}</span>
  }

  return (
    <Link
      href={`/eat/c/${creator.slug}`}
      onClick={(e) => e.stopPropagation()}
      className={`${base} transition-colors hover:bg-grubano-primary/15 active:scale-[0.98]`}
      aria-label={`${t('signedBy')} ${creator.name} — ${t('seeProfile')}`}
    >
      {inner}
    </Link>
  )
}
