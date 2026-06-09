'use client'

import { useTranslations } from 'next-intl'
import { Ticket } from 'lucide-react'
import { reservationLabel } from '@/lib/reservation-code'

// ── <SessionBadge /> — short reservation code (#A3F2) or walk-in pill ────────
//
// The anchor of a service across the entire UI (operator's list/plan/addition,
// guest's /t and /eat/account). Same id → same code via lib/reservation-code.
// Two visual variants:
//   - `subtle`  (default): small, sober — used inside dense rows.
//   - `large`           : prominent — used as the session header on the
//                          addition view, the /t landing, and the consumer
//                          /eat/account modal.

export interface SessionBadgeProps {
  /** The reservation id whose code we want to render. `null` / empty →
   *  walk-in pill (no code, sober label). */
  reservationId: string | null | undefined
  /** Visual weight. Defaults to subtle (in-list usage). */
  variant?: 'subtle' | 'large'
  className?: string
}

export default function SessionBadge({
  reservationId, variant = 'subtle', className = '',
}: SessionBadgeProps) {
  const t = useTranslations('session')
  const label = reservationLabel(reservationId)

  if (label.kind === 'walkin') {
    return (
      <span
        title={t('codeTooltip')}
        className={[
          'inline-flex items-center gap-1 rounded-full font-bold uppercase tracking-wider',
          variant === 'large'
            ? 'bg-muted px-3 py-1 text-[12px] text-muted-foreground'
            : 'bg-muted px-2 py-0.5 text-[10px] text-muted-foreground',
          className,
        ].join(' ')}
      >
        <Ticket size={variant === 'large' ? 13 : 10} className="opacity-70" />
        {t('walkin')}
      </span>
    )
  }

  return (
    <span
      title={t('codeTooltip')}
      className={[
        'inline-flex items-center gap-1 rounded-full font-mono font-bold',
        variant === 'large'
          ? 'bg-primary/10 px-3 py-1 text-[13px] text-primary'
          : 'bg-primary/10 px-2 py-0.5 text-[11px] text-primary',
        className,
      ].join(' ')}
    >
      <Ticket size={variant === 'large' ? 13 : 10} className="opacity-80" />
      {label.value}
    </span>
  )
}
