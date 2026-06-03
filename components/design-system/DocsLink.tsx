'use client'

/**
 * DocsLink — contextual help link from any app surface to docs.grubano.com.
 *
 * Brick B2 of the App↔Docs system. Reads a frozen, locally-embedded snapshot
 * of the docs-map contract (lib/docs-map.ts) so resolution is zero-latency,
 * CORS-safe, and tolerant of docs-site outages. The snapshot is re-synced via
 * `node scripts/sync-docs-map.js` whenever the docs team bumps a topic.
 *
 * Locale resolution: uses the user's app locale if the docs site supports it,
 * otherwise falls back to the docs primary locale (today: "fr"). The link
 * ALWAYS resolves to a usable URL — unknown topic keys point to the docs home
 * for the user's resolved locale (no broken links).
 *
 * Behaviour: always opens in a new tab (rel="noopener noreferrer") so the
 * user never loses their place in the app.
 *
 * Usage:
 *   <DocsLink topic="restaurant.stocks" />                            // default "link" variant
 *   <DocsLink topic="restaurant.stocks" variant="icon" />             // small "?" next to a section title
 *   <DocsLink topic="restaurant.stocks" label="Aide sur les stocks" /> // override default label
 *
 * @see lib/docs-map.ts — the embedded snapshot
 * @see scripts/sync-docs-map.js — refresher
 */

import * as React from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { ExternalLink, HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { resolveDocsUrl, isKnownDocsTopic, type DocsTopic } from '@/lib/docs-map'

export type DocsLinkVariant = 'link' | 'icon'

export interface DocsLinkProps extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, 'href' | 'target' | 'rel'> {
  /** Topic key from the published docs-map contract (see lib/docs-map.ts). */
  topic: DocsTopic | (string & {})  // string & {} = allow free strings without losing autocompletion on known topics
  /** Visual variant. Defaults to "link" (text + arrow). */
  variant?: DocsLinkVariant
  /** Override the default localised label ("En savoir plus" / "Aide"). */
  label?: string
  /** Custom aria-label for accessibility (defaults to label). */
  'aria-label'?: string
}

export const DocsLink = React.forwardRef<HTMLAnchorElement, DocsLinkProps>(function DocsLink(
  {
    topic,
    variant = 'link',
    label,
    className,
    'aria-label': ariaLabel,
    ...rest
  },
  ref,
) {
  const locale = useLocale()
  const t = useTranslations('docs')

  const url = resolveDocsUrl(topic, locale)

  // Dev-only console hint when we silently fall back to the docs home.
  if (process.env.NODE_ENV !== 'production' && !isKnownDocsTopic(topic)) {
    // eslint-disable-next-line no-console
    console.warn(
      `[DocsLink] Unknown topic "${topic}" — falling back to docs home. ` +
      'Update lib/docs-map.ts (or run node scripts/sync-docs-map.js) if this is a new topic.',
    )
  }

  if (variant === 'icon') {
    const iconLabel = label ?? t('help')
    return (
      <a
        ref={ref}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={ariaLabel ?? iconLabel}
        title={iconLabel}
        className={cn(
          // Subtle round chip; orange accent on hover/focus. Sized to sit
          // comfortably next to an inline title or label.
          'inline-flex h-5 w-5 items-center justify-center rounded-grubano-pill',
          'text-grubano-ink-muted bg-transparent',
          'transition-colors duration-150',
          'hover:text-grubano-primary hover:bg-grubano-tint',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grubano-primary/40',
          'align-middle ms-1',
          className,
        )}
        {...rest}
      >
        <HelpCircle size={14} strokeWidth={2} aria-hidden />
      </a>
    )
  }

  // ── "link" variant (default) — text + external-link icon
  const linkLabel = label ?? t('learnMore')
  return (
    <a
      ref={ref}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={ariaLabel ?? linkLabel}
      className={cn(
        'inline-flex items-center gap-1 text-grubano-sm font-semibold',
        'text-grubano-primary',
        // Underline on hover for "this is a link" affordance, but kept off
        // by default so the chrome stays calm in dense UIs.
        'transition-colors duration-150',
        'hover:text-grubano-primaryHover hover:underline underline-offset-4',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-grubano-primary/40 rounded-grubano-sm',
        className,
      )}
      {...rest}
    >
      <span>{linkLabel}</span>
      <ExternalLink size={14} strokeWidth={2.25} aria-hidden />
    </a>
  )
})

export default DocsLink
