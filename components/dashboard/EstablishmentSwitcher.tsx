'use client'

import { useState, useRef, useEffect, useTransition } from 'react'
import { useRouter } from '@/navigation'
import { useTranslations } from 'next-intl'
import { Store, ChevronDown, Check, Loader2 } from 'lucide-react'
import {
  ESTABLISHMENT_COOKIE,
  ESTABLISHMENT_COOKIE_MAX_AGE,
} from '@/lib/establishment'

export interface EstablishmentOption {
  id:    string
  name:  string
  city?: string | null
}

/**
 * Header dropdown to switch the operator's active establishment.
 *
 * The choice is written to a durable, non-HttpOnly cookie and the route is
 * refreshed (router.refresh) so the server components re-read the cookie and
 * re-fetch their data for the newly-selected establishment.
 *
 * MONO behaviour (the whole point of "no visible change at N=1"): with 0 or 1
 * establishment there is nothing to switch, so the component renders NOTHING —
 * no DOM, no spacing, no chrome. Existing single-restaurant operators see the
 * page exactly as before.
 */
export default function EstablishmentSwitcher({
  establishments,
  currentId,
}: {
  establishments: EstablishmentOption[]
  currentId:      string
}) {
  const t = useTranslations('establishment')
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const ref = useRef<HTMLDivElement>(null)

  // Close the menu on any outside click.
  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // Nothing to switch → render nothing (mono-establishment invisibility).
  if (establishments.length <= 1) return null

  const current = establishments.find((e) => e.id === currentId) ?? establishments[0]

  function choose(id: string) {
    setOpen(false)
    if (id === currentId) return
    // Durable, path-wide, lax cookie. Read server-side on the next refresh.
    document.cookie =
      `${ESTABLISHMENT_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=${ESTABLISHMENT_COOKIE_MAX_AGE}; samesite=lax`
    startTransition(() => router.refresh())
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-2 rounded-grubano-md border border-grubano-border bg-grubano-surface px-3 py-2 text-sm font-semibold text-grubano-ink transition hover:border-grubano-primary"
      >
        {pending
          ? <Loader2 size={15} className="animate-spin text-grubano-primary" />
          : <Store size={15} className="text-grubano-primary" />}
        <span className="max-w-[140px] truncate">{current.name}</span>
        <ChevronDown size={14} className={`text-grubano-ink-muted transition ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute end-0 z-50 mt-1.5 w-60 overflow-hidden rounded-grubano-lg border border-grubano-border bg-grubano-surface shadow-grubano-lg"
        >
          <p className="px-3 pb-1 pt-2.5 text-[10px] font-bold uppercase tracking-wider text-grubano-ink-faint">
            {t('label')}
          </p>
          <ul className="max-h-72 overflow-y-auto py-1">
            {establishments.map((e) => {
              const active = e.id === current.id
              return (
                <li key={e.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => choose(e.id)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-start text-sm transition hover:bg-grubano-tint ${
                      active ? 'text-grubano-primary' : 'text-grubano-ink'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-semibold">{e.name}</span>
                      {e.city ? <span className="ms-1 text-xs text-grubano-ink-muted">· {e.city}</span> : null}
                    </span>
                    {active && <Check size={15} className="shrink-0 text-grubano-primary" />}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
