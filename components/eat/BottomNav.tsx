'use client'

import { useTranslations } from 'next-intl'
import { Link, usePathname } from '@/navigation'
import { useEffect, useState } from 'react'
import { Home, Search, Heart, ShoppingBag, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { cartCount, CART_EVENT } from '@/lib/eat-cart'

interface NavItem {
  href: string
  icon: typeof Home
  labelKey: string
  isCart?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { href: '/eat', icon: Home, labelKey: 'home' },
  // 2nd destination already routes to the EXISTING search screen — relabelled
  // « Recherche » with the magnifier icon to match Claude Design (no new route).
  { href: '/eat/search', icon: Search, labelKey: 'search' },
  { href: '/eat/favorites', icon: Heart, labelKey: 'favorites' },
  { href: '/eat/cart', icon: ShoppingBag, labelKey: 'cart', isCart: true },
  { href: '/eat/account', icon: User, labelKey: 'profile' },
]

// Deep / immersive screens that hide the tab bar (Bolt = Stack screens).
const HIDDEN_PREFIXES = ['/eat/r/', '/eat/track', '/eat/dish/', '/eat/splash', '/eat/promos']

export default function BottomNav() {
  const t = useTranslations('eat.nav')
  const pathname = usePathname()
  const [count, setCount] = useState(0)

  useEffect(() => {
    const sync = () => setCount(cartCount())
    sync()
    window.addEventListener(CART_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(CART_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [pathname])

  const isActive = (href: string) => pathname === href || (href !== '/eat' && pathname.startsWith(href))
  // Immersive screens hide the MOBILE bottom bar (unchanged behaviour). The desktop
  // rail stays persistent (≥lg) — same items, routes, active state and cart count.
  const hideBottomBar = HIDDEN_PREFIXES.some((p) => pathname.startsWith(p))

  return (
    <>
      {/* ── Desktop left rail (≥lg) — persistent. Same destinations as the mobile bar.
          Surface = the warm canvas (bg-gb-surface), delineated by a hairline border —
          part of the app, not a disconnected white panel. The ACTIVE destination is a
          raised white pill with accent-strong text/icon (WCAG 4.96:1). */}
      <aside className="fixed left-0 top-0 z-50 hidden h-screen w-[240px] flex-col border-r border-gb-stroke bg-gb-surface px-4 py-6 lg:flex">
        <Link href="/eat" className="mb-8 flex items-center gap-2.5 px-2" aria-label="Grubano">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/grubano-symbol-color.svg" alt="" className="h-9 w-9" />
          <span className="font-gb-display text-xl font-extrabold text-gb-content">Grubano</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-1">
          {NAV_ITEMS.map(({ href, icon: Icon, labelKey, isCart }) => {
            const active = isActive(href)
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  'flex items-center gap-3 rounded-gb-lg px-3 py-2.5 font-gb-sans text-[15px] transition-colors',
                  active
                    ? 'bg-gb-surface-elevated font-semibold text-gb-accent-strong shadow-gb-sm'
                    : 'font-medium text-gb-oat-600 hover:bg-gb-surface-elevated hover:text-gb-content',
                )}
              >
                <Icon size={22} strokeWidth={2} />
                <span className="flex-1">{t(labelKey)}</span>
                {isCart && count > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-gb-full bg-gb-accent-strong px-1.5 text-[11px] font-bold text-white">
                    {count > 9 ? '9+' : count}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>
        {/* The « Gold · pts » card from the desktop reference needs loyalty data the
            layout does not load, and the ossature must never fetch — so it is DEFERRED
            to a per-screen pass (the Profile tab already routes to the loyalty wallet). */}
      </aside>

      {/* ── Mobile bottom bar (<lg) — hidden on immersive screens (unchanged). */}
      {!hideBottomBar && (
        <nav
          className="fixed bottom-0 left-1/2 z-50 flex h-[60px] w-full max-w-[480px] -translate-x-1/2 items-stretch justify-around border-t border-gb-stroke bg-gb-surface-elevated lg:hidden"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {NAV_ITEMS.map(({ href, icon: Icon, labelKey, isCart }) => {
            const active = isActive(href)
            return (
              <Link
                key={href}
                href={href}
                className="flex flex-1 flex-col items-center justify-center gap-1 transition-transform duration-150 active:scale-90"
              >
                <span className="relative">
                  <Icon size={23} strokeWidth={2} className={active ? 'text-gb-accent-strong' : 'text-gb-content-muted'} />
                  {isCart && count > 0 && (
                    <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-gb-full bg-gb-accent-strong px-1 text-[9px] font-bold text-white">
                      {count > 9 ? '9+' : count}
                    </span>
                  )}
                </span>
                <span className={cn('font-gb-sans text-[11px] font-medium', active ? 'text-gb-accent-strong' : 'text-gb-content-muted')}>
                  {t(labelKey)}
                </span>
              </Link>
            )
          })}
        </nav>
      )}
    </>
  )
}
