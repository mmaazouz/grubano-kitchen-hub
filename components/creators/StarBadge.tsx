'use client'

import { Star } from 'lucide-react'
import { useTranslations } from 'next-intl'

// ── ⭐ Étoiles Grubano — shared display (Mission 4) ─────────────────────────────
//
// DOCTRINE: the stars are ledger-proven commercial performance. ZERO stars ⇒ we
// render NOTHING on public surfaces (absence is the signal — never « 0 étoile »).
// The studio is the only place that shows progression toward the next star.

const MAX_STARS = 3

/** Row of filled stars (1..3). `stars <= 0` ⇒ renders nothing. */
export function StarBadge({
  stars,
  size = 13,
  className = '',
}: {
  stars: number
  size?: number
  className?: string
}) {
  const t = useTranslations('creators.stars')
  const n = Math.max(0, Math.min(MAX_STARS, Math.round(stars)))
  if (n <= 0) return null
  return (
    <span
      className={`inline-flex items-center gap-0.5 align-middle ${className}`}
      title={t('legend')}
      aria-label={t('aria', { count: n })}
    >
      {Array.from({ length: n }, (_, i) => (
        <Star key={i} size={size} className="text-amber-400" fill="currentColor" strokeWidth={0} />
      ))}
    </span>
  )
}

/** Visual-only star row used inside the studio progress card (no a11y label —
 *  the surrounding text carries the meaning). Always renders `n` filled stars. */
function StarRow({ n, size = 14 }: { n: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {Array.from({ length: Math.max(0, n) }, (_, i) => (
        <Star key={i} size={size} className="text-amber-400" fill="currentColor" strokeWidth={0} />
      ))}
    </span>
  )
}

export type StarProgressShape = {
  nextStar: 1 | 2 | 3 | null
  missingRestaurants: number
  missingSales: number
}

/** Studio « Vos étoiles » card: current stars + progression to the next level.
 *  Renders even at 0 stars (the studio shows the path to ⭐ — never on public). */
export function StarProgressCard({
  stars,
  progress,
  className = '',
}: {
  stars: number
  progress: StarProgressShape
  className?: string
}) {
  const t = useTranslations('creators.stars')
  const n = Math.max(0, Math.min(MAX_STARS, Math.round(stars)))

  let body: React.ReactNode
  if (progress.nextStar === null) {
    body = <p className="text-[12px] text-grubano-ink-soft">{t('maxReached')}</p>
  } else {
    const needR = progress.missingRestaurants > 0
    const needS = progress.missingSales > 0
    const line = needR && needS
      ? t('progressBoth', { restos: progress.missingRestaurants, sales: progress.missingSales })
      : needR
        ? t('progressRestos', { restos: progress.missingRestaurants })
        : needS
          ? t('progressSales', { sales: progress.missingSales })
          : t('progressAlmost')
    body = (
      <div className="flex flex-wrap items-center gap-1.5">
        <p className="text-[12px] text-grubano-ink-soft">{line}</p>
        <StarRow n={progress.nextStar} size={13} />
      </div>
    )
  }

  return (
    <div className={`rounded-2xl border border-grubano-line bg-white p-4 ${className}`}>
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-wider text-grubano-ink-faint">
          {t('studioTitle')}
        </p>
        {n > 0
          ? <StarRow n={n} size={16} />
          : <span className="text-[12px] text-grubano-ink-faint">{t('none')}</span>}
      </div>
      <div className="mt-2">
        {n <= 0 && progress.nextStar === 1 && (
          <p className="mb-1 text-[12px] text-grubano-ink-soft">{t('firstStar')}</p>
        )}
        {body}
      </div>
      <p className="mt-3 text-[10px] text-grubano-ink-faint">{t('legend')}</p>
    </div>
  )
}
