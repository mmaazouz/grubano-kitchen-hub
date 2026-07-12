'use client'

import { Fragment } from 'react'
import { ChevronRight } from 'lucide-react'
import { Link } from '@/navigation'
import { cn } from '@/lib/utils'

// ── Sober dashboard breadcrumb (C13-2) ────────────────────────────────────────
// A low-emphasis "fil d'Ariane" for the establishment → brand → menu spine.
// Built from existing primitives only (lucide + locale-aware Link) — NOT placed
// in components/design-system (Agent 6's territory). If Agent 6 wants to promote
// it to a DS primitive later, the props below are the contract.
//
// • Each crumb with an `href` is a link; the LAST crumb (or any without href) is
//   rendered as the current page (aria-current), de-emphasised but not a link.
// • Direction-safe: the row follows the document `dir`, and the chevron flips
//   under RTL via the `rtl:` variant (no-op if the variant is not enabled).

export type Crumb = { label: string; href?: string }

export function Breadcrumb({ items, className }: { items: Crumb[]; className?: string }) {
  const visible = items.filter(Boolean)
  if (visible.length === 0) return null

  return (
    <nav aria-label="Fil d'Ariane" className={cn('min-w-0', className)}>
      <ol className="flex flex-wrap items-center gap-1 text-[12px] leading-none">
        {visible.map((c, i) => {
          const isLast = i === visible.length - 1
          const linked = Boolean(c.href) && !isLast
          return (
            <Fragment key={`${c.label}-${i}`}>
              <li className="min-w-0">
                {linked ? (
                  <Link
                    href={c.href as string}
                    className="truncate font-medium text-muted-foreground transition-colors hover:text-primary"
                  >
                    {c.label}
                  </Link>
                ) : (
                  <span
                    aria-current={isLast ? 'page' : undefined}
                    className={cn(
                      'truncate',
                      isLast ? 'font-semibold text-foreground' : 'text-muted-foreground',
                    )}
                  >
                    {c.label}
                  </span>
                )}
              </li>
              {!isLast && (
                <li aria-hidden className="text-muted-foreground/40">
                  <ChevronRight size={13} className="shrink-0 rtl:rotate-180" />
                </li>
              )}
            </Fragment>
          )
        })}
      </ol>
    </nav>
  )
}

export default Breadcrumb
