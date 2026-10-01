'use client'

import { useTranslations } from 'next-intl'
import { Link, usePathname } from '@/navigation'

// ── /eat-next bottom nav (Agent 127 wireframe → Agent 129 Stellar → Agent 135 i18n) ──
// Dressed with Stellar tokens (resolves inside the layout's .grubano-v2 wrapper):
// active = stellar primary (green), Plus Jakarta Sans. 4 destinations.
const ITEMS = [
  { href: '/eat-next',        key: 'home' },
  { href: '/eat-next/search', key: 'search' },
  { href: '/eat-next/cart',   key: 'cart' },
  { href: '/eat-next/track',  key: 'track' },
] as const

export default function WireframeNav() {
  const t = useTranslations('eatNext.nav')
  const pathname = usePathname()
  return (
    <nav className="fixed bottom-0 left-1/2 z-50 w-full max-w-[480px] -translate-x-1/2 border-t border-stellar-border bg-stellar-bg">
      <ul className="flex">
        {ITEMS.map((it) => {
          const active = pathname === it.href || (it.href !== '/eat-next' && pathname.startsWith(it.href))
          return (
            <li key={it.href} className="flex-1">
              <Link
                href={it.href}
                className={`flex h-14 flex-col items-center justify-center font-stellar-display text-xs ${active ? 'font-bold text-stellar-primary' : 'text-stellar-muted-fg'}`}
              >
                <span className={`mb-0.5 h-5 w-5 rounded-stellar-sm ${active ? 'bg-stellar-primary' : 'bg-stellar-surface-2'}`} aria-hidden />
                {t(it.key)}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
