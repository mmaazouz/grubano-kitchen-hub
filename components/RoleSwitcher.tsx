'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Link, usePathname } from '@/navigation'
import { LayoutGrid, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { spacesForRoles, currentSpace, type RoleSpace } from '@/lib/role-spaces'

// ── <RoleSwitcher /> — multi-role space selector (Phase 4 refonte, Agent 14) ──
//
// Self-contained: reads the role SET from the session (GET /api/auth/session — no
// SessionProvider needed, so it drops into ANY shell), maps it to the spaces the
// user can reach (lib/role-spaces) and lets them switch. DISPLAY ONLY — it never
// grants access (middleware is the gate) and never lists a space for a role the
// user does not hold. A MONO-role user (≤1 space) renders NOTHING (no switcher).
// The current space is detected from the pathname, so hosts just drop it in.
//
// `tone`: 'dark' for the dark sidebars (operator / creator), 'light' for the
// consumer account screen. Reuses the existing palette tokens — no new visual
// language.

export default function RoleSwitcher({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  const t = useTranslations('roleSwitcher')
  const pathname = usePathname()
  const [spaces, setSpaces] = useState<RoleSpace[]>([])

  useEffect(() => {
    let cancelled = false
    fetch('/api/auth/session', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (cancelled) return
        const roles = (s?.user as { roles?: string[] } | undefined)?.roles
        setSpaces(spacesForRoles(roles))
      })
      .catch(() => { /* anonymous / error → no switcher */ })
    return () => { cancelled = true }
  }, [])

  // Mono-space (or not loaded yet) → no switcher at all.
  if (spaces.length <= 1) return null

  const current = currentSpace(pathname, spaces)
  const dark = tone === 'dark'

  return (
    <div className={cn('px-3 py-3', dark && 'border-b border-white/10')}>
      <p className={cn(
        'px-1 mb-1.5 text-[9px] font-bold uppercase tracking-widest',
        dark ? 'text-white/30' : 'text-grubano-ink-faint',
      )}>
        {t('title')}
      </p>
      <div className="space-y-0.5">
        {spaces.map((sp) => {
          const active = current?.key === sp.key
          return (
            <Link
              key={sp.key}
              href={sp.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                active
                  ? (dark ? 'bg-grubano-primary text-white' : 'bg-grubano-tint text-grubano-primary')
                  : (dark ? 'text-white/60 hover:bg-white/10 hover:text-white'
                          : 'text-grubano-ink-muted hover:bg-grubano-surface-muted hover:text-grubano-ink'),
              )}
            >
              <span className="flex items-center gap-2 min-w-0">
                <LayoutGrid size={15} className="shrink-0" />
                <span className="truncate">{t(sp.labelKey)}</span>
              </span>
              {active && <Check size={14} className="shrink-0" />}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
